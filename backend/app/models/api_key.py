"""API Key 도메인 SQLAlchemy 모델 (SPEC-B2B-001 Module 4)

B2B 조직의 API 키 관리.
전체 키는 생성 시 한 번만 반환되며, DB에는 SHA-256 해시만 저장.
"""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Text, func
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class APIKey(TimestampMixin, Base):
    """API 키 테이블 (SPEC-B2B-001 Module 4)

    B2B 조직의 API 접근을 위한 키 관리.
    평문 키는 절대 저장하지 않으며 SHA-256 해시와 마지막 4자리만 보관.
    """

    __tablename__ = "api_keys"

    # @MX:ANCHOR: API 키 모델 - 보안상 핵심 테이블, 평문 키 저장 금지
    # @MX:REASON: AC-007 보안 요구사항 - DB에는 해시만 저장

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

    # 생성자 FK (사용자)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # 키 접두사 (예: "bdk_")
    key_prefix: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # SHA-256 해시 (평문 키 대신 저장)
    # @MX:WARN: 절대 평문 키를 이 컬럼에 저장하지 말 것
    # @MX:REASON: 보안 요구사항 - 해시만 저장하여 키 복구 불가능하게 함
    key_hash: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        unique=True,
    )

    # 마지막 4자리 (사용자 확인용)
    key_last4: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # 키 이름/설명
    name: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # 스코프 목록 (예: ["read", "write", "analysis", "admin"])
    scopes: Mapped[list[str]] = mapped_column(
        ARRAY(Text),
        nullable=False,
        server_default=sa.text("'{}'::text[]"),
    )

    # 활성 상태 (기본값: True)
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=sa.text("true"),
    )

    # 마지막 사용 시각 (nullable)
    last_used_at: Mapped[DateTime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # 만료 시각 (nullable - 만료 없는 키는 None)
    expires_at: Mapped[DateTime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    __table_args__ = (
        # key_hash 인덱스 (빠른 키 검증)
        Index("ix_api_key_hash", "key_hash"),
        # organization_id 인덱스 (조직별 조회)
        Index("ix_api_key_org_id", "organization_id"),
    )

    def __init__(
        self,
        organization_id: uuid.UUID,
        created_by: uuid.UUID | None,
        key_prefix: str,
        key_hash: str,
        key_last4: str,
        name: str,
        scopes: list[str],
        is_active: bool = True,
        **kwargs,
    ) -> None:
        """APIKey 초기화

        Args:
            organization_id: 조직 UUID
            created_by: 생성자 사용자 UUID
            key_prefix: 키 접두사 (예: "bdk_")
            key_hash: SHA-256 해시 (평문 키 아님)
            key_last4: 전체 키의 마지막 4자리
            name: 키 이름/설명
            scopes: 허용된 스코프 목록
            is_active: 활성 상태 (기본값: True)
        """
        super().__init__(
            organization_id=organization_id,
            created_by=created_by,
            key_prefix=key_prefix,
            key_hash=key_hash,
            key_last4=key_last4,
            name=name,
            scopes=scopes,
            is_active=is_active,
            **kwargs,
        )

    def __repr__(self) -> str:
        return (
            f"<APIKey id={self.id} "
            f"name={self.name!r} "
            f"prefix={self.key_prefix} "
            f"active={self.is_active}>"
        )
