#!/usr/bin/env python3
"""삼성화재 크롤링 + 즉시 인제스트 통합 파이프라인

GitHub Actions 환경에서 로컬 스토리지 없이 실행하기 위한 스크립트.
PDF를 다운로드 후 임시 파일에 저장 → 즉시 인제스트 → 삭제 방식으로
디스크에 최대 1개 파일만 유지.

실행:
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_and_ingest_samsung
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_and_ingest_samsung --dry-run
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_and_ingest_samsung --gun 장기
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_and_ingest_samsung --resume-state failure_state.json

# @MX:NOTE: GitHub Actions 전용 통합 파이프라인 - 로컬 스토리지 불필요
# @MX:NOTE: 임시 파일 방식: tempfile.NamedTemporaryFile → process_single_file → 삭제
# @MX:NOTE: 실패 상태 저장: failure_state.json → artifact 업로드 → --resume-state로 재시작
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

# 삼성화재 API 설정
API_URL = "https://www.samsungfire.com/vh/data/VH.HDIF0103.do"
PDF_BASE = "https://www.samsungfire.com"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.samsungfire.com",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "ko-KR,ko;q=0.9",
    "X-Requested-With": "XMLHttpRequest",
}

# 수집 대상 카테고리
TARGET_GUN_GB: dict[str, set[str]] = {
    "장기": {"건강", "상해", "종합", "자녀", "통합", "통합형"},
    "일반보험": {"상해", "종합"},
}

MIN_SALE_END_DT = "19000101"
RATE_LIMIT = 1.0
DEFAULT_FAIL_THRESHOLD = 0.05
FAIL_MIN_SAMPLES = 50

# 실패 상태 저장 경로 (GitHub Actions artifact로 업로드)
DEFAULT_STATE_PATH = Path("failure_state.json")


@dataclass
class FailureRecord:
    """실패 건 상세 정보."""
    idx: int
    fpath: str
    url: str
    prd_name: str
    prd_gun: str
    prd_gb: str
    error_type: str          # download_failed / ingest_failed / invalid_content
    http_status: int | None  # HTTP 상태코드 (다운로드 실패 시)
    http_content_type: str   # 응답 Content-Type
    error_msg: str
    file_size: int           # 다운로드된 바이트 수 (0이면 빈 응답)
    timestamp: str = field(default_factory=lambda: datetime.now(tz=timezone.utc).isoformat())


@dataclass
class CrawlState:
    """크롤링 상태 (중단/재시작용)."""
    last_processed_idx: int = 0
    failures: list[FailureRecord] = field(default_factory=list)
    started_at: str = field(default_factory=lambda: datetime.now(tz=timezone.utc).isoformat())
    stopped_at: str | None = None
    stop_reason: str | None = None  # fail_threshold / completed / interrupted

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


async def fetch_all_products(client: httpx.AsyncClient) -> list[dict]:
    """API에서 전체 약관 목록을 가져온다."""
    logger.info("삼성화재 약관 API 조회 중...")
    resp = await client.post(API_URL, timeout=60.0)
    resp.raise_for_status()
    data = resp.json()
    items: list[dict] = data["responseMessage"]["body"]["data"]["list"]
    logger.info("전체 %d개 항목 조회 완료", len(items))
    return items


def filter_targets(items: list[dict], gun_filter: str | None = None) -> list[dict]:
    """질병/상해 관련 항목을 필터링한다."""
    today = datetime.now(tz=timezone.utc).strftime("%Y%m%d")
    result = []
    for item in items:
        gun = item.get("prdGun", "")
        gb = item.get("prdGb", "")
        sale_end = item.get("saleEnDt", "0")
        f1 = item.get("prdfilename1", "")

        if gun not in TARGET_GUN_GB:
            continue
        if gb not in TARGET_GUN_GB[gun]:
            continue
        if gun_filter and gun != gun_filter:
            continue
        if sale_end < MIN_SALE_END_DT:
            continue
        if not f1:
            continue

        item["_sale_status"] = "ON_SALE" if (not sale_end or sale_end >= today) else "DISCONTINUED"
        result.append(item)
    return result


_DOWNLOAD_MAX_RETRIES = 3
_DOWNLOAD_RETRY_BASE_WAIT = 2.0  # 초 (exponential: 2s, 4s, 8s)


async def download_pdf(
    client: httpx.AsyncClient, path: str
) -> tuple[bytes, int | None, str]:
    """약관 PDF/DOCX를 다운로드한다 (RemoteProtocolError 재시도 포함).

    Returns:
        (content_bytes, http_status_code, content_type)
        content_bytes가 빈 bytes면 실패.
    """
    url = f"{PDF_BASE}{path}"
    ext = Path(path).suffix.lower()

    for attempt in range(_DOWNLOAD_MAX_RETRIES + 1):
        try:
            resp = await client.get(url, timeout=30.0, follow_redirects=True)
            content_type = resp.headers.get("content-type", "")
            status = resp.status_code

            if status >= 400:
                logger.warning(
                    "다운로드 HTTP 오류 %d: %s (Content-Type: %s)",
                    status, url, content_type,
                )
                return b"", status, content_type

            data = resp.content
            if len(data) < 1000:
                logger.warning(
                    "다운로드 응답 너무 작음 (%d bytes): %s (Content-Type: %s)",
                    len(data), url, content_type,
                )
                return b"", status, content_type

            # 파일 시그니처 검증
            if ext == ".pdf" and data[:4] != b"%PDF":
                if data[:2] == b"PK":
                    logger.info(
                        "ZIP 파일 수신 (.pdf 확장자): %s (%d bytes) → 저장 보류",
                        url, len(data),
                    )
                    return data, status, content_type
                logger.warning(
                    "PDF 시그니처 불일치: %s (받은 데이터 앞 20바이트: %r, Content-Type: %s)",
                    url, data[:20], content_type,
                )
                return b"", status, content_type

            if ext == ".docx" and data[:2] != b"PK":
                logger.warning(
                    "DOCX 시그니처 불일치: %s (받은 데이터 앞 20바이트: %r, Content-Type: %s)",
                    url, data[:20], content_type,
                )
                return b"", status, content_type

            return data, status, content_type

        except (httpx.RemoteProtocolError, httpx.ReadError) as e:
            # 삼성화재 서버가 간헐적으로 연결을 끊는 일시적 오류 → 재시도
            if attempt < _DOWNLOAD_MAX_RETRIES:
                wait = _DOWNLOAD_RETRY_BASE_WAIT * (2 ** attempt)
                logger.warning(
                    "다운로드 연결 끊김 (재시도 %d/%d, %.0f초 후): %s",
                    attempt + 1, _DOWNLOAD_MAX_RETRIES, wait, Path(path).name,
                )
                await asyncio.sleep(wait)
                continue
            logger.warning("다운로드 예외 %s: %s (%s)", url, e, type(e).__name__)
            return b"", None, ""

        except httpx.TimeoutException as e:
            logger.warning("다운로드 타임아웃 %s: %s", url, e)
            return b"", None, ""
        except httpx.ConnectError as e:
            logger.warning("다운로드 연결 실패 %s: %s", url, e)
            return b"", None, ""
        except Exception as e:
            logger.warning("다운로드 예외 %s: %s (%s)", url, e, type(e).__name__)
            return b"", None, ""

    return b"", None, ""  # unreachable


async def ingest_pdf_bytes(
    session_factory: object,
    pdf_bytes: bytes,
    metadata: dict,
    ext: str = ".pdf",
    dry_run: bool = False,
) -> dict:
    """PDF bytes를 임시 파일로 저장 후 인제스트하고 삭제한다."""
    from scripts.ingest_local_pdfs import process_single_file

    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
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

    # 오류 유형별 집계
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

    print(f"\n처음 10건 URL:")
    for f in failures[:10]:
        print(f"  [{f.idx}] {f.url}")
        print(f"       오류={f.error_type}, HTTP={f.http_status}, size={f.file_size}bytes")
        if f.error_msg:
            print(f"       메시지: {f.error_msg[:100]}")
    print(sep)


# @MX:ANCHOR: [AUTO] 크롤링+인제스트 메인 함수 - 다수 호출부
# @MX:REASON: crawl_and_ingest은 main, CLI, 테스트 등에서 호출됨
async def crawl_and_ingest(
    gun_filter: str | None = None,
    dry_run: bool = False,
    fail_threshold: float = DEFAULT_FAIL_THRESHOLD,
    resume_from: int = 0,
    resume_state_path: Path | None = None,
    state_output_path: Path = DEFAULT_STATE_PATH,
) -> dict:
    """삼성화재 크롤링 + 즉시 인제스트 실행.

    Args:
        gun_filter: 수집할 종류 필터 (예: '장기', '일반보험'). None이면 전체.
        dry_run: True이면 DB에 실제로 쓰지 않음
        fail_threshold: 실패율 임계값 (초과 시 중단)
        resume_from: 이어서 시작할 인덱스
        resume_state_path: 이전 실패 상태 JSON 경로 (지정 시 해당 실패 건부터 재처리)
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

    # 크롤러 재시작 시 이미 처리된 URL 스킵 (다운로드 전 체크)
    from scripts.ingest_local_pdfs import load_processed_urls
    async with _db.session_factory() as _session:
        processed_urls: set[str] = await load_processed_urls(_session, company_code="samsung-fire")
    logger.info("이미 처리된 URL (삼성화재): %d개 (재시작 시 스킵됨)", len(processed_urls))

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
    prev_state: CrawlState | None = None
    retry_fpaths: set[str] | None = None
    if resume_state_path and resume_state_path.exists():
        try:
            prev_state = CrawlState.from_json(resume_state_path.read_text(encoding="utf-8"))
            retry_fpaths = {f.fpath for f in prev_state.failures}
            logger.info(
                "이전 실패 상태 로드: %d건 재처리 예정 (이전 실행: %s)",
                len(retry_fpaths), prev_state.started_at,
            )
        except Exception as e:
            logger.warning("실패 상태 파일 로드 실패, 전체 처리로 진행: %s", e)

    # 현재 실행 상태 초기화
    current_state = CrawlState()

    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True) as client:
        items = await fetch_all_products(client)
        targets = filter_targets(items, gun_filter=gun_filter)
        logger.info(
            "수집 대상: %d개%s%s",
            len(targets),
            f" (종류={gun_filter})" if gun_filter else "",
            " [DRY RUN]" if dry_run else "",
        )

        # PDF 파일 목록 생성 (중복 제거)
        seen: set[str] = set()
        pdf_tasks: list[tuple[dict, str, str]] = []
        for item in targets:
            for fkey in ("prdfilename1", "prdfilename2"):
                fpath = item.get(fkey, "")
                if not fpath or fpath in seen:
                    continue
                seen.add(fpath)
                ext = Path(fpath).suffix.lower() or ".pdf"
                pdf_tasks.append((item, fpath, ext))

        stats["total"] = len(pdf_tasks)

        # 처리 대상 결정
        if retry_fpaths is not None:
            # 실패 건만 재처리
            pdf_tasks = [(item, fp, ext) for item, fp, ext in pdf_tasks if fp in retry_fpaths]
            logger.info("재처리 대상: %d개 (전체 %d개 중 실패 건만)", len(pdf_tasks), stats["total"])
            stats["total"] = len(pdf_tasks)
        elif resume_from > 0:
            logger.info("인덱스 %d부터 이어서 시작", resume_from)
            pdf_tasks = pdf_tasks[resume_from:]

        logger.info("총 처리 대상 파일: %d개", len(pdf_tasks))

        # @MX:WARN: [AUTO] 순차 처리 필수 - asyncio.gather 사용 금지
        # @MX:REASON: pdfplumber + PDFMiner 내부 캐시가 asyncio gather 환경에서 GC 타이밍이 지연됨
        processed = 0
        for idx, (item, fpath, ext) in enumerate(pdf_tasks, start=1 + (0 if retry_fpaths else resume_from)):
            prd_name = item.get("prdName", "")
            prd_gun = item.get("prdGun", "")
            prd_gb = item.get("prdGb", "")
            sale_status = item.get("_sale_status", "UNKNOWN")
            url = f"{PDF_BASE}{fpath}"

            if idx % 50 == 0 or idx == 1:
                logger.info(
                    "진행: %d / %d (성공=%d, 스킵=%d, 실패=%d)",
                    idx, stats["total"] + (0 if retry_fpaths else resume_from),
                    stats["success"], stats["skipped"], stats["failed"],
                )

            # Rate limit
            await asyncio.sleep(RATE_LIMIT)

            # 이미 DB에 저장된 URL이면 다운로드 없이 스킵
            if url in processed_urls:
                stats["skipped"] += 1
                logger.debug("[%d] URL 스킵 (이미 처리됨): %s", idx, Path(fpath).name)
                continue

            # 다운로드 (상세 오류 정보 포함)
            pdf_bytes, http_status, content_type = await download_pdf(client, fpath)
            processed += 1
            current_state.last_processed_idx = idx

            if not pdf_bytes:
                stats["failed"] += 1
                failure = FailureRecord(
                    idx=idx,
                    fpath=fpath,
                    url=url,
                    prd_name=prd_name,
                    prd_gun=prd_gun,
                    prd_gb=prd_gb,
                    error_type="download_failed",
                    http_status=http_status,
                    http_content_type=content_type,
                    error_msg=f"HTTP {http_status}, Content-Type: {content_type}",
                    file_size=0,
                )
                current_state.failures.append(failure)
                logger.warning(
                    "[%d] 다운로드 실패: %s | HTTP=%s | Content-Type=%s",
                    idx, Path(fpath).name, http_status, content_type,
                )

                # fail-stop 로직: 재시도 후에도 실패 → 즉시 중단
                current_state.stopped_at = datetime.now(tz=timezone.utc).isoformat()
                current_state.stop_reason = "fail_immediate"
                save_state(current_state, state_output_path)
                logger.error(
                    "다운로드 실패 → 즉시 중단 (인덱스: %d)\n재시작: --resume-state %s",
                    idx, state_output_path,
                )
                break
            elif pdf_bytes[:2] == b"PK" and Path(fpath).suffix.lower() not in {".docx", ".hwp"}:
                # ZIP 파일 (DOCX는 이미 정상 처리됨): 임베딩 보류, 실패 아님
                logger.info(
                    "[%d] ZIP 파일 인제스트 보류 (임베딩 미지원): %s (%d bytes)",
                    idx, Path(fpath).name, len(pdf_bytes),
                )
                continue

            # 메타데이터 구성
            fname_stem = Path(fpath).stem
            metadata = {
                "format_type": "B",
                "company_code": "samsung-fire",
                "company_name": "삼성화재",
                "product_code": fname_stem,
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
                    ext=ext,
                    dry_run=dry_run,
                )
            except Exception as e:
                error_msg = f"{type(e).__name__}: {e}"
                logger.error("[%d] 인제스트 예외 %s: %s", idx, fname_stem, error_msg)
                result = {"status": "failed", "error": error_msg}

            status = result.get("status", "failed")
            if status == "success":
                stats["success"] += 1
                processed_urls.add(url)  # 런 중 중복 다운로드 방지
                ss = result.get("sale_status", sale_status)
                if ss == "ON_SALE":
                    stats["on_sale"] += 1
                elif ss == "DISCONTINUED":
                    stats["discontinued"] += 1
                else:
                    stats["unknown"] += 1
                logger.info("[%d] 완료: %s (%s/%s)", idx, Path(fpath).name, prd_gun, prd_gb)

            elif status == "skipped":
                stats["skipped"] += 1
                logger.debug("[%d] 스킵(중복): %s", idx, Path(fpath).name)

            elif status == "dry_run":
                stats["dry_run"] += 1

            else:
                stats["failed"] += 1
                error_msg = result.get("error", "")
                failure = FailureRecord(
                    idx=idx,
                    fpath=fpath,
                    url=url,
                    prd_name=prd_name,
                    prd_gun=prd_gun,
                    prd_gb=prd_gb,
                    error_type="ingest_failed",
                    http_status=http_status,
                    http_content_type=content_type,
                    error_msg=error_msg,
                    file_size=len(pdf_bytes),
                )
                current_state.failures.append(failure)
                logger.warning(
                    "[%d] 인제스트 실패: %s | 오류: %s",
                    idx, Path(fpath).name, error_msg[:200],
                )

            # 파일마다 GC 강제 실행
            del pdf_bytes
            gc.collect()

    # 완료 상태 저장
    current_state.stopped_at = datetime.now(tz=timezone.utc).isoformat()
    current_state.stop_reason = current_state.stop_reason or "completed"
    if current_state.failures:
        save_state(current_state, state_output_path)

    # 결과 출력
    sep = "=" * 60
    print(f"\n{sep}")
    print("삼성화재 크롤링+인제스트 완료")
    print(sep)
    print(f"총 파일:     {stats['total']:>6,}개")
    print(f"성공:        {stats['success']:>6,}개")
    print(f"스킵(중복):  {stats['skipped']:>6,}개")
    print(f"실패:        {stats['failed']:>6,}개")
    if dry_run:
        print(f"dry-run:     {stats['dry_run']:>6,}개")
    print(sep)
    print(f"  ON_SALE:      {stats['on_sale']:>5,}개")
    print(f"  DISCONTINUED: {stats['discontinued']:>5,}개")
    print(f"  UNKNOWN:      {stats['unknown']:>5,}개")
    print(sep)

    if current_state.failures:
        print_failure_summary(current_state.failures)
        print(f"\n실패 상태 파일: {state_output_path}")
        print(f"재처리 명령: python -m scripts.crawl_and_ingest_samsung --resume-state {state_output_path}")

    return {**stats, "state_path": str(state_output_path) if current_state.failures else None}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """CLI 인자를 파싱한다."""
    parser = argparse.ArgumentParser(
        description="삼성화재 크롤링 + 즉시 인제스트 (GitHub Actions 전용)",
    )
    parser.add_argument(
        "--gun",
        default=None,
        choices=["장기", "일반보험"],
        help="수집할 종류 필터 (미지정 시 전체)",
    )
    parser.add_argument(
        "--dry-run",
        dest="dry_run",
        action="store_true",
        help="DB에 실제로 쓰지 않고 처리 결과만 출력",
    )
    parser.add_argument(
        "--fail-threshold",
        type=float,
        default=DEFAULT_FAIL_THRESHOLD,
        help=f"실패율 임계값 (기본값: {DEFAULT_FAIL_THRESHOLD * 100:.0f}%%)",
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
        gun_filter=args.gun,
        dry_run=args.dry_run,
        fail_threshold=args.fail_threshold,
        resume_from=args.resume_from,
        resume_state_path=args.resume_state,
        state_output_path=args.state_output,
    ))
    # DB 초기화 실패 등 오류 시 exit code 1 (GitHub Actions false positive 방지)
    if isinstance(result, dict) and "error" in result:
        logger.error("종료 오류: %s", result["error"])
        sys.exit(1)
