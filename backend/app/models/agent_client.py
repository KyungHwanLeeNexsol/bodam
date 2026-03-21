"""B2B 에이전트 클라이언트 SQLAlchemy 모델 (SPEC-B2B-001 Phase 3)

AgentClient, ConsentStatus 모델 정의.
PII 필드는 Fernet 암호화하여 저장.
"""

from __future__ import annotations

import uuid
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy import DateTime, Enum, ForeignKey, Index, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class ConsentStatus(StrEnum):
    """고객 개인정보 동의 상태 열거형 (SPEC-B2B-001 REQ-003)"""

    # 동의 대기 중
    PENDING = "PENDING"
    # 동의 완료
    ACTIVE = "ACTIVE"
    # 동의 철회
    REVOKED = "REVOKED"


class AgentClient(Base, TimestampMixin):
    """에이전트 클라이언트(고객) 테이블

    보험 설계사가 관리하는 고객 정보.
    PII(이름, 전화번호, 이메일)는 Fernet 암호화 후 저장.
    """

    __tablename__ = "agent_clients"

    __table_args__ = (
        # (organization_id, agent_id) 복합 인덱스
        Index("ix_agent_clients_org_agent", "organization_id", "agent_id"),
        # organization_id 단일 인덱스
        Index("ix_agent_clients_organization_id", "organization_id"),
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

    # 담당 설계사 FK
    agent_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # 고객명 (암호화된 값)
    client_name: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # 연락처 (암호화된 값)
    client_phone: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # 이메일 (암호화된 값, nullable)
    client_email: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    # 동의 상태 (기본값: PENDING)
    # @MX:NOTE: StrEnum과 SQLAlchemy 호환을 위해 insert_default 사용
    consent_status: Mapped[ConsentStatus] = mapped_column(
        Enum(ConsentStatus, name="consentstatus", create_type=False),
        nullable=False,
        insert_default=ConsentStatus.PENDING,
        server_default=ConsentStatus.PENDING.value,
    )

    # 동의 일시 (nullable)
    consent_date: Mapped[sa.DateTime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # 메모 (nullable)
    notes: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    # 역방향 관계
    organization: Mapped["Organization"] = relationship(
        "Organization",
        back_populates="agent_clients",
    )

    def __init__(
        self,
        organization_id: uuid.UUID,
        agent_id: uuid.UUID,
        client_name: str,
        client_phone: str,
        client_email: str | None = None,
        consent_status: ConsentStatus = ConsentStatus.PENDING,
        consent_date: sa.DateTime | None = None,
        notes: str | None = None,
        **kwargs,
    ) -> None:
        """AgentClient 초기화

        Args:
            organization_id: 조직 UUID
            agent_id: 담당 설계사 UUID
            client_name: 고객명 (암호화된 값)
            client_phone: 연락처 (암호화된 값)
            client_email: 이메일 (암호화된 값, 선택)
            consent_status: 동의 상태 (기본값: PENDING)
            consent_date: 동의 일시 (선택)
            notes: 메모 (선택)
        """
        super().__init__(
            organization_id=organization_id,
            agent_id=agent_id,
            client_name=client_name,
            client_phone=client_phone,
            client_email=client_email,
            consent_status=consent_status,
            consent_date=consent_date,
            notes=notes,
            **kwargs,
        )

    def __repr__(self) -> str:
        return (
            f"<AgentClient id={self.id} "
            f"org_id={self.organization_id} "
            f"agent_id={self.agent_id} "
            f"status={self.consent_status}>"
        )
