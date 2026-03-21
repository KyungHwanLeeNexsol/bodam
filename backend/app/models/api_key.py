"""B2B API 키 SQLAlchemy 모델 (SPEC-B2B-001 Module 4)

APIKey 모델 정의.
SHA-256 해시 저장, 스코프 기반 접근 제어.
"""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Text, func
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


# @MX:ANCHOR: APIKey - API 키 인증의 핵심 엔티티
# @MX:REASON: B2B 클라이언트 인증에 사용되는 키 관리
class APIKey(Base, TimestampMixin):
    """API 키 테이블

    B2B 파트너가 API 요청 시 사용하는 인증 키.
    보안을 위해 평문 키는 저장하지 않고 SHA-256 해시만 저장.
    """

    __tablename__ = "api_keys"

    __table_args__ = (
        # key_hash 인덱스 (빠른 키 조회용)
        Index("ix_api_keys_key_hash", "key_hash"),
        # organization_id 인덱스 (조직별 키 조회용)
        Index("ix_api_keys_organization_id", "organization_id"),
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

    # 생성자 FK
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # 키 접두사 (기본값: "bdk_")
    key_prefix: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default="bdk_",
        server_default=sa.text("'bdk_'"),
    )

    # SHA-256 해시 (평문 저장 금지)
    key_hash: Mapped[str] = mapped_column(
        Text,
        nullable=False,
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

    # 허용 스코프 목록
    scopes: Mapped[list] = mapped_column(
        ARRAY(Text),
        nullable=False,
        default=list,
        server_default=sa.text("'{}'"),
    )

    # 활성 상태 (기본값: True)
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=sa.text("true"),
    )

    # 마지막 사용 시각 (nullable)
    last_used_at: Mapped[sa.DateTime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # 만료 일시 (nullable)
    expires_at: Mapped[sa.DateTime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # 역방향 관계
    organization: Mapped["Organization"] = relationship(
        "Organization",
        back_populates="api_keys",
    )

    def __repr__(self) -> str:
        return (
            f"<APIKey id={self.id} "
            f"prefix={self.key_prefix!r} "
            f"last4={self.key_last4!r} "
            f"active={self.is_active}>"
        )
