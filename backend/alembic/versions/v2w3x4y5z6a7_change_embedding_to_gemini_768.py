"""change_embedding_to_gemini_768

Revision ID: v2w3x4y5z6a7
Revises: u1v2w3x4y5z6
Create Date: 2026-03-30 00:00:00.000000

임베딩 모델을 BAAI/bge-m3(1024차원)에서 Gemini text-embedding-004(768차원)으로 교체.
기존 1024차원 벡터를 768차원으로 직접 변환할 수 없으므로
먼저 기존 임베딩을 NULL로 초기화한 후 컬럼 타입을 변경.
NULL로 초기화된 청크는 크롤러 재실행 시 Gemini API로 재생성됨.
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "v2w3x4y5z6a7"
down_revision: str | None = "u1v2w3x4y5z6"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    """policy_chunks.embedding을 vector(1024) → vector(768)로 변경

    ALTER COLUMN TYPE은 전체 테이블 rewrite가 필요하여 수십만 행에서 타임아웃 발생.
    DROP + ADD COLUMN 방식을 사용하면 PostgreSQL 카탈로그만 업데이트되어 즉시 처리됨.
    기존 임베딩 데이터는 768차원으로 변환 불가하므로 재생성 필요 - 데이터 손실 없음.
    """
    # 기존 HNSW 인덱스 삭제
    op.execute("DROP INDEX IF EXISTS idx_policy_chunks_embedding")

    # 기존 컬럼 삭제 (즉시 처리 - 카탈로그 업데이트만)
    op.execute("ALTER TABLE policy_chunks DROP COLUMN IF EXISTS embedding")

    # 768차원 컬럼 추가 (즉시 처리 - nullable 컬럼은 PG11+에서 테이블 rewrite 없음)
    op.execute("ALTER TABLE policy_chunks ADD COLUMN embedding vector(768)")

    # HNSW 인덱스 생성 (빈 컬럼이므로 즉시 처리)
    op.execute(
        "CREATE INDEX idx_policy_chunks_embedding "
        "ON policy_chunks "
        "USING hnsw (embedding vector_cosine_ops) "
        "WITH (m = 16, ef_construction = 64)"
    )


def downgrade() -> None:
    """policy_chunks.embedding을 vector(768) → vector(1024)로 롤백"""
    op.execute("DROP INDEX IF EXISTS idx_policy_chunks_embedding")

    op.execute("ALTER TABLE policy_chunks DROP COLUMN IF EXISTS embedding")

    op.execute("ALTER TABLE policy_chunks ADD COLUMN embedding vector(1024)")

    op.execute(
        "CREATE INDEX idx_policy_chunks_embedding "
        "ON policy_chunks "
        "USING hnsw (embedding vector_cosine_ops) "
        "WITH (m = 16, ef_construction = 64)"
    )
