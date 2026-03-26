#!/usr/bin/env python3
"""NH농협손해보험 크롤링 + 즉시 인제스트 통합 파이프라인

GitHub Actions 환경에서 로컬 스토리지 없이 실행하기 위한 스크립트.
PDF를 다운로드 후 임시 파일에 저장 → 즉시 인제스트 → 삭제 방식으로
디스크에 최대 1개 파일만 유지.

2단계 구성:
  Phase 1 (Playwright): 공시 페이지 SPA에서 상품 목록 전체 수집
  Phase 2 (httpx):      브라우저 쿠키 재사용 → PDF 다운로드 + 즉시 인제스트

실행:
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_and_ingest_nh
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_and_ingest_nh --dry-run
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_and_ingest_nh --resume-state failure_state_nh.json

# @MX:NOTE: GitHub Actions 전용 통합 파이프라인 - 로컬 스토리지 불필요
# @MX:NOTE: Devon.js SPA → Playwright 필수 (상품 목록 수집 + PDF 다운로드). httpx는 302 리다이렉트 후 타임아웃 발생
# @MX:NOTE: 수집 로직 재사용: crawl_nh_fire.collect_all_products / switch_tab
# @MX:NOTE: 다운로드: httpx POST /imageView/downloadFile.ajax (브라우저 세션 쿠키 재사용)
# @MX:NOTE: 실패 발생 시 즉시 중단(fail-stop) → failure_state_nh.json artifact로 재처리 가능
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

# NH농협손해보험 설정
COMPANY_CODE = "nh-fire"
COMPANY_NAME = "NH농협손해보험"
BASE_URL = "https://www.nhfire.co.kr"
DOWNLOAD_AJAX = f"{BASE_URL}/imageView/downloadFile.ajax"
ANNOUNCE_URL = f"{BASE_URL}/announce/productAnnounce/retrieveInsuranceProductsAnnounce.nhfire"

HEADERS: dict[str, str] = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
    "Referer": ANNOUNCE_URL,
}

RATE_LIMIT = 0.5  # 초
DEFAULT_STATE_PATH = Path("failure_state_nh.json")


@dataclass
class FailureRecord:
    """실패 건 상세 정보."""

    idx: int
    url: str           # source_url (file_id + a_file_seqn 포함)
    file_id: str
    a_file_seqn: str
    prd_name: str
    category: str
    sale_status: str
    error_type: str    # download_failed / ingest_failed
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


async def download_pdf_bytes(
    client: httpx.AsyncClient,
    file_id: str,
    a_file_seqn: str,
) -> tuple[bytes, int | None, str]:
    """httpx POST로 PDF를 다운로드한다.

    Returns:
        (content_bytes, http_status, content_type)
        content_bytes가 빈 bytes면 실패.
    """
    for method in ("POST", "GET"):
        try:
            if method == "POST":
                resp = await client.post(
                    DOWNLOAD_AJAX,
                    data={"oFileId": file_id, "oAfileSeqn": a_file_seqn},
                    timeout=httpx.Timeout(120.0),
                    follow_redirects=True,
                )
            else:
                resp = await client.get(
                    DOWNLOAD_AJAX,
                    params={"oFileId": file_id, "oAfileSeqn": a_file_seqn},
                    timeout=httpx.Timeout(120.0),
                    follow_redirects=True,
                )

            content_type = resp.headers.get("content-type", "")
            status = resp.status_code

            if status >= 400:
                logger.warning("다운로드 HTTP %d: fileId=%s (%s)", status, file_id, method)
                return b"", status, content_type

            data = resp.content
            if not data or len(data) < 1000:
                logger.warning(
                    "다운로드 응답 너무 작음 (%d bytes): fileId=%s (%s)",
                    len(data) if data else 0, file_id, method,
                )
                continue  # 다음 메서드 시도

            if data[:4] != b"%PDF":
                logger.warning(
                    "PDF 시그니처 불일치: fileId=%s (%s) (앞 20바이트: %r)",
                    file_id, method, data[:20],
                )
                continue

            return data, status, content_type

        except httpx.TimeoutException as e:
            logger.warning("다운로드 타임아웃: fileId=%s (%s) %s", file_id, method, e)
        except httpx.ConnectError as e:
            logger.warning("다운로드 연결 실패: fileId=%s (%s) %s", file_id, method, e)
        except Exception as e:
            logger.warning("다운로드 예외 fileId=%s (%s): %s (%s)", file_id, method, e, type(e).__name__)

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


def save_state(state: CrawlState, state_path: Path) -> None:
    """크롤링 상태를 JSON으로 저장한다."""
    state_path.write_text(state.to_json(), encoding="utf-8")
    logger.info("상태 저장 완료: %s (실패 %d건)", state_path, len(state.failures))


def print_failure_summary(failures: list[FailureRecord]) -> None:
    """실패 건 상세 요약을 출력한다."""
    if not failures:
        return

    sep = "-" * 60
    print(f"\n{sep}")
    print(f"실패 건 상세 ({len(failures)}건)")
    print(sep)

    by_type: dict[str, int] = {}
    by_status: dict[str | int, int] = {}
    for f in failures:
        by_type[f.error_type] = by_type.get(f.error_type, 0) + 1
        key = f.http_status if f.http_status else "연결실패/타임아웃"
        by_status[key] = by_status.get(key, 0) + 1

    print("오류 유형별:")
    for etype, cnt in sorted(by_type.items(), key=lambda x: -x[1]):
        print(f"  {etype}: {cnt}건")

    print("HTTP 상태별:")
    for status, cnt in sorted(by_status.items(), key=lambda x: -x[1]):
        print(f"  HTTP {status}: {cnt}건")

    print("\n처음 10건:")
    for f in failures[:10]:
        print(f"  [{f.idx}] {f.prd_name[:40]} (fileId={f.file_id})")
        print(f"       오류={f.error_type}, HTTP={f.http_status}, size={f.file_size}bytes")
        if f.error_msg:
            print(f"       메시지: {f.error_msg[:100]}")
    print(sep)


# @MX:ANCHOR: [AUTO] NH농협손해보험 크롤링+인제스트 메인 진입점
# @MX:REASON: GitHub Actions workflow 및 CLI __main__에서 호출되는 파이프라인 핵심 함수
async def crawl_and_ingest(
    dry_run: bool = False,
    resume_from: int = 0,
    resume_state_path: Path | None = None,
    state_output_path: Path = DEFAULT_STATE_PATH,
) -> dict:
    """NH농협손해보험 크롤링 + 즉시 인제스트 실행.

    Args:
        dry_run: True이면 DB에 실제로 쓰지 않음
        resume_from: 이어서 시작할 인덱스
        resume_state_path: 이전 실패 상태 JSON 경로 (지정 시 해당 실패 건만 재처리)
        state_output_path: 크롤링 상태 저장 경로
    """
    from playwright.async_api import async_playwright

    # 크롤링 보조 함수 import (crawl_nh_fire.py 재사용)
    from scripts.crawl_nh_fire import (  # noqa: PLC0415
        _infer_category,
        collect_all_products,
        download_pdf_via_playwright,
        switch_tab,
    )

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

    # 재시작 시 이미 처리된 URL 스킵
    from scripts.ingest_local_pdfs import load_processed_urls
    async with _db.session_factory() as _session:
        processed_urls: set[str] = await load_processed_urls(_session, company_code=COMPANY_CODE)
    logger.info("이미 처리된 URL (NH농협손보): %d개 (재시작 시 스킵됨)", len(processed_urls))

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
    logger.info("NH농협손해보험 크롤링+인제스트 시작%s", " [DRY RUN]" if dry_run else "")
    logger.info("=" * 60)

    all_products: list[dict] = []

    # Phase 1: Playwright로 상품 목록 수집
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
            await page.goto(ANNOUNCE_URL, timeout=60000, wait_until="networkidle")
            await asyncio.sleep(3)
            logger.info("  페이지 로딩 완료")
        except Exception as e:
            logger.error("  공시 페이지 로딩 실패: %s", e)
            await browser.close()
            return {"error": str(e)}

        # 판매중 + 판매중지 탭 순회
        tab_configs = [
            ("Y", "ON_SALE", "판매중"),
            ("N", "DISCONTINUED", "판매중지"),
        ]

        for sel_yn, sale_status, tab_label in tab_configs:
            logger.info("  [%s] 상품 목록 수집 중...", tab_label)
            await switch_tab(page, sel_yn)

            try:
                tab_products = await collect_all_products(page, sel_yn, sale_status)
            except Exception as e:
                logger.error("  [%s] 수집 오류: %s", tab_label, e)
                tab_products = []

            logger.info("  [%s] %d개 약관 항목 수집", tab_label, len(tab_products))
            all_products.extend(tab_products)
            await asyncio.sleep(1)

        logger.info(
            "[Phase 1 완료] 전체 %d개 약관 항목 (ON_SALE=%d, DISCONTINUED=%d)",
            len(all_products),
            sum(1 for p in all_products if p["sale_status"] == "ON_SALE"),
            sum(1 for p in all_products if p["sale_status"] == "DISCONTINUED"),
        )

        if dry_run:
            for p in all_products:
                logger.info(
                    "  [DRY] [%s] %s (%s, fileId=%s)",
                    p["sale_status"], p["product_name"][:55], p.get("sub_name", ""), p["file_id"],
                )
            logger.info("DRY RUN 완료. 실제 다운로드 없음.")
            stats["dry_run"] = len(all_products)
            stats["total"] = len(all_products)
            await browser.close()
            return stats

        stats["total"] = len(all_products)

        # 브라우저 세션 쿠키 추출 (다운로드 인증에 사용)
        browser_cookies = await context.cookies()
        cookie_dict = {c["name"]: c["value"] for c in browser_cookies}
        logger.info("  브라우저 세션 쿠키 추출 완료 (%d개)", len(cookie_dict))

        # Phase 2: httpx로 PDF 다운로드 + 즉시 인제스트
        logger.info("[Phase 2] PDF 다운로드+인제스트 시작 (총 %d개)...", len(all_products))

        # 처리 대상 결정
        if retry_urls is not None:
            pdf_tasks = [
                p for p in all_products
                if f"{DOWNLOAD_AJAX}?oFileId={p['file_id']}&oAfileSeqn={p['a_file_seqn']}" in retry_urls
            ]
            logger.info("재처리 대상: %d개 (전체 %d개 중 실패 건만)", len(pdf_tasks), stats["total"])
            stats["total"] = len(pdf_tasks)
        elif resume_from > 0:
            logger.info("인덱스 %d부터 이어서 시작", resume_from)
            pdf_tasks = all_products[resume_from:]
        else:
            pdf_tasks = all_products

        # @MX:WARN: [AUTO] 순차 처리 필수 - asyncio.gather 사용 금지
        # @MX:REASON: pdfplumber + PDFMiner 내부 캐시가 asyncio gather 환경에서 GC 타이밍이 지연됨
        base_idx = 0 if retry_urls is not None else resume_from
        async with httpx.AsyncClient(
            headers=HEADERS,
            cookies=cookie_dict,
            follow_redirects=True,
            timeout=httpx.Timeout(30.0),
        ) as client:
            for loop_i, prod in enumerate(pdf_tasks):
                idx = loop_i + 1 + base_idx

                file_id = prod["file_id"]
                a_file_seqn = prod["a_file_seqn"]
                prd_name = prod["product_name"]
                product_code = prod["product_code"]
                sale_status = prod["sale_status"]
                category = _infer_category(prd_name, prod.get("sub_name", ""))
                source_url = f"{DOWNLOAD_AJAX}?oFileId={file_id}&oAfileSeqn={a_file_seqn}"

                if loop_i % 50 == 0:
                    logger.info(
                        "진행: %d / %d (성공=%d, 스킵=%d, 실패=%d)",
                        idx,
                        stats["total"] + base_idx,
                        stats["success"],
                        stats["skipped"],
                        stats["failed"],
                    )

                # Rate limit
                await asyncio.sleep(RATE_LIMIT)

                # 이미 DB에 저장된 URL 스킵
                if source_url in processed_urls:
                    stats["skipped"] += 1
                    logger.debug("[%d] URL 스킵 (이미 처리됨): fileId=%s", idx, file_id)
                    continue

                # 쿠키 갱신 (50개마다 브라우저 세션 동기화)
                if loop_i > 0 and loop_i % 50 == 0:
                    try:
                        fresh_cookies = await context.cookies()
                        client.cookies.update({c["name"]: c["value"] for c in fresh_cookies})
                    except Exception as e:
                        logger.debug("쿠키 갱신 실패 (무시): %s", e)

                # 다운로드: Playwright 우선, httpx fallback
                # downloadFile.ajax가 302 리다이렉트 후 파일 서버로 이동하는데
                # httpx+쿠키만으로는 세션 인증이 안 됨 → Playwright 브라우저 세션 필수
                pdf_bytes: bytes | None = await download_pdf_via_playwright(
                    page, file_id, a_file_seqn
                )
                http_status: int | None = None
                content_type: str = ""
                if not pdf_bytes:
                    logger.debug(
                        "  [%d] Playwright 다운로드 실패 → httpx fallback: fileId=%s",
                        idx, file_id,
                    )
                    pdf_bytes, http_status, content_type = await download_pdf_bytes(
                        client, file_id, a_file_seqn
                    )
                current_state.last_processed_idx = idx

                if not pdf_bytes:
                    stats["failed"] += 1
                    failure = FailureRecord(
                        idx=idx,
                        url=source_url,
                        file_id=file_id,
                        a_file_seqn=a_file_seqn,
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
                    logger.warning(
                        "[%d] 다운로드 실패 (스킵): %s | HTTP=%s",
                        idx, prd_name[:40], http_status,
                    )
                    # 다운로드 실패는 skip & continue (타임아웃/CDN 불안정은 일시적 오류)
                    # 인제스트 실패는 여전히 fail_immediate로 처리 (버그 가능성)
                    save_state(current_state, state_output_path)
                    continue

                # 메타데이터 구성
                metadata = {
                    "format_type": "B",
                    "company_code": COMPANY_CODE,
                    "company_name": COMPANY_NAME,
                    "product_code": product_code,
                    "product_name": prd_name,
                    "category": "NON_LIFE",
                    "source_url": source_url,
                    "sale_status": sale_status,
                }

                # 인제스트
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
                    processed_urls.add(source_url)  # 런 중 중복 다운로드 방지
                    ss = result.get("sale_status", sale_status)
                    if ss == "ON_SALE":
                        stats["on_sale"] += 1
                    elif ss == "DISCONTINUED":
                        stats["discontinued"] += 1
                    else:
                        stats["unknown"] += 1
                    logger.info("[%d] 완료: %s (%s)", idx, prd_name[:40], category)

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
                        url=source_url,
                        file_id=file_id,
                        a_file_seqn=a_file_seqn,
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
                    logger.warning("[%d] 인제스트 실패: %s | %s", idx, prd_name[:40], error_msg[:100])

                    # fail-stop: 인제스트 실패도 즉시 중단
                    current_state.stopped_at = datetime.now(tz=timezone.utc).isoformat()
                    current_state.stop_reason = "fail_immediate"
                    save_state(current_state, state_output_path)
                    logger.error(
                        "인제스트 실패 → 즉시 중단 (인덱스: %d)\n재시작: --resume-state %s",
                        idx, state_output_path,
                    )
                    break

        await browser.close()

    # 완료 처리
    if not current_state.stop_reason:
        current_state.stopped_at = datetime.now(tz=timezone.utc).isoformat()
        current_state.stop_reason = "completed"

    if current_state.failures:
        save_state(current_state, state_output_path)

    sep = "=" * 60
    print(f"\n{sep}")
    print(f"NH농협손해보험 크롤링+인제스트 완료")
    print(f"중단 사유: {current_state.stop_reason}")
    print(sep)
    print(f"전체:        {stats['total']:>6,}개")
    print(f"성공:        {stats['success']:>6,}개")
    print(f"스킵(중복):  {stats['skipped']:>6,}개")
    print(f"실패:        {stats['failed']:>6,}개")
    print(sep)
    print(f"  ON_SALE:      {stats['on_sale']:>5,}개")
    print(f"  DISCONTINUED: {stats['discontinued']:>5,}개")
    print(f"  UNKNOWN:      {stats['unknown']:>5,}개")
    print(sep)

    if current_state.failures:
        print_failure_summary(current_state.failures)
        print(f"\n실패 상태 파일: {state_output_path}")
        print(f"재처리 명령: python -m scripts.crawl_and_ingest_nh --resume-state {state_output_path}")

    return {**stats, "state_path": str(state_output_path) if current_state.failures else None}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """CLI 인자를 파싱한다."""
    parser = argparse.ArgumentParser(
        description="NH농협손해보험 크롤링 + 즉시 인제스트 (GitHub Actions 전용)",
    )
    parser.add_argument(
        "--dry-run",
        dest="dry_run",
        action="store_true",
        help="DB에 실제로 쓰지 않고 처리 결과만 출력",
    )
    parser.add_argument(
        "--resume-from",
        type=int,
        default=0,
        dest="resume_from",
        help="이어서 시작할 파일 인덱스",
    )
    parser.add_argument(
        "--resume-state",
        type=Path,
        default=None,
        dest="resume_state",
        help="이전 실패 상태 JSON 경로 (지정 시 해당 실패 건만 재처리)",
    )
    parser.add_argument(
        "--state-output",
        type=Path,
        default=DEFAULT_STATE_PATH,
        dest="state_output",
        help=f"실패 상태 저장 경로 (기본값: {DEFAULT_STATE_PATH})",
    )
    return parser.parse_args(argv)


if __name__ == "__main__":
    args = parse_args()
    result = asyncio.run(crawl_and_ingest(
        dry_run=args.dry_run,
        resume_from=args.resume_from,
        resume_state_path=args.resume_state,
        state_output_path=args.state_output,
    ))
    if isinstance(result, dict) and "error" in result:
        logger.error("종료 오류: %s", result["error"])
        sys.exit(1)
