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

    768차원과 1024차원은 직접 캐스팅 불가이므로:
    1단계: 기존 임베딩을 NULL로 초기화 (백필 스크립트로 재생성 예정)
    2단계: 컬럼 타입을 vector(1024)로 변경
    """
    # 1단계: 기존 768차원 임베딩 무효화
    op.execute("UPDATE policy_chunks SET embedding = NULL WHERE embedding IS NOT NULL")

    # 2단계: 컬럼 타입 변경 (NULL 상태에서만 가능)
    op.execute(
        "ALTER TABLE policy_chunks ALTER COLUMN embedding TYPE vector(1024)"
    )


def downgrade() -> None:
    """policy_chunks.embedding을 vector(1024) → vector(768)으로 롤백

    롤백 시에도 기존 임베딩은 호환 불가이므로 NULL로 초기화.
    """
    # 기존 1024차원 임베딩 무효화
    op.execute("UPDATE policy_chunks SET embedding = NULL WHERE embedding IS NOT NULL")

    # 컬럼 타입 롤백
    op.execute(
        "ALTER TABLE policy_chunks ALTER COLUMN embedding TYPE vector(768)"
    )
