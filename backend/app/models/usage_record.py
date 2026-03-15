"""사용량 기록 도메인 SQLAlchemy 모델 (SPEC-B2B-001 Phase 4)

B2B 조직의 API 사용량 추적 및 과금 기반 데이터.
AC-009: API 요청 시 사용량 자동 기록
"""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from sqlalchemy import ForeignKey, Index, Integer, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class UsageRecord(TimestampMixin, Base):
    """사용량 기록 테이블 (SPEC-B2B-001 Phase 4)

    API 요청마다 사용량 정보를 기록.
    조직별 월간 사용량 집계 및 과금 계산에 사용.
    """

    __tablename__ = "usage_records"

    # @MX:ANCHOR: 사용량 추적의 핵심 테이블 - 과금 및 한도 관리의 기반
    # @MX:REASON: AC-009/AC-010 요구사항 - 모든 B2B API 요청이 기록됨

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

    # 호출 엔드포인트 (예: /api/v1/b2b/clients)
    endpoint: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # HTTP 메서드 (GET, POST, PUT, DELETE 등)
    method: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # HTTP 응답 코드 (200, 201, 400, 404, 429 등)
    status_code: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    # 소비된 토큰 수 (기본값: 0, AI 분석 요청의 경우 양수)
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

    __table_args__ = (
        # (organization_id, created_at) 복합 인덱스 (월간 집계 조회 성능)
        Index("ix_usage_org_created", "organization_id", "created_at"),
        # api_key_id 인덱스 (API 키별 사용량 조회)
        Index("ix_usage_api_key_id", "api_key_id"),
        # user_id 인덱스 (사용자별 사용량 조회)
        Index("ix_usage_user_id", "user_id"),
    )

    def __init__(
        self,
        organization_id: uuid.UUID,
        endpoint: str,
        method: str,
        status_code: int,
        response_time_ms: int,
        ip_address: str,
        api_key_id: uuid.UUID | None = None,
        user_id: uuid.UUID | None = None,
        tokens_consumed: int = 0,
        **kwargs,
    ) -> None:
        """UsageRecord 초기화

        Args:
            organization_id: 조직 UUID
            endpoint: 호출된 엔드포인트 경로
            method: HTTP 메서드
            status_code: HTTP 응답 코드
            response_time_ms: 응답 시간(밀리초)
            ip_address: 요청 IP 주소
            api_key_id: API 키 UUID (API 키 인증 시, 선택)
            user_id: 사용자 UUID (JWT 인증 시, 선택)
            tokens_consumed: 소비된 토큰 수 (기본값: 0)
        """
        super().__init__(
            organization_id=organization_id,
            endpoint=endpoint,
            method=method,
            status_code=status_code,
            response_time_ms=response_time_ms,
            ip_address=ip_address,
            api_key_id=api_key_id,
            user_id=user_id,
            tokens_consumed=tokens_consumed,
            **kwargs,
        )

    def __repr__(self) -> str:
        return (
            f"<UsageRecord id={self.id} "
            f"org={self.organization_id} "
            f"endpoint={self.endpoint!r} "
            f"status={self.status_code}>"
        )
