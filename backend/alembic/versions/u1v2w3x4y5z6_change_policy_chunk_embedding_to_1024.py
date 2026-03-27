"""change_policy_chunk_embedding_to_1024

Revision ID: u1v2w3x4y5z6
Revises: t0u1v2w3x4y5
Create Date: 2026-03-27 00:00:00.000000

임베딩 모델을 Gemini(768차원)에서 BAAI/bge-m3(1024차원)으로 교체.
기존 768차원 벡터를 1024차원으로 직접 변환할 수 없으므로
먼저 기존 임베딩을 NULL로 초기화한 후 컬럼 타입을 변경.
NULL로 초기화된 청크는 backfill_embeddings.py 스크립트로 재생성 필요.
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "u1v2w3x4y5z6"
down_revision: str | None = "t0u1v2w3x4y5"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    """policy_chunks.embedding을 vector(768) → vector(1024)로 변경

    CockroachDB에서 ALTER COLUMN TYPE은 동시 쓰기가 있을 때 RETRY_SERIALIZABLE 오류 발생.
    DROP + ADD COLUMN 방식이 CockroachDB 온라인 스키마 변경에 더 안전함.
    기존 임베딩 데이터는 어차피 재생성 예정이므로 손실 없음.
    """
    # 기존 컬럼 삭제 (모든 임베딩 데이터 제거)
    op.execute("ALTER TABLE policy_chunks DROP COLUMN IF EXISTS embedding")

    # 새 컬럼 추가 (1024차원)
    op.execute("ALTER TABLE policy_chunks ADD COLUMN IF NOT EXISTS embedding vector(1024)")


def downgrade() -> None:
    """policy_chunks.embedding을 vector(1024) → vector(768)으로 롤백"""
    # 기존 컬럼 삭제
    op.execute("ALTER TABLE policy_chunks DROP COLUMN IF EXISTS embedding")

    # 768차원 컬럼 복원
    op.execute("ALTER TABLE policy_chunks ADD COLUMN IF NOT EXISTS embedding vector(768)")
