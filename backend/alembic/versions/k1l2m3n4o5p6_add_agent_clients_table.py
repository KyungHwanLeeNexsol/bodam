"""add_agent_clients_table

Revision ID: k1l2m3n4o5p6
Revises: j0k1l2m3n4o5
Create Date: 2026-03-15 00:00:00.000000

SPEC-B2B-001 Phase 3:
- consentstatus PostgreSQL ENUM 타입 생성
- agent_clients 테이블 생성 (PII 암호화 고객 정보)
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import ENUM as PG_ENUM

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "k1l2m3n4o5p6"
down_revision: str | None = "j0k1l2m3n4o5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """agent_clients 테이블 및 consentstatus enum 타입 생성"""
    # consentstatus ENUM 타입 생성
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE consentstatus AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """)

    # agent_clients 테이블 생성
    op.create_table(
        "agent_clients",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "organization_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "agent_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # PII 암호화 필드 (Fernet 토큰)
        sa.Column("client_name", sa.Text(), nullable=False),
        sa.Column("client_phone", sa.Text(), nullable=False),
        sa.Column("client_email", sa.Text(), nullable=True),
        # 동의 상태 (기본값: PENDING)
        sa.Column(
            "consent_status",
            PG_ENUM("PENDING", "ACTIVE", "REVOKED", name="consentstatus", create_type=False),
            nullable=False,
            server_default="PENDING",
        ),
        sa.Column("consent_date", sa.DateTime(timezone=True), nullable=True),
        # 메모 (암호화 불필요)
        sa.Column("notes", sa.Text(), nullable=True),
        # TimestampMixin
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
    )

    # (organization_id, agent_id) 복합 인덱스
    op.create_index(
        "ix_agent_client_org_agent",
        "agent_clients",
        ["organization_id", "agent_id"],
    )

    # organization_id 단일 인덱스
    op.create_index(
        "ix_agent_client_org_id",
        "agent_clients",
        ["organization_id"],
    )


def downgrade() -> None:
    """agent_clients 테이블 및 consentstatus enum 타입 삭제"""
    op.drop_index("ix_agent_client_org_id", table_name="agent_clients")
    op.drop_index("ix_agent_client_org_agent", table_name="agent_clients")
    op.drop_table("agent_clients")

    # consentstatus ENUM 타입 삭제
    consentstatus_enum = postgresql.ENUM(
        "PENDING",
        "ACTIVE",
        "REVOKED",
        name="consentstatus",
    )
    consentstatus_enum.drop(op.get_bind(), checkfirst=True)
