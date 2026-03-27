"""임베딩 백필 스크립트

DB에 이미 저장된 PolicyChunk 중 embedding=NULL인 항목에 대해
BAAI/bge-m3 로컬 모델로 임베딩을 일괄 생성하여 UPDATE한다.

Usage:
    # AXA 전체 백필
    PYTHONPATH=. uv run python -m scripts.backfill_embeddings --company axa-general

    # 전체 보험사 백필 (embedding=NULL인 모든 청크)
    PYTHONPATH=. uv run python -m scripts.backfill_embeddings

    # Dry-run (DB 쓰기 없이 통계만)
    PYTHONPATH=. uv run python -m scripts.backfill_embeddings --company axa-general --dry-run

    # 배치 크기 조정 (기본 128)
    PYTHONPATH=. uv run python -m scripts.backfill_embeddings --company axa-general --batch-size 128

# @MX:NOTE: PolicyChunk.embedding IS NULL → BAAI/bge-m3 로컬 모델(1024차원) → UPDATE
# @MX:NOTE: 보험사 필터: --company 옵션으로 InsuranceCompany.code 기준 필터링
# @MX:NOTE: 배치 크기: 로컬 CPU 추론 최적값 128개 단위 처리, API 키 불필요
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

# 기본 배치 크기 (bge-m3 CPU 추론 최적값)
DEFAULT_BATCH_SIZE = 128
# UPDATE 트랜잭션당 청크 수
# @MX:NOTE: 1로 설정 — 각 UPDATE를 독립 트랜잭션으로 처리
# @MX:REASON: CockroachDB ABORT_REASON_CLIENT_REJECT 방지
#             (다수 UPDATE 단일 트랜잭션 → gul 초과 → 연쇄 실패)
UPDATE_BATCH_SIZE = 1
# 직렬화 에러 재시도 횟수
_MAX_RETRIES = 3


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


def _is_serialization_error(exc: Exception) -> bool:
    """CockroachDB 직렬화/재시도 오류 여부 판별."""
    msg = str(exc)
    return any(
        kw in msg
        for kw in (
            "SerializationError",
            "TransactionRetryWithProtoRefreshError",
            "ABORT_REASON_CLIENT_REJECT",
            "restart transaction",
        )
    )


async def update_embeddings(
    session_factory: object,
    id_to_embedding: dict[object, list[float]],
) -> tuple[int, int]:
    """PolicyChunk.embedding을 단건 트랜잭션으로 UPDATE한다.

    # @MX:NOTE: UPDATE_BATCH_SIZE=1 — 각 청크를 독립 트랜잭션으로 처리
    # @MX:REASON: CockroachDB ABORT_REASON_CLIENT_REJECT 방지
    #             (다수 UPDATE 단일 트랜잭션 → 트랜잭션 지속시간 → gul 초과)

    Returns:
        (updated, failed) 튜플
    """
    from sqlalchemy import update

    from app.models.insurance import PolicyChunk

    if not id_to_embedding:
        return 0, 0

    updated = 0
    failed = 0

    for chunk_id, embedding in id_to_embedding.items():
        last_exc: Exception | None = None
        for attempt in range(_MAX_RETRIES):
            try:
                async with session_factory() as session:  # type: ignore[union-attr]
                    await session.connection(execution_options={"isolation_level": "READ COMMITTED"})
                    stmt = (
                        update(PolicyChunk)
                        .where(PolicyChunk.id == chunk_id)
                        .values(embedding=embedding)
                    )
                    await session.execute(stmt)
                    await session.commit()
                    updated += 1
                    last_exc = None
                    break
            except Exception as exc:
                last_exc = exc
                if _is_serialization_error(exc) and attempt < _MAX_RETRIES - 1:
                    wait = 0.5 * (2**attempt)
                    logger.warning(
                        "직렬화 오류 (id=%s, 시도 %d/%d), %.1f초 후 재시도: %s",
                        chunk_id, attempt + 1, _MAX_RETRIES, wait, exc,
                    )
                    await asyncio.sleep(wait)
                    continue
                break

        if last_exc is not None:
            logger.error("단건 UPDATE 실패 (id=%s): %s", chunk_id, last_exc)
            failed += 1

    return updated, failed


async def _embed_local(
    model: object,
    texts: list[str],
) -> list[list[float]]:
    """BAAI/bge-m3 로컬 모델 임베딩 생성

    동기 추론을 asyncio.to_thread로 비동기 루프에서 비블로킹 실행.
    50자 미만 텍스트는 빈 리스트로 반환.

    Args:
        model: SentenceTransformer 인스턴스 (backfill() 시작 시 1회 로드)
        texts: 임베딩할 텍스트 목록

    Returns:
        임베딩 벡터 목록 (50자 미만 위치에는 빈 리스트)
    """
    from sentence_transformers import SentenceTransformer  # type: ignore[import-untyped]

    MIN_CHARS = 50
    valid_indices = [i for i, t in enumerate(texts) if len(t) >= MIN_CHARS]
    valid_texts = [texts[i] for i in valid_indices]
    results: list[list[float]] = [[] for _ in texts]

    if not valid_texts:
        return results

    def _encode() -> list[list[float]]:
        st_model: SentenceTransformer = model  # type: ignore[assignment]
        embeddings = st_model.encode(
            valid_texts,
            batch_size=128,
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        return [emb.tolist() for emb in embeddings]

    embeddings = await asyncio.to_thread(_encode)
    for orig_idx, emb in zip(valid_indices, embeddings):
        results[orig_idx] = emb
    return results


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

    # ── 로컬 임베딩 모델 초기화 (BAAI/bge-m3, 1회 로드) ─────────
    # @MX:NOTE: BAAI/bge-m3 모델을 백필 시작 시 1회 로드 — API 키 불필요
    # @MX:NOTE: ~600MB HuggingFace 캐시에서 로드, GitHub Actions에서 캐시 적중 시 빠름
    _model_name = getattr(settings, "embedding_model", "BAAI/bge-m3")

    if not dry_run:
        from sentence_transformers import SentenceTransformer  # type: ignore[import-untyped]
        logger.info("BAAI/bge-m3 모델 로드 중 (model=%s)...", _model_name)
        _st_model = SentenceTransformer(_model_name)
        logger.info("임베딩 초기화 완료 (model=%s, dim=1024, 로컬 CPU 추론)", _model_name)
    else:
        _st_model = None

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

        # bge-m3 로컬 임베딩 생성
        try:
            embeddings = await _embed_local(_st_model, chunk_texts)
        except Exception as e:
            logger.error("임베딩 생성 실패 (배치 %d~%d): %s", offset + 1, offset + len(rows), e)
            stats["failed"] += len(rows)
            offset += len(rows)
            batch_index += 1
            continue
        batch_index += 1

        # 유효한 임베딩만 UPDATE
        id_to_embedding: dict[object, list[float]] = {}
        for chunk_id, embedding in zip(chunk_ids, embeddings):
            if embedding:  # 빈 리스트(50자 미만 텍스트)는 스킵
                id_to_embedding[chunk_id] = embedding
            else:
                stats["skipped"] += 1

        try:
            batch_updated, batch_failed = await update_embeddings(session_factory, id_to_embedding)
            stats["updated"] += batch_updated
            stats["failed"] += batch_failed
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
        help=f"bge-m3 인코딩 배치 크기 (기본: {DEFAULT_BATCH_SIZE})",
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

    if args.batch_size > 512:
        logger.warning("batch-size 최대 512 (메모리 제한). 512로 조정합니다.")
        args.batch_size = 512

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
