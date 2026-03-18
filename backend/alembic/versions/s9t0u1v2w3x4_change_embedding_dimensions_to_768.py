"""change_embedding_dimensions_to_768

Revision ID: s9t0u1v2w3x4
Revises: r8s9t0u1v2w3
Create Date: 2026-03-18 00:00:00.000000

임베딩 모델을 OpenAI text-embedding-3-small(1536차원)에서
Google Gemini text-embedding-004(768차원)로 전환 (프로덕션 데이터 없음):
- policy_chunks.embedding: vector(1536) → vector(768)
- case_precedents.embedding: vector(1536) → vector(768)
- HNSW 인덱스 재생성 (차원 변경으로 인한 필수 재생성)
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "s9t0u1v2w3x4"
down_revision: str | None = "r8s9t0u1v2w3"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    """임베딩 차원을 1536에서 768로 변경"""

    # ─────────────────────────────────────────────
    # policy_chunks 테이블 임베딩 차원 변경
    # ─────────────────────────────────────────────

    # 기존 HNSW 인덱스 삭제 (차원 변경 전 필수)
    op.execute("DROP INDEX IF EXISTS idx_policy_chunks_embedding")

    # 임베딩 컬럼을 vector(768)로 변경 (기존 데이터 없음, NULL로 초기화)
    op.execute(
        "ALTER TABLE policy_chunks "
        "ALTER COLUMN embedding TYPE vector(768) "
        "USING NULL"
    )

    # 768차원 HNSW 인덱스 재생성 (코사인 유사도 최적화)
    op.execute(
        "CREATE INDEX idx_policy_chunks_embedding "
        "ON policy_chunks "
        "USING hnsw (embedding vector_cosine_ops) "
        "WITH (m = 16, ef_construction = 64)"
    )

    # ─────────────────────────────────────────────
    # case_precedents 테이블 임베딩 차원 변경
    # ─────────────────────────────────────────────

    # 기존 HNSW 인덱스 삭제
    op.execute("DROP INDEX IF EXISTS ix_case_precedents_embedding")

    # 임베딩 컬럼을 vector(768)로 변경
    op.execute(
        "ALTER TABLE case_precedents "
        "ALTER COLUMN embedding TYPE vector(768) "
        "USING NULL"
    )

    # 768차원 HNSW 인덱스 재생성
    op.execute(
        "CREATE INDEX ix_case_precedents_embedding "
        "ON case_precedents "
        "USING hnsw (embedding vector_cosine_ops)"
    )


def downgrade() -> None:
    """임베딩 차원을 768에서 1536으로 롤백"""

    # ─────────────────────────────────────────────
    # policy_chunks 롤백
    # ─────────────────────────────────────────────

    op.execute("DROP INDEX IF EXISTS idx_policy_chunks_embedding")

    op.execute(
        "ALTER TABLE policy_chunks "
        "ALTER COLUMN embedding TYPE vector(1536) "
        "USING NULL"
    )

    op.execute(
        "CREATE INDEX idx_policy_chunks_embedding "
        "ON policy_chunks "
        "USING hnsw (embedding vector_cosine_ops) "
        "WITH (m = 16, ef_construction = 64)"
    )

    # ─────────────────────────────────────────────
    # case_precedents 롤백
    # ─────────────────────────────────────────────

    op.execute("DROP INDEX IF EXISTS ix_case_precedents_embedding")

    op.execute(
        "ALTER TABLE case_precedents "
        "ALTER COLUMN embedding TYPE vector(1536) "
        "USING NULL"
    )

    op.execute(
        "CREATE INDEX ix_case_precedents_embedding "
        "ON case_precedents "
        "USING hnsw (embedding vector_cosine_ops)"
    )
