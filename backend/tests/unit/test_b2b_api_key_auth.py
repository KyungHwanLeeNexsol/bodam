"""API Key 인증 의존성 단위 테스트 (SPEC-B2B-001 Module 4)

스코프 기반 인증 및 X-API-Key 헤더 검증:
- require_scope: 스코프 기반 접근 제어
- get_current_user_or_api_key: JWT 또는 API 키 인증

AC-007: X-API-Key 헤더로 인증 가능
AC-008: 스코프 없는 엔드포인트 호출 시 403
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest


class TestRequireScopeDependency:
    """require_scope 의존성 테스트"""

    def test_require_scope_importable(self):
        """require_scope가 deps.py에서 임포트 가능해야 한다"""
        from app.api.deps import require_scope

        assert require_scope is not None

    def test_require_scope_returns_callable(self):
        """require_scope는 호출 가능한 객체를 반환해야 한다"""
        from app.api.deps import require_scope

        checker = require_scope("read")
        assert callable(checker)

    @pytest.mark.asyncio
    async def test_require_scope_passes_when_key_has_scope(self):
        """API 키에 필요한 스코프가 있으면 통과해야 한다"""
        from app.api.deps import require_scope
        from app.models.api_key import APIKey

        mock_api_key = MagicMock(spec=APIKey)
        mock_api_key.scopes = ["read", "write"]

        checker = require_scope("read")
        # 스코프가 있으면 예외 없이 통과
        result = await checker(api_key=mock_api_key)
        assert result == mock_api_key

    @pytest.mark.asyncio
    async def test_require_scope_raises_403_when_scope_missing(self):
        """API 키에 필요한 스코프가 없으면 403을 발생시켜야 한다 (AC-008)"""
        from fastapi import HTTPException

        from app.api.deps import require_scope
        from app.models.api_key import APIKey

        mock_api_key = MagicMock(spec=APIKey)
        mock_api_key.scopes = ["read"]

        checker = require_scope("write")

        with pytest.raises(HTTPException) as exc_info:
            await checker(api_key=mock_api_key)

        assert exc_info.value.status_code == 403
        # 에러 메시지에 스코프 이름이 포함되어야 함
        assert "write" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_require_scope_403_message_contains_scope_name(self):
        """403 에러 메시지에 필요한 스코프 이름이 포함되어야 한다"""
        from fastapi import HTTPException

        from app.api.deps import require_scope
        from app.models.api_key import APIKey

        mock_api_key = MagicMock(spec=APIKey)
        mock_api_key.scopes = []

        checker = require_scope("analysis")

        with pytest.raises(HTTPException) as exc_info:
            await checker(api_key=mock_api_key)

        assert "analysis" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_require_scope_passes_with_none_key_when_user_auth(self):
        """JWT 인증된 사용자의 경우 (api_key=None) 스코프 검사를 건너뛰어야 한다"""
        from app.api.deps import require_scope

        checker = require_scope("read")
        # api_key가 None이면 스코프 검사 없이 통과
        result = await checker(api_key=None)
        assert result is None


class TestGetCurrentUserOrAPIKey:
    """get_current_user_or_api_key 의존성 테스트"""

    def test_get_current_user_or_api_key_importable(self):
        """get_current_user_or_api_key가 deps.py에서 임포트 가능해야 한다"""
        from app.api.deps import get_current_user_or_api_key

        assert get_current_user_or_api_key is not None

    @pytest.mark.asyncio
    async def test_returns_user_from_jwt(self):
        """Bearer JWT가 있으면 User를 반환해야 한다"""
        from app.api.deps import get_current_user_or_api_key
        from app.models.user import User

        mock_user = MagicMock(spec=User)
        mock_db = AsyncMock()
        mock_settings = MagicMock()
        mock_settings.secret_key = "test-secret"
        mock_settings.jwt_algorithm = "HS256"

        # JWT 크레덴셜 모킹
        from fastapi.security import HTTPAuthorizationCredentials

        mock_credentials = MagicMock(spec=HTTPAuthorizationCredentials)
        mock_credentials.credentials = "valid_jwt_token"

        with pytest.MonkeyPatch.context() as mp:
            # _get_user_from_token을 모킹하여 user 반환
            from app.api import deps
            original = deps._get_user_from_token

            async def mock_get_user(*args, **kwargs):
                return mock_user

            mp.setattr(deps, "_get_user_from_token", mock_get_user)

            user, api_key, org = await get_current_user_or_api_key(
                credentials=mock_credentials,
                x_api_key=None,
                db=mock_db,
                settings=mock_settings,
            )

        assert user == mock_user
        assert api_key is None
        assert org is None

    @pytest.mark.asyncio
    async def test_returns_api_key_from_x_api_key_header(self):
        """X-API-Key 헤더가 있으면 APIKey와 Organization을 반환해야 한다"""
        from app.api.deps import get_current_user_or_api_key
        from app.models.api_key import APIKey
        from app.models.organization import Organization

        mock_api_key = MagicMock(spec=APIKey)
        mock_org = MagicMock(spec=Organization)

        mock_db = AsyncMock()
        mock_settings = MagicMock()

        with pytest.MonkeyPatch.context() as mp:
            from app.services.b2b import api_key_service

            async def mock_validate(raw_key):
                return mock_api_key, mock_org

            # APIKeyService 모킹
            mock_service_instance = MagicMock()
            mock_service_instance.validate_api_key = AsyncMock(
                return_value=(mock_api_key, mock_org)
            )

            original_class = api_key_service.APIKeyService

            class MockAPIKeyService:
                def __init__(self, db):
                    pass

                async def validate_api_key(self, raw_key):
                    return mock_api_key, mock_org

            mp.setattr(api_key_service, "APIKeyService", MockAPIKeyService)

            user, api_key, org = await get_current_user_or_api_key(
                credentials=None,
                x_api_key="bdk_" + "a" * 32,
                db=mock_db,
                settings=mock_settings,
            )

        assert user is None
        assert api_key == mock_api_key
        assert org == mock_org

    @pytest.mark.asyncio
    async def test_raises_401_when_no_credentials(self):
        """인증 수단이 없으면 401을 발생시켜야 한다"""
        from fastapi import HTTPException

        from app.api.deps import get_current_user_or_api_key

        mock_db = AsyncMock()
        mock_settings = MagicMock()

        with pytest.raises(HTTPException) as exc_info:
            await get_current_user_or_api_key(
                credentials=None,
                x_api_key=None,
                db=mock_db,
                settings=mock_settings,
            )

        assert exc_info.value.status_code == 401
