#!/usr/bin/env python3
"""범용 보험사 크롤링 + 즉시 인제스트 통합 파이프라인

YAML 설정 기반 보험사(GenericLifeCrawler / GenericNonLifeCrawler)를 단일 스크립트로 지원.
--company COMPANY_CODE 파라미터 하나로 모든 YAML 설정 보험사를 처리한다.

지원 보험사 (config/companies/*.yaml):
  생명보험: hanwha_life, kyobo_life, samsung_life, shinhan_life,
            nh_life, heungkuk_life, dongyang_life, mirae_life
  손해보험: hyundai_marine, meritz_fire, hanwha_general, heungkuk_fire,
            axa_general, hana_insurance, mg_insurance, nh_insurance, lotte_insurance

실행:
    cd backend && PYTHONPATH=. uv run python -m scripts.crawl_and_ingest_generic --company hanwha_life
    cd backend && PYTHONPATH=. uv run python -m scripts.crawl_and_ingest_generic --company hanwha_life --dry-run
    cd backend && PYTHONPATH=. uv run python -m scripts.crawl_and_ingest_generic --company hanwha_life --resume-state failure_state_hanwha_life.json

# @MX:NOTE: GitHub Actions 전용 통합 파이프라인 (GenericLifeCrawler / GenericNonLifeCrawler 공용)
# @MX:NOTE: Playwright 필수 - 모든 대상 보험사가 JS 렌더링 페이지 사용
# @MX:NOTE: --company 파라미터로 단일 워크플로우에서 모든 YAML 보험사 지원
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
    product_name: str
    source_url: str
    error: str


@dataclass
class GenericIngestState:
    """범용 인제스트 실패 상태 (재처리용 JSON 직렬화 가능)."""
    company_code: str = ""
    failures: list[FailureRecord] = field(default_factory=list)
    stop_reason: str = ""
    crawl_failed_count: int = 0
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def save(self, path: Path) -> None:
        data = asdict(self)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info("실패 상태 저장: %s (%d건)", path, len(self.failures))

    @classmethod
    def load(cls, path: Path) -> "GenericIngestState":
        data = json.loads(path.read_text(encoding="utf-8"))
        failures = [FailureRecord(**f) for f in data.get("failures", [])]
        return cls(
            company_code=data.get("company_code", ""),
            failures=failures,
            stop_reason=data.get("stop_reason", ""),
            crawl_failed_count=data.get("crawl_failed_count", 0),
            created_at=data.get("created_at", ""),
        )


def _build_crawler(config, storage):
    """YAML 설정 카테고리에 따라 적합한 크롤러 인스턴스를 반환한다."""
    if config.category == "LIFE":
        from app.services.crawler.companies.life.generic_life import GenericLifeCrawler
        return GenericLifeCrawler(config=config, storage=storage)
    else:
        from app.services.crawler.companies.nonlife.generic_nonlife import GenericNonLifeCrawler
        return GenericNonLifeCrawler(config=config, storage=storage)


async def crawl_and_ingest(
    company_code: str,
    dry_run: bool = False,
    fail_threshold: float = DEFAULT_FAIL_THRESHOLD,
    resume_state: Path | None = None,
    state_output: Path | None = None,
) -> dict:
    """지정 보험사 크롤링 + 즉시 인제스트 실행.

    Args:
        company_code: 보험사 코드 (예: hanwha_life, hyundai_marine)
        dry_run: True이면 크롤링만 하고 DB에 저장하지 않음
        fail_threshold: 인제스트 실패율 임계값 (초과 시 중단)
        resume_state: 이전 실패 상태 JSON 경로 (실패 product_code만 재처리)
        state_output: 실패 상태를 저장할 JSON 경로
    """
    # YAML 설정 로드
    try:
        from app.services.crawler.config_loader import load_company_config
        config = load_company_config(company_code)
    except FileNotFoundError:
        logger.error("보험사 설정 파일 없음: %s", company_code)
        return {"error": f"설정 파일 없음: config/companies/{company_code}.yaml"}

    logger.info(
        "=== %s (%s) 크롤링+인제스트 시작%s ===",
        config.company_name, company_code, " (DRY RUN)" if dry_run else "",
    )

    # 재처리 모드: 이전 실패 product_code 로드
    failed_product_codes: set[str] | None = None
    if resume_state and resume_state.exists():
        prev_state = GenericIngestState.load(resume_state)
        failed_product_codes = {f.product_code for f in prev_state.failures}
        logger.info(
            "재처리 모드: 이전 실패 product_code %d개만 처리",
            len(failed_product_codes),
        )
    elif resume_state:
        logger.warning("resume_state 파일 없음 (%s) → 전체 실행", resume_state)

    # DB 초기화
    if not dry_run:
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

        # 크롤러 재시작 시 이미 처리된 URL 스킵
        from scripts.ingest_local_pdfs import load_processed_urls
        async with _db.session_factory() as _session:
            processed_urls: set[str] = await load_processed_urls(_session)
        logger.info("이미 처리된 URL: %d개 (재시작 시 스킵됨)", len(processed_urls))
    else:
        import app.core.database as _db  # type: ignore[assignment]
        processed_urls = set()

    # 임시 디렉터리에 크롤링
    with tempfile.TemporaryDirectory(prefix=f"{company_code}-crawl-") as tmp_dir:
        tmp_path = Path(tmp_dir)
        logger.info("임시 크롤링 디렉터리: %s", tmp_path)

        from app.services.crawler.storage import LocalFileStorage
        storage = LocalFileStorage(str(tmp_path))
        crawler = _build_crawler(config, storage)

        # 크롤링 실행
        logger.info("%s 크롤링 시작...", config.company_name)
        crawl_result = await crawler.crawl()

        logger.info(
            "크롤링 완료: 발견=%d, 신규=%d, 업데이트=%d, 스킵=%d, 실패=%d",
            crawl_result.total_found,
            crawl_result.new_count,
            crawl_result.updated_count,
            crawl_result.skipped_count,
            crawl_result.failed_count,
        )

        # 크롤링 실패율 체크
        if crawl_result.total_found > 0:
            fail_rate = crawl_result.failed_count / max(crawl_result.total_found, 1)
            if fail_rate > fail_threshold:
                logger.error(
                    "크롤링 실패율 %.1f%% > 임계값 %.1f%% → 인제스트 중단",
                    fail_rate * 100, fail_threshold * 100,
                )
                state = GenericIngestState(
                    company_code=company_code,
                    stop_reason=f"crawl_fail_rate={fail_rate:.2%}",
                    crawl_failed_count=crawl_result.failed_count,
                )
                if state_output:
                    state.save(state_output)
                return {
                    "error": f"크롤링 실패율 {fail_rate:.1%} 초과",
                    "crawl_failed": crawl_result.failed_count,
                }

        if dry_run:
            logger.info("[DRY RUN] 크롤링만 완료, DB 저장 없음")
            return {
                "dry_run": True,
                "company_code": company_code,
                "total_found": crawl_result.total_found,
                "crawl_failed": crawl_result.failed_count,
            }

        # 인제스트
        from scripts.ingest_local_pdfs import ingest_pdf_file

        ingest_stats = {"success": 0, "skipped": 0, "failed": 0}
        failure_records: list[FailureRecord] = []
        total_attempted = 0

        for idx, result in enumerate(crawl_result.results, start=1):
            if result.get("status") == "FAILED":
                ingest_stats["failed"] += 1
                failure_records.append(FailureRecord(
                    product_code=result.get("product_code", ""),
                    product_name=result.get("product_name", ""),
                    source_url=result.get("source_url", ""),
                    error=result.get("error", "크롤링 실패"),
                ))
                continue

            product_code = result.get("product_code", "")
            source_url = result.get("source_url", "")

            # 재처리 모드: 실패 목록에 없는 항목 스킵
            if failed_product_codes is not None and product_code not in failed_product_codes:
                ingest_stats["skipped"] += 1
                continue

            # 이미 처리된 URL이면 스킵
            if source_url and source_url in processed_urls:
                ingest_stats["skipped"] += 1
                logger.debug("[%d] URL 스킵 (이미 처리됨): %s", idx, product_code)
                continue

            pdf_path_rel = result.get("pdf_path", "")
            if not pdf_path_rel:
                ingest_stats["failed"] += 1
                continue

            pdf_path = tmp_path / pdf_path_rel
            if not pdf_path.exists():
                logger.warning("[%d] PDF 파일 없음: %s", idx, pdf_path)
                ingest_stats["failed"] += 1
                failure_records.append(FailureRecord(
                    product_code=product_code,
                    product_name=result.get("product_name", ""),
                    source_url=source_url,
                    error="PDF 파일 없음",
                ))
                continue

            metadata = {
                "format_type": "B",
                "company_code": config.company_code,
                "company_name": config.company_name,
                "product_code": product_code,
                "product_name": result.get("product_name", product_code),
                "category": config.category,
                "source_url": source_url,
                "sale_status": result.get("sale_status", "UNKNOWN"),
            }

            if idx % 50 == 0 or idx == 1:
                logger.info(
                    "인제스트 진행: %d / %d (성공=%d, 스킵=%d, 실패=%d)",
                    idx, len(crawl_result.results),
                    ingest_stats["success"], ingest_stats["skipped"], ingest_stats["failed"],
                )

            try:
                ingest_result = await ingest_pdf_file(
                    _db.session_factory,
                    pdf_path,
                    metadata,
                    dry_run=False,
                )
            except Exception as e:
                logger.error("[%d] 인제스트 예외 %s: %s", idx, pdf_path.name, e)
                ingest_result = {"status": "failed", "error": str(e)}

            status = ingest_result.get("status", "failed")
            if status == "success":
                ingest_stats["success"] += 1
                total_attempted += 1
            elif status == "skipped":
                ingest_stats["skipped"] += 1
            else:
                ingest_stats["failed"] += 1
                total_attempted += 1
                failure_records.append(FailureRecord(
                    product_code=product_code,
                    product_name=result.get("product_name", ""),
                    source_url=source_url,
                    error=ingest_result.get("error", ""),
                ))

            # 실패율 체크 (샘플 충분 시)
            if total_attempted >= 20:
                fail_rate = ingest_stats["failed"] / total_attempted
                if fail_rate > fail_threshold:
                    logger.error(
                        "인제스트 실패율 %.1f%% > %.1f%% → 중단",
                        fail_rate * 100, fail_threshold * 100,
                    )
                    state = GenericIngestState(
                        company_code=company_code,
                        failures=failure_records,
                        stop_reason="ingest_fail_threshold",
                    )
                    if state_output:
                        state.save(state_output)
                    break

            gc.collect()

        logger.info(
            "=== %s 인제스트 완료: 성공=%d, 스킵=%d, 실패=%d ===",
            config.company_name,
            ingest_stats["success"], ingest_stats["skipped"], ingest_stats["failed"],
        )

        # 실패 상태 저장
        if failure_records and state_output:
            state = GenericIngestState(
                company_code=company_code,
                failures=failure_records,
                stop_reason="completed_with_failures" if failure_records else "",
            )
            state.save(state_output)

    return {
        "company_code": company_code,
        "company_name": config.company_name,
        **ingest_stats,
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """CLI 인자를 파싱한다."""
    parser = argparse.ArgumentParser(
        description="범용 보험사 크롤링 + 인제스트 통합 파이프라인"
    )
    parser.add_argument(
        "--company",
        required=True,
        metavar="COMPANY_CODE",
        help="보험사 코드 (예: hanwha_life, hyundai_marine). config/companies/*.yaml 기반",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="크롤링만 하고 DB에 저장하지 않음",
    )
    parser.add_argument(
        "--fail-threshold",
        type=float,
        default=DEFAULT_FAIL_THRESHOLD,
        help=f"실패율 임계값 (기본값: {DEFAULT_FAIL_THRESHOLD})",
    )
    parser.add_argument(
        "--resume-state",
        type=Path,
        default=None,
        metavar="FILE",
        help="이전 실패 상태 JSON 경로 (실패 건만 재처리)",
    )
    parser.add_argument(
        "--state-output",
        type=Path,
        default=None,
        metavar="FILE",
        help="실패 상태를 저장할 JSON 경로",
    )
    return parser.parse_args(argv)


async def main(argv: list[str] | None = None) -> int:
    """메인 진입점."""
    args = parse_args(argv)

    state_output = args.state_output
    if state_output is None and not args.dry_run:
        state_output = Path(f"failure_state_{args.company}.json")

    result = await crawl_and_ingest(
        company_code=args.company,
        dry_run=args.dry_run,
        fail_threshold=args.fail_threshold,
        resume_state=args.resume_state,
        state_output=state_output,
    )

    if "error" in result:
        logger.error("실행 실패: %s", result["error"])
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
