#!/usr/bin/env python3
"""삼성생명 크롤링 + 즉시 인제스트 통합 파이프라인

GitHub Actions 환경에서 실행하기 위한 스크립트.
1단계: Playwright로 Vue SPA 페이지 로딩 -> Vue 컴포넌트 메서드 호출 -> 응답 인터셉트로 상품 목록 수집
2단계: httpx로 PDF 다운로드 (CDN 공개 URL) -> 즉시 인제스트 -> 메모리 해제

실행:
    cd backend && PYTHONPATH=. uv run python -m scripts.crawl_and_ingest_samsung_life
    cd backend && PYTHONPATH=. uv run python -m scripts.crawl_and_ingest_samsung_life --dry-run
    cd backend && PYTHONPATH=. uv run python -m scripts.crawl_and_ingest_samsung_life --resume-state failure_state_samsung_life.json

# @MX:NOTE: [AUTO] 삼성생명 API는 AES 암호화 파라미터를 사용하므로 직접 POST 불가
# @MX:NOTE: [AUTO] Vue 컴포넌트 apiInsuPrdtSalesAllList 메서드를 호출하여 응답 인터셉트
# @MX:NOTE: [AUTO] PDF URL은 공개 CDN이므로 httpx로 직접 다운로드 (Playwright 불필요)
"""
from __future__ import annotations

import argparse
import asyncio
import datetime
import gc
import json
import logging
import sys
import tempfile
from dataclasses import asdict, dataclass, field
from datetime import timezone
from math import ceil
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

COMPANY_CODE = "samsung-life"
COMPANY_NAME = "삼성생명"
TARGET_PAGE_URL = (
    "https://www.samsunglife.com"
    "/individual/products/disclosure/sales/PDO-PRPRI010110M"
)

RATE_LIMIT = 0.3  # 초 (CDN이라 빠름)
PAGE_SIZE = 100
DEFAULT_STATE_FILE = "failure_state_samsung_life.json"

# Vue 인스턴스 검색 JS 헬퍼
FIND_VUE_JS = """
function findVueByMethod(el, methodName, depth) {
    if (depth > 20) return null;
    if (el.__vue__ && el.__vue__.$options.methods &&
        el.__vue__.$options.methods[methodName]) {
        return el.__vue__;
    }
    for (const c of el.children || []) {
        const v = findVueByMethod(c, methodName, depth + 1);
        if (v) return v;
    }
    return null;
}
"""


@dataclass
class FailureRecord:
    """다운로드/인제스트 실패 건."""
    product_name: str
    category: str
    source_url: str
    sale_status: str
    error: str
    timestamp: str = field(default_factory=lambda: datetime.datetime.now(tz=timezone.utc).isoformat())


@dataclass
class SamsungLifeIngestState:
    """삼성생명 실패 상태 (재처리용 JSON 직렬화 가능)."""
    failures: list[FailureRecord] = field(default_factory=list)
    stop_reason: str = ""
    created_at: str = field(default_factory=lambda: datetime.datetime.now(timezone.utc).isoformat())

    def save(self, path: Path) -> None:
        data = asdict(self)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info("실패 상태 저장: %s (%d건)", path, len(self.failures))

    @classmethod
    def load(cls, path: Path) -> "SamsungLifeIngestState":
        data = json.loads(path.read_text(encoding="utf-8"))
        failures = [FailureRecord(**f) for f in data.get("failures", [])]
        return cls(
            failures=failures,
            stop_reason=data.get("stop_reason", ""),
            created_at=data.get("created_at", ""),
        )


