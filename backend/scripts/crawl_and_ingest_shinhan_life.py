#!/usr/bin/env python3
"""신한라이프 크롤링 + 즉시 인제스트 통합 파이프라인

GitHub Actions 환경에서 실행하기 위한 스크립트.
1단계: Playwright로 공시 페이지 방문 → page.on("response") 인터셉트(1페이지)
       + page.evaluate 내부 fetch()로 2페이지 이상 수집
2단계: httpx로 PDF 직접 다운로드 (공개 CDN, 인증 불필요) → 즉시 인제스트 → 메모리 해제

실행:
    cd backend && PYTHONPATH=. uv run python -m scripts.crawl_and_ingest_shinhan_life
    cd backend && PYTHONPATH=. uv run python -m scripts.crawl_and_ingest_shinhan_life --dry-run
    cd backend && PYTHONPATH=. uv run python -m scripts.crawl_and_ingest_shinhan_life --resume-state failure_state_shinhan_life.json

# @MX:NOTE: [AUTO] 신한라이프 API: POST /co/wcms/nodeInfoListPage.pwkjson (catId=M160991914330045272)
# @MX:NOTE: [AUTO] meta06="TRUE"=판매중(cdhi0030), "FALSE"=판매중지(cdhi0040t01), catId는 동일
# @MX:NOTE: [AUTO] PDF: meta10=사업방법서, meta11=약관 (/repo/DigitalPlattform/... → /bizxpress/...)
# @MX:NOTE: [AUTO] 페이지네이션: 1페이지 인터셉트 + 2페이지~ page.evaluate fetch()
# @MX:NOTE: [AUTO] PDF 공개 CDN — httpx 직접 다운로드 가능 (HTTP 200 확인됨)
"""
from __future__ import annotations

import argparse
import asyncio
import datetime
import gc
import json
import logging
import math
import sys
import tempfile
from dataclasses import asdict, dataclass, field
from datetime import timezone
from pathlib import Path

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

COMPANY_CODE = "shinhan-life"
COMPANY_NAME = "신한라이프"
BASE_URL = "https://www.shinhanlife.co.kr"

# @MX:NOTE: [AUTO] 판매중/판매중지 모두 동일한 catId 사용, meta06으로 구분
LIST_API = f"{BASE_URL}/co/wcms/nodeInfoListPage.pwkjson"
CAT_ID = "M160991914330045272"
PAGE_SIZE = 50

RATE_LIMIT = 0.5  # 초
PAGE_WAIT_SEC = 8  # SPA 초기 로딩 대기
DEFAULT_STATE_FILE = "failure_state_shinhan_life.json"

HEADERS: dict[str, str] = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
    "Referer": BASE_URL,
}

# (scrnId, meta06, sale_status_label) 쌍
TARGETS = [
    ("cdhi0030", "TRUE", "ON_SALE"),
    ("cdhi0040t01", "FALSE", "DISCONTINUED"),
]


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
class ShinhanLifeIngestState:
    """신한라이프 실패 상태 (재처리용 JSON 직렬화 가능)."""
    failures: list[FailureRecord] = field(default_factory=list)
    stop_reason: str = ""
    created_at: str = field(default_factory=lambda: datetime.datetime.now(timezone.utc).isoformat())

    def save(self, path: Path) -> None:
        data = asdict(self)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info("실패 상태 저장: %s (%d건)", path, len(self.failures))

    @classmethod
    def load(cls, path: Path) -> "ShinhanLifeIngestState":
        data = json.loads(path.read_text(encoding="utf-8"))
        failures = [FailureRecord(**f) for f in data.get("failures", [])]
        return cls(
            failures=failures,
            stop_reason=data.get("stop_reason", ""),
            created_at=data.get("created_at", ""),
        )


