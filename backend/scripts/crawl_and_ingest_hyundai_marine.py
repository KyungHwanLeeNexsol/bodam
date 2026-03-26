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


@dataclass
class HyundaiMarineIngestState:
    """현대해상 인제스트 실패 상태 (재처리용 JSON 직렬화 가능)."""
    failures: list[FailureRecord] = field(default_factory=list)
    stop_reason: str = ""
    crawl_failed_count: int = 0
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def save(self, path: Path) -> None:
        data = asdict(self)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info("실패 상태 저장: %s (%d건)", path, len(self.failures))

    @classmethod
    def load(cls, path: Path) -> "HyundaiMarineIngestState":
        data = json.loads(path.read_text(encoding="utf-8"))
        failures = [FailureRecord(**f) for f in data.get("failures", [])]
        return cls(
            failures=failures,
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
    if resume_state and resume_state.exists():
        prev_state = HyundaiMarineIngestState.load(resume_state)
        failed_product_codes = {f.product_code for f in prev_state.failures}
        logger.info(
            "재처리 모드: 이전 실패 product_code %d개만 처리",
            len(failed_product_codes),
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
    logger.info("이미 처리된 URL (현대해상): %d개 (재시작 시 스킵됨)", len(processed_urls))

    # 임시 디렉터리에 크롤링
    with tempfile.TemporaryDirectory(prefix="hyundai-marine-crawl-") as tmp_dir:
        tmp_path = Path(tmp_dir)
        logger.info("임시 크롤링 디렉터리: %s", tmp_path)

        # 1단계: Playwright 크롤링
        logger.info("=" * 60)
        logger.info("현대해상화재보험 크롤링 시작%s", " (DRY RUN)" if dry_run else "")
        if failed_product_codes is not None:
            logger.info("재처리 대상 product_code: %s", sorted(failed_product_codes))
        logger.info("=" * 60)

        from app.services.crawler.companies.nonlife.hyundai_marine_crawler import HyundaiMarineCrawler
        from app.services.crawler.storage import LocalFileStorage

        storage = LocalFileStorage(str(tmp_path))
        crawler = HyundaiMarineCrawler(
            storage=storage,
            rate_limit_seconds=2.0,
            max_retries=3,
            fail_threshold=fail_threshold,
        )

        crawl_result = await crawler.crawl(processed_urls=processed_urls)

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
                    "크롤링 실패율 %.1f%% > 임계값 %.1f%% → 인제스트 중단",
                    fail_rate * 100,
                    fail_threshold * 100,
                )
                state = HyundaiMarineIngestState(
                    stop_reason=f"crawl_fail_rate={fail_rate:.2%}",
                    crawl_failed_count=crawl_result.failed_count,
                )
                if state_output:
                    state.save(state_output)
                return {
                    "error": f"crawl_fail_rate={fail_rate:.2%}",
                    "crawl": {
                        "total_found": crawl_result.total_found,
                        "new_count": crawl_result.new_count,
                        "failed_count": crawl_result.failed_count,
                    },
                }

        # 상품 메타데이터 조회 테이블 생성 (uid_prefix → {name, sale_status, pdf_url})
        # 저장 경로: hyundai-marine/{on-sale|discontinued}/{uid_prefix}/{filename}
        # uid_prefix = uuid.replace("-","")[:8]
        product_meta: dict[str, dict] = {}
        for r in (crawl_result.results or []):
            uuid_val = r.get("product_code", "")  # 크롤러가 UUID를 product_code로 저장
            if uuid_val:
                uid_prefix = uuid_val.replace("-", "")[:8]
                product_meta[uid_prefix] = {
                    "product_name": r.get("product_name", uuid_val),
                    "sale_status": r.get("sale_status", "ON_SALE"),
                    "product_code": uuid_val,
                    "pdf_url": r.get("pdf_url", ""),
                }

        if dry_run:
            pdf_files = list(tmp_path.rglob("*.pdf")) + list(tmp_path.rglob("*.PDF"))
            logger.info("[DRY RUN] 수집된 PDF: %d개 (인제스트 생략)", len(pdf_files))
            return {
                "crawl": {
                    "total_found": crawl_result.total_found,
                    "new_count": crawl_result.new_count,
                    "failed_count": crawl_result.failed_count,
                },
                "ingest": {"skipped": len(pdf_files), "reason": "dry_run"},
            }

        # 2단계: 저장된 PDF 순차 인제스트
        # @MX:WARN: [AUTO] 순차 처리 필수 - asyncio.gather 사용 금지
        # @MX:REASON: pdfplumber + PDFMiner 내부 캐시가 asyncio gather 환경에서 GC 타이밍이 지연됨
        all_pdf_files = sorted(
            list(tmp_path.rglob("*.pdf")) + list(tmp_path.rglob("*.PDF"))
        )

        # resume 모드: 실패 product_code에 해당하는 파일만 처리
        if failed_product_codes is not None:
            pdf_files = [
                p for p in all_pdf_files
                if (
                    p.relative_to(tmp_path).parts[2]
                    if len(p.relative_to(tmp_path).parts) >= 3
                    else p.stem
                ) in failed_product_codes
            ]
            logger.info(
                "인제스트 대상(재처리): %d개 PDF (전체 %d개 중 실패 product_code 필터)",
                len(pdf_files),
                len(all_pdf_files),
            )
        else:
            pdf_files = all_pdf_files
            logger.info("인제스트 대상: %d개 PDF", len(pdf_files))

        ingest_stats = {"success": 0, "skipped": 0, "failed": 0}
        failure_records: list[FailureRecord] = []

        for idx, pdf_path in enumerate(pdf_files, start=1):
            # 경로에서 메타데이터 추출: hyundai-marine/{on-sale|discontinued}/{uid_prefix}/{filename}
            rel_parts = pdf_path.relative_to(tmp_path).parts
            uid_prefix = rel_parts[2] if len(rel_parts) >= 3 else pdf_path.stem
            meta = product_meta.get(uid_prefix, {})
            product_code = meta.get("product_code", uid_prefix)  # 전체 UUID
            product_name = meta.get("product_name", uid_prefix)
            sale_status = meta.get("sale_status", "ON_SALE")

            # source_url: product_meta에서 직접 복원
            source_url = meta.get("pdf_url", "")
            if not source_url:
                source_url = f"https://www.hi.co.kr/data/{pdf_path.name}"

            metadata = {
                "format_type": "B",
                "company_code": "hyundai-marine",
                "company_name": "현대해상",
                "product_code": product_code,
                "product_name": product_name,
                "category": "NON_LIFE",
                "source_url": source_url,
                "sale_status": sale_status,
            }

            if idx % 50 == 0 or idx == 1:
                logger.info(
                    "인제스트 진행: %d / %d (성공=%d, 스킵=%d, 실패=%d)",
                    idx,
                    len(pdf_files),
                    ingest_stats["success"],
                    ingest_stats["skipped"],
                    ingest_stats["failed"],
                )

            # 이미 DB에 저장된 URL이면 인제스트 없이 스킵
            if source_url in processed_urls:
                ingest_stats["skipped"] += 1
                logger.debug("[%d] URL 스킵 (이미 처리됨): %s", idx, pdf_path.name)
                continue

            try:
                result = await ingest_pdf_file(
                    _db.session_factory,
                    pdf_path,
                    metadata,
                    dry_run=False,
                )
            except Exception as e:
                logger.error("[%d] 인제스트 예외 %s: %s", idx, pdf_path.name, e)
                result = {"status": "failed", "error": str(e)}

            status = result.get("status", "failed")
            if status == "success":
                ingest_stats["success"] += 1
                logger.debug("[%d] 완료: %s (%s)", idx, pdf_path.name, product_code)
            elif status == "skipped":
                ingest_stats["skipped"] += 1
            else:
                ingest_stats["failed"] += 1
                error_msg = result.get("error", "")
                logger.warning("[%d] 실패: %s - %s", idx, pdf_path.name, error_msg)
                failure_records.append(FailureRecord(
                    product_code=uid_prefix,  # 경로 매칭용 uid_prefix
                    pdf_filename=pdf_path.name,
                    error=error_msg,
                ))

            gc.collect()

        # 실패 상태 저장
        if state_output and failure_records:
            state = HyundaiMarineIngestState(
                failures=failure_records,
                stop_reason="ingest_failures",
                crawl_failed_count=crawl_result.failed_count,
            )
            state.save(state_output)
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
