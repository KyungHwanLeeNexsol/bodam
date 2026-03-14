"""add_chat_tables

Revision ID: b2c3d4e5f6g7
Revises: a1b2c3d4e5f6
Create Date: 2026-03-13 22:30:00.000000

채팅 도메인 테이블 생성 마이그레이션:
- chat_sessions: 채팅 세션 테이블
- chat_messages: 채팅 메시지 테이블 (FK: chat_sessions)
- message_role_enum: 메시지 역할 enum 타입
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2c3d4e5f6g7"
down_revision: str | Sequence[str] | None = "a1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """채팅 테이블 및 enum 타입 생성"""

    # ─────────────────────────────────────────────
    # message_role_enum 타입 생성
    # ─────────────────────────────────────────────
    op.execute(
        "CREATE TYPE message_role_enum AS ENUM ('user', 'assistant', 'system')"
    )

    # ─────────────────────────────────────────────
    # chat_sessions 테이블 생성
    # ─────────────────────────────────────────────
    op.create_table(
        "chat_sessions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "title",
            sa.Text(),
            nullable=False,
            server_default="새 대화",
        ),
        sa.Column("user_id", sa.Text(), nullable=True),
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
    # 사용자 ID 인덱스 (사용자별 세션 조회 최적화)
    op.create_index("idx_chat_sessions_user_id", "chat_sessions", ["user_id"])
    # 최신순 정렬 인덱스
    op.create_index(
        "idx_chat_sessions_updated_at",
        "chat_sessions",
        ["updated_at"],
        postgresql_using="btree",
    )

    # ─────────────────────────────────────────────
    # chat_messages 테이블 생성
    # ─────────────────────────────────────────────
    op.create_table(
        "chat_messages",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "role",
            sa.Enum("user", "assistant", "system", name="message_role_enum", create_type=False),
            nullable=False,
        ),
        sa.Column("content", sa.Text(), nullable=False),
        # JSONB: AI 모델명, 출처 목록 등 메타데이터 저장
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["chat_sessions.id"],
            name="fk_chat_messages_session_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    # 세션별 메시지 조회 인덱스
    op.create_index("idx_chat_messages_session_id", "chat_messages", ["session_id"])


def downgrade() -> None:
    """채팅 테이블 및 enum 타입 제거"""

    # 메시지 테이블 인덱스 및 테이블 제거 (FK 우선)
    op.drop_index("idx_chat_messages_session_id", table_name="chat_messages")
    op.drop_table("chat_messages")

    # 세션 테이블 인덱스 및 테이블 제거
    op.drop_index("idx_chat_sessions_updated_at", table_name="chat_sessions")
    op.drop_index("idx_chat_sessions_user_id", table_name="chat_sessions")
    op.drop_table("chat_sessions")

    # enum 타입 제거
    op.execute("DROP TYPE IF EXISTS message_role_enum")
