"""add_social_accounts_table

Revision ID: g7h8i9j0k1l2
Revises: f6g7h8i9j0k1
Create Date: 2026-03-15 00:00:00.000000

SPEC-OAUTH-001 TAG-001:
- social_accounts 테이블 추가
- (provider, provider_user_id) UNIQUE 제약조건
- user_id -> users.id CASCADE DELETE FK
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "g7h8i9j0k1l2"
down_revision: str | None = "f6g7h8i9j0k1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """social_accounts 테이블 생성"""
    op.create_table(
        "social_accounts",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider", sa.VARCHAR(20), nullable=False),
        sa.Column("provider_user_id", sa.VARCHAR(255), nullable=False),
        sa.Column("provider_email", sa.VARCHAR(255), nullable=True),
        sa.Column("provider_name", sa.VARCHAR(100), nullable=True),
        sa.Column("access_token", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider", "provider_user_id", name="uq_social_provider_user"),
    )
    # user_id 인덱스
    op.create_index("ix_social_accounts_user_id", "social_accounts", ["user_id"])
    # (provider, provider_email) 복합 인덱스
    op.create_index(
        "ix_social_provider_email",
        "social_accounts",
        ["provider", "provider_email"],
    )


def downgrade() -> None:
    """social_accounts 테이블 삭제"""
    op.drop_index("ix_social_provider_email", table_name="social_accounts")
    op.drop_index("ix_social_accounts_user_id", table_name="social_accounts")
    op.drop_table("social_accounts")
