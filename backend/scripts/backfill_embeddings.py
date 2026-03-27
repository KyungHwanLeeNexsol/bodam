"""임베딩 백필 스크립트

DB에 이미 저장된 PolicyChunk 중 embedding=NULL인 항목에 대해
Google Gemini 임베딩을 일괄 생성하여 UPDATE한다.

Usage:
    # AXA 전체 백필
    PYTHONPATH=. uv run python -m scripts.backfill_embeddings --company axa-general

    # 전체 보험사 백필 (embedding=NULL인 모든 청크)
    PYTHONPATH=. uv run python -m scripts.backfill_embeddings

    # Dry-run (DB 쓰기 없이 통계만)
    PYTHONPATH=. uv run python -m scripts.backfill_embeddings --company axa-general --dry-run

    # 배치 크기 조정 (기본 50, 최대 100)
    PYTHONPATH=. uv run python -m scripts.backfill_embeddings --company axa-general --batch-size 80

# @MX:NOTE: PolicyChunk.embedding IS NULL → Gemini text-embedding-004(768차원) → UPDATE
# @MX:NOTE: 보험사 필터: --company 옵션으로 InsuranceCompany.code 기준 필터링
# @MX:NOTE: 배치 크기: Gemini API 최대 100개 제한에 맞춰 기본 50개 단위로 처리
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
import time
from pathlib import Path

# 프로젝트 루트 추가 (스크립트 직접 실행 대응)
_project_root = Path(__file__).parent.parent
sys.path.insert(0, str(_project_root))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("backfill_embeddings")

# 기본 배치 크기 (Gemini API 최대 100개 제한 이하)
DEFAULT_BATCH_SIZE = 50
# UPDATE 트랜잭션당 청크 수 (DB 트랜잭션 크기 제한)
UPDATE_BATCH_SIZE = 200


async def count_null_embeddings(
    session_factory: object,
    company_code: str | None,
) -> int:
    """embedding=NULL인 PolicyChunk 수를 반환한다."""
    from sqlalchemy import func, select

    from app.models.insurance import InsuranceCompany, Policy, PolicyChunk

    async with session_factory() as session:  # type: ignore[union-attr]
        stmt = (
            select(func.count(PolicyChunk.id))
            .join(Policy, PolicyChunk.policy_id == Policy.id)
            .where(PolicyChunk.embedding.is_(None))
        )
        if company_code:
            stmt = stmt.join(InsuranceCompany, Policy.company_id == InsuranceCompany.id).where(
                InsuranceCompany.code == company_code
            )
        result = await session.execute(stmt)
        return result.scalar_one()


async def fetch_null_embedding_chunks(
    session_factory: object,
    company_code: str | None,
    limit: int,
    offset: int,
) -> list[tuple[object, str]]:
    """embedding=NULL인 PolicyChunk (id, chunk_text) 목록을 페이지 단위로 조회한다."""
    from sqlalchemy import select

    from app.models.insurance import InsuranceCompany, Policy, PolicyChunk

    async with session_factory() as session:  # type: ignore[union-attr]
        stmt = (
            select(PolicyChunk.id, PolicyChunk.chunk_text)
            .join(Policy, PolicyChunk.policy_id == Policy.id)
            .where(PolicyChunk.embedding.is_(None))
            .order_by(PolicyChunk.id)
            .limit(limit)
            .offset(offset)
        )
        if company_code:
            stmt = stmt.join(InsuranceCompany, Policy.company_id == InsuranceCompany.id).where(
                InsuranceCompany.code == company_code
            )
        result = await session.execute(stmt)
        return result.all()


async def update_embeddings(
    session_factory: object,
    id_to_embedding: dict[object, list[float]],
) -> int:
    """PolicyChunk.embedding을 일괄 UPDATE한다. 성공한 건수를 반환한다."""
    from sqlalchemy import update

    from app.models.insurance import PolicyChunk

    if not id_to_embedding:
        return 0

    updated = 0
    # UPDATE_BATCH_SIZE 단위로 나눠서 CockroachDB 트랜잭션 크기 제한 방지
    items = list(id_to_embedding.items())
    for i in range(0, len(items), UPDATE_BATCH_SIZE):
        batch = items[i : i + UPDATE_BATCH_SIZE]
        async with session_factory() as session:  # type: ignore[union-attr]
            await session.connection(execution_options={"isolation_level": "READ COMMITTED"})
            for chunk_id, embedding in batch:
                stmt = (
                    update(PolicyChunk)
                    .where(PolicyChunk.id == chunk_id)
                    .values(embedding=embedding)
                )
                await session.execute(stmt)
            await session.commit()
            updated += len(batch)
    return updated


async def backfill(
    company_code: str | None,
    batch_size: int,
    dry_run: bool,
) -> dict[str, int]:
    """임베딩 백필 메인 로직."""
    # ── DB 초기화 ─────────────────────────────────────────────
    from app.core.config import Settings
    import app.core.database as db_module

    settings = Settings()  # type: ignore[call-arg]
    database_url = getattr(settings, "database_url", None) or os.environ.get("DATABASE_URL", "")
    if not database_url:
        logger.error("DATABASE_URL이 설정되지 않았습니다.")
        sys.exit(1)

    await db_module.init_database(settings)
    session_factory = db_module.session_factory

    # ── 임베딩 서비스 초기화 (다중 API 키 라운드 로빈) ──────────
    from app.services.rag.embeddings import EmbeddingService

    # GEMINI_API_KEY1/2/3 우선, 없으면 GEMINI_API_KEY 단일 키로 폴백
    _model = getattr(settings, "embedding_model", "models/text-embedding-004")
    _dimensions = getattr(settings, "embedding_dimensions", 768)
    _api_keys = [
        k for k in [
            os.environ.get("GEMINI_API_KEY1"),
            os.environ.get("GEMINI_API_KEY2"),
            os.environ.get("GEMINI_API_KEY3"),
        ]
        if k
    ]
    if not _api_keys:
        # 단일 키 폴백
        _single = getattr(settings, "gemini_api_key", None) or os.environ.get("GEMINI_API_KEY", "")
        if _single:
            _api_keys = [_single]

    if not _api_keys and not dry_run:
        logger.error("GEMINI_API_KEY1/2/3 또는 GEMINI_API_KEY가 설정되지 않았습니다.")
        sys.exit(1)

    # 키별 EmbeddingService 인스턴스 생성
    embedding_services: list[EmbeddingService] = []
    if not dry_run and _api_keys:
        for _key in _api_keys:
            embedding_services.append(
                EmbeddingService(api_key=_key, model=_model, dimensions=_dimensions)
            )
        logger.info(
            "임베딩 서비스 초기화 완료 (model=%s, dim=%d, 키 %d개 라운드 로빈)",
            _model, _dimensions, len(embedding_services),
        )

    # ── 대상 건수 확인 ─────────────────────────────────────────
    total = await count_null_embeddings(session_factory, company_code)
    label = f"보험사={company_code}" if company_code else "전체"
    logger.info("임베딩 백필 대상: %d개 청크 (%s, embedding=NULL)", total, label)

    if total == 0:
        logger.info("백필할 청크가 없습니다.")
        return {"total": 0, "updated": 0, "skipped": 0, "failed": 0}

    stats = {"total": total, "updated": 0, "skipped": 0, "failed": 0}
    offset = 0
    batch_index = 0
    start_time = time.time()

    while offset < total:
        rows = await fetch_null_embedding_chunks(session_factory, company_code, batch_size, offset)
        if not rows:
            break

        chunk_ids = [row[0] for row in rows]
        chunk_texts = [row[1] for row in rows]

        if dry_run:
            logger.info(
                "[dry-run] 배치 %d~%d / %d — 임베딩 생성 스킵",
                offset + 1, offset + len(rows), total,
            )
            stats["skipped"] += len(rows)
            offset += len(rows)
            continue

        # 라운드 로빈으로 EmbeddingService 선택
        svc = embedding_services[batch_index % len(embedding_services)]
        batch_index += 1

        # Gemini 임베딩 생성
        try:
            embeddings = await svc.embed_batch(chunk_texts)
        except Exception as e:
            logger.error("임베딩 생성 실패 (배치 %d~%d): %s", offset + 1, offset + len(rows), e)
            stats["failed"] += len(rows)
            offset += len(rows)
            continue

        # 유효한 임베딩만 UPDATE
        id_to_embedding: dict[object, list[float]] = {}
        for chunk_id, embedding in zip(chunk_ids, embeddings):
            if embedding is not None:
                id_to_embedding[chunk_id] = embedding
            else:
                stats["skipped"] += 1

        try:
            updated = await update_embeddings(session_factory, id_to_embedding)
            stats["updated"] += updated
        except Exception as e:
            logger.error("DB UPDATE 실패 (배치 %d~%d): %s", offset + 1, offset + len(rows), e)
            stats["failed"] += len(rows)

        elapsed = time.time() - start_time
        rate = stats["updated"] / elapsed if elapsed > 0 else 0
        remaining = (total - offset - len(rows)) / rate / 60 if rate > 0 else 0
        logger.info(
            "진행: %d / %d (갱신=%d, 스킵=%d, 실패=%d) | %.1f청크/초 | 잔여 ~%.0f분",
            offset + len(rows), total,
            stats["updated"], stats["skipped"], stats["failed"],
            rate, remaining,
        )

        offset += len(rows)

    elapsed_total = time.time() - start_time
    logger.info(
        "백필 완료: 총 %d개 처리 → 갱신=%d, 스킵=%d, 실패=%d (소요 %.1f초)",
        total, stats["updated"], stats["skipped"], stats["failed"], elapsed_total,
    )
    return stats


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """CLI 인자를 파싱한다."""
    parser = argparse.ArgumentParser(
        description="PolicyChunk embedding=NULL 백필 스크립트",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
사용 예시:
  PYTHONPATH=. uv run python -m scripts.backfill_embeddings --company axa-general
  PYTHONPATH=. uv run python -m scripts.backfill_embeddings
  PYTHONPATH=. uv run python -m scripts.backfill_embeddings --dry-run
        """,
    )
    parser.add_argument(
        "--company",
        type=str,
        default=None,
        help="대상 보험사 코드 (InsuranceCompany.code, 예: axa-general). 미지정 시 전체",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help=f"Gemini API 호출당 청크 수 (기본: {DEFAULT_BATCH_SIZE}, 최대: 100)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="DB 쓰기 없이 대상 건수 확인만",
    )
    return parser.parse_args(argv)


async def main() -> None:
    """진입점."""
    args = parse_args()

    if args.batch_size > 100:
        logger.warning("batch-size 최대 100 (Gemini API 제한). 100으로 조정합니다.")
        args.batch_size = 100

    logger.info("=" * 60)
    logger.info("임베딩 백필 시작")
    logger.info("  대상 보험사: %s", args.company or "전체")
    logger.info("  배치 크기:   %d", args.batch_size)
    logger.info("  Dry-run:     %s", args.dry_run)
    logger.info("=" * 60)

    stats = await backfill(
        company_code=args.company,
        batch_size=args.batch_size,
        dry_run=args.dry_run,
    )

    print()
    print("=" * 40)
    print("  백필 결과")
    print("=" * 40)
    print(f"  총 대상:  {stats['total']:>8,}개")
    print(f"  갱신:     {stats['updated']:>8,}개")
    print(f"  스킵:     {stats['skipped']:>8,}개")
    print(f"  실패:     {stats['failed']:>8,}개")
    print("=" * 40)

    if stats["failed"] > 0:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
