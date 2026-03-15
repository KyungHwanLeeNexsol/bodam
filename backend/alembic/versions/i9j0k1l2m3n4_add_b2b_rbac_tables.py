"""add_b2b_rbac_tables

Revision ID: i9j0k1l2m3n4
Revises: h8i9j0k1l2m3
Create Date: 2026-03-15 00:00:00.000000

SPEC-B2B-001 Phase 1:
- users 테이블에 role 컬럼 추가 (userrole enum)
- organizations 테이블 생성
- organization_members 테이블 생성
- 필요한 PostgreSQL ENUM 타입 생성
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "i9j0k1l2m3n4"
down_revision: str | None = "h8i9j0k1l2m3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """B2B RBAC 테이블 생성 및 users 테이블 role 컬럼 추가"""

    # 1. userrole enum 타입 생성
    userrole_enum = postgresql.ENUM(
        "B2C_USER",
        "AGENT",
        "AGENT_ADMIN",
        "ORG_OWNER",
        "SYSTEM_ADMIN",
        name="userrole",
    )
    userrole_enum.create(op.get_bind(), checkfirst=True)

    # 2. orgtype enum 타입 생성
    orgtype_enum = postgresql.ENUM(
        "GA",
        "INDEPENDENT",
        "CORPORATE",
        name="orgtype",
    )
    orgtype_enum.create(op.get_bind(), checkfirst=True)

    # 3. plantype enum 타입 생성
    plantype_enum = postgresql.ENUM(
        "FREE_TRIAL",
        "BASIC",
        "PROFESSIONAL",
        "ENTERPRISE",
        name="plantype",
    )
    plantype_enum.create(op.get_bind(), checkfirst=True)

    # 4. orgmemberrole enum 타입 생성
    orgmemberrole_enum = postgresql.ENUM(
        "ORG_OWNER",
        "AGENT_ADMIN",
        "AGENT",
        name="orgmemberrole",
    )
    orgmemberrole_enum.create(op.get_bind(), checkfirst=True)

    # 5. users 테이블에 role 컬럼 추가 (기본값: B2C_USER)
    op.add_column(
        "users",
        sa.Column(
            "role",
            sa.Enum(
                "B2C_USER",
                "AGENT",
                "AGENT_ADMIN",
                "ORG_OWNER",
                "SYSTEM_ADMIN",
                name="userrole",
                create_type=False,
            ),
            nullable=False,
            server_default="B2C_USER",
        ),
    )

    # 6. organizations 테이블 생성
    op.create_table(
        "organizations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("business_number", sa.Text(), nullable=False),
        sa.Column(
            "org_type",
            sa.Enum("GA", "INDEPENDENT", "CORPORATE", name="orgtype", create_type=False),
            nullable=False,
        ),
        sa.Column("parent_org_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "plan_type",
            sa.Enum(
                "FREE_TRIAL",
                "BASIC",
                "PROFESSIONAL",
                "ENTERPRISE",
                name="plantype",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column(
            "monthly_api_limit",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1000"),
        ),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
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
        sa.ForeignKeyConstraint(
            ["parent_org_id"],
            ["organizations.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("business_number", name="uq_org_business_number"),
    )
    # 상위 조직 인덱스
    op.create_index("ix_org_parent_org_id", "organizations", ["parent_org_id"])

    # 7. organization_members 테이블 생성
    op.create_table(
        "organization_members",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "role",
            sa.Enum("ORG_OWNER", "AGENT_ADMIN", "AGENT", name="orgmemberrole", create_type=False),
            nullable=False,
        ),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "joined_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "user_id", name="uq_org_member_org_user"),
    )
    # 조직별 멤버 조회 인덱스
    op.create_index(
        "ix_org_member_org_id",
        "organization_members",
        ["organization_id"],
    )
    # 사용자별 조직 조회 인덱스
    op.create_index(
        "ix_org_member_user_id",
        "organization_members",
        ["user_id"],
    )


def downgrade() -> None:
    """B2B RBAC 테이블 삭제 및 users 테이블 role 컬럼 제거"""

    # organization_members 먼저 삭제 (FK 의존성)
    op.drop_index("ix_org_member_user_id", table_name="organization_members")
    op.drop_index("ix_org_member_org_id", table_name="organization_members")
    op.drop_table("organization_members")

    # organizations 삭제
    op.drop_index("ix_org_parent_org_id", table_name="organizations")
    op.drop_table("organizations")

    # users 테이블 role 컬럼 제거
    op.drop_column("users", "role")

    # enum 타입 삭제
    op.execute("DROP TYPE IF EXISTS orgmemberrole")
    op.execute("DROP TYPE IF EXISTS plantype")
    op.execute("DROP TYPE IF EXISTS orgtype")
    op.execute("DROP TYPE IF EXISTS userrole")
