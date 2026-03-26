#!/usr/bin/env python3
"""메리츠화재 크롤링 + 즉시 인제스트 통합 파이프라인

GitHub Actions 환경에서 로컬 스토리지 없이 실행하기 위한 스크립트.
Playwright 다운로드 이벤트로 PDF bytes를 수신 → 즉시 인제스트 → 디스크에 저장하지 않음.

메리츠화재 특성:
  - AngularJS SPA → Playwright 필수 (목록 수집 + 다운로드 모두)
  - PDF 다운로드: pdfDown() 버튼 클릭 → POST /hp/fileDownload.do (암호화된 경로)
  - 직접 HTTP GET 불가 → Playwright download 이벤트 필수
  - source_url: download.url이 모든 상품에 동일한 POST URL이므로
    synthetic URL 사용 (안정적 중복 체크)

단계 구성:
  (category, sale_status) 조합별로:
    1. DISCLOSURE_URL 로딩 → 카테고리 클릭 → 판매/판매중지 탭 선택
    2. 테이블 행 수집 (이름, hasFile)
    3. 미처리 상품만 Playwright download event로 PDF 수신 → 즉시 인제스트

실행:
    cd backend && PYTHONPATH=. uv run python -m scripts.crawl_and_ingest_meritz
    cd backend && PYTHONPATH=. uv run python -m scripts.crawl_and_ingest_meritz --dry-run
    cd backend && PYTHONPATH=. uv run python -m scripts.crawl_and_ingest_meritz --resume-state failure_state_meritz.json

# @MX:NOTE: GitHub Actions 전용 통합 파이프라인 - 로컬 스토리지 불필요
# @MX:NOTE: AngularJS SPA → Playwright download event 필수 (httpx로 직접 다운로드 불가)
# @MX:NOTE: source_url은 synthetic URL 형식 (download.url은 모든 상품이 동일 POST URL이라 dedup 불가)
# @MX:NOTE: 실패 발생 시 즉시 중단(fail-stop) → failure_state_meritz.json artifact로 재처리 가능
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

# 메리츠화재 설정
COMPANY_CODE = "meritz-fire"
COMPANY_NAME = "메리츠화재"
DISCLOSURE_URL = "https://www.meritzfire.com/disclosure/product-announcement/product-list.do"

# 수집 대상 카테고리 (기존 crawl_meritz_fire.py와 동일)
TARGET_CATEGORIES = ["질병보험", "상해보험", "암보험", "어린이보험", "통합보험"]

# 제외 키워드 (기업보험·단체보험 등)
NEGATIVE_KEYWORDS = ["단체", "기업", "법인", "퇴직", "저축"]

RATE_LIMIT = 0.5  # 초 (상품 간 대기)
DEFAULT_STATE_PATH = Path("failure_state_meritz.json")
PLAYWRIGHT_DOWNLOAD_TIMEOUT = 20_000  # ms


@dataclass
class FailureRecord:
    """실패 건 상세 정보."""

    category: str
    sale_status: str       # "판매" or "판매중지"
    product_name: str
    source_url: str        # synthetic URL (재처리 시 DB 중복 체크용)
    error_type: str        # download_failed / ingest_failed / timeout
    error_msg: str
    timestamp: str = field(default_factory=lambda: datetime.now(tz=timezone.utc).isoformat())


@dataclass
class CrawlState:
    """크롤링 상태 (중단/재시작용)."""

    failures: list[FailureRecord] = field(default_factory=list)
    started_at: str = field(default_factory=lambda: datetime.now(tz=timezone.utc).isoformat())
    stopped_at: str | None = None
    stop_reason: str | None = None   # fail_immediate / completed / interrupted
    total_processed: int = 0
    total_skipped: int = 0

    def to_json(self) -> str:
        data = asdict(self)
        return json.dumps(data, ensure_ascii=False, indent=2)

    @classmethod
    def from_json(cls, text: str) -> "CrawlState":
        data = json.loads(text)
        failures = [FailureRecord(**f) for f in data.pop("failures", [])]
        state = cls(**data)
        state.failures = failures
        return state


def build_source_url(category: str, sale_status: str, product_name: str) -> str:
    """안정적인 dedup용 synthetic source_url을 반환한다.

    # @MX:NOTE: download.url은 모든 상품이 동일 POST URL → dedup 불가
    # → 카테고리+판매상태+상품명으로 unique URL 생성
    """
    status_code = "ON_SALE" if sale_status == "판매" else "DISCONTINUED"
    safe_name = product_name.replace("/", "_").replace(" ", "_")
    return f"https://www.meritzfire.com/disclosure/{category}/{status_code}/{safe_name}"


def is_target_product(name: str) -> bool:
    """제외 키워드가 포함된 상품은 수집하지 않는다."""
    return not any(kw in name for kw in NEGATIVE_KEYWORDS)


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


def save_state(state: CrawlState, state_path: Path) -> None:
    """크롤링 상태를 JSON으로 저장한다."""
    state_path.write_text(state.to_json(), encoding="utf-8")
    logger.info("상태 저장 완료: %s (실패 %d건)", state_path, len(state.failures))


async def navigate_to_category(
    page: object,
    category: str,
    sale_status: str,
) -> bool:
    """DISCLOSURE_URL로 이동 후 카테고리·판매상태 탭을 선택한다.

    Returns:
        True if navigation succeeded.
    """
    await page.goto(DISCLOSURE_URL, timeout=30_000, wait_until="networkidle")  # type: ignore[attr-defined]
    await asyncio.sleep(4)

    # 카테고리 클릭
    clicked = await page.evaluate(  # type: ignore[attr-defined]
        f"""() => {{
        const anchors = Array.from(document.querySelectorAll('a'));
        for (const a of anchors) {{
            if (a.textContent.trim() === '{category}') {{
                a.click();
                return true;
            }}
        }}
        return false;
    }}"""
    )

    if not clicked:
        logger.warning("[%s] 카테고리 '%s' 클릭 실패", COMPANY_NAME, category)
        return False

    await asyncio.sleep(4)

    # 판매중지 탭 클릭
    if sale_status == "판매중지":
        tab_clicked = await page.evaluate(  # type: ignore[attr-defined]
            """() => {
            const elements = document.querySelectorAll('a, li, button, span');
            for (const el of elements) {
                if (el.textContent.trim() === '판매중지') {
                    el.click();
                    return true;
                }
            }
            return false;
        }"""
        )
        if not tab_clicked:
            logger.warning("[%s] 판매중지 탭 없음 (%s)", COMPANY_NAME, category)
            return False
        await asyncio.sleep(3)

    return True


async def get_row_info(page: object) -> list[dict]:
    """현재 페이지에서 테이블 행 정보(이름, 파일 버튼 존재 여부)를 수집한다."""
    return await page.evaluate(  # type: ignore[attr-defined]
        """() => {
        const rows = document.querySelectorAll('table tbody tr');
        return Array.from(rows).map((tr, idx) => {
            const tds = tr.querySelectorAll('td');
            const name = tds[0] ? tds[0].textContent.trim() : '';
            const hasFile = tds[3] && tds[3].querySelector('a.btn_file') !== null;
            return {idx, name, hasFile};
        });
    }"""
    )


async def download_and_ingest_product(
    page: object,
    session_factory: object,
    row_idx: int,
    product_name: str,
    category: str,
    sale_status: str,
    source_url: str,
    dry_run: bool,
) -> dict:
    """단일 상품 PDF를 Playwright download event로 수신 후 즉시 인제스트한다.

    # @MX:NOTE: Playwright expect_download 필수 - POST /hp/fileDownload.do는 직접 GET 불가
    Returns:
        {"status": "ok"|"invalid"|"failed"|"dry_run", "size": int}
    """
    if dry_run:
        logger.info("  [DRY] %s", product_name)
        return {"status": "dry_run", "size": 0}

    try:
        async with page.expect_download(timeout=PLAYWRIGHT_DOWNLOAD_TIMEOUT) as dl_info:  # type: ignore[attr-defined]
            await page.evaluate(  # type: ignore[attr-defined]
                f"""() => {{
                const rows = document.querySelectorAll('table tbody tr');
                const row = rows[{row_idx}];
                if (row) {{
                    const btn = row.querySelectorAll('td')[3]?.querySelector('a.btn_file');
                    if (btn) btn.click();
                }}
            }}"""
            )

        download = await dl_info.value
        tmp_path = await download.path()

        if not tmp_path:
            return {"status": "failed", "error": "다운로드 경로 없음", "size": 0}

        pdf_bytes = Path(tmp_path).read_bytes()

        if pdf_bytes[:4] != b"%PDF" or len(pdf_bytes) < 1000:
            logger.warning(
                "  [INVALID] %s - PDF 시그니처 불일치 (%d bytes)",
                product_name, len(pdf_bytes),
            )
            return {"status": "invalid", "size": len(pdf_bytes)}

        status_code = "ON_SALE" if sale_status == "판매" else "DISCONTINUED"
        metadata = {
            "format_type": "B",
            "company_code": COMPANY_CODE,
            "company_name": COMPANY_NAME,
            "product_code": product_name,  # 메리츠화재: 상품명을 product_code로 사용
            "product_name": product_name,
            "category": "NON_LIFE",
            "sale_status": status_code,
            "source_url": source_url,
        }

        ingest_result = await ingest_pdf_bytes(session_factory, pdf_bytes, metadata, dry_run)

        del pdf_bytes
        gc.collect()

        logger.info(
            "  [OK] %s (%s) → %s",
            product_name,
            sale_status,
            ingest_result.get("status", "?"),
        )
        return {"status": "ok", "size": len(pdf_bytes) if "pdf_bytes" in dir() else 0}

    except TimeoutError:
        return {"status": "timeout", "error": "Playwright download timeout", "size": 0}
    except Exception as e:
        return {"status": "failed", "error": str(e), "size": 0}


async def process_category(
    page: object,
    session_factory: object,
    processed_urls: set[str],
    category: str,
    sale_status: str,
    dry_run: bool,
    state: CrawlState,
    fail_stop: bool = True,
) -> bool:
    """카테고리+판매상태 조합에 대해 수집+인제스트를 수행한다.

    # @MX:NOTE: (category, sale_status) 조합마다 DISCLOSURE_URL 재로딩으로 SPA 상태 초기화
    Returns:
        True if should continue, False if fail-stop triggered.
    """
    nav_ok = await navigate_to_category(page, category, sale_status)
    if not nav_ok:
        logger.warning("[%s] %s (%s) 네비게이션 실패, 건너뜀", COMPANY_NAME, category, sale_status)
        return True

    row_info = await get_row_info(page)
    total = len(row_info)
    with_file = sum(1 for r in row_info if r["hasFile"])
    logger.info(
        "[%s] %s (%s): 총 %d행, 파일 있음 %d개",
        COMPANY_NAME, category, sale_status, total, with_file,
    )

    for r in row_info:
        if not r["hasFile"]:
            continue

        name: str = r["name"]
        idx: int = r["idx"]

        if not is_target_product(name):
            logger.debug("  [SKIP-KEYWORD] %s", name)
            continue

        source_url = build_source_url(category, sale_status, name)

        if source_url in processed_urls:
            logger.info("  [SKIP-DB] %s", name)
            state.total_skipped += 1
            continue

        result = await download_and_ingest_product(
            page=page,
            session_factory=session_factory,
            row_idx=idx,
            product_name=name,
            category=category,
            sale_status=sale_status,
            source_url=source_url,
            dry_run=dry_run,
        )

        if result["status"] in ("failed", "timeout", "invalid"):
            error_type = result["status"]
            error_msg = result.get("error", "")
            logger.error(
                "  [FAIL] %s: %s - %s",
                name, error_type, error_msg,
            )
            state.failures.append(
                FailureRecord(
                    category=category,
                    sale_status=sale_status,
                    product_name=name,
                    source_url=source_url,
                    error_type=error_type,
                    error_msg=error_msg,
                )
            )
            if fail_stop:
                logger.error("[fail-stop] 실패 발생 → 중단")
                return False
        else:
            state.total_processed += 1
            processed_urls.add(source_url)

        await asyncio.sleep(RATE_LIMIT)

    return True


async def retry_failures(
    page: object,
    session_factory: object,
    processed_urls: set[str],
    failures: list[FailureRecord],
    dry_run: bool,
    state: CrawlState,
) -> None:
    """이전 실패 건을 재처리한다.

    # @MX:NOTE: 각 실패 건마다 DISCLOSURE_URL → 카테고리 → 탭 → 상품명으로 행 탐색
    """
    logger.info("재처리 모드: 실패 %d건 재시도", len(failures))

    for fail in failures:
        category = fail.category
        sale_status = fail.sale_status
        product_name = fail.product_name
        source_url = fail.source_url

        if source_url in processed_urls:
            logger.info("  [SKIP-DB] %s (이미 처리됨)", product_name)
            state.total_skipped += 1
            continue

        nav_ok = await navigate_to_category(page, category, sale_status)
        if not nav_ok:
            logger.warning("  [RETRY-NAV-FAIL] %s (%s/%s)", product_name, category, sale_status)
            state.failures.append(
                FailureRecord(
                    category=category,
                    sale_status=sale_status,
                    product_name=product_name,
                    source_url=source_url,
                    error_type="nav_failed",
                    error_msg="카테고리 네비게이션 실패",
                )
            )
            continue

        row_info = await get_row_info(page)

        # 상품명으로 행 탐색
        target_row = next(
            (r for r in row_info if r["name"] == product_name and r["hasFile"]),
            None,
        )

        if target_row is None:
            logger.warning("  [RETRY-NOT-FOUND] %s - 테이블에서 찾지 못함", product_name)
            state.failures.append(
                FailureRecord(
                    category=category,
                    sale_status=sale_status,
                    product_name=product_name,
                    source_url=source_url,
                    error_type="not_found",
                    error_msg="테이블에서 상품 행 탐색 실패",
                )
            )
            continue

        result = await download_and_ingest_product(
            page=page,
            session_factory=session_factory,
            row_idx=target_row["idx"],
            product_name=product_name,
            category=category,
            sale_status=sale_status,
            source_url=source_url,
            dry_run=dry_run,
        )

        if result["status"] in ("failed", "timeout", "invalid"):
            logger.error("  [RETRY-FAIL] %s: %s", product_name, result.get("error", ""))
            state.failures.append(
                FailureRecord(
                    category=category,
                    sale_status=sale_status,
                    product_name=product_name,
                    source_url=source_url,
                    error_type=result["status"],
                    error_msg=result.get("error", ""),
                )
            )
        else:
            logger.info("  [RETRY-OK] %s", product_name)
            state.total_processed += 1
            processed_urls.add(source_url)

        await asyncio.sleep(RATE_LIMIT)


# @MX:ANCHOR: [AUTO] 메리츠화재 크롤링+인제스트 메인 진입점
# @MX:REASON: GitHub Actions workflow 및 CLI __main__에서 호출되는 파이프라인 핵심 함수
async def crawl_and_ingest(
    dry_run: bool = False,
    resume_state_path: Path | None = None,
    state_output_path: Path = DEFAULT_STATE_PATH,
) -> dict:
    """메리츠화재 크롤링 + 즉시 인제스트 실행.

    Args:
        dry_run: True이면 실제 인제스트 없이 목록만 출력
        resume_state_path: 재처리할 실패 상태 JSON 경로
        state_output_path: 실패 상태 출력 경로

    Returns:
        실행 결과 요약 dict
    """
    from playwright.async_api import async_playwright

    try:
        from app.core.config import Settings
        import app.core.database as db_module
        settings = Settings()  # type: ignore[call-arg]
        await db_module.init_database(settings)
    except Exception as e:
        logger.error("DB 초기화 실패: %s", e)
        return {"error": str(e), "total_processed": 0, "total_skipped": 0, "total_failed": 0, "stop_reason": "db_init_failed"}

    import app.core.database as _db
    from scripts.ingest_local_pdfs import load_processed_urls

    if _db.session_factory is None:
        logger.error("DB 세션 팩토리 초기화 실패")
        return {"error": "session_factory is None", "total_processed": 0, "total_skipped": 0, "total_failed": 0, "stop_reason": "db_init_failed"}

    state = CrawlState()
    retry_mode = False
    retry_targets: list[FailureRecord] = []

    # 재처리 모드 설정
    if resume_state_path and resume_state_path.exists():
        prev_state = CrawlState.from_json(resume_state_path.read_text(encoding="utf-8"))
        if prev_state.failures:
            retry_mode = True
            retry_targets = prev_state.failures
            logger.info("재처리 모드: 이전 실패 %d건 처리 예정", len(retry_targets))

    # 이미 처리된 URL 로딩
    async with _db.session_factory() as session:
        processed_urls = await load_processed_urls(session, COMPANY_CODE)
    logger.info("이미 처리된 URL: %d건", len(processed_urls))

    logger.info("=" * 60)
    logger.info("메리츠화재 크롤링+인제스트 시작%s", " (DRY RUN)" if dry_run else "")
    logger.info("=" * 60)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            accept_downloads=True,
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
        )
        page = await context.new_page()

        try:
            if retry_mode:
                # 재처리 모드: 실패 건만 재시도
                await retry_failures(
                    page=page,
                    session_factory=_db.session_factory,
                    processed_urls=processed_urls,
                    failures=retry_targets,
                    dry_run=dry_run,
                    state=state,
                )
            else:
                # 전체 실행 모드: 카테고리 × 판매상태 조합 순차 처리
                for category in TARGET_CATEGORIES:
                    for sale_status in ["판매", "판매중지"]:
                        should_continue = await process_category(
                            page=page,
                            session_factory=_db.session_factory,
                            processed_urls=processed_urls,
                            category=category,
                            sale_status=sale_status,
                            dry_run=dry_run,
                            state=state,
                            fail_stop=True,
                        )
                        if not should_continue:
                            state.stop_reason = "fail_immediate"
                            state.stopped_at = datetime.now(tz=timezone.utc).isoformat()
                            break
                    else:
                        continue
                    break

        except Exception as e:
            logger.error("크롤링 중 예외 발생: %s", e)
            state.stop_reason = f"exception: {e}"
            state.stopped_at = datetime.now(tz=timezone.utc).isoformat()
        finally:
            await browser.close()

    if not state.stop_reason:
        state.stop_reason = "completed"
        state.stopped_at = datetime.now(tz=timezone.utc).isoformat()

    # 실패 건 저장
    if state.failures or state.stop_reason != "completed":
        save_state(state, state_output_path)

    # 결과 요약
    logger.info("=" * 60)
    logger.info("메리츠화재 크롤링+인제스트 완료")
    logger.info("처리: %d건, 스킵: %d건, 실패: %d건", state.total_processed, state.total_skipped, len(state.failures))
    logger.info("중단 사유: %s", state.stop_reason)
    logger.info("=" * 60)

    if state.failures:
        sep = "-" * 60
        print(f"\n{sep}\n실패 건 상세 ({len(state.failures)}건)\n{sep}")
        for f in state.failures[:10]:
            print(f"  [{f.category}/{f.sale_status}] {f.product_name[:50]}")
            print(f"    오류: {f.error_type} - {f.error_msg[:80]}")
        print(sep)

    return {
        "total_processed": state.total_processed,
        "total_skipped": state.total_skipped,
        "total_failed": len(state.failures),
        "stop_reason": state.stop_reason,
    }


def main() -> None:
    """CLI 진입점."""
    parser = argparse.ArgumentParser(description="메리츠화재 크롤링 + 인제스트")
    parser.add_argument("--dry-run", action="store_true", help="인제스트 없이 목록만 확인")
    parser.add_argument(
        "--resume-state",
        type=str,
        default="",
        help="재처리할 실패 상태 JSON 경로 (failure_state_meritz.json)",
    )
    parser.add_argument(
        "--state-output",
        type=str,
        default=str(DEFAULT_STATE_PATH),
        help="실패 상태 출력 경로",
    )
    args = parser.parse_args()

    resume_state_path = Path(args.resume_state) if args.resume_state else None
    state_output_path = Path(args.state_output)

    result = asyncio.run(
        crawl_and_ingest(
            dry_run=args.dry_run,
            resume_state_path=resume_state_path,
            state_output_path=state_output_path,
        )
    )

    if result.get("error"):
        logger.error("실행 실패: %s", result["error"])
        sys.exit(1)

    if result.get("total_failed", 0) > 0:
        logger.warning("실패 건 있음: %d건 → %s에서 재처리 가능", result["total_failed"], state_output_path)
        sys.exit(1)


if __name__ == "__main__":
    main()
