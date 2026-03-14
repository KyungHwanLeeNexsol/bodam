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


def upgrade() -> None:
    """PDF 분석 테이블 및 enum 타입 생성"""

    conn = op.get_bind()

    # 이미 존재하는 enum 타입 조회
    existing_types = {
        row[0]
        for row in conn.execute(
            sa.text(
                "SELECT typname FROM pg_type WHERE typname IN ("
                "'pdf_upload_status_enum', 'pdf_session_status_enum', 'pdf_message_role_enum'"
                ")"
            )
        ).fetchall()
    }

    # Enum 타입 생성 (존재하지 않는 경우에만)
    if "pdf_upload_status_enum" not in existing_types:
        op.execute(
            sa.text(
                "CREATE TYPE pdf_upload_status_enum AS ENUM "
                "('uploaded', 'analyzing', 'completed', 'failed', 'expired')"
            )
        )

    if "pdf_session_status_enum" not in existing_types:
        op.execute(
            sa.text(
                "CREATE TYPE pdf_session_status_enum AS ENUM "
                "('active', 'expired', 'deleted')"
            )
        )

    if "pdf_message_role_enum" not in existing_types:
        op.execute(
            sa.text(
                "CREATE TYPE pdf_message_role_enum AS ENUM "
                "('user', 'assistant')"
            )
        )

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
            sa.ForeignKey("users.id", ondelete="CASCADE"),
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
            sa.Enum(
                "uploaded",
                "analyzing",
                "completed",
                "failed",
                "expired",
                name="pdf_upload_status_enum",
                create_type=False,
            ),
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
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "upload_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("pdf_uploads.id", ondelete="CASCADE"),
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
            sa.Enum(
                "active",
                "expired",
                "deleted",
                name="pdf_session_status_enum",
                create_type=False,
            ),
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
            sa.ForeignKey("pdf_analysis_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "role",
            sa.Enum(
                "user",
                "assistant",
                name="pdf_message_role_enum",
                create_type=False,
            ),
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
