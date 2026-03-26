#!/usr/bin/env python3
"""MG손해보험 크롤링 + 즉시 인제스트 통합 파이프라인

GitHub Actions 환경에서 실행하기 위한 스크립트.
1단계: Playwright로 Devon.js SPA 페이지 로딩 → comToken 추출 → AJAX API로 상품 목록 수집
2단계: Playwright fetch로 PDF 다운로드 → 즉시 인제스트 → 메모리 해제

실행:
    cd backend && PYTHONPATH=. uv run python -m scripts.crawl_and_ingest_mg
    cd backend && PYTHONPATH=. uv run python -m scripts.crawl_and_ingest_mg --dry-run
    cd backend && PYTHONPATH=. uv run python -m scripts.crawl_and_ingest_mg --resume-state failure_state_mg.json

# @MX:NOTE: [AUTO] Devon.js SPA이므로 모든 API 호출을 Playwright page.evaluate(fetch()) 로 수행
# @MX:NOTE: [AUTO] PDF 다운로드도 브라우저 세션 쿠키가 필요하여 Playwright fetch 사용
# @MX:NOTE: [AUTO] 장기보험(L) 중 건강/운전자/의료/상해 카테고리만 수집
"""
from __future__ import annotations

import argparse
import asyncio
import base64
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

COMPANY_CODE = "mg-insurance"
COMPANY_NAME = "MG손해보험"
BASE_URL = "https://www.yebyeol.co.kr"
PAGE_URL = f"{BASE_URL}/PB031210DM.scp"
PRODUCT_LIST_API = "/PB031210_001.ajax"
PDF_DOWNLOAD_API = "/PB031130_003.form"

# 수집 대상 카테고리: 장기보험(L) 중 건강/운전자/의료/상해
# @MX:NOTE: [AUTO] (대분류코드, 중분류코드, 사람이 읽을 수 있는 이름) 튜플
TARGET_CATEGORIES: list[tuple[str, str, str]] = [
    ("L", "06", "건강보험"),
    ("L", "07", "운전자보험"),
    ("L", "15", "실손의료보험"),
    ("L", "16", "상해보험"),
]

RATE_LIMIT = 0.5  # 초
DEFAULT_FAIL_THRESHOLD = 0.05


@dataclass
class FailureRecord:
    """다운로드/인제스트 실패 건."""
    product_name: str
    category: str
    source_url: str
    sale_status: str
    error: str
    timestamp: str = field(default_factory=lambda: datetime.now(tz=timezone.utc).isoformat())


@dataclass
class MGIngestState:
    """MG손해보험 실패 상태 (재처리용 JSON 직렬화 가능)."""
    failures: list[FailureRecord] = field(default_factory=list)
    stop_reason: str = ""
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def save(self, path: Path) -> None:
        data = asdict(self)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info("실패 상태 저장: %s (%d건)", path, len(self.failures))

    @classmethod
    def load(cls, path: Path) -> "MGIngestState":
        data = json.loads(path.read_text(encoding="utf-8"))
        failures = [FailureRecord(**f) for f in data.get("failures", [])]
        return cls(
            failures=failures,
            stop_reason=data.get("stop_reason", ""),
            created_at=data.get("created_at", ""),
        )


def _category_display_name(lccd: str, mccd: str) -> str:
    """대분류/중분류 코드를 사람이 읽을 수 있는 이름으로 변환한다."""
    for lc, mc, name in TARGET_CATEGORIES:
        if lc == lccd and mc == mccd:
            return name
    return f"{lccd}-{mccd}"


