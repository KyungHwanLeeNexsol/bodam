"""add_search_vector_to_policy_chunks

Revision ID: r8s9t0u1v2w3
Revises: q7r8s9t0u1v2
Create Date: 2026-03-18 00:00:00.000000

policy_chunks 테이블에 전문 검색 지원 추가 (SPEC-PIPELINE-001 REQ-10, REQ-11):
- search_vector (tsvector): 한국어/영어 전문 검색 벡터 컬럼
- GIN 인덱스: idx_policy_chunks_search_vector (고속 전문 검색)
- 트리거: trg_policy_chunks_search_vector_update (chunk_text 변경 시 자동 갱신)
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "r8s9t0u1v2w3"
down_revision: str | None = "q7r8s9t0u1v2"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    """search_vector 컬럼, GIN 인덱스, 자동 갱신 트리거 추가

    CockroachDB: tsvector/GIN/트리거 미지원 → 스킵 (search_vector 컬럼은 TEXT로 유지)
    PostgreSQL: 전체 마이그레이션 실행
    """
    bind = op.get_bind()
    # CockroachDB는 tsvector, GIN 인덱스, plpgsql 트리거 미지원 → 스킵
    if "cockroach" in str(getattr(bind, "engine", bind)).lower() or \
       "cockroach" in str(getattr(bind.dialect, "name", "")).lower() or \
       "26257" in str(getattr(getattr(bind, "engine", None), "url", "") or ""):
        return

    try:
        op.execute(
            "ALTER TABLE policy_chunks ADD COLUMN IF NOT EXISTS search_vector tsvector"
        )
        op.execute(
            "UPDATE policy_chunks SET search_vector = to_tsvector('simple', coalesce(chunk_text, ''))"
        )
        op.execute(
            "CREATE INDEX IF NOT EXISTS idx_policy_chunks_search_vector "
            "ON policy_chunks USING GIN (search_vector)"
        )
        op.execute("""
CREATE OR REPLACE FUNCTION fn_policy_chunks_search_vector_update()
RETURNS trigger AS $$
BEGIN
    NEW.search_vector := to_tsvector('simple', coalesce(NEW.chunk_text, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
""")
        op.execute("""
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_policy_chunks_search_vector_update'
          AND tgrelid = 'policy_chunks'::regclass
    ) THEN
        CREATE TRIGGER trg_policy_chunks_search_vector_update
        BEFORE INSERT OR UPDATE OF chunk_text
        ON policy_chunks
        FOR EACH ROW
        EXECUTE FUNCTION fn_policy_chunks_search_vector_update();
    END IF;
END $$
""")
    except Exception:
        pass  # tsvector 미지원 환경에서 무시


def downgrade() -> None:
    """search_vector 컬럼, GIN 인덱스, 트리거 제거"""
    # 트리거 제거
    op.execute(
        "DROP TRIGGER IF EXISTS trg_policy_chunks_search_vector_update ON policy_chunks"
    )

    # 트리거 함수 제거
    op.execute(
        "DROP FUNCTION IF EXISTS fn_policy_chunks_search_vector_update()"
    )

    # GIN 인덱스 제거
    op.execute(
        "DROP INDEX IF EXISTS idx_policy_chunks_search_vector"
    )

    # search_vector 컬럼 제거
    op.execute(
        "ALTER TABLE policy_chunks DROP COLUMN IF EXISTS search_vector"
    )
