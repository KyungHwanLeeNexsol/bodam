#!/usr/bin/env python3
"""KB손해보험 크롤링 + 즉시 인제스트 통합 파이프라인

GitHub Actions 환경에서 실행하기 위한 스크립트.
1단계: Playwright로 KB손보 PDF 크롤링 → 임시 디렉터리(/tmp/kb-crawl)에 저장
2단계: 저장된 PDF를 순차 인제스트 → 임시 파일 삭제

실행:
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_and_ingest_kb
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_and_ingest_kb --dry-run

# @MX:NOTE: GitHub Actions 전용 통합 파이프라인
# @MX:NOTE: KB손보는 Playwright 필수 (JS 렌더링, euc-kr 인코딩)
# @MX:NOTE: 크롤링 완료 후 /tmp/kb-crawl/ 에서 순차 인제스트 - 최대 수백MB 디스크 사용
# @MX:SPEC: SPEC-INGEST-001
"""
from __future__ import annotations

import argparse
import asyncio
import gc
import logging
import sys
import tempfile
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


# @MX:ANCHOR: [AUTO] KB손보 크롤링+인제스트 메인 함수
# @MX:REASON: __main__ 및 테스트에서 호출됨
async def crawl_and_ingest(
    dry_run: bool = False,
    fail_threshold: float = DEFAULT_FAIL_THRESHOLD,
) -> dict:
    """KB손해보험 크롤링 + 즉시 인제스트 실행.

    Args:
        dry_run: True이면 크롤링만 하고 DB에 저장하지 않음
        fail_threshold: 크롤링 실패율 임계값
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

    # 임시 디렉터리에 크롤링
    with tempfile.TemporaryDirectory(prefix="kb-crawl-") as tmp_dir:
        tmp_path = Path(tmp_dir)
        logger.info("임시 크롤링 디렉터리: %s", tmp_path)

        # 1단계: Playwright 크롤링
        logger.info("=" * 60)
        logger.info("KB손해보험 크롤링 시작%s", " (DRY RUN)" if dry_run else "")
        logger.info("=" * 60)

        from app.services.crawler.companies.nonlife.kb_nonlife_crawler import KBNonLifeCrawler
        from app.services.crawler.storage import LocalFileStorage

        storage = LocalFileStorage(str(tmp_path))
        crawler = KBNonLifeCrawler(
            storage=storage,
            rate_limit_seconds=2.0,
            max_retries=3,
            fail_threshold=fail_threshold,
        )

        crawl_result = await crawler.crawl()

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
                    fail_rate * 100, fail_threshold * 100,
                )
                return {
                    "error": f"crawl_fail_rate={fail_rate:.2%}",
                    "crawl": {
                        "total_found": crawl_result.total_found,
                        "new_count": crawl_result.new_count,
                        "failed_count": crawl_result.failed_count,
                    },
                }

        # 상품명 조회 테이블 생성 (product_code → product_name)
        product_names: dict[str, str] = {}
        for r in (crawl_result.results or []):
            code = r.get("product_code", "")
            name = r.get("product_name", "")
            if code and name:
                product_names[code] = name

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
        pdf_files = sorted(
            list(tmp_path.rglob("*.pdf")) + list(tmp_path.rglob("*.PDF"))
        )
        logger.info("인제스트 대상: %d개 PDF", len(pdf_files))

        ingest_stats = {"success": 0, "skipped": 0, "failed": 0}

        for idx, pdf_path in enumerate(pdf_files, start=1):
            # 경로에서 메타데이터 추출: kb-nonlife/{product_code}/{filename}
            rel_parts = pdf_path.relative_to(tmp_path).parts
            product_code = rel_parts[1] if len(rel_parts) >= 2 else pdf_path.stem
            product_name = product_names.get(product_code, product_code)

            # 파일명에서 판매 상태 추론 (KB 크롤러는 현재 적용 약관만 수집)
            sale_status = "ON_SALE"

            metadata = {
                "format_type": "B",
                "company_code": "kb-nonlife",
                "company_name": "KB손해보험",
                "product_code": product_code,
                "product_name": product_name,
                "category": "NON_LIFE",
                "source_url": f"https://www.kbinsure.co.kr/CG802030003.ec?fileNm={pdf_path.name}",
                "sale_status": sale_status,
            }

            if idx % 50 == 0 or idx == 1:
                logger.info(
                    "인제스트 진행: %d / %d (성공=%d, 스킵=%d, 실패=%d)",
                    idx, len(pdf_files),
                    ingest_stats["success"], ingest_stats["skipped"], ingest_stats["failed"],
                )

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
                logger.warning("[%d] 실패: %s - %s", idx, pdf_path.name, result.get("error", ""))

            gc.collect()

    # 결과 출력
    sep = "=" * 60
    print(f"\n{sep}")
    print("KB손해보험 크롤링+인제스트 완료")
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
    parser = argparse.ArgumentParser(description="KB손해보험 크롤링 + 즉시 인제스트 (GitHub Actions 전용)")
    parser.add_argument("--dry-run", dest="dry_run", action="store_true")
    parser.add_argument(
        "--fail-threshold",
        type=float,
        default=DEFAULT_FAIL_THRESHOLD,
        help=f"크롤링 실패율 임계값 (기본값: {DEFAULT_FAIL_THRESHOLD * 100:.0f}%%)",
    )
    return parser.parse_args(argv)


if __name__ == "__main__":
    args = parse_args()
    result = asyncio.run(crawl_and_ingest(
        dry_run=args.dry_run,
        fail_threshold=args.fail_threshold,
    ))
    if isinstance(result, dict) and "error" in result:
        logger.error("종료 오류: %s", result["error"])
        sys.exit(1)
