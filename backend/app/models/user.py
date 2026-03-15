"""사용자 도메인 SQLAlchemy 모델 (SPEC-AUTH-001 Module 1, SPEC-SEC-001 M2, SPEC-B2B-001)

User 테이블 정의. 이메일 유니크, bcrypt 해시 비밀번호 저장.
SPEC-SEC-001: ConsentRecord 모델 추가 (PIPA 동의 이력 관리).
SPEC-B2B-001: UserRole enum 및 role 컬럼 추가 (RBAC 지원).
"""

from __future__ import annotations

import uuid
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy import Boolean, Enum, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class UserRole(StrEnum):
    """사용자 역할 열거형 (SPEC-B2B-001 RBAC)

    보담 플랫폼의 역할 기반 접근 제어를 위한 역할 정의.
    """

    # 일반 사용자 (기본값)
    B2C_USER = "B2C_USER"
    # 보험 설계사
    AGENT = "AGENT"
    # 설계사 관리자
    AGENT_ADMIN = "AGENT_ADMIN"
    # 조직 소유자
    ORG_OWNER = "ORG_OWNER"
    # 시스템 관리자
    SYSTEM_ADMIN = "SYSTEM_ADMIN"


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

    # 사용자 역할 (기본값: B2C_USER)
    # @MX:NOTE: SPEC-B2B-001 RBAC - B2B 기능 접근 제어에 사용
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="userrole", create_type=False),
        nullable=False,
        default=UserRole.B2C_USER,
        server_default=UserRole.B2C_USER.value,
    )

    def __init__(
        self,
        email: str,
        hashed_password: str | None = None,
        full_name: str | None = None,
        is_active: bool = True,
        role: UserRole = UserRole.B2C_USER,
        **kwargs,
    ) -> None:
        """User 초기화

        Args:
            email: 이메일 주소 (소문자로 정규화 필요)
            hashed_password: bcrypt 해시된 비밀번호 (소셜 전용 계정은 None)
            full_name: 사용자 이름 (선택)
            is_active: 계정 활성 상태 (기본값: True)
            role: 사용자 역할 (기본값: B2C_USER)
        """
        super().__init__(
            email=email,
            hashed_password=hashed_password,
            full_name=full_name,
            is_active=is_active,
            role=role,
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
