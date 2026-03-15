"""B2B 고객(AgentClient) 도메인 SQLAlchemy 모델 (SPEC-B2B-001 Phase 3)

보험 설계사가 관리하는 고객 정보 모델.
PII(이름, 전화번호, 이메일)는 Fernet 암호화 후 저장 (PIPA 준수).
"""

from __future__ import annotations

import uuid
from enum import StrEnum

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class ConsentStatus(StrEnum):
    """개인정보 동의 상태 열거형

    PENDING: 동의 대기 중 (기본값, 분석 불가)
    ACTIVE: 동의 완료 (분석 허용)
    REVOKED: 동의 철회 (30일 후 데이터 삭제 예약)
    """

    # 동의 대기 중
    PENDING = "PENDING"
    # 동의 완료
    ACTIVE = "ACTIVE"
    # 동의 철회
    REVOKED = "REVOKED"


# @MX:ANCHOR: AgentClient 모델 - 고객 관리 기능의 핵심 데이터 모델
# @MX:REASON: 모든 고객 CRUD 및 동의 관리 로직에서 참조
class AgentClient(Base, TimestampMixin):
    """설계사 고객 테이블 (SPEC-B2B-001 Module 2)

    보험 설계사가 관리하는 고객 정보.
    PII 필드(client_name, client_phone, client_email)는 반드시 암호화된 값을 저장.
    직접 평문을 저장하면 안 됨 - ClientService를 통해 접근할 것.
    """

    __tablename__ = "agent_clients"

    # 기본 키: UUID (서버 기본값)
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )

    # 조직 FK (CASCADE 삭제) - 멀티테넌트 격리 기준
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # 담당 설계사 FK (CASCADE 삭제)
    agent_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # @MX:WARN: PII 필드 - 반드시 암호화된 값만 저장할 것
    # @MX:REASON: PIPA(개인정보보호법) 요구사항 - 고객 개인정보 암호화 의무
    # 고객명 (암호화된 Fernet 토큰)
    client_name: Mapped[str] = mapped_column(Text, nullable=False)

    # 연락처 (암호화된 Fernet 토큰)
    client_phone: Mapped[str] = mapped_column(Text, nullable=False)

    # 이메일 (암호화된 Fernet 토큰, 선택)
    client_email: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 개인정보 동의 상태 (기본값: PENDING)
    consent_status: Mapped[ConsentStatus] = mapped_column(
        Enum(ConsentStatus, name="consentstatus", create_type=False),
        nullable=False,
        default=ConsentStatus.PENDING,
        server_default=ConsentStatus.PENDING.value,
    )

    # 동의/철회 일시 (nullable)
    consent_date: Mapped[DateTime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # 메모 (암호화 불필요, 민감정보 아님)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        # (organization_id, agent_id) 복합 인덱스 - 설계사별 고객 조회 최적화
        Index("ix_agent_client_org_agent", "organization_id", "agent_id"),
        # organization_id 단일 인덱스 - 조직별 고객 조회 최적화
        Index("ix_agent_client_org_id", "organization_id"),
    )

    def __init__(
        self,
        organization_id: uuid.UUID,
        agent_id: uuid.UUID,
        client_name: str,
        client_phone: str,
        client_email: str | None = None,
        consent_status: ConsentStatus = ConsentStatus.PENDING,
        notes: str | None = None,
        **kwargs,
    ) -> None:
        """AgentClient 초기화

        Args:
            organization_id: 조직 UUID
            agent_id: 담당 설계사 UUID
            client_name: 고객명 (암호화된 토큰)
            client_phone: 연락처 (암호화된 토큰)
            client_email: 이메일 (암호화된 토큰, 선택)
            consent_status: 동의 상태 (기본값: PENDING)
            notes: 메모 (평문)
        """
        super().__init__(
            organization_id=organization_id,
            agent_id=agent_id,
            client_name=client_name,
            client_phone=client_phone,
            client_email=client_email,
            consent_status=consent_status,
            notes=notes,
            **kwargs,
        )

    def __repr__(self) -> str:
        return (
            f"<AgentClient id={self.id} "
            f"org_id={self.organization_id} "
            f"agent_id={self.agent_id} "
            f"consent={self.consent_status}>"
        )
