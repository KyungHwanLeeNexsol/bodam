"""add_usage_records_table

Revision ID: l2m3n4o5p6q7
Revises: k1l2m3n4o5p6
Create Date: 2026-03-15 00:00:00.000000

SPEC-B2B-001 Phase 4:
- usage_records 테이블 추가
- (organization_id, created_at) 복합 인덱스
- api_key_id, user_id 인덱스
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "l2m3n4o5p6q7"
down_revision: str | None = "k1l2m3n4o5p6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """usage_records 테이블 생성"""
    op.create_table(
        "usage_records",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "organization_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "api_key_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column("endpoint", sa.Text(), nullable=False),
        sa.Column("method", sa.Text(), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column(
            "tokens_consumed",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("response_time_ms", sa.Integer(), nullable=False),
        sa.Column("ip_address", sa.Text(), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["api_key_id"],
            ["api_keys.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    # (organization_id, created_at) 복합 인덱스 (월간 집계 조회 성능)
    op.create_index(
        "ix_usage_org_created",
        "usage_records",
        ["organization_id", "created_at"],
    )

    # api_key_id 인덱스 (API 키별 사용량 조회)
    op.create_index(
        "ix_usage_api_key_id",
        "usage_records",
        ["api_key_id"],
    )

    # user_id 인덱스 (사용자별 사용량 조회)
    op.create_index(
        "ix_usage_user_id",
        "usage_records",
        ["user_id"],
    )


def downgrade() -> None:
    """usage_records 테이블 삭제"""
    op.drop_index("ix_usage_user_id", table_name="usage_records")
    op.drop_index("ix_usage_api_key_id", table_name="usage_records")
    op.drop_index("ix_usage_org_created", table_name="usage_records")
    op.drop_table("usage_records")
