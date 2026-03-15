"""조직 도메인 SQLAlchemy 모델 (SPEC-B2B-001 Phase 1)

B2B 보험 설계사 대시보드의 조직 구조 관리.
GA(법인대리점), 독립 설계사, 기업 고객 조직을 계층 구조로 관리.
"""

from __future__ import annotations

import uuid
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy import Boolean, Enum, ForeignKey, Index, Integer, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class OrgType(StrEnum):
    """조직 유형 열거형

    GA: 법인대리점
    INDEPENDENT: 독립 설계사
    CORPORATE: 기업 고객
    """

    # 법인대리점
    GA = "GA"
    # 독립 설계사
    INDEPENDENT = "INDEPENDENT"
    # 기업 고객
    CORPORATE = "CORPORATE"


class PlanType(StrEnum):
    """요금제 유형 열거형

    FREE_TRIAL: 무료 체험
    BASIC: 기본
    PROFESSIONAL: 전문가
    ENTERPRISE: 엔터프라이즈
    """

    # 무료 체험 (14일)
    FREE_TRIAL = "FREE_TRIAL"
    # 기본 요금제
    BASIC = "BASIC"
    # 전문가 요금제
    PROFESSIONAL = "PROFESSIONAL"
    # 엔터프라이즈 요금제
    ENTERPRISE = "ENTERPRISE"


class Organization(TimestampMixin, Base):
    """조직 테이블 (SPEC-B2B-001)

    B2B 보험 설계사 조직. 최대 3단계 계층 구조 지원.
    사업자등록번호는 유니크하게 관리.
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

    # 조직 유형 (GA, INDEPENDENT, CORPORATE)
    org_type: Mapped[OrgType] = mapped_column(
        Enum(OrgType, name="orgtype", create_type=False),
        nullable=False,
    )

    # 상위 조직 FK (nullable: 최상위 조직은 None)
    # @MX:NOTE: 계층 구조 - 최대 3단계 허용 (validate_org_hierarchy로 검증)
    parent_org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
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

    __table_args__ = (
        # 사업자등록번호 유니크 제약 (이름 명시)
        UniqueConstraint("business_number", name="uq_org_business_number"),
        # 상위 조직 인덱스 (계층 조회 성능 향상)
        Index("ix_org_parent_org_id", "parent_org_id"),
    )

    def __init__(
        self,
        name: str,
        business_number: str,
        org_type: OrgType,
        plan_type: PlanType,
        parent_org_id: uuid.UUID | None = None,
        monthly_api_limit: int = 1000,
        is_active: bool = True,
        **kwargs,
    ) -> None:
        """Organization 초기화

        Args:
            name: 조직명
            business_number: 사업자등록번호
            org_type: 조직 유형 (GA/INDEPENDENT/CORPORATE)
            plan_type: 요금제 유형
            parent_org_id: 상위 조직 UUID (최상위 조직은 None)
            monthly_api_limit: 월간 API 호출 한도 (기본값: 1000)
            is_active: 조직 활성 상태 (기본값: True)
        """
        super().__init__(
            name=name,
            business_number=business_number,
            org_type=org_type,
            plan_type=plan_type,
            parent_org_id=parent_org_id,
            monthly_api_limit=monthly_api_limit,
            is_active=is_active,
            **kwargs,
        )

    def __repr__(self) -> str:
        return f"<Organization id={self.id} name={self.name!r} type={self.org_type}>"
