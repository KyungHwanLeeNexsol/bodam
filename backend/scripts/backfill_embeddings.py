"""임베딩 백필 스크립트

DB에 이미 저장된 PolicyChunk 중 embedding=NULL인 항목에 대해
OpenAI text-embedding-3-small(768차원)로 임베딩을 일괄 생성하여 UPDATE한다.

Usage:
    # 인터랙티브 선택 메뉴 (--company 미지정 + 터미널 실행)
    PYTHONPATH=. uv run python -m scripts.backfill_embeddings

    # 보험사 직접 지정
    PYTHONPATH=. uv run python -m scripts.backfill_embeddings --company axa-general

    # Dry-run (DB 쓰기 없이 통계만)
    PYTHONPATH=. uv run python -m scripts.backfill_embeddings --dry-run

    # 배치 크기 조정 (기본 2048)
    PYTHONPATH=. uv run python -m scripts.backfill_embeddings --company axa-general --batch-size 2048

# @MX:NOTE: PolicyChunk.embedding IS NULL → OpenAI text-embedding-3-small(768차원) → UPDATE
# @MX:NOTE: 보험사 필터: --company 옵션으로 InsuranceCompany.code 기준 필터링
# @MX:NOTE: 배치 크기: OpenAI API 최대 2048개 단위 처리, 벌크 UPDATE로 DB 왕복 최소화
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
import time
from pathlib import Path  # noqa: F401 - _project_root에서 사용

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

# 기본 배치 크기 (OpenAI API 최대 2048, 기본값 2048로 변경)
DEFAULT_BATCH_SIZE = 2048
# DB 오류 재시도 횟수
_MAX_RETRIES = 3
# 임베딩 생성 최소 텍스트 길이 (50자 미만 스킵)
_MIN_CHARS = 50


async def fetch_companies_with_null_embeddings(
    session_factory: object,
) -> list[tuple[str, str, int]]:
    """NULL 임베딩이 있는 보험사 목록을 (code, name, count) 형태로 반환한다."""
    from sqlalchemy import func, select

    from app.models.insurance import InsuranceCompany, Policy, PolicyChunk

    async with session_factory() as session:  # type: ignore[union-attr]
        stmt = (
            select(
                InsuranceCompany.code,
                InsuranceCompany.name,
                func.count(PolicyChunk.id).label("null_count"),
            )
            .join(Policy, PolicyChunk.policy_id == Policy.id)
            .join(InsuranceCompany, Policy.company_id == InsuranceCompany.id)
            .where(PolicyChunk.embedding.is_(None))
            .group_by(InsuranceCompany.code, InsuranceCompany.name)
            .order_by(InsuranceCompany.name)
        )
        result = await session.execute(stmt)
        return [(row.code, row.name, row.null_count) for row in result.all()]


async def prompt_company_select(session_factory: object) -> str | None:
    """NULL 임베딩 보험사 목록을 출력하고 사용자가 선택한 code를 반환한다.

    Returns:
        선택된 InsuranceCompany.code, 또는 전체 선택 시 None
    """
    companies = await fetch_companies_with_null_embeddings(session_factory)

    if not companies:
        logger.info("임베딩 백필 대상 보험사가 없습니다 (embedding=NULL 청크 없음).")
        return None

    print()
    print("=" * 50)
    print("  임베딩 백필 대상 보험사 선택")
    print("=" * 50)
    print(f"  {'번호':<4} {'보험사명':<20} {'코드':<25} {'미완료'}")
    print("-" * 50)
    print(f"  {'0':<4} {'전체 (all)':<20}")
    for i, (code, name, count) in enumerate(companies, 1):
        print(f"  {i:<4} {name:<20} {code:<25} {count:>8,}개")
    print("=" * 50)

    while True:
        try:
            raw = input("\n번호 입력 (0=전체): ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            logger.info("취소됨.")
            sys.exit(0)

        if raw == "0":
            logger.info("선택: 전체 보험사")
            return None

        try:
            idx = int(raw) - 1
            if 0 <= idx < len(companies):
                code, name, count = companies[idx]
                logger.info("선택: %s (%s) — %d개", name, code, count)
                return code
        except ValueError:
            pass

        print(f"  올바른 번호를 입력하세요 (0~{len(companies)}).")


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
) -> tuple[int, int]:
    """PolicyChunk.embedding을 벌크 트랜잭션으로 UPDATE한다.

    단일 트랜잭션에서 전체 배치를 처리하여 네트워크 왕복을 최소화.
    실패 시 단건 폴백으로 부분 저장 보장.

    Returns:
        (updated, failed) 튜플
    """
    from sqlalchemy import update

    from app.models.insurance import PolicyChunk

    if not id_to_embedding:
        return 0, 0

    # 벌크 UPDATE 시도 (단일 트랜잭션)
    try:
        async with session_factory() as session:  # type: ignore[union-attr]
            for chunk_id, embedding in id_to_embedding.items():
                stmt = (
                    update(PolicyChunk)
                    .where(PolicyChunk.id == chunk_id)
                    .values(embedding=embedding)
                )
                await session.execute(stmt)
            await session.commit()
            return len(id_to_embedding), 0
    except Exception as exc:
        logger.warning("벌크 UPDATE 실패, 단건 폴백 전환: %s", str(exc)[:200])

    # 단건 폴백 (벌크 실패 시에만 실행)
    updated = 0
    failed = 0
    for chunk_id, embedding in id_to_embedding.items():
        try:
            async with session_factory() as session:  # type: ignore[union-attr]
                stmt = (
                    update(PolicyChunk)
                    .where(PolicyChunk.id == chunk_id)
                    .values(embedding=embedding)
                )
                await session.execute(stmt)
                await session.commit()
                updated += 1
        except Exception:
            failed += 1

    return updated, failed


async def init_db() -> object:
    """DB를 초기화하고 session_factory를 반환한다."""
    import app.core.database as db_module
    from app.core.config import Settings

    settings = Settings()  # type: ignore[call-arg]
    database_url = getattr(settings, "database_url", None) or os.environ.get("DATABASE_URL", "")
    if not database_url:
        logger.error("DATABASE_URL이 설정되지 않았습니다.")
        sys.exit(1)

    await db_module.init_database(settings)
    return db_module.session_factory


async def backfill(
    company_code: str | None,
    batch_size: int,
    dry_run: bool,
    session_factory: object = None,
) -> dict[str, int]:
    """임베딩 백필 메인 로직."""
    # ── DB 초기화 (외부에서 이미 초기화된 경우 재사용) ─────────
    if session_factory is None:
        session_factory = await init_db()

    # ── OpenAI 임베딩 서비스 초기화 ─────────────────────────────
    # @MX:NOTE: get_embedding_service()가 config의 embedding_provider=openai 기준으로 OpenAIEmbeddingService 반환
    # @MX:NOTE: OPENAI_API_KEY 환경변수 또는 .env 파일 필요
    if not dry_run:
        from app.services.rag.embeddings import get_embedding_service
        embedding_service = get_embedding_service()
        logger.info(
            "OpenAI 임베딩 서비스 초기화 완료 (model=text-embedding-3-small, dim=768)"
        )
    else:
        embedding_service = None

    # ── 대상 건수 확인 ─────────────────────────────────────────
    total = await count_null_embeddings(session_factory, company_code)
    label = f"보험사={company_code}" if company_code else "전체"
    logger.info("임베딩 백필 대상: %d개 청크 (%s, embedding=NULL)", total, label)

    if total == 0:
        logger.info("백필할 청크가 없습니다.")
        return {"total": 0, "updated": 0, "skipped": 0, "failed": 0}

    stats = {"total": total, "updated": 0, "skipped": 0, "failed": 0}
    offset = 0
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

        # 50자 미만 텍스트 필터링 (임베딩 의미 없음)
        valid_indices = [i for i, t in enumerate(chunk_texts) if len(t) >= _MIN_CHARS]
        valid_texts = [chunk_texts[i] for i in valid_indices]

        short_count = len(chunk_texts) - len(valid_texts)
        if short_count:
            stats["skipped"] += short_count

        id_to_embedding: dict[object, list[float]] = {}

        if valid_texts:
            try:
                embeddings = await embedding_service.embed_batch(valid_texts)  # type: ignore[union-attr]
                for orig_idx, emb in zip(valid_indices, embeddings):
                    if emb:
                        id_to_embedding[chunk_ids[orig_idx]] = emb
                    else:
                        stats["skipped"] += 1
            except Exception as e:
                logger.error("임베딩 생성 실패 (배치 %d~%d): %s", offset + 1, offset + len(rows), e)
                stats["failed"] += len(valid_texts)
                offset += len(rows)
                continue

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
        description="PolicyChunk embedding=NULL 백필 스크립트 (OpenAI text-embedding-3-small)",
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
        help=f"OpenAI API 배치 크기 (기본: {DEFAULT_BATCH_SIZE}, 최대: 2048)",
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

    if args.batch_size > 2048:
        logger.warning("batch-size 최대 2048 (OpenAI API 제한). 2048로 조정합니다.")
        args.batch_size = 2048

    # --company 미지정 + 인터랙티브 터미널: 보험사 선택 메뉴 표시
    session_factory = None
    if args.company is None and sys.stdin.isatty():
        session_factory = await init_db()
        args.company = await prompt_company_select(session_factory)

    logger.info("=" * 60)
    logger.info("임베딩 백필 시작 (OpenAI text-embedding-3-small)")
    logger.info("  대상 보험사: %s", args.company or "전체")
    logger.info("  배치 크기:   %d", args.batch_size)
    logger.info("  Dry-run:     %s", args.dry_run)
    logger.info("=" * 60)

    stats = await backfill(
        company_code=args.company,
        batch_size=args.batch_size,
        dry_run=args.dry_run,
        session_factory=session_factory,
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
