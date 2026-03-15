"""소셜 계정 도메인 SQLAlchemy 모델 (SPEC-OAUTH-001 TAG-001)

OAuth2 소셜 로그인으로 연결된 외부 계정을 관리.
한 사용자가 카카오/네이버/구글 복수 계정을 연결할 수 있음.
"""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from sqlalchemy import ForeignKey, Index, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class SocialAccount(TimestampMixin, Base):
    """소셜 계정 연결 테이블

    OAuth2 프로바이더(카카오/네이버/구글)와 연결된 계정 정보.
    (provider, provider_user_id) 조합이 UNIQUE.
    access_token은 Fernet 대칭키로 암호화하여 저장.
    """

    __tablename__ = "social_accounts"

    # 기본 키: UUID (서버 기본값)
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )

    # 사용자 FK (CASCADE 삭제, NOT NULL)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # OAuth2 프로바이더 식별자 ('kakao', 'naver', 'google')
    provider: Mapped[str] = mapped_column(
        sa.VARCHAR(20),
        nullable=False,
    )

    # 프로바이더에서 발급한 사용자 고유 ID
    provider_user_id: Mapped[str] = mapped_column(
        sa.VARCHAR(255),
        nullable=False,
    )

    # 프로바이더에서 제공하는 이메일 (선택 동의인 경우 None 가능)
    provider_email: Mapped[str | None] = mapped_column(
        sa.VARCHAR(255),
        nullable=True,
        index=True,
    )

    # 프로바이더에서 제공하는 사용자 이름
    provider_name: Mapped[str | None] = mapped_column(
        sa.VARCHAR(100),
        nullable=True,
    )

    # OAuth2 액세스 토큰 (Fernet 암호화 저장, 갱신 시 업데이트)
    # @MX:NOTE: 보안을 위해 반드시 암호화된 값만 저장할 것
    # @MX:SPEC: SPEC-OAUTH-001 ACC-22 (토큰 비노출)
    access_token: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    __table_args__ = (
        # (provider, provider_user_id) 유니크 - 같은 소셜 계정 중복 연결 방지
        UniqueConstraint("provider", "provider_user_id", name="uq_social_provider_user"),
        # (provider, provider_email) 인덱스 - 이메일로 기존 계정 조회
        Index("ix_social_provider_email", "provider", "provider_email"),
    )

    def __init__(
        self,
        user_id: uuid.UUID,
        provider: str,
        provider_user_id: str,
        provider_email: str | None = None,
        provider_name: str | None = None,
        access_token: str | None = None,
        **kwargs,
    ) -> None:
        """SocialAccount 초기화

        Args:
            user_id: 연결할 사용자 UUID
            provider: OAuth2 프로바이더 ('kakao', 'naver', 'google')
            provider_user_id: 프로바이더 발급 사용자 ID
            provider_email: 프로바이더 이메일 (선택)
            provider_name: 프로바이더 사용자명 (선택)
            access_token: Fernet 암호화된 액세스 토큰 (선택)
        """
        super().__init__(
            user_id=user_id,
            provider=provider,
            provider_user_id=provider_user_id,
            provider_email=provider_email,
            provider_name=provider_name,
            access_token=access_token,
            **kwargs,
        )

    def __repr__(self) -> str:
        return (
            f"<SocialAccount id={self.id} provider={self.provider!r} "
            f"provider_user_id={self.provider_user_id!r}>"
        )
