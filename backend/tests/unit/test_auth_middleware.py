"""인증 미들웨어 단위 테스트 (SPEC-AUTH-001 Module 4)

get_current_user FastAPI 의존성 함수를 테스트.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest


class TestGetCurrentUser:
    """get_current_user 의존성 테스트"""

    def test_get_current_user_importable(self):
        """get_current_user가 임포트 가능해야 한다"""
        from app.api.deps import get_current_user

        assert get_current_user is not None

    async def test_valid_token_returns_user(self):
        """유효한 Bearer 토큰은 사용자 정보를 반환해야 한다"""
        from app.core.security import create_access_token

        user_id = str(uuid.uuid4())
        token = create_access_token(
            user_id=user_id,
            secret_key="test-secret-key-for-testing-purposes-only",
            algorithm="HS256",
            expire_minutes=30,
        )

        # mock request with Authorization header
        from fastapi.security import HTTPAuthorizationCredentials

        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

        # mock db
        mock_db = AsyncMock()
        mock_user = MagicMock()
        mock_user.id = uuid.UUID(user_id)
        mock_user.email = "user@example.com"
        mock_user.is_active = True
        mock_db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=mock_user)))

        # mock settings
        mock_settings = MagicMock()
        mock_settings.secret_key = "test-secret-key-for-testing-purposes-only"
        mock_settings.jwt_algorithm = "HS256"

        from app.api.deps import _get_user_from_token

        result = await _get_user_from_token(
            credentials=credentials,
            db=mock_db,
            settings=mock_settings,
        )
        assert result is not None

    async def test_invalid_token_raises_401(self):
        """유효하지 않은 토큰은 HTTPException 401을 발생시켜야 한다"""
        from fastapi import HTTPException
        from fastapi.security import HTTPAuthorizationCredentials

        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="invalid.token.here")

        mock_db = AsyncMock()
        mock_settings = MagicMock()
        mock_settings.secret_key = "test-secret-key-for-testing-purposes-only"
        mock_settings.jwt_algorithm = "HS256"

        from app.api.deps import _get_user_from_token

        with pytest.raises(HTTPException) as exc_info:
            await _get_user_from_token(
                credentials=credentials,
                db=mock_db,
                settings=mock_settings,
            )

        assert exc_info.value.status_code == 401

    async def test_missing_user_in_db_raises_401(self):
        """DB에 없는 사용자 ID를 가진 토큰은 HTTPException 401을 발생시켜야 한다"""
        from fastapi import HTTPException
        from fastapi.security import HTTPAuthorizationCredentials

        from app.core.security import create_access_token

        user_id = str(uuid.uuid4())
        token = create_access_token(
            user_id=user_id,
            secret_key="test-secret-key-for-testing-purposes-only",
            algorithm="HS256",
            expire_minutes=30,
        )

        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

        # 사용자가 DB에 없는 경우
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None)))

        mock_settings = MagicMock()
        mock_settings.secret_key = "test-secret-key-for-testing-purposes-only"
        mock_settings.jwt_algorithm = "HS256"

        from app.api.deps import _get_user_from_token

        with pytest.raises(HTTPException) as exc_info:
            await _get_user_from_token(
                credentials=credentials,
                db=mock_db,
                settings=mock_settings,
            )

        assert exc_info.value.status_code == 401

    async def test_inactive_user_raises_401(self):
        """비활성 사용자는 HTTPException 401을 발생시켜야 한다"""
        from fastapi import HTTPException
        from fastapi.security import HTTPAuthorizationCredentials

        from app.core.security import create_access_token

        user_id = str(uuid.uuid4())
        token = create_access_token(
            user_id=user_id,
            secret_key="test-secret-key-for-testing-purposes-only",
            algorithm="HS256",
            expire_minutes=30,
        )

        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

        mock_db = AsyncMock()
        mock_user = MagicMock()
        mock_user.id = uuid.UUID(user_id)
        mock_user.is_active = False
        mock_db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=mock_user)))

        mock_settings = MagicMock()
        mock_settings.secret_key = "test-secret-key-for-testing-purposes-only"
        mock_settings.jwt_algorithm = "HS256"

        from app.api.deps import _get_user_from_token

        with pytest.raises(HTTPException) as exc_info:
            await _get_user_from_token(
                credentials=credentials,
                db=mock_db,
                settings=mock_settings,
            )

        assert exc_info.value.status_code == 401