def _samsung_pdf_url(goods_code: str, filename: str, doc_type: str = "301", from_date: str = "") -> str:
    """삼성생명 PDF 직접 다운로드 URL을 구성한다.

    # @MX:NOTE: [AUTO] CDN URL 패턴: /uploadDir/doc/{year}/{mmdd}/{goodsCode}001/{docType}/{filename}.pdf
    # @MX:NOTE: [AUTO] goodsCode에 '001' suffix 추가 필요 (순수 숫자 코드인 경우)
    # @MX:NOTE: [AUTO] 날짜: fromdate 우선 사용, 없으면 filename timestamp에서 추출
    # @MX:NOTE: [AUTO] doc_type: "301"=보험약관, "401"=사업방법서, "101"=상품요약서
    """
    try:
        is_short_numeric = goods_code.isdigit() and len(goods_code) <= 6

        if is_short_numeric:
            # 구형 코드 (12970 등): goodsCode + '001' suffix + fromdate 기반 날짜
            cdn_code = f"{goods_code}001"
            if from_date and len(from_date) >= 8:
                clean_date = from_date.replace("-", "")
                year = clean_date[:4]
                mmdd = clean_date[4:8]
            else:
                ts_sec = int(filename) / 1000.0
                dt = datetime.datetime.fromtimestamp(ts_sec, tz=datetime.timezone.utc)
                year = dt.strftime("%Y")
                mmdd = dt.strftime("%m%d")
        else:
            # 신형 코드 (LP0257009P20470 등): 원본 goodsCode + timestamp 기반 날짜
            cdn_code = goods_code
            ts_sec = int(filename) / 1000.0
            dt = datetime.datetime.fromtimestamp(ts_sec, tz=datetime.timezone.utc)
            year = dt.strftime("%Y")
            mmdd = dt.strftime("%m%d")

        if not year or not mmdd:
            return ""

        return (
            f"https://pcms.samsunglife.com/uploadDir/doc"
            f"/{year}/{mmdd}/{cdn_code}/{doc_type}/{filename}.pdf"
        )
    except (ValueError, OSError):
        return ""


# @MX:ANCHOR: [AUTO] collect_products - Playwright로 삼성생명 상품 목록 수집
# @MX:REASON: API가 AES 암호화 파라미터를 사용하므로 Vue 컴포넌트 메서드 호출 + 응답 인터셉트 필수
async def collect_products(page: object) -> list[dict]:
    """Playwright 페이지에서 Vue 컴포넌트를 통해 전체 상품 목록을 수집한다.

    1. 페이지 로딩 후 8초 대기 (Vue 초기화)
    2. 응답 인터셉트 설정 (salesAllPrdtList URL)
    3. Vue 메서드 호출로 pageLength=100, tab1CurrentPage=0부터 순회
    4. totalRows로 전체 페이지 수 계산 후 루프
    """
    from playwright.async_api import Page  # type: ignore[attr-defined]
    page: Page  # type: ignore[no-redef]

    # API 응답 인터셉트 버퍼
    response_buffer: list[dict] = []

    async def _capture_response(response: object) -> None:
        """salesAllPrdtList 응답을 버퍼에 적재한다."""
        if "salesAllPrdtList" not in response.url or response.status != 200:
            return
        try:
            body = await response.body()
            data = json.loads(body.decode("utf-8", errors="ignore"))
            if data.get("code") == "200" and data.get("response"):
                response_buffer.append(data)
        except Exception:
            pass

    page.on("response", _capture_response)

    logger.info("[%s] 약관공시 페이지 로딩 (Vue 초기화)...", COMPANY_NAME)
    try:
        await page.goto(TARGET_PAGE_URL, timeout=60_000, wait_until="networkidle")
        await asyncio.sleep(8)
    except Exception as exc:
        logger.warning("[%s] 초기 페이지 로드 타임아웃 (계속 진행): %s", COMPANY_NAME, exc)

    # 초기 응답으로 totalRows 파악
    total_rows: int | None = None
    if response_buffer:
        first_items = response_buffer[0].get("response", [])
        if first_items:
            total_rows = int(first_items[0].get("totalRows", 0))
            logger.info("[%s] 전체 상품 수: %d개", COMPANY_NAME, total_rows)

    if total_rows is None:
        logger.warning("[%s] 초기 응답 없음 - 페이지 로드 실패", COMPANY_NAME)
        return []

    total_pages = ceil(total_rows / PAGE_SIZE)
    all_items: list[dict] = []

    # pageLength=100으로 재설정하여 0페이지부터 수집
    response_buffer.clear()

    for page_no in range(total_pages):
        # Vue 메서드 호출
        try:
            await page.evaluate(f"""
                async () => {{
                    {FIND_VUE_JS}
                    const vue = findVueByMethod(document.body, 'apiInsuPrdtSalesAllList', 0);
                    if (!vue) return false;
                    vue.$data.pageLength = {PAGE_SIZE};
                    vue.$data.tab1CurrentPage = {page_no};
                    vue.apiInsuPrdtSalesAllList();
                    return true;
                }}
            """)
        except Exception as exc:
            logger.warning("[%s] 페이지 %d Vue 호출 실패: %s", COMPANY_NAME, page_no, exc)
            break

        # 응답 대기
        waited = 0
        while not response_buffer and waited < 15:
            await asyncio.sleep(1)
            waited += 1

        if not response_buffer:
            logger.warning("[%s] 페이지 %d 응답 없음 - 중단", COMPANY_NAME, page_no)
            break

        current_data = response_buffer.pop(0)
        items: list[dict] = current_data.get("response") or []

        if not items:
            logger.info("[%s] 페이지 %d 빈 응답 - 수집 완료", COMPANY_NAME, page_no)
            break

        all_items.extend(items)
        logger.info(
            "[%s] 페이지 %d/%d 수집: %d개 (누적 %d개)",
            COMPANY_NAME, page_no + 1, total_pages, len(items), len(all_items),
        )

        # 다음 페이지 호출 전 대기
        if page_no < total_pages - 1:
            await asyncio.sleep(2)

    logger.info("[%s] 전체 상품 수집 완료: %d개", COMPANY_NAME, len(all_items))
    return all_items


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


