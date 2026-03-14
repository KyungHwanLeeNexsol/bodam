"""사용자 PIPA 엔드포인트 단위 테스트 (SPEC-SEC-001 TAG-1)

RED phase: 사용자 계정 삭제 및 데이터 내보내기 엔드포인트 구현 전 실패하는 테스트.
DELETE /users/me, GET /users/me/data 엔드포인트를 검증.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient


@pytest.fixture
def test_app():
    """테스트용 FastAPI 앱 (users 라우터만 포함)"""
    from app.api.v1.users import router

    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    return app


@pytest.fixture
def mock_privacy_service():
    """mock PrivacyService"""
    service = AsyncMock()
    return service


@pytest.fixture
def mock_user():
    """테스트용 User mock 객체"""
    user = MagicMock()
    user.id = uuid.uuid4()
    user.email = "test@example.com"
    user.full_name = "테스트 사용자"
    user.hashed_password = "hashed_password_value"
    user.is_active = True
    user.created_at = datetime.now(UTC)
    return user


class TestUsersRouterStructure:
    """Users 라우터 구조 테스트"""

    def test_users_router_importable(self):
        """users 라우터가 임포트 가능해야 한다"""
        from app.api.v1.users import router

        assert router is not None

    def test_users_router_has_delete_me_route(self):
        """users 라우터는 DELETE /users/me 라우트를 가져야 한다"""
        from app.api.v1.users import router

        methods_and_paths = [(r.path, list(r.methods)) for r in router.routes if hasattr(r, "methods")]
        delete_routes = [(path, methods) for path, methods in methods_and_paths if "DELETE" in methods]
        assert any("/users/me" in path for path, _ in delete_routes)

    def test_users_router_has_get_data_route(self):
        """users 라우터는 GET /users/me/data 라우트를 가져야 한다"""
        from app.api.v1.users import router

        paths = [r.path for r in router.routes]
        assert "/users/me/data" in paths


class TestDeleteAccountEndpoint:
    """DELETE /users/me 계정 삭제 엔드포인트 테스트"""

    @pytest.mark.asyncio
    async def test_delete_me_without_token_returns_401(self, test_app):
        """토큰 없이 계정 삭제 요청 시 401을 반환해야 한다"""
        from app.api.deps import get_current_user

        async def raise_401():
            from fastapi import HTTPException

            raise HTTPException(status_code=401, detail="인증이 필요합니다.")

        test_app.dependency_overrides[get_current_user] = raise_401

        async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as client:
            response = await client.request(
                "DELETE",
                "/api/v1/users/me",
                json={"password": "somepassword"},
            )

        test_app.dependency_overrides.clear()
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_delete_me_with_wrong_password_returns_401(self, test_app, mock_user, mock_privacy_service):
        """잘못된 비밀번호로 계정 삭제 요청 시 401을 반환해야 한다"""
        from app.api.deps import get_current_user
        from app.api.v1.users import get_privacy_service

        # 비밀번호 불일치 시나리오: hashed_password와 다른 값
        mock_user.hashed_password = "correct_hashed"

        test_app.dependency_overrides[get_current_user] = lambda: mock_user
        test_app.dependency_overrides[get_privacy_service] = lambda: mock_privacy_service

        async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as client:
            response = await client.request(
                "DELETE",
                "/api/v1/users/me",
                json={"password": "wrong_password"},
                headers={"Authorization": "Bearer some.jwt.token"},
            )

        test_app.dependency_overrides.clear()
        assert response.status_code == 401
        data = response.json()
        assert "비밀번호" in data["detail"]

    @pytest.mark.asyncio
    async def test_delete_me_with_correct_password_returns_200(self, test_app, mock_user, mock_privacy_service):
        """올바른 비밀번호로 계정 삭제 요청 시 200을 반환해야 한다"""
        from app.api.deps import get_current_user
        from app.api.v1.users import get_privacy_service
        from app.core.security import hash_password

        # 실제 bcrypt 해시로 설정 (verify_password 통과용)
        mock_user.hashed_password = hash_password("correct_password")

        test_app.dependency_overrides[get_current_user] = lambda: mock_user
        test_app.dependency_overrides[get_privacy_service] = lambda: mock_privacy_service

        async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as client:
            response = await client.request(
                "DELETE",
                "/api/v1/users/me",
                json={"password": "correct_password"},
                headers={"Authorization": "Bearer some.jwt.token"},
            )

        test_app.dependency_overrides.clear()
        assert response.status_code == 200
        data = response.json()
        assert "계정이 삭제되었습니다" in data["message"]
        assert "deleted_at" in data

    @pytest.mark.asyncio
    async def test_delete_me_calls_privacy_service(self, test_app, mock_user, mock_privacy_service):
        """계정 삭제 시 PrivacyService.delete_user_data가 호출되어야 한다"""
        from app.api.deps import get_current_user
        from app.api.v1.users import get_privacy_service
        from app.core.security import hash_password

        mock_user.hashed_password = hash_password("correct_password")

        test_app.dependency_overrides[get_current_user] = lambda: mock_user
        test_app.dependency_overrides[get_privacy_service] = lambda: mock_privacy_service

        async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as client:
            await client.request(
                "DELETE",
                "/api/v1/users/me",
                json={"password": "correct_password"},
                headers={"Authorization": "Bearer some.jwt.token"},
            )

        test_app.dependency_overrides.clear()
        mock_privacy_service.delete_user_data.assert_called_once_with(mock_user)


class TestExportUserDataEndpoint:
    """GET /users/me/data 데이터 내보내기 엔드포인트 테스트"""

    @pytest.mark.asyncio
    async def test_export_data_without_token_returns_401(self, test_app):
        """토큰 없이 데이터 내보내기 요청 시 401을 반환해야 한다"""
        from app.api.deps import get_current_user

        async def raise_401():
            from fastapi import HTTPException

            raise HTTPException(status_code=401, detail="인증이 필요합니다.")

        test_app.dependency_overrides[get_current_user] = raise_401

        async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as client:
            response = await client.get("/api/v1/users/me/data")

        test_app.dependency_overrides.clear()
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_export_data_returns_200_with_valid_token(self, test_app, mock_user, mock_privacy_service):
        """유효한 토큰으로 데이터 내보내기 요청 시 200을 반환해야 한다"""
        from app.api.deps import get_current_user
        from app.api.v1.users import get_privacy_service

        mock_privacy_service.export_user_data.return_value = {
            "user": {"id": str(mock_user.id), "email": "test@example.com"},
            "conversations": [],
            "policies": [],
            "activity_log": [],
        }

        test_app.dependency_overrides[get_current_user] = lambda: mock_user
        test_app.dependency_overrides[get_privacy_service] = lambda: mock_privacy_service

        async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as client:
            response = await client.get(
                "/api/v1/users/me/data",
                headers={"Authorization": "Bearer some.jwt.token"},
            )

        test_app.dependency_overrides.clear()
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_export_data_returns_expected_fields(self, test_app, mock_user, mock_privacy_service):
        """데이터 내보내기 응답에 user, conversations, policies, activity_log 필드가 포함되어야 한다"""
        from app.api.deps import get_current_user
        from app.api.v1.users import get_privacy_service

        mock_privacy_service.export_user_data.return_value = {
            "user": {"id": str(mock_user.id), "email": "test@example.com"},
            "conversations": [{"id": "conv-1", "title": "테스트 대화"}],
            "policies": [],
            "activity_log": [],
        }

        test_app.dependency_overrides[get_current_user] = lambda: mock_user
        test_app.dependency_overrides[get_privacy_service] = lambda: mock_privacy_service

        async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as client:
            response = await client.get(
                "/api/v1/users/me/data",
                headers={"Authorization": "Bearer some.jwt.token"},
            )

        test_app.dependency_overrides.clear()
        data = response.json()
        assert "user" in data
        assert "conversations" in data
        assert "policies" in data
        assert "activity_log" in data

    @pytest.mark.asyncio
    async def test_export_data_calls_privacy_service(self, test_app, mock_user, mock_privacy_service):
        """데이터 내보내기 시 PrivacyService.export_user_data가 호출되어야 한다"""
        from app.api.deps import get_current_user
        from app.api.v1.users import get_privacy_service

        mock_privacy_service.export_user_data.return_value = {
            "user": {},
            "conversations": [],
            "policies": [],
            "activity_log": [],
        }

        test_app.dependency_overrides[get_current_user] = lambda: mock_user
        test_app.dependency_overrides[get_privacy_service] = lambda: mock_privacy_service

        async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as client:
            await client.get(
                "/api/v1/users/me/data",
                headers={"Authorization": "Bearer some.jwt.token"},
            )

        test_app.dependency_overrides.clear()
        mock_privacy_service.export_user_data.assert_called_once_with(mock_user)