def _build_pdf_url(repo_path: str) -> str:
    """신한라이프 PDF URL을 구성한다.

    # @MX:NOTE: [AUTO] /repo/DigitalPlattform/... → /bizxpress/... 경로 변환
    # @MX:NOTE: [AUTO] __etc/ 및 __media/ 하위 경로 모두 지원
    # @MX:NOTE: [AUTO] httpx.AsyncClient가 URL 인코딩을 자동 처리하므로 한글 파일명 사용 가능
    """
    if not repo_path:
        return ""
    # /repo/DigitalPlattform 제거 후 /bizxpress 접두사 추가
    prefix = "/repo/DigitalPlattform"
    if repo_path.startswith(prefix):
        path = repo_path[len(prefix):]
    else:
        path = repo_path
    return f"{BASE_URL}/bizxpress{path}"


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


# @MX:ANCHOR: [AUTO] collect_products - nodeInfoListPage API로 상품 목록 전체 수집
# @MX:REASON: 1페이지 응답 인터셉트 + 2페이지~ page.evaluate fetch() 페이지네이션
async def collect_products(
    page: object,
    scrnId: str,
    meta06: str,
    sale_status: str,
) -> list[dict]:
    """신한라이프 nodeInfoListPage API를 통해 상품 목록 전체를 수집한다.

    1. 공시 페이지 방문 → 자동 트리거되는 1페이지 응답 인터셉트
    2. listCount / PAGE_SIZE로 전체 페이지 수 계산
    3. 2페이지 이상: page.evaluate 내부 fetch()로 호출 (세션 쿠키 자동 포함)
    """
    from playwright.async_api import Page  # type: ignore[attr-defined]
    page: Page  # type: ignore[no-redef]

    page_url = f"{BASE_URL}/hp/{scrnId}.do"
    first_response: list[dict] = []

    async def _on_response(response: object) -> None:
        """nodeInfoListPage 첫 번째 응답을 캡처한다."""
        if "nodeInfoListPage" not in response.url:
            return
        if response.status != 200:
            return
        try:
            body = await response.body()
            data = json.loads(body.decode("utf-8", errors="ignore"))
            el = data.get("elData", {})
            items = el.get("nodeInfoVoList", [])
            if items:
                first_response.append(el)
        except Exception:
            pass

    page.on("response", _on_response)

    logger.info("[%s][%s] 페이지 로딩: %s", COMPANY_NAME, sale_status, page_url)
    try:
        await page.goto(page_url, timeout=60_000, wait_until="networkidle")
        await asyncio.sleep(PAGE_WAIT_SEC)
    except Exception as exc:
        logger.warning("[%s][%s] 페이지 로딩 타임아웃 (계속 진행): %s",
                       COMPANY_NAME, sale_status, exc)

    if not first_response:
        logger.warning("[%s][%s] 1페이지 응답 인터셉트 실패", COMPANY_NAME, sale_status)
        return []

    el0 = first_response[0]
    total_count: int = el0.get("listCount", 0)
    all_items: list[dict] = list(el0.get("nodeInfoVoList", []))

    logger.info(
        "[%s][%s] 총 %d건 수집 예정 (1페이지 %d건 캡처됨)",
        COMPANY_NAME, sale_status, total_count, len(all_items),
    )

    total_pages = math.ceil(total_count / PAGE_SIZE)

    # 2페이지 이상: page.evaluate 내부 fetch() 호출
    # 2페이지 이상: 페이지 JS 네임스페이스 함수를 호출하여 응답 인터셉트
    # @MX:NOTE: [AUTO] {scrnId}.Trms.selectGoodsList(pageNum) — dp.Ajax.send() 래퍼
    # @MX:NOTE: [AUTO] page.on("response") 리스너가 이미 등록되어 있어 응답 자동 캡처
    next_page_responses: list[dict] = []

    async def _on_page_response(response: object) -> None:
        """페이지네이션 API 응답을 버퍼에 추가한다."""
        if "nodeInfoListPage" not in response.url:
            return
        if response.status != 200:
            return
        try:
            body = await response.body()
            data = json.loads(body.decode("utf-8", errors="ignore"))
            el = data.get("elData", {})
            items = el.get("nodeInfoVoList", [])
            if items is not None:
                next_page_responses.append(el)
        except Exception:
            pass

    page.on("response", _on_page_response)
    # scrnId를 JS 네임스페이스로 변환 (cdhi0040t01 → cdhi0040t01)
    js_ns = scrnId  # 네임스페이스는 scrnId와 동일

    for page_idx in range(2, total_pages + 1):
        next_page_responses.clear()
        await asyncio.sleep(1)
        try:
            # JS 페이지네이션 함수 직접 호출
            await page.evaluate(
                f"() => {{ {js_ns}.Trms.selectGoodsList({page_idx}); }}"
            )
        except Exception as exc:
            logger.warning(
                "[%s][%s] 페이지 %d JS 호출 실패: %s",
                COMPANY_NAME, sale_status, page_idx, exc,
            )
            break

        # 응답 대기 (최대 15초)
        waited = 0
        while not next_page_responses and waited < 15:
            await asyncio.sleep(1)
            waited += 1

        if not next_page_responses:
            logger.warning(
                "[%s][%s] 페이지 %d 응답 없음 — 중단",
                COMPANY_NAME, sale_status, page_idx,
            )
            break

        items: list[dict] = next_page_responses[0].get("nodeInfoVoList", [])
        if not items:
            logger.info(
                "[%s][%s] 페이지 %d 빈 응답 — 수집 완료",
                COMPANY_NAME, sale_status, page_idx,
            )
            break

        all_items.extend(items)
        logger.info(
            "[%s][%s] 페이지 %d/%d 수집: %d건 (누적 %d건)",
            COMPANY_NAME, sale_status, page_idx, total_pages,
            len(items), len(all_items),
        )

    logger.info(
        "[%s][%s] 상품 수집 완료: %d건 (예상 %d건)",
        COMPANY_NAME, sale_status, len(all_items), total_count,
    )
    return all_items