# @MX:ANCHOR: [AUTO] download_and_ingest_all - 상품별 PDF 다운로드 및 인제스트 루프
# @MX:REASON: 크롤러 핵심 루프, 실패 상태 관리 및 resume 지원
async def download_and_ingest_all(
    session_factory: object,
    products: list[dict],
    state: SamsungLifeIngestState,
    state_output_path: Path,
    processed_urls: set[str],
    dry_run: bool = False,
    resume_urls: set[str] | None = None,
) -> dict[str, int]:
    """수집된 상품 목록에서 약관 PDF를 다운로드하고 인제스트한다.

    # @MX:NOTE: [AUTO] PDF URL은 공개 CDN이므로 httpx로 직접 다운로드
    """
    import httpx

    stats = {"total": 0, "success": 0, "skipped": 0, "failed": 0, "dry_run": 0}

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(30.0, connect=10.0),
        follow_redirects=True,
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
    ) as client:
        for idx, item in enumerate(products, 1):
            goods_code: str = item.get("goodsCode") or ""
            goods_name: str = item.get("goodsName") or ""
            filename3: str = item.get("filename3") or ""
            from_date: str = item.get("fromdate") or ""
            l_code: str = item.get("lCode") or ""

            if not goods_code or not goods_name or not filename3:
                continue

            stats["total"] += 1

            sale_status = "DISCONTINUED" if l_code == "판매중지" else "ON_SALE"
            pdf_url = _samsung_pdf_url(goods_code, filename3, "301", from_date)
            if not pdf_url:
                stats["skipped"] += 1
                continue

            # source_url = 구성된 PDF URL
            source_url = pdf_url

            # resume 모드: 지정된 URL만 재처리
            if resume_urls is not None and source_url not in resume_urls:
                stats["skipped"] += 1
                continue

            # 이미 처리된 URL 스킵 (중복 다운로드 방지)
            if source_url in processed_urls:
                stats["skipped"] += 1
                continue

            if idx % 100 == 0 or idx == 1:
                logger.info(
                    "진행: %d / %d (성공=%d, 스킵=%d, 실패=%d)",
                    stats["total"], len(products),
                    stats["success"], stats["skipped"], stats["failed"],
                )

            await asyncio.sleep(RATE_LIMIT)

            # PDF 다운로드 (httpx - CDN 공개 URL)
            pdf_bytes: bytes | None = None
            try:
                resp = await client.get(pdf_url)
                if resp.status_code == 200 and len(resp.content) > 1000:
                    if resp.content[:4] == b"%PDF":
                        pdf_bytes = resp.content
                    else:
                        logger.warning(
                            "[%d] PDF 시그니처 불일치: %s (sig=%s, size=%d)",
                            idx, goods_name[:40], resp.content[:8], len(resp.content),
                        )
                elif resp.status_code == 404:
                    # 404: CDN에서 오래된 PDF 삭제됨 — 스킵 (실패 아님)
                    stats["skipped"] += 1
                    logger.debug("[%d] HTTP 404 스킵 (CDN 파일 없음): %s", idx, goods_name[:40])
                    continue
                else:
                    logger.warning(
                        "[%d] 다운로드 실패: %s | HTTP=%d | size=%d",
                        idx, goods_name[:40], resp.status_code, len(resp.content),
                    )
            except Exception as e:
                logger.warning("[%d] 다운로드 예외 %s: %s", idx, goods_name[:40], e)

            # 상품명에 날짜 suffix 추가 (중복 방지)
            product_name = f"{goods_name}_{from_date}" if from_date else goods_name

            if not pdf_bytes:
                stats["failed"] += 1
                state.failures.append(FailureRecord(
                    product_name=product_name,
                    category="LIFE",
                    source_url=source_url,
                    sale_status=sale_status,
                    error="다운로드 실패 또는 PDF 시그니처 불일치",
                ))
                continue

            # 인제스트
            metadata = {
                "format_type": "B",
                "company_code": COMPANY_CODE,
                "company_name": COMPANY_NAME,
                "product_code": goods_code,
                "product_name": product_name,
                "category": "LIFE",
                "source_url": source_url,
                "sale_status": sale_status,
            }

            try:
                result = await ingest_pdf_bytes(session_factory, pdf_bytes, metadata, dry_run=dry_run)
            except Exception as e:
                error_msg = f"{type(e).__name__}: {e}"
                logger.error("[%d] 인제스트 예외 %s: %s", idx, product_name[:40], error_msg)
                result = {"status": "failed", "error": error_msg}

            gc.collect()

            status = result.get("status", "failed")
            if status == "success":
                stats["success"] += 1
                processed_urls.add(source_url)
                logger.info("[%d] 완료: %s (%s)", idx, product_name[:40], sale_status)
            elif status == "skipped":
                stats["skipped"] += 1
                logger.debug("[%d] 스킵(중복): %s", idx, product_name[:40])
            elif status == "dry_run":
                stats["dry_run"] += 1
            else:
                stats["failed"] += 1
                error_msg = result.get("error", "")
                logger.warning("[%d] 인제스트 실패 %s: %s", idx, product_name[:40], error_msg)
                state.failures.append(FailureRecord(
                    product_name=product_name,
                    category="LIFE",
                    source_url=source_url,
                    sale_status=sale_status,
                    error=error_msg,
                ))
                state.save(state_output_path)

    return stats


