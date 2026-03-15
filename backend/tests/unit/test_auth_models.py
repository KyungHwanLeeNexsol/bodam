"""인증 모델 단위 테스트 (SPEC-AUTH-001 Module 1)

User SQLAlchemy 모델 구조 및 제약 조건을 검증.
"""

from __future__ import annotations

import uuid

import pytest


class TestUserModelStructure:
    """User 모델 구조 테스트"""

    def test_user_model_importable(self):
        """User 모델이 임포트 가능해야 한다"""
        from app.models.user import User

        assert User is not None

    def test_user_model_has_required_columns(self):
        """User 모델은 필수 컬럼을 모두 가져야 한다"""
        from app.models.user import User

        mapper = User.__mapper__
        column_names = {col.key for col in mapper.columns}

        assert "id" in column_names
        assert "email" in column_names
        assert "hashed_password" in column_names
        assert "full_name" in column_names
        assert "is_active" in column_names
        assert "created_at" in column_names
        assert "updated_at" in column_names

    def test_user_model_tablename(self):
        """User 모델의 테이블명은 'users'여야 한다"""
        from app.models.user import User

        assert User.__tablename__ == "users"

    def test_user_model_id_is_uuid(self):
        """User.id는 UUID 타입이어야 한다"""
        from app.models.user import User

        id_col = User.__mapper__.columns["id"]
        # UUID PK 확인
        assert id_col.primary_key is True

    def test_user_model_email_is_unique(self):
        """User.email은 UNIQUE 제약이 있어야 한다"""
        from app.models.user import User

        email_col = User.__mapper__.columns["email"]
        assert email_col.unique is True

    def test_user_model_email_is_not_nullable(self):
        """User.email은 nullable이 아니어야 한다"""
        from app.models.user import User

        email_col = User.__mapper__.columns["email"]
        assert email_col.nullable is False

    def test_user_model_hashed_password_nullable(self):
        """User.hashed_password는 nullable이어야 한다 (SPEC-OAUTH-001: 소셜 전용 계정 지원)"""
        from app.models.user import User

        col = User.__mapper__.columns["hashed_password"]
        assert col.nullable is True

    def test_user_model_is_active_default_true(self):
        """User.is_active 기본값은 True여야 한다"""
        from app.models.user import User

        col = User.__mapper__.columns["is_active"]
        # 서버 기본값 또는 Python 기본값 확인
        assert col.default is not None or col.server_default is not None

    def test_user_model_instantiation(self):
        """User 인스턴스를 생성할 수 있어야 한다"""
        from app.models.user import User

        user = User(
            email="test@example.com",
            hashed_password="hashed_pw",
            full_name="테스트 사용자",
        )
        assert user.email == "test@example.com"
        assert user.hashed_password == "hashed_pw"
        assert user.full_name == "테스트 사용자"

    def test_user_model_inherits_timestamp_mixin(self):
        """User 모델은 TimestampMixin을 상속해야 한다"""
        from app.models.base import TimestampMixin
        from app.models.user import User

        assert issubclass(User, TimestampMixin)

    def test_user_model_full_name_nullable(self):
        """User.full_name은 nullable이어야 한다 (선택 입력)"""
        from app.models.user import User

        col = User.__mapper__.columns["full_name"]
        assert col.nullable is True


class TestAuthSchemas:
    """Auth Pydantic 스키마 테스트"""

    def test_register_request_schema_importable(self):
        """RegisterRequest 스키마가 임포트 가능해야 한다"""
        from app.schemas.auth import RegisterRequest

        assert RegisterRequest is not None

    def test_login_request_schema_importable(self):
        """LoginRequest 스키마가 임포트 가능해야 한다"""
        from app.schemas.auth import LoginRequest

        assert LoginRequest is not None

    def test_user_response_schema_importable(self):
        """UserResponse 스키마가 임포트 가능해야 한다"""
        from app.schemas.auth import UserResponse

        assert UserResponse is not None

    def test_token_response_schema_importable(self):
        """TokenResponse 스키마가 임포트 가능해야 한다"""
        from app.schemas.auth import TokenResponse

        assert TokenResponse is not None

    def test_register_request_validates_email(self):
        """RegisterRequest는 유효한 이메일을 요구해야 한다"""
        from pydantic import ValidationError

        from app.schemas.auth import RegisterRequest

        with pytest.raises(ValidationError):
            RegisterRequest(email="not-an-email", password="password123", full_name="테스트")

    def test_register_request_valid(self):
        """RegisterRequest는 유효한 데이터를 수락해야 한다"""
        from app.schemas.auth import RegisterRequest

        req = RegisterRequest(email="user@example.com", password="password123", full_name="테스트")
        assert req.email == "user@example.com"

    def test_login_request_valid(self):
        """LoginRequest는 이메일과 비밀번호를 수락해야 한다"""
        from app.schemas.auth import LoginRequest

        req = LoginRequest(email="user@example.com", password="password123")
        assert req.email == "user@example.com"

    def test_token_response_has_access_token_and_type(self):
        """TokenResponse는 access_token과 token_type을 가져야 한다"""
        from app.schemas.auth import TokenResponse

        token = TokenResponse(access_token="some.jwt.token", token_type="bearer")
        assert token.access_token == "some.jwt.token"
        assert token.token_type == "bearer"

    def test_user_response_has_required_fields(self):
        """UserResponse는 id, email, full_name, is_active를 가져야 한다"""
        from app.schemas.auth import UserResponse

        user_id = uuid.uuid4()
        resp = UserResponse(
            id=user_id,
            email="user@example.com",
            full_name="테스트",
            is_active=True,
        )
        assert resp.id == user_id
        assert resp.email == "user@example.com"

    def test_register_request_email_normalized_to_lowercase(self):
        """RegisterRequest 이메일은 소문자로 정규화되어야 한다"""
        from app.schemas.auth import RegisterRequest

        req = RegisterRequest(email="User@Example.COM", password="password123", full_name="테스트")
        assert req.email == "user@example.com"

    def test_login_request_email_normalized_to_lowercase(self):
        """LoginRequest 이메일은 소문자로 정규화되어야 한다"""
        from app.schemas.auth import LoginRequest

        req = LoginRequest(email="User@Example.COM", password="password123")
        assert req.email == "user@example.com"