# @MX:ANCHOR: [AUTO] collect_products - Playwright로 MG손해보험 상품 목록 수집
# @MX:REASON: Devon.js SPA이므로 브라우저 세션이 필수이며, comToken CSRF 토큰 필요
async def collect_products(page: object) -> list[dict]:
    """Playwright 페이지에서 대상 카테고리의 전체 상품 목록을 수집한다.

    Devon.js 프레임워크 기반 SPA이므로:
    1. 페이지 로딩 후 comToken 히든 인풋에서 CSRF 토큰 추출
    2. 각 카테고리 × 판매상태(0=판매중, 1=판매중지)별 AJAX API 호출
    3. JSON 응답에서 상품 목록 파싱
    """
    from playwright.async_api import Page  # type: ignore[attr-defined]
    page: Page  # type: ignore[no-redef]

    logger.info("[%s] 페이지 로딩: %s", COMPANY_NAME, PAGE_URL)
    await page.goto(PAGE_URL, timeout=30000, wait_until="domcontentloaded")
    await asyncio.sleep(3)

    all_products: list[dict] = []
    seen_data_idnos: set[str] = set()

    for lccd, mccd, cat_name in TARGET_CATEGORIES:
        for sale_yn, sale_label in [("0", "ON_SALE"), ("1", "DISCONTINUED")]:
            # Playwright evaluate로 AJAX 호출 (브라우저 세션/쿠키 유지)
            result = await page.evaluate(f"""
                async () => {{
                    const tokenEl = document.querySelector('input[name="comToken"]');
                    const token = tokenEl ? tokenEl.value : '';
                    const resp = await fetch('{PRODUCT_LIST_API}', {{
                        method: 'POST',
                        headers: {{'Content-Type': 'application/x-www-form-urlencoded'}},
                        body: new URLSearchParams({{
                            searchPrdtLccd: '{lccd}',
                            searchPrdtMccd: '{mccd}',
                            searchPrdtSaleYn: '{sale_yn}',
                            searchText: '',
                            comToken: token,
                            devonTokenFieldSessionscope: 'comToken',
                        }}).toString()
                    }});
                    const text = await resp.text();
                    try {{ return JSON.parse(text); }} catch(e) {{ return {{error: text.substring(0, 200)}}; }}
                }}
            """)

            if not result or "error" in result:
                logger.warning(
                    "[%s] API 응답 오류: %s %s (SaleYn=%s) - %s",
                    COMPANY_NAME, lccd, mccd, sale_yn,
                    result.get("error", "empty response") if result else "null",
                )
                continue

            rows = result.get("list", {}).get("rows", [])
            new_count = 0

            for row in rows:
                data_idno = str(row.get("dataIdno", ""))
                if not data_idno or data_idno in seen_data_idnos:
                    continue
                seen_data_idnos.add(data_idno)
                new_count += 1

                all_products.append({
                    "dataIdno": data_idno,
                    "productName": row.get("inskdAbbrNm", ""),
                    "doc2Org": row.get("doc2Org", ""),
                    "lccd": lccd,
                    "mccd": mccd,
                    "categoryName": cat_name,
                    "saleYn": sale_yn,
                    "saleStatus": sale_label,
                })

            logger.info(
                "[%s] %s (SaleYn=%s): %d개 조회, 신규 %d개 (누적 %d개)",
                COMPANY_NAME, cat_name, sale_yn,
                len(rows), new_count, len(all_products),
            )

    logger.info("[%s] 전체 상품 수집 완료: %d개 (중복 제거 후)", COMPANY_NAME, len(all_products))
    return all_products


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
    page: object,
    session_factory: object,
    products: list[dict],
    state: MGIngestState,
    state_output_path: Path,
    processed_urls: set[str],
    dry_run: bool = False,
    resume_urls: set[str] | None = None,
) -> dict[str, int]:
    """수집된 상품 목록에서 약관 PDF를 다운로드하고 인제스트한다."""
    stats = {"total": 0, "success": 0, "skipped": 0, "failed": 0, "dry_run": 0}

    for idx, product in enumerate(products, 1):
        data_idno = product["dataIdno"]
        product_name = product["productName"]
        cat_name = product["categoryName"]
        sale_status = product["saleStatus"]

        stats["total"] += 1
        # 소스 URL: 고유 식별용 (실제 다운로드는 POST 방식)
        source_url = f"{BASE_URL}{PDF_DOWNLOAD_API}?dataIdno={data_idno}&docCfcd=2"

        # resume 모드: 지정된 URL만 재처리
        if resume_urls is not None and source_url not in resume_urls:
            stats["skipped"] += 1
            continue

        # 이미 처리된 URL 스킵 (중복 다운로드 방지)
        if source_url in processed_urls:
            stats["skipped"] += 1
            logger.debug("[%d] URL 스킵 (이미 처리됨): %s", idx, product_name[:40])
            continue

        if idx % 50 == 0 or idx == 1:
            logger.info(
                "진행: %d / %d (성공=%d, 스킵=%d, 실패=%d)",
                stats["total"], len(products),
                stats["success"], stats["skipped"], stats["failed"],
            )

        await asyncio.sleep(RATE_LIMIT)

        # PDF 다운로드 (Playwright fetch - Devon.js 세션 쿠키 필요)
        # @MX:NOTE: [AUTO] fetch 후 ArrayBuffer → base64 변환하여 Python으로 전달
        pdf_bytes: bytes | None = None
        try:
            pdf_b64_result = await page.evaluate(f"""
                async () => {{
                    try {{
                        const resp = await fetch('{PDF_DOWNLOAD_API}', {{
                            method: 'POST',
                            headers: {{'Content-Type': 'application/x-www-form-urlencoded'}},
                            body: new URLSearchParams({{
                                dataIdno: '{data_idno}',
                                docCfcd: '2',
                            }}).toString()
                        }});
                        const status = resp.status;
                        const ct = resp.headers.get('content-type') || '';
                        const buf = await resp.arrayBuffer();
                        const bytes = new Uint8Array(buf);
                        // base64 인코딩 (청크 단위로 처리하여 콜스택 오버플로우 방지)
                        let binary = '';
                        const chunkSize = 8192;
                        for (let i = 0; i < bytes.length; i += chunkSize) {{
                            const chunk = bytes.subarray(i, i + chunkSize);
                            binary += String.fromCharCode.apply(null, chunk);
                        }}
                        const b64 = btoa(binary);
                        return {{status: status, contentType: ct, b64: b64, size: buf.byteLength}};
                    }} catch(e) {{
                        return {{error: e.toString()}};
                    }}
                }}
            """)

            if not pdf_b64_result or "error" in pdf_b64_result:
                error_msg = pdf_b64_result.get("error", "unknown") if pdf_b64_result else "null response"
                logger.warning("[%d] PDF 다운로드 실패: %s - %s", idx, product_name[:40], error_msg)
            else:
                http_status = pdf_b64_result.get("status", 0)
                size = pdf_b64_result.get("size", 0)
                b64_data = pdf_b64_result.get("b64", "")

                if http_status == 200 and b64_data and size > 1000:
                    raw_bytes = base64.b64decode(b64_data)
                    # PDF 시그니처 확인
                    if raw_bytes[:4] == b"%PDF":
                        pdf_bytes = raw_bytes
                    else:
                        logger.warning(
                            "[%d] PDF 시그니처 불일치: %s (sig=%s, size=%d)",
                            idx, product_name[:40], raw_bytes[:8], size,
                        )
                else:
                    logger.warning(
                        "[%d] 다운로드 실패: %s | HTTP=%d | size=%d",
                        idx, product_name[:40], http_status, size,
                    )
        except Exception as e:
            logger.warning("[%d] 다운로드 예외 %s: %s", idx, product_name[:40], e)

        if not pdf_bytes:
            stats["failed"] += 1
            state.failures.append(FailureRecord(
                product_name=product_name,
                category=cat_name,
                source_url=source_url,
                sale_status=sale_status,
                error="다운로드 실패 또는 PDF 시그니처 불일치",
            ))
            state.save(state_output_path)
            continue

        # 인제스트
        metadata = {
            "format_type": "B",
            "company_code": COMPANY_CODE,
            "company_name": COMPANY_NAME,
            "product_code": data_idno,
            "product_name": product_name,
            "category": "NON_LIFE",
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
            logger.info("[%d] 완료: %s (%s, %s)", idx, product_name[:40], cat_name, sale_status)
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
                category=cat_name,
                source_url=source_url,
                sale_status=sale_status,
                error=error_msg,
            ))
            state.save(state_output_path)

    return stats


