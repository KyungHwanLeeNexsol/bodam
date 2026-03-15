"""조직 멤버 도메인 SQLAlchemy 모델 (SPEC-B2B-001 Phase 1)

조직과 사용자 간의 다대다 관계 관리.
한 사용자는 하나의 조직에만 소속 가능 (organization_id + user_id UNIQUE).
"""

from __future__ import annotations

import uuid
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class OrgMemberRole(StrEnum):
    """조직 멤버 역할 열거형

    ORG_OWNER: 조직 소유자 (최상위 권한)
    AGENT_ADMIN: 설계사 관리자
    AGENT: 보험 설계사
    """

    # 조직 소유자
    ORG_OWNER = "ORG_OWNER"
    # 설계사 관리자
    AGENT_ADMIN = "AGENT_ADMIN"
    # 보험 설계사
    AGENT = "AGENT"


class OrganizationMember(Base):
    """조직 멤버 테이블 (SPEC-B2B-001)

    조직과 사용자 간의 멤버십 관리.
    (organization_id, user_id) 조합이 UNIQUE하여 중복 멤버 방지.
    """

    __tablename__ = "organization_members"

    # 기본 키: UUID (서버 기본값)
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )

    # 조직 FK (CASCADE 삭제)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # 사용자 FK (CASCADE 삭제)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # 조직 내 역할 (ORG_OWNER, AGENT_ADMIN, AGENT)
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

    # 조직 가입 일시 (서버 기본값: 현재 시각)
    joined_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    __table_args__ = (
        # (organization_id, user_id) 복합 유니크 - 중복 멤버 방지
        UniqueConstraint("organization_id", "user_id", name="uq_org_member_org_user"),
        # 조직별 멤버 조회 인덱스
        Index("ix_org_member_org_id", "organization_id"),
        # 사용자별 조직 조회 인덱스
        Index("ix_org_member_user_id", "user_id"),
    )

    def __init__(
        self,
        organization_id: uuid.UUID,
        user_id: uuid.UUID,
        role: OrgMemberRole,
        is_active: bool = True,
        **kwargs,
    ) -> None:
        """OrganizationMember 초기화

        Args:
            organization_id: 조직 UUID
            user_id: 사용자 UUID
            role: 조직 내 역할
            is_active: 멤버 활성 상태 (기본값: True)
        """
        super().__init__(
            organization_id=organization_id,
            user_id=user_id,
            role=role,
            is_active=is_active,
            **kwargs,
        )

    def __repr__(self) -> str:
        return (
            f"<OrganizationMember id={self.id} "
            f"org_id={self.organization_id} "
            f"user_id={self.user_id} "
            f"role={self.role}>"
        )
