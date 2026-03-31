"""add_embedding_null_partial_index

Revision ID: w3x4y5z6a7b8
Revises: v2w3x4y5z6a7
Create Date: 2026-03-31 00:00:00.000000

embedding IS NULL 조건의 COUNT/SELECT 쿼리가 full table scan을 유발하여
305K+ 행에서 3분 이상 소요되는 문제 해결.
partial index 추가로 NULL 행만 인덱싱하여 수 초 이내로 단축.
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "w3x4y5z6a7b8"
down_revision: str | None = "v2w3x4y5z6a7"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    """embedding IS NULL 조건에 대한 partial index 추가.

    백필 스크립트의 COUNT 및 커서 페이지네이션 쿼리 성능을 개선.
    Fly.io PostgreSQL 환경에서 실행.
    """
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_policy_chunks_embedding_null "
        "ON policy_chunks (id) "
        "WHERE embedding IS NULL"
    )


def downgrade() -> None:
    """partial index 제거."""
    op.execute("DROP INDEX IF EXISTS idx_policy_chunks_embedding_null")
