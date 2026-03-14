"""인가 경계 통합 테스트 (SPEC-SEC-001 M5 TAG-4)

인가 경계 및 사용자 데이터 격리 검증.
FastAPI dependency_overrides를 활용하여 DB 없이 동작.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient


def _make_mock_db_override(return_value=None):
    """get_db를 대체하는 mock DB 세션 의존성"""
    mock_db = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none = MagicMock(return_value=return_value)
    scalars_result = MagicMock()
    scalars_result.all = MagicMock(return_value=[])
    execute_result.scalars = MagicMock(return_value=scalars_result)
    mock_db.execute = AsyncMock(return_value=execute_result)
    mock_db.add = MagicMock()
    mock_db.flush = AsyncMock()
    mock_db.delete = AsyncMock()
    mock_db.commit = AsyncMock()

    async def override():
        yield mock_db

    return override


def _make_mock_user(user_id: uuid.UUID | None = None) -> MagicMock:
    """테스트용 User mock 객체"""
    user = MagicMock()
    user.id = user_id or uuid.uuid4()
    user.email = "user@example.com"
    user.full_name = "사용자"
    user.is_active = True
    user.hashed_password = "hashed"
    return user


def _make_app_with_users() -> FastAPI:
    """users 라우터가 포함된 테스트용 앱"""
    from app.api.v1.users import router as users_router

    app = FastAPI()
    app.include_router(users_router, prefix="/api/v1")
    return app


def _make_app_with_auth_and_users() -> FastAPI:
    """auth + users 라우터가 포함된 테스트용 앱"""
    from app.api.v1.auth import router as auth_router
    from app.api.v1.users import router as users_router

    app = FastAPI()
    app.include_router(auth_router, prefix="/api/v1")
    app.include_router(users_router, prefix="/api/v1")
    return app


class TestUnauthenticatedProtectedEndpointAccess:
    """인증 보호 엔드포인트 미인증 접근 테스트"""

    @pytest.mark.asyncio
    async def test_unauthenticated_get_user_data_returns_401(self):
        """미인증 상태에서 /users/me/data 접근 시 401을 반환해야 한다"""
        from app.api.deps import get_current_user
        from app.core.database import get_db

        app = _make_app_with_users()

        async def raise_401():
            raise HTTPException(status_code=401, detail="인증이 필요합니다.")

        app.dependency_overrides[get_current_user] = raise_401
        app.dependency_overrides[get_db] = _make_mock_db_override()

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/users/me/data")

        app.dependency_overrides.clear()
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_unauthenticated_delete_account_returns_401(self):
        """미인증 상태에서 계정 삭제 시도 시 401을 반환해야 한다"""
        from app.api.deps import get_current_user
        from app.core.database import get_db

        app = _make_app_with_users()

        async def raise_401():
            raise HTTPException(status_code=401, detail="인증이 필요합니다.")

        app.dependency_overrides[get_current_user] = raise_401
        app.dependency_overrides[get_db] = _make_mock_db_override()

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.request(
                "DELETE",
                "/api/v1/users/me",
                json={"password": "password"},
            )

        app.dependency_overrides.clear()
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_unauthenticated_auth_me_returns_401(self):
        """미인증 상태에서 /auth/me 접근 시 401을 반환해야 한다"""
        from app.api.deps import get_current_user
        from app.core.database import get_db

        app = _make_app_with_auth_and_users()

        async def raise_401():
            raise HTTPException(status_code=401, detail="인증이 필요합니다.")

        app.dependency_overrides[get_current_user] = raise_401
        app.dependency_overrides[get_db] = _make_mock_db_override()

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/auth/me")

        app.dependency_overrides.clear()
        assert response.status_code == 401


class TestCrossUserDataIsolation:
    """사용자 간 데이터 격리 테스트"""

    @pytest.mark.asyncio
    async def test_delete_me_only_deletes_current_user(self):
        """DELETE /users/me는 현재 인증 사용자의 계정만 삭제해야 한다"""
        from app.api.deps import get_current_user
        from app.api.v1.users import get_privacy_service
        from app.core.security import hash_password

        app = _make_app_with_users()

        # 인증된 사용자 A
        user_a = _make_mock_user()
        user_a.hashed_password = hash_password("correct_password")
        app.dependency_overrides[get_current_user] = lambda: user_a

        mock_privacy_service = AsyncMock()
        app.dependency_overrides[get_privacy_service] = lambda: mock_privacy_service

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.request(
                "DELETE",
                "/api/v1/users/me",
                json={"password": "correct_password"},
                headers={"Authorization": "Bearer token"},
            )

        app.dependency_overrides.clear()
        assert response.status_code == 200
        # 사용자 A 본인의 데이터만 삭제됨
        mock_privacy_service.delete_user_data.assert_called_once_with(user_a)

    @pytest.mark.asyncio
    async def test_export_data_only_returns_current_user_data(self):
        """GET /users/me/data는 현재 인증 사용자의 데이터만 반환해야 한다"""
        from app.api.deps import get_current_user
        from app.api.v1.users import get_privacy_service

        app = _make_app_with_users()

        user_a = _make_mock_user()
        app.dependency_overrides[get_current_user] = lambda: user_a

        mock_privacy_service = AsyncMock()
        mock_privacy_service.export_user_data.return_value = {
            "user": {"id": str(user_a.id), "email": "user@example.com"},
            "conversations": [],
            "policies": [],
            "activity_log": [],
        }
        app.dependency_overrides[get_privacy_service] = lambda: mock_privacy_service

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get(
                "/api/v1/users/me/data",
                headers={"Authorization": "Bearer token"},
            )

        app.dependency_overrides.clear()
        assert response.status_code == 200
        # 사용자 A 본인의 데이터로 export 호출됨
        mock_privacy_service.export_user_data.assert_called_once_with(user_a)

    @pytest.mark.asyncio
    async def test_wrong_password_prevents_account_deletion(self):
        """잘못된 비밀번호로는 계정을 삭제할 수 없어야 한다"""
        from app.api.deps import get_current_user
        from app.api.v1.users import get_privacy_service
        from app.core.security import hash_password

        app = _make_app_with_users()

        user_a = _make_mock_user()
        user_a.hashed_password = hash_password("correct_password")
        app.dependency_overrides[get_current_user] = lambda: user_a

        mock_privacy_service = AsyncMock()
        app.dependency_overrides[get_privacy_service] = lambda: mock_privacy_service

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.request(
                "DELETE",
                "/api/v1/users/me",
                json={"password": "wrong_password"},
                headers={"Authorization": "Bearer token"},
            )

        app.dependency_overrides.clear()
        assert response.status_code == 401
        # delete_user_data는 호출되지 않음 (비밀번호 검증 실패)
        mock_privacy_service.delete_user_data.assert_not_called()
