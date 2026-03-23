#!/usr/bin/env python3
"""보험사별 순차 크롤링 파이프라인.

각 보험사에 대해 수집 → 인제스트 → 임베딩 → 기록을 순차적으로 실행한다.

Usage:
    python scripts/run_crawl_pipeline.py
    python scripts/run_crawl_pipeline.py --companies heungkuk_fire axa_general
    python scripts/run_crawl_pipeline.py --skip-crawl   # 인제스트+임베딩만
    python scripts/run_crawl_pipeline.py --skip-embed   # 크롤링+인제스트만
    python scripts/run_crawl_pipeline.py --resume       # 미완료 회사만 재시도
"""
from __future__ import annotations

import argparse
import json
import logging
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

_project_root = Path(__file__).parent.parent
PYTHON = sys.executable
PROGRESS_FILE = _project_root / "data" / "pipeline_progress.json"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("pipeline")

# 손해보험사 처리 순서 (한화는 사이트 점검 중이므로 마지막)
NONLIFE_COMPANIES = [
    "heungkuk_fire",
    "axa_general",
    "mg_insurance",
    "nh_fire",
    "lotte_insurance",
    "hanwha_general",
]


def load_progress() -> dict:
    """pipeline_progress.json 로드. 없으면 빈 dict 반환."""
    if PROGRESS_FILE.exists():
        try:
            return json.loads(PROGRESS_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def save_progress(progress: dict) -> None:
    """pipeline_progress.json 저장."""
    PROGRESS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PROGRESS_FILE.write_text(
        json.dumps(progress, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def run_step(cmd: list[str], step_name: str) -> tuple[bool, str]:
    """명령어를 실행하고 성공 여부와 출력을 반환."""
    logger.info("[%s] 실행: %s", step_name, " ".join(cmd))
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            cwd=_project_root,
            timeout=3600,  # 1시간 타임아웃
        )
        output = result.stdout + result.stderr
        if result.returncode != 0:
            logger.warning("[%s] 종료 코드: %d", step_name, result.returncode)
            logger.warning("[%s] 마지막 출력:\n%s", step_name, output[-2000:])
            return False, output
        logger.info("[%s] 완료 (종료 코드: 0)", step_name)
        return True, output
    except subprocess.TimeoutExpired:
        logger.error("[%s] 타임아웃 (1시간 초과)", step_name)
        return False, "TIMEOUT"
    except Exception as exc:
        logger.error("[%s] 실행 오류: %s", step_name, exc)
        return False, str(exc)


def extract_crawl_count(output: str) -> int:
    """크롤러 출력에서 수집 수 파싱."""
    import re
    m = re.search(r"총\s+(\d+)개\s+PDF\s+수집", output)
    if m:
        return int(m.group(1))
    return -1


def extract_ingest_count(output: str) -> int:
    """인제스트 출력에서 처리 수 파싱."""
    import re
    m = re.search(r"성공[:\s]+(\d+)", output)
    if m:
        return int(m.group(1))
    return -1


def run_company_pipeline(
    company_id: str,
    skip_crawl: bool = False,
    skip_embed: bool = False,
    skip_status_update: bool = False,
) -> dict:
    """단일 보험사 파이프라인 실행. 결과 dict 반환."""
    result = {
        "company_id": company_id,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "crawl": {"status": "skipped", "count": 0, "output_tail": ""},
        "ingest": {"status": "skipped", "count": 0, "output_tail": ""},
        "status_update": {"status": "skipped"},
        "finished_at": None,
        "status": "pending",
    }

    # ── Step 1: 크롤링 ─────────────────────────────────────────
    if not skip_crawl:
        logger.info("=" * 60)
        logger.info("[%s] Step 1/3: 크롤링 시작", company_id)
        ok, out = run_step(
            [PYTHON, "scripts/crawl_nonlife_playwright.py", "--company", company_id],
            f"{company_id}/crawl",
        )
        result["crawl"] = {
            "status": "success" if ok else "failed",
            "count": extract_crawl_count(out),
            "output_tail": out[-1000:],
        }
        if not ok:
            logger.warning("[%s] 크롤링 실패 - 인제스트 단계 건너뜀", company_id)
            result["finished_at"] = datetime.now(timezone.utc).isoformat()
            result["status"] = "crawl_failed"
            return result

    # ── Step 2: 인제스트 + 임베딩 ──────────────────────────────
    logger.info("[%s] Step 2/3: 인제스트 + 임베딩 시작", company_id)
    ingest_cmd = [PYTHON, "scripts/ingest_local_pdfs.py", "--company", company_id]
    if not skip_embed:
        ingest_cmd.append("--embed")

    ok, out = run_step(ingest_cmd, f"{company_id}/ingest")
    result["ingest"] = {
        "status": "success" if ok else "failed",
        "count": extract_ingest_count(out),
        "output_tail": out[-1000:],
    }

    # ── Step 3: 현황 문서 업데이트 ─────────────────────────────
    if not skip_status_update:
        logger.info("[%s] Step 3/3: 현황 문서 업데이트", company_id)
        ok_status, out_status = run_step(
            [PYTHON, "scripts/update_pipeline_status.py", "--company", company_id],
            f"{company_id}/status_update",
        )
        result["status_update"] = {
            "status": "success" if ok_status else "failed",
            "output_tail": out_status[-500:],
        }
        if not ok_status:
            logger.warning("[%s] 현황 문서 업데이트 실패 (파이프라인은 계속)", company_id)

    result["finished_at"] = datetime.now(timezone.utc).isoformat()
    result["status"] = "completed" if ok else "ingest_failed"
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="보험사별 순차 크롤링 파이프라인")
    parser.add_argument("--companies", nargs="+", default=None, help="처리할 회사 ID 목록 (기본: 전체)")
    parser.add_argument("--skip-crawl", action="store_true", help="크롤링 건너뜀 (인제스트+임베딩만)")
    parser.add_argument("--skip-embed", action="store_true", help="임베딩 건너뜀 (크롤링+인제스트만)")
    parser.add_argument("--resume", action="store_true", help="이미 completed 상태인 회사 건너뜀")
    parser.add_argument("--skip-status-update", action="store_true", help="현황 문서 업데이트 건너뜀")
    args = parser.parse_args()

    companies = args.companies or NONLIFE_COMPANIES
    progress = load_progress()

    logger.info("=" * 60)
    logger.info("보험사별 크롤링 파이프라인 시작")
    logger.info("대상: %s", companies)
    logger.info("진행 파일: %s", PROGRESS_FILE)
    logger.info("=" * 60)

    for company_id in companies:
        # resume 모드: 이미 완료된 회사 스킵
        if args.resume and progress.get(company_id, {}).get("status") == "completed":
            logger.info("[%s] 이미 완료됨 - 건너뜀", company_id)
            continue

        logger.info("")
        logger.info("▶ [%s] 파이프라인 시작", company_id)
        result = run_company_pipeline(
            company_id,
            skip_crawl=args.skip_crawl,
            skip_embed=args.skip_embed,
            skip_status_update=args.skip_status_update,
        )

        # 진행 상황 저장
        progress[company_id] = result
        save_progress(progress)

        # 결과 출력
        logger.info("◀ [%s] 파이프라인 완료: %s", company_id, result["status"])
        logger.info("   크롤링: %s (%d개)", result["crawl"]["status"], result["crawl"]["count"])
        logger.info("   인제스트: %s (%d개)", result["ingest"]["status"], result["ingest"]["count"])
        logger.info("   현황문서: %s", result["status_update"]["status"])

    # 최종 요약
    logger.info("")
    logger.info("=" * 60)
    logger.info("파이프라인 전체 완료")
    logger.info("=" * 60)
    completed = sum(1 for r in progress.values() if r.get("status") == "completed")
    failed = sum(1 for r in progress.values() if "failed" in r.get("status", ""))
    logger.info("완료: %d / 실패: %d / 전체: %d", completed, failed, len(companies))

    # 진행 파일 위치 안내
    logger.info("결과 파일: %s", PROGRESS_FILE)


if __name__ == "__main__":
    main()
