"""add_users_table

Revision ID: d4e5f6g7h8i9
Revises: c3d4e5f6g7h8
Create Date: 2026-03-14 00:00:00.000000

사용자 인증 테이블 생성 마이그레이션 (SPEC-AUTH-001):
- users: 사용자 계정 테이블 (이메일/비밀번호 기반 인증)
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4e5f6g7h8i9"
down_revision: str | Sequence[str] | None = "c3d4e5f6g7h8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """users 테이블 생성"""

    op.create_table(
        "users",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        # 이메일 (소문자 저장, 유니크 인덱스)
        sa.Column("email", sa.Text(), nullable=False),
        # bcrypt 해시된 비밀번호
        sa.Column("hashed_password", sa.Text(), nullable=False),
        # 사용자 이름 (선택)
        sa.Column("full_name", sa.Text(), nullable=True),
        # 계정 활성 상태 (기본값: true)
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
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
        sa.PrimaryKeyConstraint("id"),
    )
    # 이메일 유니크 인덱스 (대소문자 구분 없이 조회 가능)
    op.create_index("ix_users_email", "users", ["email"], unique=True)


def downgrade() -> None:
    """users 테이블 제거"""
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
