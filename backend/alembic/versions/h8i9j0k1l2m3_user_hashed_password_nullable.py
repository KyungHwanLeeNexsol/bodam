"""user_hashed_password_nullable

Revision ID: h8i9j0k1l2m3
Revises: g7h8i9j0k1l2
Create Date: 2026-03-15 00:00:00.000000

SPEC-OAUTH-001 TAG-002:
- users.hashed_password를 nullable=True로 변경
- 소셜 전용 계정(카카오/네이버/구글) 지원을 위해 비밀번호 없는 계정 허용
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "h8i9j0k1l2m3"
down_revision: str | None = "g7h8i9j0k1l2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """hashed_password 컬럼 nullable=True로 변경"""
    op.alter_column(
        "users",
        "hashed_password",
        existing_type=sa.Text(),
        nullable=True,
    )


def downgrade() -> None:
    """hashed_password 컬럼 nullable=False로 롤백 (데이터 확인 필요)"""
    op.alter_column(
        "users",
        "hashed_password",
        existing_type=sa.Text(),
        nullable=False,
    )
