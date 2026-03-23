#!/usr/bin/env python3
"""CockroachDB에 인제스트된 PDF 파일을 로컬에서 삭제하여 디스크 공간 확보."""
from __future__ import annotations

import asyncio
import logging
import os
import sys
from pathlib import Path

if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)

# 프로젝트 경로 설정
BACKEND_DIR = Path(__file__).parent.parent
DATA_DIR = BACKEND_DIR / "data"
sys.path.insert(0, str(BACKEND_DIR))

# .env 로드
from dotenv import load_dotenv  # noqa: E402
load_dotenv(BACKEND_DIR / ".env")


async def get_ingested_hashes() -> set[str]:
    """DB에서 인제스트된 content_hash 목록 조회."""
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
    from sqlalchemy import text

    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        raise RuntimeError("DATABASE_URL 환경변수 없음")

    engine = create_async_engine(db_url, echo=False, pool_size=2, max_overflow=0)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    hashes: set[str] = set()
    async with session_factory() as session:
        result = await session.execute(
            text("SELECT metadata_->>'content_hash' FROM policies WHERE metadata_->>'content_hash' IS NOT NULL")
        )
        for row in result:
            if row[0]:
                hashes.add(row[0])
    await engine.dispose()
    logger.info("DB에서 %d개 content_hash 조회 완료", len(hashes))
    return hashes


def find_local_pdfs() -> list[Path]:
    """로컬 data/ 디렉토리의 모든 PDF 목록."""
    return list(DATA_DIR.rglob("*.pdf"))


def extract_hash_from_filename(path: Path) -> str | None:
    """파일명에서 content_hash 추출. 형식: name_<hash>.pdf 또는 name_<hash_prefix>.pdf"""
    stem = path.stem
    # 언더스코어로 분리하여 마지막 부분이 hex인지 확인
    parts = stem.split("_")
    for candidate in reversed(parts):
        if len(candidate) >= 8 and all(c in "0123456789abcdefABCDEF" for c in candidate):
            return candidate.lower()
    return None


async def cleanup(dry_run: bool = False) -> None:
    logger.info("=" * 60)
    logger.info("인제스트 완료 PDF 정리 시작 (dry_run=%s)", dry_run)
    logger.info("=" * 60)

    # 1. DB에서 인제스트된 hash 목록
    ingested_hashes = await get_ingested_hashes()
    if not ingested_hashes:
        logger.warning("DB에 인제스트된 항목이 없습니다.")
        return

    # 2. 로컬 PDF 목록
    local_pdfs = find_local_pdfs()
    logger.info("로컬 PDF: %d개", len(local_pdfs))

    # 3. 매칭 및 삭제
    deleted_count = 0
    deleted_bytes = 0
    skipped_count = 0

    for pdf_path in local_pdfs:
        file_hash = extract_hash_from_filename(pdf_path)
        if file_hash and (file_hash in ingested_hashes or file_hash[:16] in {h[:16] for h in ingested_hashes}):
            sz = pdf_path.stat().st_size
            if not dry_run:
                pdf_path.unlink()
            deleted_count += 1
            deleted_bytes += sz
            if deleted_count % 500 == 0:
                logger.info("삭제 중: %d개 (%.1f GB)...", deleted_count, deleted_bytes / 1024**3)
        else:
            skipped_count += 1

    logger.info("=" * 60)
    logger.info("완료: %s %d개 파일 (%.2f GB)", "삭제" if not dry_run else "[DRY] 삭제 예정", deleted_count, deleted_bytes / 1024**3)
    logger.info("스킵 (미인제스트): %d개", skipped_count)

    import shutil
    _, _, free = shutil.disk_usage("C:")
    logger.info("현재 여유공간: %.0f MB", free / 1024**2)


if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    asyncio.run(cleanup(dry_run=dry_run))
