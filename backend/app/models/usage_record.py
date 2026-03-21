"""B2B 사용량 기록 SQLAlchemy 모델 (SPEC-B2B-001 Phase 4)

UsageRecord 모델 정의.
API 요청 시 사용량 자동 기록 (AC-009).
TimestampMixin 미사용 (created_at만 필요).
"""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from sqlalchemy import DateTime, ForeignKey, Index, Integer, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class UsageRecord(Base):
    """API 사용량 기록 테이블

    B2B 조직의 API 요청 이력 저장.
    JWT 인증 또는 API 키 인증에 따라 user_id 또는 api_key_id가 설정됨.
    """

    __tablename__ = "usage_records"

    __table_args__ = (
        # 조직별 기간 조회 인덱스
        Index("ix_usage_records_org_created", "organization_id", "created_at"),
        # API 키별 조회 인덱스
        Index("ix_usage_records_api_key", "api_key_id"),
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

    # API 키 FK (nullable: JWT 인증 시 None)
    api_key_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("api_keys.id", ondelete="SET NULL"),
        nullable=True,
    )

    # 사용자 FK (nullable: API 키 인증 시 None)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # 엔드포인트
    endpoint: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # HTTP 메서드
    method: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # HTTP 응답 코드
    status_code: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    # 소비된 토큰 수 (기본값: 0)
    tokens_consumed: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default=sa.text("0"),
    )

    # 응답 시간 (밀리초)
    response_time_ms: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    # 요청 IP 주소
    ip_address: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # 기록 생성 일시 (서버 기본값: now())
    created_at: Mapped[sa.DateTime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    # 역방향 관계
    organization: Mapped["Organization"] = relationship(
        "Organization",
        back_populates="usage_records",
    )

    def __repr__(self) -> str:
        return (
            f"<UsageRecord id={self.id} "
            f"org_id={self.organization_id} "
            f"endpoint={self.endpoint!r} "
            f"status={self.status_code}>"
        )
