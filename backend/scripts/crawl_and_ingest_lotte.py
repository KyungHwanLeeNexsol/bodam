#!/usr/bin/env python3
"""롯데손해보험 크롤링 + 즉시 인제스트 통합 파이프라인

GitHub Actions 환경에서 로컬 스토리지 없이 실행하기 위한 스크립트.
PDF를 다운로드 후 임시 파일에 저장 → 즉시 인제스트 → 삭제 방식으로
디스크에 최대 1개 파일만 유지.

2단계 구성:
  Phase 1 (Playwright): 공시 페이지 SPA에서 4단계 UI 순회로 상품 목록 전체 수집
  Phase 2 (httpx):      직접 PDF URL 다운로드 + 즉시 인제스트

실행:
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_and_ingest_lotte
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_and_ingest_lotte --dry-run
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_and_ingest_lotte --resume-state failure_state_lotte.json

# @MX:NOTE: GitHub Actions 전용 통합 파이프라인 - 로컬 스토리지 불필요
# @MX:NOTE: 4단계 SPA(procTask→step2→step3→step4) → Playwright 필수, PDF URL은 /upload/C/ 직접 경로
# @MX:NOTE: 수집 로직 재사용: crawl_lotte_insurance._collect_products_via_network_intercept
# @MX:NOTE: 실패 발생 시 즉시 중단(fail-stop) → failure_state_lotte.json artifact로 재처리 가능
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

# 롯데손해보험 설정
COMPANY_CODE = "lotte-insurance"
COMPANY_NAME = "롯데손해보험"
BASE_URL = "https://www.lotteins.co.kr"
PRODUCT_LIST_URL = f"{BASE_URL}/web/C/D/H/cdh190.jsp"
RATE_LIMIT = 0.5  # 초

DEFAULT_STATE_PATH = Path("failure_state_lotte.json")

HEADERS: dict[str, str] = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Referer": PRODUCT_LIST_URL,
}


@dataclass
class FailureRecord:
    """실패 건 상세 정보."""

    idx: int
    url: str
    prd_name: str
    category: str
    sale_status: str
    error_type: str          # download_failed / ingest_failed
    http_status: int | None
    http_content_type: str
    error_msg: str
    file_size: int
    timestamp: str = field(default_factory=lambda: datetime.now(tz=timezone.utc).isoformat())


@dataclass
class CrawlState:
    """크롤링 상태 (중단/재시작용)."""

    last_processed_idx: int = 0
    failures: list[FailureRecord] = field(default_factory=list)
    started_at: str = field(default_factory=lambda: datetime.now(tz=timezone.utc).isoformat())
    stopped_at: str | None = None
    stop_reason: str | None = None  # fail_immediate / completed / interrupted

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


def save_state(state: CrawlState, state_path: Path) -> None:
    """크롤링 상태를 JSON으로 저장한다."""
    state_path.write_text(state.to_json(), encoding="utf-8")
    logger.info("상태 저장 완료: %s (실패 %d건)", state_path, len(state.failures))


def _extract_product_code(url: str, fallback_idx: int = 0) -> str:
    """PDF URL에서 상품코드를 추출한다. 추출 불가 시 URL 기반 코드를 반환한다."""
    # URL 패턴: /upload/C/D/H/파일명.pdf
    stem = Path(url.split("?")[0]).stem
    if stem and len(stem) > 2:
        return stem[:50]
    return f"lotte_{fallback_idx:04d}"


async def download_pdf_bytes(
    client: httpx.AsyncClient,
    url: str,
) -> tuple[bytes, int | None, str]:
    """PDF URL에서 바이트를 다운로드한다.

    Returns:
        (content_bytes, http_status, content_type)
        content_bytes가 빈 bytes면 실패.
    """
    try:
        resp = await client.get(url, timeout=httpx.Timeout(60.0, connect=10.0))
        content_type = resp.headers.get("content-type", "")
        status = resp.status_code

        if status >= 400:
            logger.warning("다운로드 HTTP %d: %s", status, url[-80:])
            return b"", status, content_type

        data = resp.content
        if not data or len(data) < 1000:
            logger.warning("다운로드 응답 너무 작음 (%d bytes): %s", len(data) if data else 0, url[-80:])
            return b"", status, content_type

        if data[:4] != b"%PDF":
            if data[:2] == b"PK":
                logger.info(
                    "ZIP 파일 수신: %s (%d bytes) → 저장 보류",
                    url[-80:], len(data),
                )
                return data, status, content_type
            logger.warning(
                "PDF 시그니처 불일치: %s (앞 20바이트: %r, Content-Type: %s)",
                url[-80:], data[:20], content_type,
            )
            return b"", status, content_type

        return data, status, content_type

    except httpx.TimeoutException as e:
        logger.warning("다운로드 타임아웃: %s (%s)", url[-80:], e)
        return b"", None, ""
    except httpx.ConnectError as e:
        logger.warning("다운로드 연결 실패: %s (%s)", url[-80:], e)
        return b"", None, ""
    except Exception as e:
        logger.warning("다운로드 예외 %s: %s (%s)", url[-80:], e, type(e).__name__)
        return b"", None, ""


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


async def crawl_and_ingest(
    dry_run: bool = False,
    resume_from: int = 0,
    resume_state_path: Path | None = None,
    state_output_path: Path = DEFAULT_STATE_PATH,
) -> dict:
    """롯데손해보험 크롤링 + 즉시 인제스트 실행.

    Args:
        dry_run: True이면 DB에 실제로 쓰지 않음
        resume_from: 이어서 시작할 인덱스
        resume_state_path: 이전 실패 상태 JSON 경로 (지정 시 해당 실패 건만 재처리)
        state_output_path: 크롤링 상태 저장 경로
    """
    # 크롤링 보조 함수 import (crawl_lotte_insurance.py 재사용)
    from scripts.crawl_lotte_insurance import (  # noqa: PLC0415
        SALE_STATUS_MAP,
        _collect_products_via_network_intercept,
    )

    # DB 초기화 (dry-run 시 스킵)
    _db = None
    if not dry_run:
        try:
            from app.core.config import Settings
            import app.core.database as db_module
            settings = Settings()  # type: ignore[call-arg]
            await db_module.init_database(settings)
        except Exception as e:
            logger.error("DB 초기화 실패: %s", e)
            return {"error": str(e)}

        import app.core.database as _db  # type: ignore[no-redef]
        if _db.session_factory is None:
            logger.error("DB 세션 팩토리 초기화 실패")
            return {"error": "session_factory is None"}

    # 이미 처리된 URL 로드 (재시작 시 중복 스킵, dry-run 시 빈 set)
    if not dry_run and _db is not None:
        from scripts.ingest_local_pdfs import load_processed_urls
        async with _db.session_factory() as _session:
            processed_urls: set[str] = await load_processed_urls(_session, company_code=COMPANY_CODE)
        logger.info("이미 처리된 URL (%s): %d개 (재시작 시 스킵됨)", COMPANY_NAME, len(processed_urls))
    else:
        processed_urls = set()
        logger.info("이미 처리된 URL (%s): 0개 (dry-run 모드)", COMPANY_NAME)

    stats = {
        "total": 0,
        "success": 0,
        "skipped": 0,
        "failed": 0,
        "dry_run": 0,
        "on_sale": 0,
        "discontinued": 0,
        "unknown": 0,
    }

    # 이전 실패 상태 로드
    retry_urls: set[str] | None = None
    if resume_state_path and resume_state_path.exists():
        try:
            prev_state = CrawlState.from_json(resume_state_path.read_text(encoding="utf-8"))
            retry_urls = {f.url for f in prev_state.failures}
            logger.info(
                "이전 실패 상태 로드: %d건 재처리 예정 (이전 실행: %s)",
                len(retry_urls), prev_state.started_at,
            )
        except Exception as e:
            logger.warning("실패 상태 파일 로드 실패, 전체 처리로 진행: %s", e)

    current_state = CrawlState()

    logger.info("=" * 60)
    logger.info("%s 크롤링+인제스트 시작%s", COMPANY_NAME, " [DRY RUN]" if dry_run else "")
    logger.info("=" * 60)

    all_products: list[dict] = []

    # Phase 1: Playwright로 상품 목록 수집 (4단계 SPA 순회)
    from playwright.async_api import async_playwright  # noqa: PLC0415
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            accept_downloads=True,
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
        )
        page = await context.new_page()

        logger.info("[Phase 1] 공시 페이지 로딩 중...")
        try:
            await page.goto(PRODUCT_LIST_URL, timeout=60000, wait_until="networkidle")
            await asyncio.sleep(3)
            logger.info("  페이지 로딩 완료")
        except Exception as e:
            logger.error("  공시 페이지 로딩 실패: %s", e)
            await browser.close()
            return {"error": str(e)}

        # 판매중 / 판매중지 각각 수집
        for issale, sale_status in SALE_STATUS_MAP.items():
            logger.info("  [%s] 상품 목록 수집 중...", sale_status)
            try:
                tab_products = await _collect_products_via_network_intercept(
                    page, issale, sale_status,
                )
            except Exception as e:
                logger.error("  [%s] 수집 오류: %s", sale_status, e)
                tab_products = []

            # URL 중복 제거
            seen_urls: set[str] = {p["url"] for p in all_products if p.get("url")}
            new_products = [p for p in tab_products if p.get("url") and p["url"] not in seen_urls]
            all_products.extend(new_products)
            logger.info("  [%s] %d개 약관 항목 수집 (%d개 신규)", sale_status, len(tab_products), len(new_products))
            await asyncio.sleep(1)

        await browser.close()

    logger.info(
        "[Phase 1 완료] 전체 %d개 약관 항목 (ON_SALE=%d, DISCONTINUED=%d)",
        len(all_products),
        sum(1 for p in all_products if p.get("sale_status") == "ON_SALE"),
        sum(1 for p in all_products if p.get("sale_status") == "DISCONTINUED"),
    )

    if dry_run:
        for p in all_products:
            logger.info(
                "  [DRY] [%s] %s | %s | %s",
                p.get("sale_status", "?"),
                p.get("category", "?")[:20],
                p.get("product_name", "?")[:40],
                p.get("url", "?")[-60:],
            )
        logger.info("DRY RUN 완료. 실제 다운로드 없음.")
        stats["dry_run"] = len(all_products)
        stats["total"] = len(all_products)
        return stats

    if not all_products:
        logger.warning("%s 수집된 PDF가 없습니다. 사이트 구조 변경 확인 필요.", COMPANY_NAME)
        return {"error": "no_products_found"}

    stats["total"] = len(all_products)

    # 처리 대상 결정
    if retry_urls is not None:
        pdf_tasks = [p for p in all_products if p.get("url") in retry_urls]
        logger.info("재처리 대상: %d개 (전체 %d개 중 실패 건만)", len(pdf_tasks), stats["total"])
        stats["total"] = len(pdf_tasks)
    elif resume_from > 0:
        logger.info("인덱스 %d부터 이어서 시작", resume_from)
        pdf_tasks = all_products[resume_from:]
    else:
        pdf_tasks = all_products

    logger.info("[Phase 2] PDF 다운로드+인제스트 시작 (총 %d개)...", len(pdf_tasks))

    base_idx = 0 if retry_urls is not None else resume_from
    async with httpx.AsyncClient(
        headers=HEADERS,
        follow_redirects=True,
        timeout=httpx.Timeout(60.0),
    ) as client:
        for loop_i, prod in enumerate(pdf_tasks):
            idx = loop_i + 1 + base_idx

            url = prod.get("url", "")
            prd_name = prod.get("product_name", "") or _extract_product_code(url, idx)
            product_code = prod.get("product_code", "") or _extract_product_code(url, idx)
            category = prod.get("category", "기타")
            sale_status = prod.get("sale_status", "ON_SALE")

            if loop_i % 50 == 0:
                logger.info(
                    "진행: %d / %d (성공=%d, 스킵=%d, 실패=%d)",
                    idx,
                    stats["total"] + base_idx,
                    stats["success"],
                    stats["skipped"],
                    stats["failed"],
                )

            if not url:
                logger.warning("[%d] URL 없음 (스킵): %s", idx, prd_name[:40])
                stats["failed"] += 1
                continue

            # Rate limit
            await asyncio.sleep(RATE_LIMIT)

            # 이미 DB에 저장된 URL이면 스킵
            if url in processed_urls:
                stats["skipped"] += 1
                logger.debug("[%d] URL 스킵 (이미 처리됨): %s", idx, url[-60:])
                continue

            # 다운로드
            pdf_bytes, http_status, content_type = await download_pdf_bytes(client, url)
            current_state.last_processed_idx = idx

            if not pdf_bytes:
                # 404: 파일 없음/삭제 → 경고만 로깅하고 계속
                if http_status == 404:
                    logger.warning(
                        "[%d] HTTP 404 (파일 없음/삭제됨) → 계속 진행: %s",
                        idx, url[-60:],
                    )
                    continue

                # 기타 오류: fail_immediate
                stats["failed"] += 1
                failure = FailureRecord(
                    idx=idx,
                    url=url,
                    prd_name=prd_name,
                    category=category,
                    sale_status=sale_status,
                    error_type="download_failed",
                    http_status=http_status,
                    http_content_type=content_type,
                    error_msg=f"HTTP {http_status}, Content-Type: {content_type}",
                    file_size=0,
                )
                current_state.failures.append(failure)
                current_state.stopped_at = datetime.now(tz=timezone.utc).isoformat()
                current_state.stop_reason = "fail_immediate"
                save_state(current_state, state_output_path)
                logger.error(
                    "다운로드 실패 → 즉시 중단 (인덱스: %d)\n재시작: --resume-state %s",
                    idx, state_output_path,
                )
                break
            elif pdf_bytes[:2] == b"PK":
                # ZIP 파일: 임베딩 보류, 실패 아님
                logger.info(
                    "[%d] ZIP 파일 인제스트 보류 (임베딩 미지원): %s (%d bytes)",
                    idx, prd_name[:40], len(pdf_bytes),
                )
                continue

            # 메타데이터 구성
            metadata = {
                "format_type": "B",
                "company_code": COMPANY_CODE,
                "company_name": COMPANY_NAME,
                "product_code": product_code,
                "product_name": prd_name,
                "category": "NON_LIFE",
                "source_url": url,
                "sale_status": sale_status,
            }

            # 인제스트 (임시 파일 → 처리 → 삭제)
            try:
                result = await ingest_pdf_bytes(
                    _db.session_factory,
                    pdf_bytes,
                    metadata,
                    dry_run=dry_run,
                )
            except Exception as e:
                error_msg = f"{type(e).__name__}: {e}"
                logger.error("[%d] 인제스트 예외 %s: %s", idx, product_code, error_msg)
                result = {"status": "failed", "error": error_msg}

            gc.collect()

            ingest_status = result.get("status", "failed")
            if ingest_status == "success":
                stats["success"] += 1
                processed_urls.add(url)
                ss = result.get("sale_status", sale_status)
                if ss == "ON_SALE":
                    stats["on_sale"] += 1
                elif ss == "DISCONTINUED":
                    stats["discontinued"] += 1
                else:
                    stats["unknown"] += 1
                logger.info("[%d] 완료: %s (%s)", idx, product_code[:40], category[:20])

            elif ingest_status == "skipped":
                stats["skipped"] += 1
                logger.debug("[%d] 스킵(중복): %s", idx, product_code)

            elif ingest_status == "dry_run":
                stats["dry_run"] += 1

            else:
                stats["failed"] += 1
                error_msg = result.get("error", "")
                failure = FailureRecord(
                    idx=idx,
                    url=url,
                    prd_name=prd_name,
                    category=category,
                    sale_status=sale_status,
                    error_type="ingest_failed",
                    http_status=None,
                    http_content_type="",
                    error_msg=error_msg[:500],
                    file_size=len(pdf_bytes),
                )
                current_state.failures.append(failure)
                current_state.stopped_at = datetime.now(tz=timezone.utc).isoformat()
                current_state.stop_reason = "fail_immediate"
                save_state(current_state, state_output_path)
                logger.error(
                    "인제스트 실패 → 즉시 중단 (인덱스: %d, 오류: %s)\n재시작: --resume-state %s",
                    idx, error_msg[:100], state_output_path,
                )
                break

    # 최종 결과
    logger.info("=" * 60)
    logger.info(
        "%s 완료: 성공=%d, 스킵=%d, 실패=%d (총 %d)",
        COMPANY_NAME, stats["success"], stats["skipped"], stats["failed"], stats["total"],
    )
    logger.info("=" * 60)
    return stats


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=f"{COMPANY_NAME} 크롤링 + 인제스트")
    parser.add_argument("--dry-run", action="store_true", help="DB에 실제로 저장하지 않음")
    parser.add_argument("--resume-from", type=int, default=0, metavar="N", help="N번째 항목부터 이어서 시작")
    parser.add_argument(
        "--resume-state",
        type=Path,
        default=None,
        metavar="FILE",
        help="이전 실패 상태 JSON 파일 (지정 시 실패 건만 재처리)",
    )
    parser.add_argument(
        "--state-output",
        type=Path,
        default=DEFAULT_STATE_PATH,
        metavar="FILE",
        help=f"실패 상태 저장 경로 (기본: {DEFAULT_STATE_PATH})",
    )
    return parser.parse_args(argv)


async def run(args: argparse.Namespace) -> dict:
    return await crawl_and_ingest(
        dry_run=args.dry_run,
        resume_from=args.resume_from,
        resume_state_path=args.resume_state,
        state_output_path=args.state_output,
    )


if __name__ == "__main__":
    import sys
    args = parse_args()
    result = asyncio.run(run(args))
    if isinstance(result, dict) and "error" in result:
        logger.error("크롤링 실패 → exit code 1")
        sys.exit(1)
