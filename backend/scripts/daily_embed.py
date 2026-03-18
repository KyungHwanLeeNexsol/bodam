#!/usr/bin/env python3
"""매일 자동 실행되는 임베딩 처리 스크립트

Gemini Free Tier 일일 쿼터(키당 1,000건)를 고려하여
임베딩이 없는 청크를 배치로 처리.
API 키 로테이션 + rate limit 대응 포함.

Windows 작업 스케줄러 또는 수동 실행:
  python scripts/daily_embed.py
  python scripts/daily_embed.py --max-chunks 500
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path

project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

try:
    from dotenv import load_dotenv
    load_dotenv(project_root / ".env")
except ImportError:
    pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(project_root / "logs" / "daily_embed.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger("daily_embed")


async def run_daily_embed(max_chunks: int = 2500) -> None:
    """임베딩이 없는 청크를 매일 배치 처리

    Args:
        max_chunks: 한 번 실행에 처리할 최대 청크 수 (기본 2500, 키 3개 기준)
    """
    import uuid

    import app.core.database as db_module
    from app.core.config import Settings
    from app.models.insurance import PolicyChunk
    from app.services.rag.embeddings import EmbeddingService
    from sqlalchemy import select

    settings = Settings()  # type: ignore[call-arg]
    await db_module.init_database(settings)

    if db_module.session_factory is None:
        logger.error("DB 초기화 실패")
        return

    # API 키 로테이션 설정
    api_keys_str = os.environ.get("GEMINI_API_KEYS", "")
    api_keys = [k.strip() for k in api_keys_str.split(",") if k.strip()] if api_keys_str else []
    if not api_keys:
        single_key = getattr(settings, "gemini_api_key", None) or os.environ.get("GEMINI_API_KEY", "")
        if single_key:
            api_keys = [single_key]
    if not api_keys:
        logger.error("GEMINI_API_KEY가 설정되지 않았습니다")
        return

    logger.info("=== 일일 임베딩 배치 시작 (API 키 %d개, 최대 %d청크) ===", len(api_keys), max_chunks)

    model_name = getattr(settings, "embedding_model", "models/text-embedding-004")
    dims = getattr(settings, "embedding_dimensions", 768)
    current_key_idx = 0

    def create_service(idx: int) -> EmbeddingService:
        return EmbeddingService(api_key=api_keys[idx], model=model_name, dimensions=dims)

    embedding_service = create_service(current_key_idx)

    async with db_module.session_factory() as session:
        # 임베딩이 없는 청크 조회 (최대 max_chunks개)
        stmt = (
            select(PolicyChunk)
            .where(PolicyChunk.embedding.is_(None))
            .limit(max_chunks)
        )
        result = await session.execute(stmt)
        chunks = result.scalars().all()

        if not chunks:
            logger.info("임베딩이 필요한 청크가 없습니다. 완료.")
            return

        logger.info("처리할 청크: %d개", len(chunks))

        success = 0
        fail = 0
        batch_size = 20  # 한 번에 임베딩할 청크 수

        for i in range(0, len(chunks), batch_size):
            batch = chunks[i:i + batch_size]
            texts = [c.chunk_text for c in batch]

            try:
                vectors = await embedding_service.embed_batch(texts)
                for chunk, vector in zip(batch, vectors):
                    if vector:
                        chunk.embedding = vector
                        success += 1
                    else:
                        fail += 1
                await session.commit()

                if (i // batch_size) % 10 == 0:
                    logger.info("진행: %d/%d (성공=%d, 실패=%d)", i + len(batch), len(chunks), success, fail)

                await asyncio.sleep(0.5)

            except Exception as exc:
                error_str = str(exc)
                # 429 Rate Limit → 키 전환
                if "429" in error_str and len(api_keys) > 1:
                    current_key_idx = (current_key_idx + 1) % len(api_keys)
                    logger.warning("Rate limit, 키 %d로 전환", current_key_idx + 1)
                    embedding_service = create_service(current_key_idx)
                    await asyncio.sleep(5.0)

                    # 전환 후 재시도
                    try:
                        vectors = await embedding_service.embed_batch(texts)
                        for chunk, vector in zip(batch, vectors):
                            if vector:
                                chunk.embedding = vector
                                success += 1
                            else:
                                fail += 1
                        await session.commit()
                        continue
                    except Exception:
                        pass

                # 일일 쿼터 소진 시 중단
                if "1000" in error_str and "PerDay" in error_str:
                    logger.warning("일일 쿼터 소진. 내일 재실행 시 이어서 처리됩니다.")
                    break

                fail += len(batch)
                logger.error("배치 실패: %s", error_str[:200])

    logger.info("=== 일일 임베딩 완료: 성공=%d, 실패=%d ===", success, fail)


def main() -> None:
    parser = argparse.ArgumentParser(description="일일 임베딩 배치 처리")
    parser.add_argument("--max-chunks", type=int, default=2500, help="최대 처리 청크 수 (기본 2500)")
    args = parser.parse_args()

    # 로그 디렉토리 생성
    (project_root / "logs").mkdir(exist_ok=True)

    asyncio.run(run_daily_embed(max_chunks=args.max_chunks))


if __name__ == "__main__":
    main()