async def run(
    dry_run: bool = False,
    resume_state_path: Path | None = None,
    state_output_path: Path = Path("failure_state_mg.json"),
) -> dict:
    """MG손해보험 크롤링 + 인제스트 메인 실행 함수."""
    from playwright.async_api import async_playwright

    logger.info("=" * 60)
    logger.info("%s 크롤링 + 인제스트 시작", COMPANY_NAME)
    logger.info("=" * 60)

    # DB 초기화 (dry-run 시 스킵)
    _db = None
    if not dry_run:
        import app.core.database as db_module
        from app.core.config import Settings
        from scripts.ingest_local_pdfs import load_processed_urls
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
    state = MGIngestState()
    resume_urls: set[str] | None = None
    if resume_state_path and resume_state_path.exists():
        prev_state = MGIngestState.load(resume_state_path)
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

        if dry_run:
            logger.info("[%s] DRY-RUN: 수집된 상품 %d개 출력", COMPANY_NAME, len(products))
            for i, p in enumerate(products, 1):
                logger.info(
                    "  [%d] dataIdno=%s | %s | %s | %s",
                    i, p["dataIdno"], p["productName"][:50],
                    p["categoryName"], p["saleStatus"],
                )
            total_stats["total"] = len(products)
            total_stats["dry_run"] = len(products)
        else:
            # Step 2: PDF 다운로드 + 인제스트
            total_stats = await download_and_ingest_all(
                page=page,
                session_factory=_db.session_factory if _db is not None else None,
                products=products,
                state=state,
                state_output_path=state_output_path,
                processed_urls=processed_urls,
                dry_run=dry_run,
                resume_urls=resume_urls,
            )

        await browser.close()

    # 최종 실패 상태 저장
    state.stop_reason = "completed"
    state.save(state_output_path)

    sep = "=" * 60
    print(f"\n{sep}")
    print(f"{COMPANY_NAME} 크롤링+인제스트 완료")
    print(sep)
    print(f"전체:        {total_stats['total']:>6,}개")
    print(f"성공:        {total_stats['success']:>6,}개")
    print(f"스킵(중복):  {total_stats['skipped']:>6,}개")
    print(f"실패:        {total_stats['failed']:>6,}개")
    if dry_run:
        print(f"dry-run:     {total_stats.get('dry_run', 0):>6,}개")
    print(sep)

    if state.failures:
        fail_rate = len(state.failures) / max(total_stats["total"], 1)
        print(f"실패율: {fail_rate:.1%} ({len(state.failures)}건)")
        print(f"재처리: python -m scripts.crawl_and_ingest_mg --resume-state {state_output_path}")

    return total_stats


def main() -> None:
    import sys

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
        default="failure_state_mg.json",
        help="실패 상태 저장 경로 (기본값: failure_state_mg.json)",
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
        logger.error("크롤링 실패 → exit code 1")
        sys.exit(1)


if __name__ == "__main__":
    main()
