"""add_api_keys_table

Revision ID: j0k1l2m3n4o5
Revises: i9j0k1l2m3n4
Create Date: 2026-03-15 00:00:00.000000

SPEC-B2B-001 Module 4:
- api_keys 테이블 생성
- key_hash 인덱스 추가 (빠른 키 검증)
- organization_id 인덱스 추가 (조직별 조회)
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "j0k1l2m3n4o5"
down_revision: str | None = "i9j0k1l2m3n4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """API Keys 테이블 생성"""
    op.create_table(
        "api_keys",
        # 기본 키: UUID (서버 기본값)
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        # 조직 FK (CASCADE 삭제)
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        # 생성자 FK (사용자, SET NULL)
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        # 키 접두사 (예: "bdk_")
        sa.Column("key_prefix", sa.Text(), nullable=False),
        # SHA-256 해시 (평문 키 대신 저장, UNIQUE)
        sa.Column("key_hash", sa.Text(), nullable=False),
        # 마지막 4자리 (사용자 확인용)
        sa.Column("key_last4", sa.Text(), nullable=False),
        # 키 이름/설명
        sa.Column("name", sa.Text(), nullable=False),
        # 스코프 목록 (배열)
        sa.Column(
            "scopes",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
        # 활성 상태 (기본값: True)
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        # 마지막 사용 시각 (nullable)
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        # 만료 시각 (nullable)
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        # 타임스탬프
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
        # PK 제약
        sa.PrimaryKeyConstraint("id"),
        # key_hash UNIQUE 제약
        sa.UniqueConstraint("key_hash", name="uq_api_key_hash"),
        # organizations FK
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            ondelete="CASCADE",
        ),
        # users FK
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            ondelete="SET NULL",
        ),
    )

    # key_hash 인덱스 (빠른 키 검증)
    op.create_index("ix_api_key_hash", "api_keys", ["key_hash"])

    # organization_id 인덱스 (조직별 조회)
    op.create_index("ix_api_key_org_id", "api_keys", ["organization_id"])


def downgrade() -> None:
    """API Keys 테이블 삭제"""
    op.drop_index("ix_api_key_org_id", table_name="api_keys")
    op.drop_index("ix_api_key_hash", table_name="api_keys")
    op.drop_table("api_keys")
