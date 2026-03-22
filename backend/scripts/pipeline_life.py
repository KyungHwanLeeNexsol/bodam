#!/usr/bin/env python3
"""생보 크롤링 완료 대기 → 인제스트 → git commit & push 파이프라인."""
from __future__ import annotations

import glob
import logging
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).parent.parent
LOGS_DIR = BACKEND_DIR / "logs"
PYTHON = r"C:\Python313\python.exe"
REPO_ROOT = BACKEND_DIR.parent
POLL_INTERVAL = 30  # 초


def find_latest_crawl_log() -> Path | None:
    logs = sorted(
        LOGS_DIR.glob("crawl_life_*.log"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return logs[0] if logs else None


def is_crawl_done(log_path: Path) -> bool:
    try:
        content = log_path.read_text(encoding="utf-8", errors="replace")
        return "생명보험 크롤링 완료 요약" in content
    except Exception:
        return False


def wait_for_crawl() -> Path:
    logger.info("생보 크롤링 완료 대기 중...")
    while True:
        log = find_latest_crawl_log()
        if log and is_crawl_done(log):
            logger.info("크롤링 완료 감지: %s", log)
            return log
        logger.info("아직 진행 중... %ds 후 재확인", POLL_INTERVAL)
        time.sleep(POLL_INTERVAL)


def run_ingest() -> bool:
    logger.info("=" * 50)
    logger.info("인제스트 시작...")
    log_path = LOGS_DIR / f"ingest_pipeline_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONPATH": str(BACKEND_DIR)}
    with log_path.open("w", encoding="utf-8") as lf:
        result = subprocess.run(
            [PYTHON, "-m", "scripts.ingest_local_pdfs"],
            cwd=BACKEND_DIR,
            env=env,
            stdout=lf,
            stderr=subprocess.STDOUT,
        )
    if result.returncode == 0:
        logger.info("인제스트 완료! 로그: %s", log_path)
        return True
    else:
        logger.error("인제스트 실패 (exit=%d), 로그: %s", result.returncode, log_path)
        return False


def sync_before_push() -> None:
    """git push 전 상태 동기화: 변경 파일 목록 확인 및 CHANGELOG 업데이트."""
    logger.info("=" * 50)
    logger.info("sync: git 상태 확인 중...")

    def run(cmd: list[str]) -> subprocess.CompletedProcess:
        return subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")

    # 변경 파일 목록 출력
    status = run(["git", "status", "--short"])
    logger.info("변경 파일:\n%s", status.stdout.strip())

    # diff --stat 출력
    diff = run(["git", "diff", "--stat", "HEAD"])
    if diff.stdout.strip():
        logger.info("diff stat:\n%s", diff.stdout.strip())

    # CHANGELOG.md 업데이트
    changelog_path = REPO_ROOT / "CHANGELOG.md"
    now = datetime.now().strftime("%Y-%m-%d")
    entry = (
        f"\n## [{now}] - 생보 크롤링 판매중지 지원 및 파이프라인 자동화\n\n"
        "### Added\n"
        "- crawl_life_insurance: 22개 생보사 판매중+판매중지 전체 재수집\n"
        "- crawl_nonlife/kb_insurance/meritz_fire: 판매중지 탭 크롤링 추가\n"
        "- auto_ingest.py: 크롤러 완료 후 자동 인제스트 스크립트\n"
        "- pipeline_life.py: 크롤링→인제스트→sync→git push 자동 파이프라인\n\n"
        "### Changed\n"
        "- ingest_local_pdfs: 연결 오류 처리 개선\n"
        "- crawl_hyundai_marine: 크롤링 안정성 개선\n"
    )

    if changelog_path.exists():
        existing = changelog_path.read_text(encoding="utf-8", errors="replace")
        if now not in existing:
            # 첫 줄(헤더) 이후에 삽입
            lines = existing.splitlines(keepends=True)
            insert_pos = 1 if lines and lines[0].startswith("#") else 0
            lines.insert(insert_pos, entry)
            changelog_path.write_text("".join(lines), encoding="utf-8")
            logger.info("CHANGELOG.md 업데이트 완료")
        else:
            logger.info("CHANGELOG.md 이미 오늘 날짜 항목 있음 - 스킵")
    else:
        changelog_path.write_text(f"# Changelog\n{entry}", encoding="utf-8")
        logger.info("CHANGELOG.md 생성 완료")

    logger.info("sync 완료")


def git_commit_and_push() -> bool:
    logger.info("=" * 50)
    logger.info("git commit & push 시작...")

    def run(cmd: list[str]) -> subprocess.CompletedProcess:
        return subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True)

    # 변경된 파일 스테이징 (CHANGELOG 포함)
    run(["git", "add",
         "backend/scripts/crawl_hyundai_marine.py",
         "backend/scripts/crawl_kb_insurance.py",
         "backend/scripts/crawl_meritz_fire.py",
         "backend/scripts/crawl_nonlife.py",
         "backend/scripts/crawl_nonlife_playwright.py",
         "backend/scripts/ingest_local_pdfs.py",
         "backend/tests/test_config.py",
         "backend/scripts/auto_ingest.py",
         "backend/scripts/wait_and_ingest.sh",
         "backend/scripts/wait_and_ingest2.sh",
         "backend/scripts/pipeline_life.py",
         "CHANGELOG.md",
    ])

    # 커밋
    msg = (
        "feat(crawler): 생보 크롤링 판매중지 탭 지원 및 파이프라인 자동화\n\n"
        "- crawl_life_insurance: 판매중지 상품 포함 전체 수집 재실행\n"
        "- crawl_nonlife: 판매중지 탭 클릭 지원 추가\n"
        "- crawl_kb_insurance: 판매중지 탭 크롤링 추가\n"
        "- crawl_meritz_fire: 판매중지 탭 크롤링 추가\n"
        "- crawl_hyundai_marine: 개선\n"
        "- auto_ingest.py: 크롤러 완료 후 자동 인제스트 스크립트\n"
        "- pipeline_life.py: 크롤링→인제스트→git push 자동 파이프라인\n\n"
        "🗿 MoAI <email@mo.ai.kr>"
    )
    commit_result = run(["git", "commit", "-m", msg])
    if commit_result.returncode != 0:
        logger.warning("커밋 실패 또는 변경사항 없음: %s", commit_result.stderr)
        if "nothing to commit" in commit_result.stdout + commit_result.stderr:
            logger.info("커밋할 변경사항 없음 - push만 진행")
        else:
            logger.error(commit_result.stderr)
            return False
    else:
        logger.info("커밋 완료")

    # 푸시
    push_result = run(["git", "push", "origin", "main"])
    if push_result.returncode == 0:
        logger.info("git push 완료!")
        return True
    else:
        logger.error("push 실패: %s", push_result.stderr)
        return False


def main() -> None:
    logger.info("=" * 50)
    logger.info("파이프라인 시작: 크롤링 → 인제스트 → sync → git push")
    logger.info("=" * 50)

    # 1. 크롤링 완료 대기
    wait_for_crawl()

    # 2. 인제스트
    ingest_ok = run_ingest()
    if not ingest_ok:
        logger.error("인제스트 실패 - git push 중단")
        sys.exit(1)

    # 3. sync (CHANGELOG 업데이트, git 상태 확인)
    sync_before_push()

    # 4. git commit & push
    git_ok = git_commit_and_push()
    if not git_ok:
        logger.error("git push 실패")
        sys.exit(1)

    logger.info("=" * 50)
    logger.info("파이프라인 전체 완료!")
    logger.info("=" * 50)


if __name__ == "__main__":
    main()
