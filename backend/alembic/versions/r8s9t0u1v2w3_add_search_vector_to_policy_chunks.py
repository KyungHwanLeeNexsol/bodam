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
    """search_vector 컬럼, GIN 인덱스, 자동 갱신 트리거 추가"""
    # tsvector 컬럼 추가
    op.execute(
        "ALTER TABLE policy_chunks ADD COLUMN IF NOT EXISTS search_vector tsvector"
    )

    # 기존 데이터에 대해 tsvector 값 생성
    op.execute(
        "UPDATE policy_chunks SET search_vector = to_tsvector('simple', coalesce(chunk_text, ''))"
    )

    # GIN 인덱스 생성 (전문 검색 고속화)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_policy_chunks_search_vector "
        "ON policy_chunks USING GIN (search_vector)"
    )

    # chunk_text 변경 시 search_vector 자동 갱신 트리거 함수
    op.execute("""
CREATE OR REPLACE FUNCTION fn_policy_chunks_search_vector_update()
RETURNS trigger AS $$
BEGIN
    NEW.search_vector := to_tsvector('simple', coalesce(NEW.chunk_text, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
""")

    # 트리거 등록 (이미 존재하지 않는 경우에만)
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
