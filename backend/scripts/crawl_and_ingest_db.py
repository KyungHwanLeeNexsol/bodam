#!/usr/bin/env python3
"""DB손해보험 크롤링 + 즉시 인제스트 통합 파이프라인

GitHub Actions 환경에서 로컬 스토리지 없이 실행하기 위한 스크립트.
PDF를 다운로드 후 임시 파일에 저장 → 즉시 인제스트 → 삭제 방식으로
디스크에 최대 1개 파일만 유지.

실행:
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_and_ingest_db
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_and_ingest_db --dry-run
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_and_ingest_db --category 장기-오프라인-건강
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_and_ingest_db --resume-state failure_state.json

# @MX:NOTE: GitHub Actions 전용 통합 파이프라인 - 로컬 스토리지 불필요
# @MX:NOTE: DB손보 5단계 AJAX API: Step2(상품목록) → Step3(판매기간) → Step4(약관파일명) → 다운로드
# @MX:NOTE: 실패 상태 저장: failure_state.json → artifact 업로드 → --resume-state로 재처리
# @MX:SPEC: SPEC-INGEST-001
"""
from __future__ import annotations

import argparse
import asyncio
import gc
import json
import logging
import sys
import tempfile
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import httpx

_project_root = Path(__file__).parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

try:
    from dotenv import load_dotenv
    load_dotenv(_project_root / ".env")
except ImportError:
    pass

if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)

# DB손해보험 API 설정
BASE_URL = "https://www.idbins.com"
STEP2_URL = f"{BASE_URL}/insuPcPbanFindProductStep2_AX.do"
STEP3_URL = f"{BASE_URL}/insuPcPbanFindProductStep3_AX.do"
STEP4_URL = f"{BASE_URL}/insuPcPbanFindProductStep4_AX.do"
DOWNLOAD_URL = f"{BASE_URL}/cYakgwanDown.do"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": f"{BASE_URL}/FWMAIV1534.do",
}

# 질병/상해 관련 카테고리
TARGET_CATEGORIES = [
    {"ln": "장기보험", "sn": "Off-Line", "mn": "간병", "label": "장기-오프라인-간병"},
    {"ln": "장기보험", "sn": "Off-Line", "mn": "건강", "label": "장기-오프라인-건강"},
    {"ln": "장기보험", "sn": "Off-Line", "mn": "상해", "label": "장기-오프라인-상해"},
    {"ln": "장기보험", "sn": "Off-Line", "mn": "질병", "label": "장기-오프라인-질병"},
    {"ln": "장기보험", "sn": "TM/CM", "mn": "간병", "label": "장기-TMCM-간병"},
    {"ln": "장기보험", "sn": "TM/CM", "mn": "건강", "label": "장기-TMCM-건강"},
    {"ln": "장기보험", "sn": "TM/CM", "mn": "상해", "label": "장기-TMCM-상해"},
    {"ln": "장기보험", "sn": "TM/CM", "mn": "질병", "label": "장기-TMCM-질병"},
    {"ln": "장기보험", "sn": "방카슈랑스", "mn": "간병", "label": "장기-방카-간병"},
    {"ln": "장기보험", "sn": "방카슈랑스", "mn": "건강", "label": "장기-방카-건강"},
    {"ln": "장기보험", "sn": "방카슈랑스", "mn": "상해", "label": "장기-방카-상해"},
    {"ln": "장기보험", "sn": "방카슈랑스", "mn": "질병", "label": "장기-방카-질병"},
    {"ln": "일반", "sn": "99", "mn": "상해", "label": "일반-상해"},
]

DEFAULT_FAIL_THRESHOLD = 0.05
FAIL_MIN_SAMPLES = 10
DEFAULT_STATE_PATH = Path("failure_state_db.json")


@dataclass
class FailureRecord:
    """실패 건 상세 정보."""
    product_name: str
    category: str
    url: str
    error_type: str    # step2_failed / step3_failed / step4_failed / download_failed / ingest_failed
    http_status: int | None
    error_msg: str
    timestamp: str = field(default_factory=lambda: datetime.now(tz=timezone.utc).isoformat())


