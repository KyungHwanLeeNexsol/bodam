"""add_access_logs_table

Revision ID: o5p6q7r8s9t0
Revises: n4o5p6q7r8s9
Create Date: 2026-03-16 00:00:00.000000

SPEC-SEC-001 M2:
- access_logs 테이블 추가 (HTTP 접근 로그)
- 90일 후 자동 삭제 (PIPA 데이터 보존 정책)
- IP 마스킹으로 개인정보 최소 수집
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "o5p6q7r8s9t0"
down_revision: str | None = "n4o5p6q7r8s9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "access_logs",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("method", sa.String(10), nullable=False),
        sa.Column("path", sa.String(500), nullable=False),
        sa.Column("query_string", sa.Text, nullable=True),
        sa.Column("status_code", sa.Integer, nullable=False),
        sa.Column("ip_masked", sa.String(50), nullable=True),
        sa.Column("user_agent", sa.String(500), nullable=True),
        sa.Column("response_time_ms", sa.Float, nullable=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    # 인덱스 생성
    op.create_index("ix_access_logs_created_at", "access_logs", ["created_at"])
    op.create_index("ix_access_logs_user_id", "access_logs", ["user_id"])
    op.create_index("ix_access_logs_path", "access_logs", ["path"])


def downgrade() -> None:
    op.drop_index("ix_access_logs_path", table_name="access_logs")
    op.drop_index("ix_access_logs_user_id", table_name="access_logs")
    op.drop_index("ix_access_logs_created_at", table_name="access_logs")
    op.drop_table("access_logs")
