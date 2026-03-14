"""사용자 도메인 SQLAlchemy 모델 (SPEC-AUTH-001 Module 1)

User 테이블 정의. 이메일 유니크, bcrypt 해시 비밀번호 저장.
"""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from sqlalchemy import Boolean, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

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
    hashed_password: Mapped[str] = mapped_column(
        Text,
        nullable=False,
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
        hashed_password: str,
        full_name: str | None = None,
        is_active: bool = True,
        **kwargs,
    ) -> None:
        """User 초기화

        Args:
            email: 이메일 주소 (소문자로 정규화 필요)
            hashed_password: bcrypt 해시된 비밀번호
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