# @MX:ANCHOR: [AUTO] download_and_ingest_all - 상품별 PDF 다운로드 및 인제스트 루프
# @MX:REASON: 크롤러 핵심 루프, 실패 상태 관리 및 resume 지원
async def download_and_ingest_all(
    session_factory: object,
    products: list[dict],
    state: ShinhanLifeIngestState,
    state_output_path: Path,
    processed_urls: set[str],
    dry_run: bool = False,
    resume_urls: set[str] | None = None,
) -> dict[str, int]:
    """수집된 상품 목록에서 약관 PDF를 다운로드하고 인제스트한다.

    # @MX:NOTE: [AUTO] meta11(약관) 우선, 없으면 meta10(사업방법서) 사용
    # @MX:NOTE: [AUTO] PDF URL = /bizxpress/cdh/cdhi/gd/pr/__etc/{filename} (한글 파일명 가능)
    """
    stats = {"total": 0, "success": 0, "skipped": 0, "failed": 0, "dry_run": 0}

    async with httpx.AsyncClient(
        headers=HEADERS,
        follow_redirects=True,
        timeout=60.0,
        verify=False,
    ) as client:
        for idx, item in enumerate(products, 1):
            sale_status: str = item.get("_sale_status", "UNKNOWN")
            product_name: str = item.get("meta05", "") or item.get("title", "")[:80]
            nd_id: str = item.get("ndId", "")

            # PDF 경로 추출: meta11(약관) 우선, meta10(사업방법서) fallback
            meta11: str = item.get("meta11", "") or ""
            meta10: str = item.get("meta10", "") or ""
            pdf_repo_path = meta11 or meta10
            doc_type = "약관" if meta11 else "사업방법서"

            if not pdf_repo_path:
                logger.debug("[%d] PDF 경로 없음 — 스킵: %s", idx, product_name[:50])
                continue

            stats["total"] += 1
            pdf_url = _build_pdf_url(pdf_repo_path)
            source_url = pdf_url

            if not pdf_url:
                stats["failed"] += 1
                state.failures.append(FailureRecord(
                    product_name=product_name or nd_id,
                    category="LIFE",
                    source_url=pdf_repo_path,
                    sale_status=sale_status,
                    error="PDF URL 구성 실패",
                ))
                continue

            # resume 모드
            if resume_urls is not None and source_url not in resume_urls:
                stats["skipped"] += 1
                continue

            # 이미 처리된 URL 스킵
            if source_url in processed_urls:
                stats["skipped"] += 1
                logger.debug("[%d] 이미 처리됨: %s", idx, product_name[:40])
                continue

            if idx % 50 == 0 or idx == 1:
                logger.info(
                    "진행: %d / %d (성공=%d, 스킵=%d, 실패=%d)",
                    idx, stats["total"],
                    stats["success"], stats["skipped"], stats["failed"],
                )

            await asyncio.sleep(RATE_LIMIT)

            if dry_run:
                logger.info(
                    "  [DRY] [%s] %s | %s | %s",
                    doc_type, product_name[:50], sale_status, pdf_url[:80],
                )
                stats["dry_run"] += 1
                continue

            # PDF 다운로드
            pdf_bytes: bytes | None = None
            try:
                resp = await client.get(pdf_url)
                if resp.status_code == 200:
                    data = resp.content
                    if len(data) > 1000 and data[:4] == b"%PDF":
                        pdf_bytes = data
                    else:
                        logger.warning(
                            "[%d] PDF 시그니처 불일치: %s (sig=%s, size=%d)",
                            idx, product_name[:40], data[:8], len(data),
                        )
                elif resp.status_code == 404:
                    logger.warning("[%d] 404 — 파일 없음: %s", idx, pdf_url[:80])
                else:
                    logger.warning(
                        "[%d] 다운로드 실패: %s | HTTP=%d",
                        idx, product_name[:40], resp.status_code,
                    )
            except Exception as exc:
                logger.warning("[%d] 다운로드 예외 %s: %s", idx, product_name[:40], exc)

            if not pdf_bytes:
                stats["failed"] += 1
                state.failures.append(FailureRecord(
                    product_name=product_name or nd_id,
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
                "product_code": nd_id or product_name[:50],
                "product_name": product_name,
                "category": "LIFE",
                "source_url": source_url,
                "sale_status": sale_status,
            }

            try:
                result = await ingest_pdf_bytes(
                    session_factory, pdf_bytes, metadata, dry_run=dry_run,
                )
            except Exception as exc:
                error_msg = f"{type(exc).__name__}: {exc}"
                logger.error("[%d] 인제스트 예외 %s: %s", idx, product_name[:40], error_msg)
                result = {"status": "failed", "error": error_msg}

            del pdf_bytes
            gc.collect()

            status = result.get("status", "failed")
            if status == "success":
                stats["success"] += 1
                processed_urls.add(source_url)
                logger.info("[%d] 완료: %s (%s)", idx, product_name[:40], sale_status)
            elif status == "skipped":
                stats["skipped"] += 1
                logger.debug("[%d] 스킵(중복): %s", idx, product_name[:40])
            else:
                stats["failed"] += 1
                error_msg = result.get("error", "")
                logger.warning("[%d] 인제스트 실패 %s: %s", idx, product_name[:40], error_msg)
                state.failures.append(FailureRecord(
                    product_name=product_name or nd_id,
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
    """신한라이프 크롤링 + 인제스트 메인 실행 함수."""
    from playwright.async_api import async_playwright

    logger.info("=" * 60)
    logger.info("%s 크롤링 + 인제스트 시작", COMPANY_NAME)
    logger.info("=" * 60)

    # DB 초기화
    _db = None
    if not dry_run:
        import app.core.database as db_module
        from app.core.config import Settings
        try:
            settings = Settings()  # type: ignore[call-arg]
            await db_module.init_database(settings)
        except Exception as exc:
            logger.error("DB 초기화 실패: %s", exc)
            return {"error": str(exc)}

        if db_module.session_factory is None:
            logger.error("DB 세션 팩토리 초기화 실패")
            return {"error": "session_factory is None"}

        _db = db_module

    # 이미 처리된 URL 로드
    if not dry_run and _db is not None:
        from scripts.ingest_local_pdfs import load_processed_urls
        async with _db.session_factory() as _session:
            processed_urls: set[str] = await load_processed_urls(
                _session, company_code=COMPANY_CODE,
            )
        logger.info(
            "이미 처리된 URL (%s): %d개",
            COMPANY_NAME, len(processed_urls),
        )
    else:
        processed_urls = set()
        logger.info("이미 처리된 URL: 0개 (dry-run 모드)")

    # resume 모드: 이전 실패 건 로드
    state = ShinhanLifeIngestState()
    resume_urls: set[str] | None = None
    if resume_state_path and resume_state_path.exists():
        prev_state = ShinhanLifeIngestState.load(resume_state_path)
        resume_urls = {f.source_url for f in prev_state.failures}
        logger.info("재처리 모드: %d건 재시도", len(resume_urls))

    total_stats: dict[str, int] = {
        "total": 0, "success": 0, "skipped": 0, "failed": 0, "dry_run": 0,
    }

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent=HEADERS["User-Agent"],
            locale="ko-KR",
        )
        page = await ctx.new_page()

        all_products: list[dict] = []

        for scrnId, meta06, sale_status in TARGETS:
            try:
                products = await collect_products(page, scrnId, meta06, sale_status)
                # sale_status 주입
                for p in products:
                    p["_sale_status"] = sale_status
                all_products.extend(products)
            except Exception as exc:
                logger.error(
                    "[%s] %s 상품 수집 실패: %s",
                    COMPANY_NAME, sale_status, exc,
                )

        await browser.close()

    if not all_products:
        logger.warning("[%s] 수집된 상품 없음", COMPANY_NAME)
        state.stop_reason = "no_products"
        state.save(state_output_path)
        return total_stats

    # 중복 제거 (동일 source_url)
    seen_urls: set[str] = set()
    deduped: list[dict] = []
    for p in all_products:
        meta11 = p.get("meta11", "") or ""
        meta10 = p.get("meta10", "") or ""
        url = _build_pdf_url(meta11 or meta10)
        if url and url not in seen_urls:
            seen_urls.add(url)
            deduped.append(p)
        elif not url:
            deduped.append(p)  # URL 없는 항목은 루프에서 처리

    logger.info(
        "[%s] 전체 수집: %d건 (중복 제거 후: %d건)",
        COMPANY_NAME, len(all_products), len(deduped),
    )

    if dry_run:
        logger.info("[%s] DRY-RUN 목록:", COMPANY_NAME)
        for i, p in enumerate(deduped, 1):
            meta11 = p.get("meta11", "") or ""
            meta10 = p.get("meta10", "") or ""
            url = _build_pdf_url(meta11 or meta10)
            doc_type = "약관" if meta11 else "사업방법서"
            logger.info(
                "  [%d] [%s] %s | %s | %s",
                i, doc_type, p.get("meta05", "")[:50],
                p.get("_sale_status", "?"), url[:80],
            )
        total_stats["total"] = len(deduped)
        total_stats["dry_run"] = len(deduped)
    else:
        total_stats = await download_and_ingest_all(
            session_factory=_db.session_factory if _db is not None else None,
            products=deduped,
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
        logger.info(
            "재처리: python -m scripts.crawl_and_ingest_shinhan_life "
            "--resume-state %s",
            state_output_path,
        )

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