async def run(
    dry_run: bool = False,
    resume_state_path: Path | None = None,
    state_output_path: Path = Path(DEFAULT_STATE_FILE),
) -> dict:
    """삼성생명 크롤링 + 인제스트 메인 실행 함수."""
    from playwright.async_api import async_playwright

    logger.info("=" * 60)
    logger.info("%s 크롤링 + 인제스트 시작", COMPANY_NAME)
    logger.info("=" * 60)

    # DB 초기화 (dry-run 시 스킵)
    _db = None
    if not dry_run:
        import app.core.database as db_module
        from app.core.config import Settings
        try:
            settings = Settings()  # type: ignore[call-arg]
            await db_module.init_database(settings)
        except Exception as e:
            logger.error("DB 초기화 실패: %s", e)
            return {"error": str(e)}

        if db_module.session_factory is None:
            logger.error("DB 세션 팩토리 초기화 실패")
            return {"error": "session_factory is None"}

        _db = db_module

    # 이미 처리된 URL 로드 (재시작 시 중복 다운로드 방지, dry-run 시 빈 set)
    if not dry_run and _db is not None:
        from scripts.ingest_local_pdfs import load_processed_urls
        async with _db.session_factory() as _session:
            processed_urls: set[str] = await load_processed_urls(_session, company_code=COMPANY_CODE)
        logger.info("이미 처리된 URL (%s): %d개 (재시작 시 스킵됨)", COMPANY_NAME, len(processed_urls))
    else:
        processed_urls = set()
        logger.info("이미 처리된 URL (%s): 0개 (dry-run 모드)", COMPANY_NAME)

    # resume 모드: 이전 실패 건 로드
    state = SamsungLifeIngestState()
    resume_urls: set[str] | None = None
    if resume_state_path and resume_state_path.exists():
        prev_state = SamsungLifeIngestState.load(resume_state_path)
        resume_urls = {f.source_url for f in prev_state.failures}
        logger.info("재처리 모드: %d건 재시도", len(resume_urls))

    total_stats: dict[str, int] = {"total": 0, "success": 0, "skipped": 0, "failed": 0, "dry_run": 0}

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context()
        page = await ctx.new_page()

        # Step 1: Playwright로 상품 목록 수집
        try:
            products = await collect_products(page)
        except Exception as e:
            logger.error("[%s] 상품 목록 수집 실패: %s", COMPANY_NAME, e)
            await browser.close()
            return {"error": str(e)}

        await browser.close()

    if not products:
        logger.warning("[%s] 수집된 상품 없음", COMPANY_NAME)
        state.stop_reason = "no_products"
        state.save(state_output_path)
        return total_stats

    if dry_run:
        logger.info("[%s] DRY-RUN: 수집된 상품 %d개 출력", COMPANY_NAME, len(products))
        for i, p in enumerate(products, 1):
            goods_code = p.get("goodsCode", "")
            goods_name = p.get("goodsName", "")
            filename3 = p.get("filename3", "")
            l_code = p.get("lCode", "")
            from_date = p.get("fromdate", "")
            pdf_url = _samsung_pdf_url(goods_code, filename3, "301", from_date) if filename3 else ""
            logger.info(
                "  [%d] goodsCode=%s | %s | %s | %s",
                i, goods_code, goods_name[:50], l_code, pdf_url[:80],
            )
        total_stats["total"] = len(products)
        total_stats["dry_run"] = len(products)
    else:
        # Step 2: httpx로 PDF 다운로드 + 인제스트
        total_stats = await download_and_ingest_all(
            session_factory=_db.session_factory if _db is not None else None,
            products=products,
            state=state,
            state_output_path=state_output_path,
            processed_urls=processed_urls,
            dry_run=dry_run,
            resume_urls=resume_urls,
        )

    # 최종 실패 상태 저장
    state.stop_reason = "completed"
    state.save(state_output_path)

    sep = "=" * 60
    logger.info("\n%s", sep)
    logger.info("%s 크롤링+인제스트 완료", COMPANY_NAME)
    logger.info("%s", sep)
    logger.info("전체:        %6d개", total_stats["total"])
    logger.info("성공:        %6d개", total_stats["success"])
    logger.info("스킵(중복):  %6d개", total_stats["skipped"])
    logger.info("실패:        %6d개", total_stats["failed"])
    if dry_run:
        logger.info("dry-run:     %6d개", total_stats.get("dry_run", 0))
    logger.info("%s", sep)

    if state.failures:
        fail_rate = len(state.failures) / max(total_stats["total"], 1)
        logger.info("실패율: %.1f%% (%d건)", fail_rate * 100, len(state.failures))
        logger.info("재처리: python -m scripts.crawl_and_ingest_samsung_life --resume-state %s", state_output_path)

    return total_stats


def main() -> None:
    parser = argparse.ArgumentParser(description=f"{COMPANY_NAME} 크롤링 + 인제스트")
    parser.add_argument("--dry-run", action="store_true", help="크롤링만 하고 DB 저장 안 함")
    parser.add_argument(
        "--resume-state",
        metavar="FILE",
        help="이전 실패 상태 JSON 파일 경로 (실패 건만 재처리)",
    )
    parser.add_argument(
        "--state-output",
        metavar="FILE",
        default=DEFAULT_STATE_FILE,
        help=f"실패 상태 저장 경로 (기본값: {DEFAULT_STATE_FILE})",
    )
    args = parser.parse_args()

    resume_path = Path(args.resume_state) if args.resume_state else None
    state_out = Path(args.state_output)

    result = asyncio.run(run(
        dry_run=args.dry_run,
        resume_state_path=resume_path,
        state_output_path=state_out,
    ))
    if isinstance(result, dict) and "error" in result:
        logger.error("크롤링 실패 -> exit code 1")
        sys.exit(1)


if __name__ == "__main__":
    main()