@dataclass
class CrawlState:
    """크롤링 상태 (중단/재시작용)."""
    failures: list[FailureRecord] = field(default_factory=list)
    started_at: str = field(default_factory=lambda: datetime.now(tz=timezone.utc).isoformat())
    stopped_at: str | None = None
    stop_reason: str | None = None

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False, indent=2)

    @classmethod
    def from_json(cls, text: str) -> "CrawlState":
        data = json.loads(text)
        failures = [FailureRecord(**f) for f in data.pop("failures", [])]
        state = cls(**data)
        state.failures = failures
        return state


async def ingest_pdf_bytes(
    session_factory: object,
    pdf_bytes: bytes,
    metadata: dict,
    dry_run: bool = False,
) -> dict:
    """PDF bytes를 임시 파일로 저장 후 인제스트하고 삭제한다."""
    from scripts.ingest_local_pdfs import process_single_file

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(pdf_bytes)
        tmp_path = Path(tmp.name)

    try:
        result = await process_single_file(
            session_factory=session_factory,
            pdf_path=tmp_path,
            metadata=metadata,
            dry_run=dry_run,
        )
    finally:
        if tmp_path.exists():
            tmp_path.unlink()

    return result


async def crawl_category_and_ingest(
    client: httpx.AsyncClient,
    session_factory: object,
    cat: dict[str, str],
    state: CrawlState,
    retry_keys: set[str] | None,
    dry_run: bool = False,
    processed_urls: set[str] | None = None,
) -> dict[str, int]:
    """특정 카테고리 크롤링 + 즉시 인제스트."""
    stats = {"products": 0, "success": 0, "skipped": 0, "failed": 0, "dry_run": 0}
    label = cat["label"]

    # Step 2: 상품 목록 조회 (판매중 + 판매중지)
    products = []
    for sl_yn in ["1", "0"]:
        try:
            resp2 = await client.post(STEP2_URL, json={
                "arc_knd_lgcg_nm": cat["ln"], "sl_chn_nm": cat["sn"],
                "arc_knd_mdcg_nm": cat["mn"], "arc_pdc_sl_yn": sl_yn,
            }, headers={"Content-Type": "application/json"}, timeout=60.0)
            items = resp2.json().get("result", [])
            for item in items:
                item["_sl_yn"] = sl_yn
            products.extend(items)
        except Exception as e:
            logger.error("[%s] Step2 실패 (sl_yn=%s): %s", label, sl_yn, e)
            state.failures.append(FailureRecord(
                product_name=f"[{label}] Step2",
                category=label,
                url=STEP2_URL,
                error_type="step2_failed",
                http_status=None,
                error_msg=str(e),
            ))

    stats["products"] = len(products)
    if not products:
        return stats

    for prod in products:
        pdc_nm = prod.get("PDC_NM", "")
        if not pdc_nm:
            continue

        sl_yn = prod.get("_sl_yn", "1")
        sale_status = "ON_SALE" if sl_yn == "1" else "DISCONTINUED"

        # retry_keys가 지정된 경우 해당 상품만 재처리
        retry_key = f"{label}::{pdc_nm}"
        if retry_keys is not None and retry_key not in retry_keys:
            continue

        # Step 3: 판매기간 조회
        periods = []
        for attempt in range(3):
            try:
                resp3 = await client.post(
                    STEP3_URL,
                    json={"pdc_nm": pdc_nm, "arc_pdc_sl_yn": sl_yn},
                    headers={"Content-Type": "application/json"},
                    timeout=60.0,
                )
                if resp3.status_code == 503:
                    await asyncio.sleep(5.0 * (attempt + 1))
                    continue
                periods = resp3.json().get("result", [])
                break
            except Exception as e:
                logger.debug("Step3 실패 [%s]: %s", pdc_nm[:30], e)
                break

        # sl_yn=0 empty 시 sl_yn=1 폴백
        if not periods and sl_yn == "0":
            try:
                resp3_fb = await client.post(
                    STEP3_URL,
                    json={"pdc_nm": pdc_nm, "arc_pdc_sl_yn": "1"},
                    headers={"Content-Type": "application/json"},
                    timeout=60.0,
                )
                periods = resp3_fb.json().get("result", [])
            except Exception:
                pass

        if not periods:
            logger.warning("[실패] Step3 empty [%s]", pdc_nm[:50])
            stats["failed"] += 1
            state.failures.append(FailureRecord(
                product_name=pdc_nm,
                category=label,
                url=STEP3_URL,
                error_type="step3_failed",
                http_status=None,
                error_msg="Step3 empty (폴백 포함)",
            ))
            continue

        sqno = periods[0].get("SQNO", "")

        # Step 4: 약관 파일명 조회
        files = []
        for attempt in range(3):
            try:
                resp4 = await client.post(
                    STEP4_URL,
                    json={"sqno": str(sqno), "arc_pdc_sl_yn": sl_yn},
                    headers={"Content-Type": "application/json"},
                    timeout=60.0,
                )
                if resp4.status_code == 503:
                    await asyncio.sleep(5.0 * (attempt + 1))
                    continue
                files = resp4.json().get("result", [])
                break
            except Exception as e:
                logger.debug("Step4 실패 [%s]: %s", pdc_nm[:30], e)
                break

        if not files:
            logger.warning("[실패] Step4 empty [%s]", pdc_nm[:50])
            stats["failed"] += 1
            state.failures.append(FailureRecord(
                product_name=pdc_nm,
                category=label,
                url=STEP4_URL,
                error_type="step4_failed",
                http_status=None,
                error_msg=f"Step4 empty (sqno={sqno})",
            ))
            continue

        file_info = files[0]
        inpl_finm = file_info.get("INPL_FINM", "")
        if not inpl_finm:
            for alt_key in ("INPL_NM", "FILE_NM", "FILE_NAME", "FILENAME"):
                inpl_finm = file_info.get(alt_key, "")
                if inpl_finm:
                    break

        if not inpl_finm:
            logger.warning("[실패] INPL_FINM 없음 [%s] - 키: %s", pdc_nm[:50], list(file_info.keys()))
            stats["failed"] += 1
            state.failures.append(FailureRecord(
                product_name=pdc_nm,
                category=label,
                url=STEP4_URL,
                error_type="step4_failed",
                http_status=None,
                error_msg=f"INPL_FINM 없음, 키={list(file_info.keys())}",
            ))
            continue

        if dry_run:
            logger.info("[DRY] %s -> %s", pdc_nm[:50], inpl_finm)
            stats["dry_run"] += 1
            continue

        # PDF 다운로드
        pdf_url = f"{DOWNLOAD_URL}?FilePath=InsProduct/{quote(inpl_finm)}"

        # 이미 DB에 저장된 URL이면 다운로드 없이 스킵
        if processed_urls is not None and pdf_url in processed_urls:
            stats["skipped"] += 1
            logger.debug("[스킵] URL 이미 처리됨: %s", pdc_nm[:50])
            continue

        try:
            resp_pdf = await client.get(pdf_url, timeout=30.0)
            http_status = resp_pdf.status_code
            content_type = resp_pdf.headers.get("content-type", "")

            if http_status != 200 or resp_pdf.content[:4] != b"%PDF" or len(resp_pdf.content) < 1000:
                logger.warning(
                    "[실패] PDF 다운로드 실패 [%s] HTTP=%d size=%d type=%s",
                    pdc_nm[:50], http_status, len(resp_pdf.content), content_type,
                )
                stats["failed"] += 1
                state.failures.append(FailureRecord(
                    product_name=pdc_nm,
                    category=label,
                    url=pdf_url,
                    error_type="download_failed",
                    http_status=http_status,
                    error_msg=f"size={len(resp_pdf.content)}, content_type={content_type}",
                ))
                continue

            pdf_bytes = resp_pdf.content

        except Exception as e:
            logger.error("[ERROR] 다운로드 예외 [%s]: %s", pdc_nm[:30], e)
            stats["failed"] += 1
            state.failures.append(FailureRecord(
                product_name=pdc_nm,
                category=label,
                url=pdf_url,
                error_type="download_failed",
                http_status=None,
                error_msg=str(e),
            ))
            continue

        # 인제스트
        safe_name = pdc_nm.strip()
        for ch in ['/', '\\', ':', '?', '"', '<', '>', '*', '|']:
            safe_name = safe_name.replace(ch, '_')

        metadata = {
            "format_type": "B",
            "company_code": "db-insurance",
            "company_name": "DB손해보험",
            "product_code": safe_name,
            "product_name": pdc_nm,
            "category": "NON_LIFE",
            "source_url": pdf_url,
            "sale_status": sale_status,
        }

        try:
            result = await ingest_pdf_bytes(session_factory, pdf_bytes, metadata, dry_run=dry_run)
        except Exception as e:
            error_msg = f"{type(e).__name__}: {e}"
            logger.error("[ERROR] 인제스트 예외 [%s]: %s", pdc_nm[:30], error_msg)
            result = {"status": "failed", "error": error_msg}

        status = result.get("status", "failed")
        if status == "success":
            stats["success"] += 1
            processed_urls.add(pdf_url)  # 런 중 중복 다운로드 방지
            logger.info("[OK] %s (%s)", pdc_nm[:50], label)
        elif status == "skipped":
            stats["skipped"] += 1
        elif status == "dry_run":
            stats["dry_run"] += 1
        else:
            stats["failed"] += 1
            error_msg = result.get("error", "")
            state.failures.append(FailureRecord(
                product_name=pdc_nm,
                category=label,
                url=pdf_url,
                error_type="ingest_failed",
                http_status=None,
                error_msg=error_msg,
            ))
            logger.warning("[실패] 인제스트 실패 [%s]: %s", pdc_nm[:50], error_msg[:100])

        del pdf_bytes
        gc.collect()
        await asyncio.sleep(2.0)

    return stats


