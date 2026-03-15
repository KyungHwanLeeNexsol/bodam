"""사용자 도메인 SQLAlchemy 모델 (SPEC-AUTH-001 Module 1, SPEC-SEC-001 M2)

User 테이블 정의. 이메일 유니크, bcrypt 해시 비밀번호 저장.
SPEC-SEC-001: ConsentRecord 모델 추가 (PIPA 동의 이력 관리).
"""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from sqlalchemy import Boolean, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class User(TimestampMixin, Base):
    """사용자 테이블

    보담 플랫폼의 인증된 사용자.
    이메일은 대소문자 구분 없이 유니크 처리.
    """

    __tablename__ = "users"

    # 기본 키: UUID (서버 기본값)
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )

    # 이메일 (유니크, 소문자 저장)
    email: Mapped[str] = mapped_column(
        Text,
        unique=True,
        nullable=False,
        index=True,
    )

    # bcrypt 해시 비밀번호 (평문 절대 저장 금지)
    # @MX:NOTE: 소셜 전용 계정은 None 허용 (SPEC-OAUTH-001 ACC-19)
    hashed_password: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    # 사용자 이름 (선택)
    full_name: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    # 계정 활성 상태 (기본값: True)
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=sa.text("true"),
    )

    def __init__(
        self,
        email: str,
        hashed_password: str | None = None,
        full_name: str | None = None,
        is_active: bool = True,
        **kwargs,
    ) -> None:
        """User 초기화

        Args:
            email: 이메일 주소 (소문자로 정규화 필요)
            hashed_password: bcrypt 해시된 비밀번호 (소셜 전용 계정은 None)
            full_name: 사용자 이름 (선택)
            is_active: 계정 활성 상태 (기본값: True)
        """
        super().__init__(
            email=email,
            hashed_password=hashed_password,
            full_name=full_name,
            is_active=is_active,
            **kwargs,
        )

    def __repr__(self) -> str:
        return f"<User id={self.id} email={self.email!r}>"


class ConsentRecord(TimestampMixin, Base):
    """개인정보 동의 이력 테이블 (SPEC-SEC-001 M2)

    PIPA 준수를 위한 사용자 동의 기록.
    회원가입 시 필수/선택 동의 항목을 저장한다.
    """

    __tablename__ = "consent_records"

    # 기본 키: UUID
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )

    # 사용자 FK (CASCADE 삭제)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # 동의 항목 유형 (예: 'terms', 'privacy', 'marketing')
    consent_type: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # 동의 여부
    consented: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )

    def __repr__(self) -> str:
        return f"<ConsentRecord user_id={self.user_id} type={self.consent_type} consented={self.consented}>"
