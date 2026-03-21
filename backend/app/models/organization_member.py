"""B2B 조직 멤버 SQLAlchemy 모델 (SPEC-B2B-001 Phase 1)

OrganizationMember, OrgMemberRole 모델 정의.
RBAC 기반 멤버 역할 관리.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class OrgMemberRole(StrEnum):
    """조직 멤버 역할 열거형 (SPEC-B2B-001 RBAC)"""

    # 조직 소유자 (GA 대표, 법인 대표)
    ORG_OWNER = "ORG_OWNER"
    # 조직 관리자 (지점장, 팀장)
    AGENT_ADMIN = "AGENT_ADMIN"
    # 보험 설계사
    AGENT = "AGENT"


class OrganizationMember(Base, TimestampMixin):
    """조직 멤버 테이블

    조직과 사용자 간의 멤버십 관계.
    (organization_id, user_id) 조합은 유니크.
    """

    __tablename__ = "organization_members"

    __table_args__ = (
        # (organization_id, user_id) 복합 유니크 제약
        UniqueConstraint("organization_id", "user_id", name="uq_org_member"),
    )

    # 기본 키: UUID (서버 기본값)
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )

    # 조직 FK
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # 사용자 FK
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # 조직 내 역할
    role: Mapped[OrgMemberRole] = mapped_column(
        Enum(OrgMemberRole, name="orgmemberrole", create_type=False),
        nullable=False,
    )

    # 멤버 활성 상태 (기본값: True)
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=sa.text("true"),
    )

    # 가입 일시
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    # 역방향 관계
    organization: Mapped["Organization"] = relationship(
        "Organization",
        back_populates="members",
    )

    def __repr__(self) -> str:
        return (
            f"<OrganizationMember id={self.id} "
            f"org_id={self.organization_id} "
            f"user_id={self.user_id} role={self.role}>"
        )
