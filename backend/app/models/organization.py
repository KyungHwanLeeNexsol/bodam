"""B2B 조직 SQLAlchemy 모델 (SPEC-B2B-001 Phase 1)

Organization, OrgType, PlanType 모델 정의.
멀티 테넌시 및 계층적 조직 구조 지원.
"""

from __future__ import annotations

import uuid
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy import Boolean, Enum, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class OrgType(StrEnum):
    """조직 유형 열거형 (SPEC-B2B-001 REQ-001)"""

    # 법인 대리점 (General Agency)
    GA = "GA"
    # 독립 설계사
    INDEPENDENT = "INDEPENDENT"
    # 기업 대리점
    CORPORATE = "CORPORATE"


class PlanType(StrEnum):
    """요금제 유형 열거형 (SPEC-B2B-001 REQ-001)"""

    # 무료 체험
    FREE_TRIAL = "FREE_TRIAL"
    # 기본
    BASIC = "BASIC"
    # 전문가
    PROFESSIONAL = "PROFESSIONAL"
    # 엔터프라이즈
    ENTERPRISE = "ENTERPRISE"


# @MX:ANCHOR: Organization - B2B 멀티테넌시의 핵심 엔티티
# @MX:REASON: 모든 B2B 서비스에서 조직 ID 기반 데이터 격리에 사용
class Organization(Base, TimestampMixin):
    """B2B 조직 테이블

    보담 플랫폼의 B2B 파트너 조직(GA, 독립 설계사, 법인 대리점).
    계층적 구조(parent_org_id)를 통해 GA-지점-팀 구조 지원.
    """

    __tablename__ = "organizations"

    # 기본 키: UUID (서버 기본값)
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )

    # 조직명
    name: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # 사업자등록번호 (유니크)
    business_number: Mapped[str] = mapped_column(
        Text,
        unique=True,
        nullable=False,
    )

    # 조직 유형 (GA/INDEPENDENT/CORPORATE)
    org_type: Mapped[OrgType] = mapped_column(
        Enum(OrgType, name="orgtype", create_type=False),
        nullable=False,
    )

    # 상위 조직 UUID (최상위 조직은 None)
    parent_org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
    )

    # 요금제 유형
    plan_type: Mapped[PlanType] = mapped_column(
        Enum(PlanType, name="plantype", create_type=False),
        nullable=False,
    )

    # 월간 API 호출 한도 (기본값: 1000)
    monthly_api_limit: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1000,
        server_default=sa.text("1000"),
    )

    # 조직 활성 상태 (기본값: True)
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=sa.text("true"),
    )

    # 하위 관계 (cascade 삭제)
    members: Mapped[list] = relationship(
        "OrganizationMember",
        back_populates="organization",
        cascade="all, delete-orphan",
    )
    api_keys: Mapped[list] = relationship(
        "APIKey",
        back_populates="organization",
        cascade="all, delete-orphan",
    )
    agent_clients: Mapped[list] = relationship(
        "AgentClient",
        back_populates="organization",
        cascade="all, delete-orphan",
    )
    usage_records: Mapped[list] = relationship(
        "UsageRecord",
        back_populates="organization",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<Organization id={self.id} name={self.name!r} type={self.org_type}>"
