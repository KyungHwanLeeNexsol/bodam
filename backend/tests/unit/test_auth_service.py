"""인증 서비스 단위 테스트 (SPEC-AUTH-001 Module 2)

AuthService의 register/login 비즈니스 로직을 mock DB로 테스트.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest


class TestAuthServiceRegister:
    """AuthService.register 테스트"""

    @pytest.fixture
    def mock_db(self):
        """mock AsyncSession"""
        db = AsyncMock()
        db.add = MagicMock()
        db.flush = AsyncMock()
        db.commit = AsyncMock()
        db.rollback = AsyncMock()
        return db

    @pytest.fixture
    def mock_settings(self):
        """mock Settings"""
        settings = MagicMock()
        settings.secret_key = "test-secret-key-very-long-enough"
        settings.jwt_algorithm = "HS256"
        settings.access_token_expire_minutes = 30
        return settings

    @pytest.fixture
    def auth_service(self, mock_db, mock_settings):
        """AuthService 인스턴스"""
        from app.services.auth_service import AuthService

        return AuthService(db=mock_db, settings=mock_settings)

    async def test_register_returns_user_response(self, auth_service, mock_db):
        """register는 UserResponse를 반환해야 한다"""
        from app.schemas.auth import RegisterRequest

        # DB 중복 이메일 검사 -> None (신규 사용자)
        mock_db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None)))

        req = RegisterRequest(email="new@example.com", password="password123", full_name="신규 사용자")

        # flush 후 User 객체에 id 설정
        def set_user_id(user_obj):
            user_obj.id = uuid.uuid4()
            user_obj.is_active = True

        mock_db.flush.side_effect = lambda: set_user_id(mock_db.add.call_args[0][0])

        result = await auth_service.register(req)

        from app.schemas.auth import UserResponse

        assert isinstance(result, UserResponse)
        assert result.email == "new@example.com"

    async def test_register_duplicate_email_raises_409(self, auth_service, mock_db):
        """중복 이메일 등록은 HTTPException 409를 발생시켜야 한다"""
        from fastapi import HTTPException

        from app.schemas.auth import RegisterRequest

        # 이미 존재하는 사용자 반환
        existing_user = MagicMock()
        existing_user.email = "existing@example.com"
        mock_db.execute = AsyncMock(
            return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=existing_user))
        )

        req = RegisterRequest(email="existing@example.com", password="password123", full_name="기존 사용자")

        with pytest.raises(HTTPException) as exc_info:
            await auth_service.register(req)

        assert exc_info.value.status_code == 409

    async def test_register_weak_password_raises_422(self, auth_service, mock_db):
        """약한 비밀번호 등록은 HTTPException 422를 발생시켜야 한다"""
        from fastapi import HTTPException

        from app.schemas.auth import RegisterRequest

        mock_db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None)))

        req = RegisterRequest(email="user@example.com", password="short", full_name="사용자")

        with pytest.raises(HTTPException) as exc_info:
            await auth_service.register(req)

        assert exc_info.value.status_code == 422

    async def test_register_hashes_password(self, auth_service, mock_db):
        """register는 비밀번호를 해시하여 저장해야 한다"""
        from app.schemas.auth import RegisterRequest

        mock_db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None)))

        req = RegisterRequest(email="new@example.com", password="password123", full_name="사용자")

        def capture_user(user_obj):
            user_obj.id = uuid.uuid4()
            user_obj.is_active = True
            # 평문이 저장되지 않음을 확인
            assert user_obj.hashed_password != "password123"

        mock_db.flush.side_effect = lambda: capture_user(mock_db.add.call_args[0][0])

        await auth_service.register(req)


class TestAuthServiceLogin:
    """AuthService.login 테스트"""

    @pytest.fixture
    def mock_db(self):
        db = AsyncMock()
        return db

    @pytest.fixture
    def mock_settings(self):
        settings = MagicMock()
        settings.secret_key = "test-secret-key-very-long-enough"
        settings.jwt_algorithm = "HS256"
        settings.access_token_expire_minutes = 30
        return settings

    @pytest.fixture
    def auth_service(self, mock_db, mock_settings):
        from app.services.auth_service import AuthService

        return AuthService(db=mock_db, settings=mock_settings)

    async def test_login_returns_token_response(self, auth_service, mock_db):
        """login은 TokenResponse를 반환해야 한다"""
        from app.core.security import hash_password
        from app.schemas.auth import LoginRequest

        # 활성 사용자 mock
        user = MagicMock()
        user.id = uuid.uuid4()
        user.email = "user@example.com"
        user.hashed_password = hash_password("password123")
        user.is_active = True

        mock_db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=user)))

        req = LoginRequest(email="user@example.com", password="password123")
        result = await auth_service.login(req)

        from app.schemas.auth import TokenResponse

        assert isinstance(result, TokenResponse)
        assert result.token_type == "bearer"
        assert len(result.access_token) > 0

    async def test_login_wrong_password_raises_401(self, auth_service, mock_db):
        """잘못된 비밀번호는 HTTPException 401을 발생시켜야 한다"""
        from fastapi import HTTPException

        from app.core.security import hash_password
        from app.schemas.auth import LoginRequest

        user = MagicMock()
        user.id = uuid.uuid4()
        user.email = "user@example.com"
        user.hashed_password = hash_password("correct_password")
        user.is_active = True

        mock_db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=user)))

        req = LoginRequest(email="user@example.com", password="wrong_password")

        with pytest.raises(HTTPException) as exc_info:
            await auth_service.login(req)

        assert exc_info.value.status_code == 401
        assert "이메일 또는 비밀번호가 올바르지 않습니다" in exc_info.value.detail

    async def test_login_nonexistent_user_raises_401(self, auth_service, mock_db):
        """존재하지 않는 사용자는 HTTPException 401을 발생시켜야 한다"""
        from fastapi import HTTPException

        from app.schemas.auth import LoginRequest

        mock_db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None)))

        req = LoginRequest(email="notfound@example.com", password="password123")

        with pytest.raises(HTTPException) as exc_info:
            await auth_service.login(req)

        assert exc_info.value.status_code == 401
        assert "이메일 또는 비밀번호가 올바르지 않습니다" in exc_info.value.detail

    async def test_login_inactive_user_raises_403(self, auth_service, mock_db):
        """비활성 사용자 로그인은 HTTPException 403을 발생시켜야 한다"""
        from fastapi import HTTPException

        from app.core.security import hash_password
        from app.schemas.auth import LoginRequest

        # 비활성 사용자
        user = MagicMock()
        user.id = uuid.uuid4()
        user.email = "inactive@example.com"
        user.hashed_password = hash_password("password123")
        user.is_active = False

        mock_db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=user)))

        req = LoginRequest(email="inactive@example.com", password="password123")

        with pytest.raises(HTTPException) as exc_info:
            await auth_service.login(req)

        assert exc_info.value.status_code == 403

    async def test_login_token_contains_user_id(self, auth_service, mock_db):
        """로그인 토큰은 user_id를 포함해야 한다"""
        from app.core.security import decode_access_token, hash_password
        from app.schemas.auth import LoginRequest

        user_id = uuid.uuid4()
        user = MagicMock()
        user.id = user_id
        user.email = "user@example.com"
        user.hashed_password = hash_password("password123")
        user.is_active = True

        mock_db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=user)))

        req = LoginRequest(email="user@example.com", password="password123")
        result = await auth_service.login(req)

        decoded_id = decode_access_token(
            result.access_token,
            secret_key="test-secret-key-very-long-enough",
            algorithm="HS256",
        )
        assert decoded_id == str(user_id)
