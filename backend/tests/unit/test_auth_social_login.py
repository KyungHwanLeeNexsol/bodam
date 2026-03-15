"""소셜 전용 계정 로그인 시도 테스트 (SPEC-OAUTH-001 ACC-21)

소셜 로그인으로만 가입한 사용자가 이메일/비밀번호 로그인 시도 시 안내 메시지 반환.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.user import User
from app.schemas.auth import LoginRequest
from app.services.auth_service import AuthService


class TestSocialOnlyAccountLogin:
    """소셜 전용 계정의 이메일/비밀번호 로그인 시도"""

    @pytest.fixture
    def mock_db(self):
        return AsyncMock()

    @pytest.fixture
    def mock_settings(self):
        settings = MagicMock()
        settings.secret_key = "test-secret"
        settings.jwt_algorithm = "HS256"
        settings.access_token_expire_minutes = 30
        return settings

    @pytest.fixture
    def auth_service(self, mock_db, mock_settings):
        return AuthService(db=mock_db, settings=mock_settings)

    async def test_social_only_user_login_returns_401_with_guidance(
        self, auth_service, mock_db
    ):
        """ACC-21: 소셜 전용 계정 로그인 시 안내 메시지 (401)"""
        from fastapi import HTTPException

        # 비밀번호 없는 소셜 전용 사용자
        mock_user = MagicMock(spec=User)
        mock_user.id = uuid.uuid4()
        mock_user.email = "social@example.com"
        mock_user.hashed_password = None  # 소셜 전용
        mock_user.is_active = True

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_user
        mock_db.execute = AsyncMock(return_value=mock_result)

        req = LoginRequest(email="social@example.com", password="anypassword123")

        with pytest.raises(HTTPException) as exc_info:
            await auth_service.login(req)

        assert exc_info.value.status_code == 401
        assert "소셜 로그인" in exc_info.value.detail

    async def test_regular_user_login_still_works(
        self, auth_service, mock_db
    ):
        """기존 이메일/비밀번호 사용자 로그인은 정상 작동"""
        from app.core.security import hash_password

        mock_user = MagicMock(spec=User)
        mock_user.id = uuid.uuid4()
        mock_user.email = "regular@example.com"
        mock_user.hashed_password = hash_password("validpass1")
        mock_user.is_active = True

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_user
        mock_db.execute = AsyncMock(return_value=mock_result)

        req = LoginRequest(email="regular@example.com", password="validpass1")
        response = await auth_service.login(req)

        assert response.access_token is not None
        assert response.token_type == "bearer"

    async def test_nonexistent_user_login_returns_401(
        self, auth_service, mock_db
    ):
        """존재하지 않는 사용자는 동일한 401 응답"""
        from fastapi import HTTPException

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute = AsyncMock(return_value=mock_result)

        req = LoginRequest(email="noone@example.com", password="anypassword123")

        with pytest.raises(HTTPException) as exc_info:
            await auth_service.login(req)

        assert exc_info.value.status_code == 401
