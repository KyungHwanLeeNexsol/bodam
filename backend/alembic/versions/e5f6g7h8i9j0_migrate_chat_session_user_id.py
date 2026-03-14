"""migrate_chat_session_user_id

Revision ID: e5f6g7h8i9j0
Revises: d4e5f6g7h8i9
Create Date: 2026-03-14 00:01:00.000000

ChatSession.user_id를 TEXT에서 UUID FK로 변경 (SPEC-AUTH-001):
- user_id 타입: TEXT -> UUID (nullable 유지)
- FK 추가: chat_sessions.user_id -> users.id
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e5f6g7h8i9j0"
down_revision: str | Sequence[str] | None = "d4e5f6g7h8i9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """chat_sessions.user_id를 UUID FK로 마이그레이션"""

    # 기존 TEXT 컬럼 제거 후 UUID 컬럼 추가
    # nullable 유지: 비로그인 사용자 하위 호환성 보장
    op.drop_column("chat_sessions", "user_id")
    op.add_column(
        "chat_sessions",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    # users 테이블 FK 추가
    op.create_foreign_key(
        "fk_chat_sessions_user_id",
        "chat_sessions",
        "users",
        ["user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    # 사용자별 세션 조회 인덱스 생성 (이전 마이그레이션에서 생성되지 않았음)
    op.create_index("idx_chat_sessions_user_id", "chat_sessions", ["user_id"])


def downgrade() -> None:
    """chat_sessions.user_id를 TEXT로 롤백"""

    op.drop_constraint("fk_chat_sessions_user_id", "chat_sessions", type_="foreignkey")
    op.drop_index("idx_chat_sessions_user_id", table_name="chat_sessions")
    op.drop_column("chat_sessions", "user_id")
    op.add_column(
        "chat_sessions",
        sa.Column("user_id", sa.Text(), nullable=True),
    )
    op.create_index("idx_chat_sessions_user_id", "chat_sessions", ["user_id"])
