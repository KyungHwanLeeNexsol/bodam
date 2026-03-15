"""User 모델 소셜 로그인 지원 테스트 (TAG-002 RED)

SPEC-OAUTH-001 ACC-19: 소셜 전용 계정(hashed_password=None) 지원 검증.
ACC-20: 이메일/비밀번호 로그인 시 소셜 계정 안내 메시지 확인.
"""

from __future__ import annotations

import uuid

import pytest

from app.models.user import User


class TestUserModelSocialSupport:
    """User 모델의 소셜 로그인 지원 테스트"""

    def test_user_hashed_password_nullable(self):
        """hashed_password 컬럼이 nullable인지 확인 (소셜 전용 계정 지원)"""
        col = User.__table__.c["hashed_password"]
        assert col.nullable is True, "hashed_password는 소셜 전용 계정을 위해 nullable이어야 함"

    def test_user_can_be_created_without_password(self):
        """비밀번호 없이 User 인스턴스 생성 가능 (소셜 전용 계정)"""
        user = User(
            email="social@kakao.com",
            hashed_password=None,
            full_name="카카오 유저",
        )
        assert user.email == "social@kakao.com"
        assert user.hashed_password is None

    def test_user_with_password_still_works(self):
        """기존 비밀번호 방식 User 인스턴스 생성도 정상 작동"""
        user = User(
            email="normal@email.com",
            hashed_password="$2b$12$hashedpassword",
            full_name="일반 유저",
        )
        assert user.hashed_password == "$2b$12$hashedpassword"

    def test_user_default_hashed_password_is_none(self):
        """hashed_password 기본값이 None인지 확인"""
        user = User(email="test@test.com")
        assert user.hashed_password is None