def save_state(state: CrawlState, state_path: Path) -> None:
    """크롤링 상태를 JSON으로 저장한다."""
    state_path.write_text(state.to_json(), encoding="utf-8")
    logger.info("상태 저장: %s (실패 %d건)", state_path, len(state.failures))


# @MX:ANCHOR: [AUTO] DB손보 크롤링+인제스트 메인 함수
# @MX:REASON: main, CLI __main__ 두 곳에서 호출됨
async def crawl_and_ingest(
    category_filter: str | None = None,
    dry_run: bool = False,
    fail_threshold: float = DEFAULT_FAIL_THRESHOLD,
    resume_state_path: Path | None = None,
    state_output_path: Path = DEFAULT_STATE_PATH,
) -> dict:
    """DB손해보험 크롤링 + 즉시 인제스트 실행."""
    # DB 초기화
    try:
        from app.core.config import Settings
        import app.core.database as db_module
        settings = Settings()  # type: ignore[call-arg]
        await db_module.init_database(settings)
    except Exception as e:
        logger.error("DB 초기화 실패: %s", e)
        return {"error": str(e)}

    import app.core.database as _db
    if _db.session_factory is None:
        logger.error("DB 세션 팩토리 초기화 실패")
        return {"error": "session_factory is None"}

    # 크롤러 재시작 시 이미 처리된 URL 스킵 (다운로드 전 체크)
    from scripts.ingest_local_pdfs import load_processed_urls
    async with _db.session_factory() as _session:
        processed_urls: set[str] = await load_processed_urls(_session, company_code="db-insurance")
    logger.info("이미 처리된 URL (DB손해보험): %d개 (재시작 시 스킵됨)", len(processed_urls))

    # 이전 실패 상태 로드
    retry_keys: set[str] | None = None
    if resume_state_path and resume_state_path.exists():
        try:
            prev = CrawlState.from_json(resume_state_path.read_text(encoding="utf-8"))
            retry_keys = {f"{f.category}::{f.product_name}" for f in prev.failures}
            logger.info("이전 실패 상태 로드: %d건 재처리 예정", len(retry_keys))
        except Exception as e:
            logger.warning("실패 상태 파일 로드 실패, 전체 처리로 진행: %s", e)

    state = CrawlState()
    total = {"products": 0, "success": 0, "skipped": 0, "failed": 0, "dry_run": 0}
    total_attempted = 0

    # 카테고리 필터
    categories = TARGET_CATEGORIES
    if category_filter:
        categories = [c for c in TARGET_CATEGORIES if c["label"] == category_filter]
        if not categories:
            logger.error("카테고리 없음: %s (가능한 값: %s)", category_filter, [c["label"] for c in TARGET_CATEGORIES])
            return {"error": f"unknown category: {category_filter}"}

    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True) as client:
        # 세션 초기화
        await client.get(f"{BASE_URL}/FWMAIV1534.do", timeout=120.0)

        for cat in categories:
            label = cat["label"]
            logger.info("[DB손해보험] 카테고리: %s", label)

            cat_stats = await crawl_category_and_ingest(
                client, _db.session_factory, cat, state, retry_keys, dry_run, processed_urls
            )

            for k in total:
                total[k] += cat_stats.get(k, 0)

            total_attempted += cat_stats.get("success", 0) + cat_stats.get("failed", 0)

            logger.info(
                "[DB손해보험] %s: %d상품, 성공=%d, 스킵=%d, 실패=%d",
                label, cat_stats["products"], cat_stats["success"], cat_stats["skipped"], cat_stats["failed"],
            )

            # fail-stop
            if not dry_run and total_attempted >= FAIL_MIN_SAMPLES:
                fail_rate = total["failed"] / total_attempted
                if fail_rate > fail_threshold:
                    state.stopped_at = datetime.now(tz=timezone.utc).isoformat()
                    state.stop_reason = "fail_threshold"
                    save_state(state, state_output_path)
                    logger.error(
                        "실패율 %.1f%% > 임계값 %.1f%% → 수집 중단\n재시작: --resume-state %s",
                        fail_rate * 100, fail_threshold * 100, state_output_path,
                    )
                    break

            await asyncio.sleep(1.0)

    state.stopped_at = datetime.now(tz=timezone.utc).isoformat()
    state.stop_reason = state.stop_reason or "completed"
    if state.failures:
        save_state(state, state_output_path)

    # 결과 출력
    sep = "=" * 60
    print(f"\n{sep}")
    print("DB손해보험 크롤링+인제스트 완료")
    print(sep)
    print(f"총 상품:     {total['products']:>6,}개")
    print(f"성공:        {total['success']:>6,}개")
    print(f"스킵(중복):  {total['skipped']:>6,}개")
    print(f"실패:        {total['failed']:>6,}개")
    if dry_run:
        print(f"dry-run:     {total['dry_run']:>6,}개")
    print(sep)

    if state.failures:
        print(f"\n실패 건수: {len(state.failures)}건")
        print(f"실패 상태 파일: {state_output_path}")
        print(f"재처리: python -m scripts.crawl_and_ingest_db --resume-state {state_output_path}")

    return {**total, "state_path": str(state_output_path) if state.failures else None}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """CLI 인자를 파싱한다."""
    parser = argparse.ArgumentParser(description="DB손해보험 크롤링 + 즉시 인제스트 (GitHub Actions 전용)")
    parser.add_argument(
        "--category",
        default=None,
        help="수집할 카테고리 (예: 장기-오프라인-건강). 미지정 시 전체",
    )
    parser.add_argument("--dry-run", dest="dry_run", action="store_true")
    parser.add_argument(
        "--fail-threshold",
        type=float,
        default=DEFAULT_FAIL_THRESHOLD,
        help=f"실패율 임계값 (기본값: {DEFAULT_FAIL_THRESHOLD * 100:.0f}%%)",
    )
    parser.add_argument("--resume-state", type=Path, default=None, dest="resume_state")
    parser.add_argument("--state-output", type=Path, default=DEFAULT_STATE_PATH, dest="state_output")
    return parser.parse_args(argv)


if __name__ == "__main__":
    args = parse_args()
    result = asyncio.run(crawl_and_ingest(
        category_filter=args.category,
        dry_run=args.dry_run,
        fail_threshold=args.fail_threshold,
        resume_state_path=args.resume_state,
        state_output_path=args.state_output,
    ))
    # DB 초기화 실패 등 오류 시 exit code 1 (GitHub Actions false positive 방지)
    if isinstance(result, dict) and "error" in result:
        logger.error("종료 오류: %s", result["error"])
        sys.exit(1)
