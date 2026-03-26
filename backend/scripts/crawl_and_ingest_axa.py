#!/usr/bin/env python3
"""AXA손해보험 크롤링 + 즉시 인제스트 통합 파이프라인

GitHub Actions 환경에서 로컬 스토리지 없이 실행하기 위한 스크립트.
PDF를 다운로드 후 임시 파일에 저장 → 즉시 인제스트 → 삭제 방식으로
디스크에 최대 1개 파일만 유지.

실행:
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_and_ingest_axa
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_and_ingest_axa --dry-run
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_and_ingest_axa --resume-state failure_state.json

# @MX:NOTE: GitHub Actions 전용 통합 파이프라인 - 로컬 스토리지 불필요
# @MX:NOTE: AXA손보 공시 페이지는 정적 HTML(UTF-8 BOM) → Playwright 불필요, httpx만 사용
# @MX:NOTE: 크롤링 로직(HTML 파싱) 재사용: crawl_axa_general.fetch_disclosure_html / parse_all_items
# @MX:NOTE: 실패 발생 시 즉시 중단(fail-stop) → failure_state.json artifact로 재처리 가능
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

# AXA손해보험 설정
COMPANY_CODE = "axa-general"
COMPANY_NAME = "AXA손해보험"
RATE_LIMIT = 0.5  # 초 (정적 HTML 기반이므로 0.5초)

DEFAULT_STATE_PATH = Path("failure_state.json")


@dataclass
class FailureRecord:
    """실패 건 상세 정보."""

    idx: int
    url: str
    prd_name: str
    category: str
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


_ICSFILES_BASE = "https://www.axa.co.kr"
_ICSFILES_MARKER = "__icsFiles/afieldfile/"
_FALLBACK_BASE = f"{_ICSFILES_BASE}/AsianPlatformInternet/doc/internet/public/"


def _build_fallback_url(url: str) -> str | None:
    """__icsFiles 경로에서 /doc/internet/public/ fallback URL 생성.

    AXA가 구형 Plone CMS의 __icsFiles 경로에서 신형 경로로 PDF를 마이그레이션했으나
    공시 페이지 HTML의 href는 아직 구형 경로를 가리키는 경우 사용.
    예: .../onsale/__icsFiles/afieldfile/2019/04/23/direct_acc_provision1904.pdf
     → https://www.axa.co.kr/AsianPlatformInternet/doc/internet/public/direct_acc_provision1904.pdf
    """
    if _ICSFILES_MARKER not in url:
        return None
    filename = url.rsplit("/", 1)[-1]
    return _FALLBACK_BASE + filename


async def _fetch_url(
    client: httpx.AsyncClient,
    url: str,
) -> tuple[bytes, int | None, str]:
    """단일 URL GET 요청 → (bytes, status, content_type)."""
    resp = await client.get(url, timeout=httpx.Timeout(30.0, connect=10.0), follow_redirects=True)
    content_type = resp.headers.get("content-type", "")
    return resp.content, resp.status_code, content_type


async def download_pdf_bytes(
    client: httpx.AsyncClient,
    url: str,
) -> tuple[bytes, int | None, str]:
    """PDF URL에서 바이트를 다운로드한다.

    __icsFiles 경로에서 404가 발생하면 /doc/internet/public/ 경로로 fallback 시도.

    Returns:
        (content_bytes, http_status, content_type)
        content_bytes가 빈 bytes면 실패.
    """
    def _validate(data: bytes, status: int | None, content_type: str, src_url: str) -> tuple[bytes, int | None, str]:
        if status is not None and status >= 400:
            return b"", status, content_type
        if len(data) < 1000:
            logger.warning("다운로드 응답 너무 작음 (%d bytes): %s", len(data), src_url[-80:])
            return b"", status, content_type
        if not data.startswith(b"%PDF"):
            logger.warning(
                "PDF 시그니처 불일치: %s (앞 20바이트: %r, Content-Type: %s)",
                src_url[-80:], data[:20], content_type,
            )
            return b"", status, content_type
        return data, status, content_type

    try:
        data, status, content_type = await _fetch_url(client, url)

        # __icsFiles 경로 404 → /doc/internet/public/ fallback 시도
        if status == 404:
            fallback_url = _build_fallback_url(url)
            if fallback_url:
                logger.info("  __icsFiles 404 → fallback 시도: %s", fallback_url[-80:])
                try:
                    fb_data, fb_status, fb_ct = await _fetch_url(client, fallback_url)
                    result = _validate(fb_data, fb_status, fb_ct, fallback_url)
                    if result[0]:
                        logger.info("  fallback 성공: %s", fallback_url[-80:])
                        return result
                    logger.warning("  fallback도 실패 (HTTP %s): %s", fb_status, fallback_url[-80:])
                except Exception as fb_e:
                    logger.warning("  fallback 요청 예외: %s", fb_e)
            logger.warning("다운로드 HTTP 오류 %d: %s", status, url[-80:])
            return b"", status, content_type

        if status is not None and status >= 400:
            logger.warning("다운로드 HTTP 오류 %d: %s", status, url[-80:])

        return _validate(data, status, content_type, url)

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

    print("\n처음 10건 URL:")
    for f in failures[:10]:
        print(f"  [{f.idx}] {f.url}")
        print(f"       오류={f.error_type}, HTTP={f.http_status}, size={f.file_size}bytes")
        if f.error_msg:
            print(f"       메시지: {f.error_msg[:100]}")
    print(sep)


# @MX:ANCHOR: [AUTO] AXA 크롤링+인제스트 메인 진입점
# @MX:REASON: GitHub Actions workflow 및 CLI __main__에서 호출되는 파이프라인 핵심 함수
async def crawl_and_ingest(
    dry_run: bool = False,
    resume_from: int = 0,
    resume_state_path: Path | None = None,
    state_output_path: Path = DEFAULT_STATE_PATH,
) -> dict:
    """AXA손해보험 크롤링 + 즉시 인제스트 실행.

    Args:
        dry_run: True이면 DB에 실제로 쓰지 않음
        resume_from: 이어서 시작할 인덱스
        resume_state_path: 이전 실패 상태 JSON 경로 (지정 시 해당 실패 건만 재처리)
        state_output_path: 크롤링 상태 저장 경로
    """
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

    # 재시작 시 이미 처리된 URL 스킵 (다운로드 전 체크)
    from scripts.ingest_local_pdfs import load_processed_urls
    async with _db.session_factory() as _session:
        processed_urls: set[str] = await load_processed_urls(_session, company_code=COMPANY_CODE)
    logger.info("이미 처리된 URL (AXA손보): %d개 (재시작 시 스킵됨)", len(processed_urls))

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

    # 이전 실패 상태 로드 (--resume-state 모드)
    retry_urls: set[str] | None = None
    prev_started_at: str | None = None
    if resume_state_path and resume_state_path.exists():
        try:
            prev_state = CrawlState.from_json(resume_state_path.read_text(encoding="utf-8"))
            retry_urls = {f.url for f in prev_state.failures}
            prev_started_at = prev_state.started_at
            logger.info(
                "이전 실패 상태 로드: %d건 재처리 예정 (이전 실행: %s)",
                len(retry_urls), prev_started_at,
            )
        except Exception as e:
            logger.warning("실패 상태 파일 로드 실패, 전체 처리로 진행: %s", e)

    current_state = CrawlState()

    # AXA 크롤링 로직 (crawl_axa_general 재사용)
    from scripts.crawl_axa_general import (  # noqa: PLC0415
        HEADERS as AXA_HEADERS,
        fetch_disclosure_html,
        parse_all_items,
    )

    async with httpx.AsyncClient(
        headers=AXA_HEADERS,
        follow_redirects=True,
        timeout=httpx.Timeout(30.0),
    ) as client:
        # 1단계: 공시 페이지 HTML 수집
        logger.info("=" * 60)
        logger.info("AXA손해보험 크롤링+인제스트 시작%s", " [DRY RUN]" if dry_run else "")
        logger.info("=" * 60)
        logger.info("[1/2] 공시 페이지 수집 중...")
        try:
            html = await fetch_disclosure_html(client)
            logger.info("  공시 페이지 수집 완료 (HTML 길이: %d자)", len(html))
        except Exception as e:
            logger.error("  공시 페이지 수집 실패: %s", e)
            return {"error": str(e)}

        # 2단계: PDF 링크 파싱
        logger.info("[1.5/2] PDF 링크 파싱 중...")
        targets = parse_all_items(html)
        stats["total"] = len(targets)
        logger.info("  수집 대상: %d개 (ON_SALE + DISCONTINUED)", len(targets))

        if dry_run:
            for t in targets:
                logger.info(
                    "  [DRY] [%s] %s (%s)",
                    t["sale_status"], t["product_name"][:60], t["product_code"],
                )
            logger.info("DRY RUN 완료. 실제 다운로드 없음.")
            stats["dry_run"] = len(targets)
            return stats

        # 처리 대상 결정
        if retry_urls is not None:
            # 이전 실패 건만 재처리
            pdf_tasks = [t for t in targets if t["source_url"] in retry_urls]
            logger.info("재처리 대상: %d개 (전체 %d개 중 실패 건만)", len(pdf_tasks), stats["total"])
            stats["total"] = len(pdf_tasks)
        elif resume_from > 0:
            logger.info("인덱스 %d부터 이어서 시작", resume_from)
            pdf_tasks = targets[resume_from:]
        else:
            pdf_tasks = targets

        logger.info("[2/2] PDF 다운로드+인제스트 시작 (총 %d개)...", len(pdf_tasks))

        # @MX:WARN: [AUTO] 순차 처리 필수 - asyncio.gather 사용 금지
        # @MX:REASON: pdfplumber + PDFMiner 내부 캐시가 asyncio gather 환경에서 GC 타이밍이 지연됨
        base_idx = 0 if retry_urls is not None else resume_from
        for loop_i, item in enumerate(pdf_tasks):
            idx = loop_i + 1 + base_idx

            url = item["source_url"]
            prd_name = item["product_name"]
            product_code = item["product_code"]
            category = item["category"]
            sale_status = item["sale_status"]

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

            # 이미 DB에 저장된 URL이면 다운로드 없이 스킵
            if url in processed_urls:
                stats["skipped"] += 1
                logger.debug("[%d] URL 스킵 (이미 처리됨): %s", idx, url[-60:])
                continue

            # 다운로드
            pdf_bytes, http_status, content_type = await download_pdf_bytes(client, url)
            current_state.last_processed_idx = idx

            if not pdf_bytes:
                # HTTP 404: 영구 오류 (파일 없음/삭제됨) → 경고만 로깅하고 재처리 없이 계속
                if http_status == 404:
                    logger.warning(
                        "[%d] HTTP 404 (파일 없음/삭제됨) → 재시도 불필요, 계속 진행: %s",
                        idx, url[-60:],
                    )
                    continue

                # 기타 오류 (5xx, 타임아웃 등): failures에 추가 후 즉시 중단 (fail_immediate)
                stats["failed"] += 1
                logger.warning(
                    "[%d] 다운로드 실패: %s | HTTP=%s | Content-Type=%s",
                    idx, url[-60:], http_status, content_type,
                )
                failure = FailureRecord(
                    idx=idx,
                    url=url,
                    prd_name=prd_name,
                    category=category,
                    error_type="download_failed",
                    http_status=http_status,
                    http_content_type=content_type,
                    error_msg=f"HTTP {http_status}, Content-Type: {content_type}",
                    file_size=0,
                )
                current_state.failures.append(failure)

                # 기타 오류 (5xx, 타임아웃 등): fail_immediate
                current_state.stopped_at = datetime.now(tz=timezone.utc).isoformat()
                current_state.stop_reason = "fail_immediate"
                save_state(current_state, state_output_path)
                logger.error(
                    "다운로드 실패 → 즉시 중단 (인덱스: %d)\n재시작: --resume-state %s",
                    idx, state_output_path,
                )
                break

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
                processed_urls.add(url)  # 런 중 중복 다운로드 방지
                ss = result.get("sale_status", sale_status)
                if ss == "ON_SALE":
                    stats["on_sale"] += 1
                elif ss == "DISCONTINUED":
                    stats["discontinued"] += 1
                else:
                    stats["unknown"] += 1
                logger.info("[%d] 완료: %s (%s)", idx, product_code, category)

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
                    error_type="ingest_failed",
                    http_status=None,
                    http_content_type="",
                    error_msg=error_msg[:500],
                    file_size=len(pdf_bytes),
                )
                current_state.failures.append(failure)
                logger.warning("[%d] 인제스트 실패: %s | %s", idx, product_code, error_msg[:100])

                # fail-stop: 인제스트 실패도 즉시 중단
                current_state.stopped_at = datetime.now(tz=timezone.utc).isoformat()
                current_state.stop_reason = "fail_immediate"
                save_state(current_state, state_output_path)
                logger.error("인제스트 실패 → 즉시 중단 (인덱스: %d)\n재시작: --resume-state %s", idx, state_output_path)
                break

    # 완료 처리
    if not current_state.stop_reason:
        current_state.stopped_at = datetime.now(tz=timezone.utc).isoformat()
        current_state.stop_reason = "completed"

    if current_state.failures:
        save_state(current_state, state_output_path)

    sep = "=" * 60
    print(f"\n{sep}")
    print(f"AXA손해보험 크롤링+인제스트 완료")
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
        print(f"재처리 명령: python -m scripts.crawl_and_ingest_axa --resume-state {state_output_path}")

    return {
        **stats,
        "stop_reason": current_state.stop_reason,
        "state_path": str(state_output_path) if current_state.failures else None,
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """CLI 인자를 파싱한다."""
    parser = argparse.ArgumentParser(
        description="AXA손해보험 크롤링 + 즉시 인제스트 (GitHub Actions 전용)",
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
        help="이어서 시작할 파일 인덱스 (이전 실행 중단 시 사용)",
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
    # fail_immediate 또는 DB 오류 시 exit code 1 (GitHub Actions 실패 표시)
    if isinstance(result, dict) and "error" in result:
        logger.error("종료 오류: %s", result["error"])
        sys.exit(1)
    if isinstance(result, dict) and result.get("stop_reason") == "fail_immediate":
        logger.error("fail_immediate 중단 → exit code 1")
        sys.exit(1)
