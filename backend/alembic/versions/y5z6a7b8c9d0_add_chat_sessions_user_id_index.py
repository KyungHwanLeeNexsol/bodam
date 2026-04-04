"""chat_sessions.user_id 인덱스 추가 (목록 조회 성능 최적화)

user_id 필터 + COUNT 쿼리에서 풀 테이블 스캔 방지.

Revision ID: y5z6a7b8c9d0
Revises: x4y5z6a7b8c9
Create Date: 2026-04-04 00:00:00.000000
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic
revision = "y5z6a7b8c9d0"
down_revision = "x4y5z6a7b8c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """user_id 인덱스 생성"""
    op.create_index(
        "ix_chat_sessions_user_id",
        "chat_sessions",
        ["user_id"],
    )


def downgrade() -> None:
    """user_id 인덱스 삭제"""
    op.drop_index("ix_chat_sessions_user_id", table_name="chat_sessions")
