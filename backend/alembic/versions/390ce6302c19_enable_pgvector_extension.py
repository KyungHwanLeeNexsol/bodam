"""enable_pgvector_extension

Revision ID: 390ce6302c19
Revises:
Create Date: 2026-03-13 21:27:07.273881

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "390ce6302c19"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """pgvector 확장 활성화 - 벡터 유사도 검색에 필요

    CockroachDB: vector 타입이 내장됨 → CREATE EXTENSION 불필요, 예외 무시
    """
    try:
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    except Exception:
        pass  # CockroachDB는 vector 내장 타입, extension 불필요


def downgrade() -> None:
    """pgvector 확장 비활성화"""
    op.execute("DROP EXTENSION IF EXISTS vector")
