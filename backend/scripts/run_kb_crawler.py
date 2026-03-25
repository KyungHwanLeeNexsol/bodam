#!/usr/bin/env python3
"""KB손해보험 크롤러 직접 실행 스크립트 (DB 연결 없이)

KBNonLifeCrawler를 LocalFileStorage로 직접 실행.
이미 수집된 상품(kb-nonlife/{code}/ 디렉토리 존재)은 자동 스킵.

실행:
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.run_kb_crawler
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.run_kb_crawler --dry-run
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

DEFAULT_FAIL_THRESHOLD = 0.05

if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)

BASE_DATA_DIR = Path(r"D:\bodam-data\crawled_pdfs")


async def main(dry_run: bool = False, fail_threshold: float = 0.05) -> None:
    from app.services.crawler.companies.nonlife.kb_nonlife_crawler import KBNonLifeCrawler
    from app.services.crawler.storage import LocalFileStorage

    storage = LocalFileStorage(str(BASE_DATA_DIR))

    if dry_run:
        # dry-run: 수집된 디렉토리 현황만 출력
        kb_dir = BASE_DATA_DIR / "kb-nonlife"
        if kb_dir.exists():
            codes = [d.name for d in kb_dir.iterdir() if d.is_dir()]
            logger.info("[DRY-RUN] 현재 수집된 상품 코드: %d개", len(codes))
            pdf_count = sum(len(list(d.glob("*.pdf"))) for d in kb_dir.iterdir() if d.is_dir())
            logger.info("[DRY-RUN] 총 PDF 파일: %d개", pdf_count)
        return

    crawler = KBNonLifeCrawler(
        storage=storage,
        rate_limit_seconds=2.0,
        max_retries=3,
        fail_threshold=fail_threshold,
    )

    logger.info("KB손해보험 크롤링 시작 (수정된 크롤러: 숨겨진 링크 제외)")
    result = await crawler.crawl()

    print(f"\n{'='*50}")
    print("KB손해보험 크롤링 완료")
    print(f"{'='*50}")
    print(f"총 발견:   {result.total_found}개")
    print(f"신규:      {result.new_count}개")
    print(f"변경없음:  {result.skipped_count}개")
    print(f"실패:      {result.failed_count}개")
    print(f"{'='*50}\n")

    if result.failed_count > 0:
        logger.warning("실패 항목이 있습니다. 디버깅 후 재실행하면 기존 수집 파일은 스킵됩니다.")
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="KB손해보험 크롤러 직접 실행")
    parser.add_argument("--dry-run", action="store_true", help="수집 현황만 출력")
    parser.add_argument(
        "--fail-threshold",
        type=float,
        default=DEFAULT_FAIL_THRESHOLD,
        help=f"실패율 임계값 (기본값: {DEFAULT_FAIL_THRESHOLD:.0%})",
    )
    args = parser.parse_args()
    asyncio.run(main(dry_run=args.dry_run, fail_threshold=args.fail_threshold))
