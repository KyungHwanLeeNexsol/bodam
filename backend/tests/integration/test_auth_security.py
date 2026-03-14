"""인증 보안 통합 테스트 (SPEC-SEC-001 M5 TAG-4)

인증 우회 시도, 만료 토큰, 변조 토큰에 대한 보안 경계 검증.
DB 의존성은 dependency_overrides로 mock 처리하여 DB 없이 동작.
"""

from __future__ import annotations

import time
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient


def _make_mock_db_override():
    """get_db를 대체하는 mock DB 세션 의존성"""
    mock_db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none = MagicMock(return_value=None)
    mock_db.execute = AsyncMock(return_value=execute_result)

    async def override():
        yield mock_db

    return override


def _make_mock_settings_override(secret_key: str = "test-secret", algorithm: str = "HS256"):
    """get_settings를 대체하는 mock 설정 의존성"""
    mock_settings = MagicMock()
    mock_settings.secret_key = secret_key
    mock_settings.jwt_algorithm = algorithm

    def override():
        return mock_settings

    return override


def _make_app_with_auth_routes() -> FastAPI:
    """auth + users 라우터를 포함한 테스트용 FastAPI 앱"""
    from app.api.v1.auth import router as auth_router
    from app.api.v1.users import router as users_router

    app = FastAPI()
    app.include_router(auth_router, prefix="/api/v1")
    app.include_router(users_router, prefix="/api/v1")
    return app


class TestExpiredTokenRejection:
    """만료 토큰 거부 테스트"""

    @pytest.mark.asyncio
    async def test_expired_token_returns_401(self):
        """만료된 JWT 토큰은 401을 반환해야 한다"""
        from app.core.config import get_settings
        from app.core.database import get_db
        from app.core.security import create_access_token

        # 즉시 만료되는 토큰 생성
        expired_token = create_access_token(
            user_id=str(uuid.uuid4()),
            secret_key="test-secret",
            algorithm="HS256",
            expire_minutes=0,
        )
        time.sleep(1)  # 만료 대기

        app = _make_app_with_auth_routes()
        app.dependency_overrides[get_db] = _make_mock_db_override()
        app.dependency_overrides[get_settings] = _make_mock_settings_override()

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get(
                "/api/v1/auth/me",
                headers={"Authorization": f"Bearer {expired_token}"},
            )

        app.dependency_overrides.clear()
        assert response.status_code == 401


class TestTamperedTokenRejection:
    """변조 토큰 거부 테스트"""

    @pytest.mark.asyncio
    async def test_tampered_jwt_returns_401(self):
        """변조된 JWT 토큰은 401을 반환해야 한다"""
        from app.core.config import get_settings
        from app.core.database import get_db
        from app.core.security import create_access_token

        valid_token = create_access_token(
            user_id=str(uuid.uuid4()),
            secret_key="original-secret",
            algorithm="HS256",
            expire_minutes=30,
        )
        # 서명 부분을 변조
        parts = valid_token.split(".")
        tampered_token = parts[0] + "." + parts[1] + ".INVALID_SIGNATURE"

        app = _make_app_with_auth_routes()
        app.dependency_overrides[get_db] = _make_mock_db_override()
        app.dependency_overrides[get_settings] = _make_mock_settings_override("original-secret")

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get(
                "/api/v1/auth/me",
                headers={"Authorization": f"Bearer {tampered_token}"},
            )

        app.dependency_overrides.clear()
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_wrong_secret_token_returns_401(self):
        """다른 시크릿으로 서명된 토큰은 401을 반환해야 한다"""
        from app.core.config import get_settings
        from app.core.database import get_db
        from app.core.security import create_access_token

        # 공격자 시크릿으로 서명된 토큰
        attacker_token = create_access_token(
            user_id=str(uuid.uuid4()),
            secret_key="attacker-secret",
            algorithm="HS256",
            expire_minutes=30,
        )

        app = _make_app_with_auth_routes()
        app.dependency_overrides[get_db] = _make_mock_db_override()
        # 서버는 다른 시크릿을 사용
        app.dependency_overrides[get_settings] = _make_mock_settings_override("server-correct-secret")

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get(
                "/api/v1/auth/me",
                headers={"Authorization": f"Bearer {attacker_token}"},
            )

        app.dependency_overrides.clear()
        assert response.status_code == 401


class TestNoTokenRejection:
    """토큰 미제공 거부 테스트"""

    @pytest.mark.asyncio
    async def test_no_token_returns_401_for_me(self):
        """토큰 없이 /auth/me 접근 시 401을 반환해야 한다"""
        from app.core.config import get_settings
        from app.core.database import get_db

        app = _make_app_with_auth_routes()
        app.dependency_overrides[get_db] = _make_mock_db_override()
        app.dependency_overrides[get_settings] = _make_mock_settings_override()

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/auth/me")

        app.dependency_overrides.clear()
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_no_token_returns_401_for_user_data(self):
        """토큰 없이 /users/me/data 접근 시 401을 반환해야 한다"""
        from app.core.config import get_settings
        from app.core.database import get_db

        app = _make_app_with_auth_routes()
        app.dependency_overrides[get_db] = _make_mock_db_override()
        app.dependency_overrides[get_settings] = _make_mock_settings_override()

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/users/me/data")

        app.dependency_overrides.clear()
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_no_token_returns_401_for_delete_account(self):
        """토큰 없이 DELETE /users/me 접근 시 401을 반환해야 한다"""
        from app.core.config import get_settings
        from app.core.database import get_db

        app = _make_app_with_auth_routes()
        app.dependency_overrides[get_db] = _make_mock_db_override()
        app.dependency_overrides[get_settings] = _make_mock_settings_override()

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.request(
                "DELETE",
                "/api/v1/users/me",
                json={"password": "somepassword"},
            )

        app.dependency_overrides.clear()
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_malformed_bearer_token_returns_401(self):
        """잘못된 형식의 Bearer 토큰은 401을 반환해야 한다"""
        from app.core.config import get_settings
        from app.core.database import get_db

        app = _make_app_with_auth_routes()
        app.dependency_overrides[get_db] = _make_mock_db_override()
        app.dependency_overrides[get_settings] = _make_mock_settings_override()

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get(
                "/api/v1/auth/me",
                headers={"Authorization": "Bearer not.a.valid.jwt.token"},
            )

        app.dependency_overrides.clear()
        assert response.status_code == 401
