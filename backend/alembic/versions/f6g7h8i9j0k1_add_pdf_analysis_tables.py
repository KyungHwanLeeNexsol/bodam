"""add_pdf_analysis_tables

Revision ID: f6g7h8i9j0k1
Revises: e5f6g7h8i9j0
Create Date: 2026-03-15 00:00:00.000000

PDF 분석 관련 테이블 추가 (SPEC-PDF-001):
- pdf_upload_status_enum 타입 추가
- pdf_session_status_enum 타입 추가
- pdf_message_role_enum 타입 추가
- pdf_uploads 테이블 추가
- pdf_analysis_sessions 테이블 추가
- pdf_analysis_messages 테이블 추가
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f6g7h8i9j0k1"
down_revision: str | Sequence[str] | None = "e5f6g7h8i9j0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# postgresql.ENUM 참조 (create_type=False: 타입 재생성 방지)
_pdf_upload_status = postgresql.ENUM(
    "uploaded", "analyzing", "completed", "failed", "expired",
    name="pdf_upload_status_enum",
    create_type=False,
)
_pdf_session_status = postgresql.ENUM(
    "active", "expired", "deleted",
    name="pdf_session_status_enum",
    create_type=False,
)
_pdf_message_role = postgresql.ENUM(
    "user", "assistant",
    name="pdf_message_role_enum",
    create_type=False,
)


def upgrade() -> None:
    """PDF 분석 테이블 및 enum 타입 생성"""

    # Enum 타입 생성 (duplicate_object 예외 무시)
    op.execute("CREATE TYPE IF NOT EXISTS pdf_upload_status_enum AS ENUM ('uploaded', 'analyzing', 'completed', 'failed', 'expired')")

    op.execute("CREATE TYPE IF NOT EXISTS pdf_session_status_enum AS ENUM ('active', 'expired', 'deleted')")

    op.execute("CREATE TYPE IF NOT EXISTS pdf_message_role_enum AS ENUM ('user', 'assistant')")

    # pdf_uploads 테이블 생성
    op.create_table(
        "pdf_uploads",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("original_filename", sa.Text(), nullable=False),
        sa.Column("stored_filename", sa.Text(), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("file_hash", sa.Text(), nullable=False),
        sa.Column(
            "mime_type",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'application/pdf'"),
        ),
        sa.Column("page_count", sa.Integer(), nullable=True),
        sa.Column(
            "status",
            _pdf_upload_status,
            nullable=False,
            server_default=sa.text("'uploaded'"),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"],
            name="fk_pdf_uploads_user_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_pdf_uploads_user_id", "pdf_uploads", ["user_id"])
    op.create_index("idx_pdf_uploads_file_hash", "pdf_uploads", ["file_hash"])

    # pdf_analysis_sessions 테이블 생성
    op.create_table(
        "pdf_analysis_sessions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "upload_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "title",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'새 분석'"),
        ),
        sa.Column(
            "status",
            _pdf_session_status,
            nullable=False,
            server_default=sa.text("'active'"),
        ),
        sa.Column("initial_analysis", postgresql.JSONB(), nullable=True),
        sa.Column("token_usage", postgresql.JSONB(), nullable=True),
        sa.Column("last_activity_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"],
            name="fk_pdf_sessions_user_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["upload_id"], ["pdf_uploads.id"],
            name="fk_pdf_sessions_upload_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_pdf_analysis_sessions_user_id", "pdf_analysis_sessions", ["user_id"]
    )
    op.create_index(
        "idx_pdf_analysis_sessions_upload_id", "pdf_analysis_sessions", ["upload_id"]
    )

    # pdf_analysis_messages 테이블 생성
    op.create_table(
        "pdf_analysis_messages",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "role",
            _pdf_message_role,
            nullable=False,
        ),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("token_count", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["session_id"], ["pdf_analysis_sessions.id"],
            name="fk_pdf_messages_session_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_pdf_analysis_messages_session_id",
        "pdf_analysis_messages",
        ["session_id"],
    )


def downgrade() -> None:
    """PDF 분석 테이블 및 enum 타입 삭제"""

    op.drop_index(
        "idx_pdf_analysis_messages_session_id", table_name="pdf_analysis_messages"
    )
    op.drop_table("pdf_analysis_messages")

    op.drop_index(
        "idx_pdf_analysis_sessions_upload_id", table_name="pdf_analysis_sessions"
    )
    op.drop_index(
        "idx_pdf_analysis_sessions_user_id", table_name="pdf_analysis_sessions"
    )
    op.drop_table("pdf_analysis_sessions")

    op.drop_index("idx_pdf_uploads_file_hash", table_name="pdf_uploads")
    op.drop_index("idx_pdf_uploads_user_id", table_name="pdf_uploads")
    op.drop_table("pdf_uploads")

    # Enum 타입 삭제
    op.execute(sa.text("DROP TYPE IF EXISTS pdf_message_role_enum"))
    op.execute(sa.text("DROP TYPE IF EXISTS pdf_session_status_enum"))
    op.execute(sa.text("DROP TYPE IF EXISTS pdf_upload_status_enum"))
