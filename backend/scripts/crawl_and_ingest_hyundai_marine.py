#!/usr/bin/env python3
"""현대해상화재보험 크롤링 + 즉시 인제스트 통합 파이프라인

GitHub Actions 환경에서 실행하기 위한 스크립트.
1단계: Playwright로 현대해상 PDF 크롤링 → 임시 디렉터리(/tmp/hyundai-marine-crawl)에 저장
2단계: 저장된 PDF를 순차 인제스트 → 임시 파일 삭제

실행:
    cd backend && PYTHONPATH=. uv run python -m scripts.crawl_and_ingest_hyundai_marine
    cd backend && PYTHONPATH=. uv run python -m scripts.crawl_and_ingest_hyundai_marine --dry-run
    cd backend && PYTHONPATH=. uv run python -m scripts.crawl_and_ingest_hyundai_marine --resume-state failure_state_hyundai_marine.json

# @MX:NOTE: [AUTO] GitHub Actions 전용 통합 파이프라인
# @MX:NOTE: [AUTO] 현대해상은 Playwright 필수 (SPA, JS 렌더링)
# @MX:NOTE: [AUTO] 크롤링 완료 후 /tmp/hyundai-marine-crawl/ 에서 순차 인제스트
# @MX:NOTE: [AUTO] resume-state 사용 시 실패 product_code만 재크롤링 + 재인제스트
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

DEFAULT_FAIL_THRESHOLD = 0.05


@dataclass
class FailureRecord:
    """인제스트 실패 건 기록."""
    product_code: str
    pdf_filename: str
    error: str
    http_status: int | None = None
    pdf_url: str | None = None


@dataclass
class HyundaiMarineIngestState:
    """현대해상 인제스트 실패 상태 (재처리용 JSON 직렬화 가능)."""
    failures: list[FailureRecord] = field(default_factory=list)
    # 다운로드/검증 실패 URL 목록 (resume 시 processed_urls에 추가하여 영구 스킵)
    download_failed_urls: list[str] = field(default_factory=list)
    stop_reason: str = ""
    crawl_failed_count: int = 0
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def save(self, path: Path) -> None:
        data = asdict(self)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info(
            "실패 상태 저장: %s (인제스트 실패=%d건, 다운로드 실패=%d건)",
            path, len(self.failures), len(self.download_failed_urls),
        )

    @classmethod
    def load(cls, path: Path) -> "HyundaiMarineIngestState":
        data = json.loads(path.read_text(encoding="utf-8"))
        failures = [FailureRecord(**f) for f in data.get("failures", [])]
        return cls(
            failures=failures,
            download_failed_urls=data.get("download_failed_urls", []),
            stop_reason=data.get("stop_reason", ""),
            crawl_failed_count=data.get("crawl_failed_count", 0),
            created_at=data.get("created_at", ""),
        )


async def ingest_pdf_file(
    session_factory: object,
    pdf_path: Path,
    metadata: dict,
    dry_run: bool = False,
) -> dict:
    """PDF 파일을 인제스트한다."""
    from scripts.ingest_local_pdfs import process_single_file
    return await process_single_file(
        session_factory=session_factory,
        pdf_path=pdf_path,
        metadata=metadata,
        dry_run=dry_run,
    )


async def ingest_pdf_bytes(
    session_factory: object,
    pdf_bytes: bytes,
    metadata: dict,
    dry_run: bool = False,
) -> dict:
    """PDF 바이트를 임시 파일 경유로 인제스트한다 (스트리밍 인제스트용)."""
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(pdf_bytes)
        tmp_path = Path(tmp.name)
    try:
        return await ingest_pdf_file(
            session_factory=session_factory,
            pdf_path=tmp_path,
            metadata=metadata,
            dry_run=dry_run,
        )
    finally:
        tmp_path.unlink(missing_ok=True)


# @MX:ANCHOR: [AUTO] 현대해상 크롤링+인제스트 메인 함수
# @MX:REASON: __main__ 및 테스트에서 호출됨
async def crawl_and_ingest(
    dry_run: bool = False,
    fail_threshold: float = DEFAULT_FAIL_THRESHOLD,
    resume_state: Path | None = None,
    state_output: Path | None = None,
) -> dict:
    """현대해상화재보험 크롤링 + 즉시 인제스트 실행.

    Args:
        dry_run: True이면 크롤링만 하고 DB에 저장하지 않음
        fail_threshold: 크롤링 실패율 임계값
        resume_state: 이전 실패 상태 JSON 경로 (이 파일의 실패 product_code만 재처리)
        state_output: 실패 상태를 저장할 JSON 경로
    """
    # 이전 실패 상태 로드 (resume 모드)
    failed_product_codes: set[str] | None = None
    prev_download_failed_urls: set[str] = set()
    if resume_state and resume_state.exists():
        prev_state = HyundaiMarineIngestState.load(resume_state)
        failed_product_codes = {f.product_code for f in prev_state.failures}
        prev_download_failed_urls = set(prev_state.download_failed_urls)
        logger.info(
            "재처리 모드: 이전 실패 product_code %d개만 처리 (다운로드 영구 실패 %d개 스킵)",
            len(failed_product_codes),
            len(prev_download_failed_urls),
        )
    elif resume_state:
        logger.warning("resume_state 파일 없음 (%s) → 전체 실행", resume_state)

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
        processed_urls: set[str] = await load_processed_urls(_session, company_code="hyundai-marine")
    # 이전 런에서 다운로드 영구 실패한 URL도 스킵 (매 런마다 재시도 방지)
    if prev_download_failed_urls:
        processed_urls.update(prev_download_failed_urls)
        logger.info(
            "이미 처리된 URL (현대해상): %d개 (DB 성공=%d + 다운로드 영구 실패=%d)",
            len(processed_urls),
            len(processed_urls) - len(prev_download_failed_urls),
            len(prev_download_failed_urls),
        )
    else:
        logger.info("이미 처리된 URL (현대해상): %d개 (재시작 시 스킵됨)", len(processed_urls))

    ingest_stats: dict[str, int] = {"success": 0, "skipped": 0, "failed": 0}
    failure_records: list[FailureRecord] = []
    download_failed_urls: list[str] = []
    ingest_count = 0

    async def _on_pdf_download_failed(pdf_url: str, reason: str) -> None:
        """다운로드/검증 실패 URL 기록 (상태 파일에 저장 → resume 시 영구 스킵)."""
        download_failed_urls.append(pdf_url)
        logger.debug("[현대해상] 다운로드 실패 URL 기록: %s (사유: %s)", pdf_url[-60:], reason)

    # 다운로드 즉시 인제스트 콜백 (스트리밍 방식)
    # @MX:WARN: [AUTO] 순차 처리 필수 - asyncio.gather 사용 금지
    # @MX:REASON: pdfplumber + PDFMiner 내부 캐시가 asyncio gather 환경에서 GC 타이밍이 지연됨
    async def _on_pdf_downloaded(pdf_bytes: bytes, info: dict) -> None:
        nonlocal ingest_count

        product_code: str = info["product_code"]
        product_name: str = info["product_name"]
        sale_status = info["sale_status"]
        pdf_url: str = info["pdf_url"]
        filename: str = info.get("filename", f"{product_code}.pdf")

        # resume 모드: 실패 product_code(uid_prefix)에 해당하는 것만 처리
        if failed_product_codes is not None:
            uid_prefix = product_code.replace("-", "")[:8]
            if uid_prefix not in failed_product_codes:
                return

        if dry_run:
            ingest_stats["skipped"] += 1
            return

        metadata = {
            "format_type": "B",
            "company_code": "hyundai-marine",
            "company_name": "현대해상",
            "product_code": product_code,
            "product_name": product_name,
            "category": "NON_LIFE",
            "source_url": pdf_url,
            "sale_status": str(sale_status),
        }

        ingest_count += 1
        if ingest_count % 50 == 1:
            logger.info(
                "인제스트 진행: %d건째 처리 중 (성공=%d, 스킵=%d, 실패=%d)",
                ingest_count,
                ingest_stats["success"],
                ingest_stats["skipped"],
                ingest_stats["failed"],
            )

        try:
            result = await ingest_pdf_bytes(_db.session_factory, pdf_bytes, metadata)
        except Exception as e:
            logger.error("인제스트 예외 [%s]: %s", filename[:40], e)
            result = {"status": "failed", "error": str(e)}

        status = result.get("status", "failed")
        if status in ("success", "new", "updated"):
            ingest_stats["success"] += 1
            processed_urls.add(pdf_url)
            logger.debug("인제스트 완료: %s (%s)", filename[:60], product_code)
        elif status == "skipped":
            ingest_stats["skipped"] += 1
        else:
            ingest_stats["failed"] += 1
            error_msg = result.get("error", "")
            logger.warning("인제스트 실패: %s - %s", filename[:40], error_msg)
            uid_prefix = product_code.replace("-", "")[:8]
            failure_records.append(FailureRecord(
                product_code=uid_prefix,
                pdf_filename=filename,
                error=error_msg,
            ))

        gc.collect()

    # 크롤링 + 즉시 인제스트 실행
    logger.info("=" * 60)
    logger.info("현대해상화재보험 크롤링 + 즉시 인제스트 시작%s", " (DRY RUN)" if dry_run else "")
    if failed_product_codes is not None:
        logger.info("재처리 대상 product_code: %d개", len(failed_product_codes))
    logger.info("=" * 60)

    from app.services.crawler.companies.nonlife.hyundai_marine_crawler import HyundaiMarineCrawler
    from app.services.crawler.storage import LocalFileStorage

    # 스트리밍 모드에서 storage는 사용되지 않으나 생성자 요구사항으로 전달
    noop_tmp = tempfile.mkdtemp(prefix="hyundai-marine-noop-")
    try:
        storage = LocalFileStorage(noop_tmp)
        crawler = HyundaiMarineCrawler(
            storage=storage,
            rate_limit_seconds=1.0,
            max_retries=3,
            fail_threshold=fail_threshold,
        )

        crawl_result = await crawler.crawl(
            processed_urls=processed_urls,
            on_download=_on_pdf_downloaded,
            on_fail=_on_pdf_download_failed,
        )
    finally:
        import shutil
        shutil.rmtree(noop_tmp, ignore_errors=True)

    logger.info(
        "크롤링 완료: 발견=%d, 신규=%d, 스킵=%d, 실패=%d",
        crawl_result.total_found,
        crawl_result.new_count,
        crawl_result.skipped_count,
        crawl_result.failed_count,
    )

    # 크롤링 실패율 체크
    if crawl_result.total_found > 0:
        fail_rate = crawl_result.failed_count / max(crawl_result.total_found, 1)
        if fail_rate > fail_threshold:
            logger.error(
                "크롤링 실패율 %.1f%% > 임계값 %.1f%%",
                fail_rate * 100,
                fail_threshold * 100,
            )
            if state_output and (failure_records or download_failed_urls):
                HyundaiMarineIngestState(
                    failures=failure_records,
                    download_failed_urls=download_failed_urls,
                    stop_reason=f"crawl_fail_rate={fail_rate:.2%}",
                    crawl_failed_count=crawl_result.failed_count,
                ).save(state_output)
            return {
                "error": f"crawl_fail_rate={fail_rate:.2%}",
                "crawl": {
                    "total_found": crawl_result.total_found,
                    "new_count": crawl_result.new_count,
                    "failed_count": crawl_result.failed_count,
                },
                "ingest": ingest_stats,
            }

    # dry_run 결과 반환
    if dry_run:
        logger.info("[DRY RUN] 크롤링 발견 %d개 (인제스트 생략)", crawl_result.total_found)
        return {
            "crawl": {
                "total_found": crawl_result.total_found,
                "new_count": crawl_result.new_count,
                "failed_count": crawl_result.failed_count,
            },
            "ingest": {"skipped": ingest_stats["skipped"], "reason": "dry_run"},
        }

    # 실패 상태 저장 (인제스트 실패 OR 다운로드 영구 실패가 있으면 저장)
    if state_output and (failure_records or download_failed_urls):
        HyundaiMarineIngestState(
            failures=failure_records,
            download_failed_urls=download_failed_urls,
            stop_reason="ingest_failures" if failure_records else "download_failures",
            crawl_failed_count=crawl_result.failed_count,
        ).save(state_output)
    elif state_output:
        logger.info("실패 건 없음 → 상태 파일 미생성")

    # 결과 출력
    sep = "=" * 60
    print(f"\n{sep}")
    print("현대해상화재보험 크롤링+인제스트 완료")
    print(sep)
    print(f"크롤링 발견:  {crawl_result.total_found:>6,}개")
    print(f"크롤링 신규:  {crawl_result.new_count:>6,}개")
    print(f"크롤링 실패:  {crawl_result.failed_count:>6,}개")
    print(sep)
    print(f"인제스트 성공: {ingest_stats['success']:>5,}개")
    print(f"인제스트 스킵: {ingest_stats['skipped']:>5,}개 (중복)")
    print(f"인제스트 실패: {ingest_stats['failed']:>5,}개")
    print(sep)

    return {
        "crawl": {
            "total_found": crawl_result.total_found,
            "new_count": crawl_result.new_count,
            "failed_count": crawl_result.failed_count,
        },
        "ingest": ingest_stats,
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """CLI 인자를 파싱한다."""
    parser = argparse.ArgumentParser(
        description="현대해상화재보험 크롤링 + 즉시 인제스트 (GitHub Actions 전용)"
    )
    parser.add_argument("--dry-run", dest="dry_run", action="store_true")
    parser.add_argument(
        "--fail-threshold",
        type=float,
        default=DEFAULT_FAIL_THRESHOLD,
        help=f"크롤링 실패율 임계값 (기본값: {DEFAULT_FAIL_THRESHOLD * 100:.0f}%%)",
    )
    parser.add_argument(
        "--resume-state",
        type=Path,
        default=None,
        help="이전 실패 상태 JSON 경로 (이 파일의 실패 product_code만 재처리)",
    )
    parser.add_argument(
        "--state-output",
        type=Path,
        default=None,
        help="실패 상태를 저장할 JSON 경로 (예: failure_state_hyundai_marine.json)",
    )
    return parser.parse_args(argv)


async def main() -> None:
    """메인 진입점."""
    args = parse_args()
    result = await crawl_and_ingest(
        dry_run=args.dry_run,
        fail_threshold=args.fail_threshold,
        resume_state=args.resume_state,
        state_output=args.state_output,
    )
    if isinstance(result, dict) and "error" in result:
        logger.error("종료 오류: %s", result["error"])
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
