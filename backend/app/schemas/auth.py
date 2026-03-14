"""인증 도메인 Pydantic 스키마 (SPEC-AUTH-001 Module 2)

회원가입, 로그인, 토큰 응답, 사용자 응답 스키마 정의.
"""

from __future__ import annotations

import uuid

from pydantic import BaseModel, EmailStr, field_validator


class RegisterRequest(BaseModel):
    """회원가입 요청 스키마"""

    # 이메일 (소문자로 정규화)
    email: EmailStr
    # 비밀번호 (평문, 서비스 레이어에서 해시 처리)
    password: str
    # 사용자 이름 (선택)
    full_name: str | None = None

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        """이메일을 소문자로 정규화"""
        return v.lower().strip()


class LoginRequest(BaseModel):
    """로그인 요청 스키마"""

    # 이메일 (소문자로 정규화)
    email: EmailStr
    # 비밀번호 (평문)
    password: str

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        """이메일을 소문자로 정규화"""
        return v.lower().strip()


class UserResponse(BaseModel):
    """사용자 정보 응답 스키마"""

    # 사용자 UUID
    id: uuid.UUID
    # 이메일
    email: str
    # 사용자 이름 (선택)
    full_name: str | None = None
    # 계정 활성 상태
    is_active: bool

    model_config = {"from_attributes": True}


class TokenResponse(BaseModel):
    """JWT 토큰 응답 스키마"""

    # JWT 액세스 토큰
    access_token: str
    # 토큰 유형 (항상 "bearer")
    token_type: str = "bearer"
