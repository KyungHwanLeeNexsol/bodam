#!/usr/bin/env python3
"""교보생명 크롤링 + 즉시 인제스트 통합 파이프라인

GitHub Actions 환경에서 실행하기 위한 스크립트.
1단계: Playwright로 전체상품조회 페이지 방문 (세션 쿠키 확보) -> page.request.post로 목록 API 호출
2단계: page.request.get으로 PDF 다운로드 (세션 쿠키 필요) -> 즉시 인제스트 -> 메모리 해제

실행:
    cd backend && PYTHONPATH=. uv run python -m scripts.crawl_and_ingest_kyobo_life
    cd backend && PYTHONPATH=. uv run python -m scripts.crawl_and_ingest_kyobo_life --dry-run
    cd backend && PYTHONPATH=. uv run python -m scripts.crawl_and_ingest_kyobo_life --resume-state failure_state_kyobo_life.json

# @MX:NOTE: [AUTO] 교보생명 API는 세션 쿠키가 필요하므로 page.request 사용 (httpx 불가)
# @MX:NOTE: [AUTO] PDF 다운로드도 세션 쿠키 + Referer 필요 → page.request.get 사용
# @MX:NOTE: [AUTO] 목록 API: POST /dtc/product-official/find-allProductSearch
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
from pathlib import Path
from urllib.parse import quote

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

COMPANY_CODE = "kyobo-life"
COMPANY_NAME = "교보생명"
REFERER_URL = "https://www.kyobo.com/dgt/web/product-official/all-product/search"
LIST_API_URL = "https://www.kyobo.com/dtc/product-official/find-allProductSearch"

RATE_LIMIT = 0.3  # 초
PAGE_SIZE = 100
DEFAULT_STATE_FILE = "failure_state_kyobo_life.json"

API_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "Referer": REFERER_URL,
    "Origin": "https://www.kyobo.com",
}


def _kyobo_pdf_url(a2_filename: str) -> str:
    """교보생명 PDF 다운로드 URL을 구성한다.

    # @MX:NOTE: [AUTO] a2 필드 = 저장된 파일명 (타임스탬프 prefix 포함)
    # @MX:NOTE: [AUTO] URL 패턴: /file/ajax/download?fName=/dtc/pdf/mm/{filename}
    """
    encoded = quote(a2_filename, safe="")
    return f"https://www.kyobo.com/file/ajax/download?fName=/dtc/pdf/mm/{encoded}"


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
class KyoboLifeIngestState:
    """교보생명 실패 상태 (재처리용 JSON 직렬화 가능)."""
    failures: list[FailureRecord] = field(default_factory=list)
    stop_reason: str = ""
    created_at: str = field(default_factory=lambda: datetime.datetime.now(timezone.utc).isoformat())

    def save(self, path: Path) -> None:
        data = asdict(self)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info("실패 상태 저장: %s (%d건)", path, len(self.failures))

    @classmethod
    def load(cls, path: Path) -> "KyoboLifeIngestState":
        data = json.loads(path.read_text(encoding="utf-8"))
        failures = [FailureRecord(**f) for f in data.get("failures", [])]
        return cls(
            failures=failures,
            stop_reason=data.get("stop_reason", ""),
            created_at=data.get("created_at", ""),
        )


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


# @MX:ANCHOR: [AUTO] collect_products - Playwright page.request로 교보생명 상품 목록 수집
# @MX:REASON: 세션 쿠키 필요하므로 page.request.post 사용, 페이지네이션 처리
async def collect_products(page: object) -> list[dict]:
    """Playwright page.request를 통해 교보생명 전체 상품 목록을 수집한다.

    1. Referer 페이지 방문으로 세션 쿠키 확보
    2. page.request.post로 목록 API 호출 (pageNo=1부터)
    3. totLstCnt 기준으로 전체 페이지 순회
    """
    from playwright.async_api import Page  # type: ignore[attr-defined]
    page: Page  # type: ignore[no-redef]

    # 세션 쿠키 확보를 위해 전체상품조회 페이지 방문
    logger.info("[%s] 전체상품조회 페이지 로딩 (세션 초기화)...", COMPANY_NAME)
    try:
        await page.goto(REFERER_URL, timeout=60_000, wait_until="networkidle")
        await asyncio.sleep(5)
    except Exception as exc:
        logger.warning("[%s] 초기 페이지 로드 실패 (계속 진행): %s", COMPANY_NAME, exc)

    all_items: list[dict] = []
    page_no = 1
    total_rows: int | None = None

    while True:
        try:
            req_body = json.dumps({
                "pageNo": page_no,
                "pageSize": PAGE_SIZE,
            })
            resp = await page.request.post(
                LIST_API_URL,
                data=req_body,
                headers=API_HEADERS,
                timeout=30_000,
            )
            if not resp.ok:
                logger.warning("[%s] 목록 API 응답 오류 (status=%d)", COMPANY_NAME, resp.status)
                break

            body = await resp.body()
            data = json.loads(body.decode("utf-8", errors="ignore"))

            if data.get("header", {}).get("code") != "SUCCESS":
                logger.warning(
                    "[%s] API 실패 응답: %s",
                    COMPANY_NAME,
                    data.get("header", {}).get("message"),
                )
                break

            body_data = data.get("body", {})
            items: list[dict] = body_data.get("list") or []
            if not items:
                break

            if total_rows is None:
                total_rows = int(body_data.get("listCnt", 0))
                logger.info("[%s] 전체 상품 수: %d개", COMPANY_NAME, total_rows)

            # API가 pageSize를 무시하고 전체를 반환하는 경우 대응
            # 첫 페이지에서 전체 수량과 동일하면 페이지네이션 불필요
            if len(items) >= (total_rows or 0) and page_no == 1:
                # 전체 반환 — 교보생명 상품만 필터 + dedup 후 바로 종료
                # @MX:NOTE: API가 전체 생보사 상품을 반환하므로 상품명에 "교보" 포함 필터
                seen_ids: set[str] = set()
                for item in items:
                    seq_id = str(item.get("dgtPdtAtrSeqtId") or "")
                    product_name = str(item.get("dgtPdtAtrNm") or "")
                    a2 = item.get("a2") or ""
                    # 교보생명 상품 필터: 상품명에 "교보" 포함 + a2(약관 PDF) 존재
                    if not seq_id or not a2:
                        continue
                    if "교보" not in product_name:
                        continue
                    if seq_id not in seen_ids:
                        seen_ids.add(seq_id)
                        all_items.append(item)
                logger.info(
                    "[%s] 전체 %d개 중 교보생명 상품 %d개 필터 (PDF 있는 것만)",
                    COMPANY_NAME, len(items), len(all_items),
                )
                break

            all_items.extend(items)
            logger.info(
                "[%s] 페이지 %d 수집: %d개 (누적 %d개)",
                COMPANY_NAME, page_no, len(items), len(all_items),
            )

            # 다음 페이지 여부 확인
            page_info = body_data.get("pageInfo", {})
            tot_cnt = int(page_info.get("totLstCnt", total_rows or 0))
            if page_no * PAGE_SIZE >= tot_cnt:
                break
            page_no += 1

        except Exception as exc:
            logger.warning("[%s] 페이지 %d 처리 오류: %s", COMPANY_NAME, page_no, exc)
            break

    logger.info("[%s] 전체 상품 수집 완료: %d개", COMPANY_NAME, len(all_items))
    return all_items


# @MX:ANCHOR: [AUTO] download_and_ingest_all - 상품별 PDF 다운로드 및 인제스트 루프
# @MX:REASON: 크롤러 핵심 루프, 실패 상태 관리 및 resume 지원
async def download_and_ingest_all(
    page: object,
    session_factory: object,
    products: list[dict],
    state: KyoboLifeIngestState,
    state_output_path: Path,
    processed_urls: set[str],
    dry_run: bool = False,
    resume_urls: set[str] | None = None,
) -> dict[str, int]:
    """수집된 상품 목록에서 약관 PDF를 다운로드하고 인제스트한다.

    # @MX:NOTE: [AUTO] PDF 다운로드는 세션 쿠키 + Referer 필요 → page.request.get 사용
    """
    from playwright.async_api import Page  # type: ignore[attr-defined]
    page: Page  # type: ignore[no-redef]

    stats = {"total": 0, "success": 0, "skipped": 0, "failed": 0, "dry_run": 0}

    for idx, item in enumerate(products, 1):
        seq_id: str = str(item.get("dgtPdtAtrSeqtId") or "")
        product_name_raw: str = item.get("dgtPdtAtrNm") or ""
        a2: str = item.get("a2") or ""
        sale_yn: str = item.get("saleYn") or "N"

        if not seq_id or not product_name_raw or not a2:
            continue

        stats["total"] += 1

        sale_status = "ON_SALE" if sale_yn == "Y" else "DISCONTINUED"
        pdf_url = _kyobo_pdf_url(a2)

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

        # 상품명 + seq_id로 중복 방지 (동일 상품명 다른 버전 존재 가능)
        product_name = f"{product_name_raw}_{seq_id}"

        # PDF 다운로드 (page.request.get - 세션 쿠키 + Referer 필요)
        pdf_bytes: bytes | None = None
        try:
            resp = await page.request.get(
                pdf_url,
                headers={"Referer": REFERER_URL},
                timeout=30_000,
            )
            if resp.status == 200:
                data = await resp.body()
                if len(data) > 1000 and data[:4] == b"%PDF":
                    pdf_bytes = data
                else:
                    logger.warning(
                        "[%d] PDF 시그니처 불일치: %s (sig=%s, size=%d)",
                        idx, product_name_raw[:40], data[:8], len(data),
                    )
            else:
                logger.warning(
                    "[%d] 다운로드 실패: %s | HTTP=%d",
                    idx, product_name_raw[:40], resp.status,
                )
        except Exception as e:
            logger.warning("[%d] 다운로드 예외 %s: %s", idx, product_name_raw[:40], e)

        if not pdf_bytes:
            stats["failed"] += 1
            state.failures.append(FailureRecord(
                product_name=product_name,
                category="LIFE",
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
            "product_code": seq_id,
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
    """교보생명 크롤링 + 인제스트 메인 실행 함수."""
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
    state = KyoboLifeIngestState()
    resume_urls: set[str] | None = None
    if resume_state_path and resume_state_path.exists():
        prev_state = KyoboLifeIngestState.load(resume_state_path)
        resume_urls = {f.source_url for f in prev_state.failures}
        logger.info("재처리 모드: %d건 재시도", len(resume_urls))

    total_stats: dict[str, int] = {"total": 0, "success": 0, "skipped": 0, "failed": 0, "dry_run": 0}

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context()
        page = await ctx.new_page()

        # Step 1: page.request로 상품 목록 수집
        try:
            products = await collect_products(page)
        except Exception as e:
            logger.error("[%s] 상품 목록 수집 실패: %s", COMPANY_NAME, e)
            await browser.close()
            return {"error": str(e)}

        if not products:
            logger.warning("[%s] 수집된 상품 없음", COMPANY_NAME)
            await browser.close()
            state.stop_reason = "no_products"
            state.save(state_output_path)
            return total_stats

        if dry_run:
            logger.info("[%s] DRY-RUN: 수집된 상품 %d개 출력", COMPANY_NAME, len(products))
            for i, p in enumerate(products, 1):
                seq_id = p.get("dgtPdtAtrSeqtId", "")
                name = p.get("dgtPdtAtrNm", "")
                a2 = p.get("a2", "")
                sale_yn = p.get("saleYn", "N")
                pdf_url = _kyobo_pdf_url(a2) if a2 else ""
                logger.info(
                    "  [%d] seqId=%s | %s | saleYn=%s | %s",
                    i, seq_id, name[:50], sale_yn, pdf_url[:80],
                )
            total_stats["total"] = len(products)
            total_stats["dry_run"] = len(products)
        else:
            # Step 2: page.request.get으로 PDF 다운로드 + 인제스트
            # 브라우저 컨텍스트 유지 (세션 쿠키 필요)
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
        logger.info("재처리: python -m scripts.crawl_and_ingest_kyobo_life --resume-state %s", state_output_path)

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
