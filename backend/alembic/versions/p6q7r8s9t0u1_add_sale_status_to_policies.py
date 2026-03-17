"""add_sale_status_to_policies

Revision ID: p6q7r8s9t0u1
Revises: o5p6q7r8s9t0
Create Date: 2026-03-17 00:00:00.000000

SPEC-CRAWLER-002 REQ-07.1:
- policies 테이블에 sale_status 컬럼 추가
- VARCHAR(20), 기본값 'UNKNOWN', nullable
- SaleStatus: ON_SALE (판매중), DISCONTINUED (판매중지), UNKNOWN (미확인)
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "p6q7r8s9t0u1"
down_revision: str | None = "o5p6q7r8s9t0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # policies 테이블에 sale_status 컬럼 추가
    op.add_column(
        "policies",
        sa.Column(
            "sale_status",
            sa.String(20),
            nullable=True,
            server_default=sa.text("'UNKNOWN'"),
        ),
    )


def downgrade() -> None:
    # policies 테이블에서 sale_status 컬럼 제거
    op.drop_column("policies", "sale_status")
