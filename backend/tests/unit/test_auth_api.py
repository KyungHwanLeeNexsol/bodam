"""인증 API 엔드포인트 단위 테스트 (SPEC-AUTH-001 Module 3)

FastAPI 라우터와 엔드포인트 구조를 검증.
실제 DB 없이 mock 서비스로 테스트.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient


@pytest.fixture
def test_app():
    """테스트용 FastAPI 앱 (auth 라우터만 포함)"""
    from app.api.v1.auth import router

    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    return app


@pytest.fixture
def mock_auth_service():
    """mock AuthService"""
    service = AsyncMock()
    return service


class TestAuthRouterStructure:
    """Auth 라우터 구조 테스트"""

    def test_auth_router_importable(self):
        """auth 라우터가 임포트 가능해야 한다"""
        from app.api.v1.auth import router

        assert router is not None

    def test_auth_router_has_correct_prefix(self):
        """auth 라우터 prefix는 '/auth'여야 한다"""
        from app.api.v1.auth import router

        assert router.prefix == "/auth"

    def test_auth_router_has_register_route(self):
        """auth 라우터는 /register 라우트를 가져야 한다"""
        from app.api.v1.auth import router

        routes = [r.path for r in router.routes]
        assert "/auth/register" in routes

    def test_auth_router_has_login_route(self):
        """auth 라우터는 /login 라우트를 가져야 한다"""
        from app.api.v1.auth import router

        routes = [r.path for r in router.routes]
        assert "/auth/login" in routes

    def test_auth_router_has_me_route(self):
        """auth 라우터는 /me 라우트를 가져야 한다"""
        from app.api.v1.auth import router

        routes = [r.path for r in router.routes]
        assert "/auth/me" in routes


class TestAuthAPIRegister:
    """POST /auth/register 엔드포인트 테스트"""

    async def test_register_returns_201(self, test_app, mock_auth_service):
        """회원가입 성공 시 201을 반환해야 한다"""
        from app.api.v1.auth import get_auth_service
        from app.schemas.auth import UserResponse

        user_id = uuid.uuid4()
        mock_auth_service.register.return_value = UserResponse(
            id=user_id,
            email="new@example.com",
            full_name="신규 사용자",
            is_active=True,
        )

        test_app.dependency_overrides[get_auth_service] = lambda: mock_auth_service

        async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as client:
            response = await client.post(
                "/api/v1/auth/register",
                json={"email": "new@example.com", "password": "password123", "full_name": "신규 사용자"},
            )

        test_app.dependency_overrides.clear()
        assert response.status_code == 201

    async def test_register_returns_user_data(self, test_app, mock_auth_service):
        """회원가입 성공 시 사용자 정보를 반환해야 한다"""
        from app.api.v1.auth import get_auth_service
        from app.schemas.auth import UserResponse

        user_id = uuid.uuid4()
        mock_auth_service.register.return_value = UserResponse(
            id=user_id,
            email="new@example.com",
            full_name="신규 사용자",
            is_active=True,
        )

        test_app.dependency_overrides[get_auth_service] = lambda: mock_auth_service

        async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as client:
            response = await client.post(
                "/api/v1/auth/register",
                json={"email": "new@example.com", "password": "password123", "full_name": "신규 사용자"},
            )

        test_app.dependency_overrides.clear()
        data = response.json()
        assert data["email"] == "new@example.com"
        assert "id" in data


class TestAuthAPILogin:
    """POST /auth/login 엔드포인트 테스트"""

    async def test_login_returns_200(self, test_app, mock_auth_service):
        """로그인 성공 시 200을 반환해야 한다"""
        from app.api.v1.auth import get_auth_service
        from app.schemas.auth import TokenResponse

        mock_auth_service.login.return_value = TokenResponse(
            access_token="some.jwt.token",
            token_type="bearer",
        )

        test_app.dependency_overrides[get_auth_service] = lambda: mock_auth_service

        async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as client:
            response = await client.post(
                "/api/v1/auth/login",
                json={"email": "user@example.com", "password": "password123"},
            )

        test_app.dependency_overrides.clear()
        assert response.status_code == 200

    async def test_login_returns_token(self, test_app, mock_auth_service):
        """로그인 성공 시 access_token과 token_type을 반환해야 한다"""
        from app.api.v1.auth import get_auth_service
        from app.schemas.auth import TokenResponse

        mock_auth_service.login.return_value = TokenResponse(
            access_token="some.jwt.token",
            token_type="bearer",
        )

        test_app.dependency_overrides[get_auth_service] = lambda: mock_auth_service

        async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as client:
            response = await client.post(
                "/api/v1/auth/login",
                json={"email": "user@example.com", "password": "password123"},
            )

        test_app.dependency_overrides.clear()
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"


class TestAuthAPIMe:
    """GET /auth/me 엔드포인트 테스트"""

    async def test_me_without_token_returns_401(self, test_app):
        """토큰 없이 /me 요청 시 401을 반환해야 한다"""
        from app.api.deps import get_current_user

        # get_current_user를 401을 반환하는 mock으로 대체
        async def raise_401():
            from fastapi import HTTPException

            raise HTTPException(status_code=401, detail="인증이 필요합니다.")

        test_app.dependency_overrides[get_current_user] = raise_401

        async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as client:
            response = await client.get("/api/v1/auth/me")

        test_app.dependency_overrides.clear()
        assert response.status_code == 401

    async def test_me_with_valid_token_returns_200(self, test_app, mock_auth_service):
        """유효한 토큰으로 /me 요청 시 200을 반환해야 한다"""
        from app.api.deps import get_current_user
        from app.api.v1.auth import get_auth_service
        from app.schemas.auth import UserResponse

        user_id = uuid.uuid4()
        mock_user = UserResponse(
            id=user_id,
            email="user@example.com",
            full_name="사용자",
            is_active=True,
        )

        # get_current_user를 mock user 반환하는 의존성으로 대체
        async def mock_current_user():
            return mock_user

        test_app.dependency_overrides[get_current_user] = mock_current_user
        test_app.dependency_overrides[get_auth_service] = lambda: mock_auth_service

        async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as client:
            response = await client.get(
                "/api/v1/auth/me",
                headers={"Authorization": "Bearer some.jwt.token"},
            )

        test_app.dependency_overrides.clear()
        assert response.status_code == 200
        data = response.json()
        assert data["email"] == "user@example.com"
