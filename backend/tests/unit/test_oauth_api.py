"""OAuth2 API 라우터 단위 테스트 (SPEC-OAUTH-001 TAG-008)

엔드포인트 존재 여부, 프로바이더 검증, 의존성 주입 확인.
"""

from __future__ import annotations

import pytest


class TestOAuthApiRouterRegistration:
    """OAuth 라우터가 main.py에 등록되었는지 확인"""

    def test_oauth_router_imported_in_main(self):
        """main.py에서 oauth_router가 임포트되는지 확인"""
        from app.main import app

        # FastAPI app 라우터 중 /auth/oauth 패턴이 존재하는지 확인
        routes = [route.path for route in app.routes if hasattr(route, "path")]
        oauth_routes = [r for r in routes if "/oauth/" in r or "/social-accounts" in r]
        assert len(oauth_routes) > 0, "OAuth 라우터가 등록되지 않았습니다"

    def test_authorize_endpoint_exists(self):
        """GET /api/v1/auth/oauth/{provider}/authorize 엔드포인트 존재"""
        from app.main import app

        routes = [route.path for route in app.routes if hasattr(route, "path")]
        assert any("/auth/oauth/{provider}/authorize" in r for r in routes)

    def test_callback_endpoint_exists(self):
        """GET /api/v1/auth/oauth/{provider}/callback 엔드포인트 존재"""
        from app.main import app

        routes = [route.path for route in app.routes if hasattr(route, "path")]
        assert any("/auth/oauth/{provider}/callback" in r for r in routes)

    def test_merge_endpoint_exists(self):
        """POST /api/v1/auth/oauth/merge 엔드포인트 존재"""
        from app.main import app

        routes = [route.path for route in app.routes if hasattr(route, "path")]
        assert any("/auth/oauth/merge" in r for r in routes)

    def test_social_accounts_list_endpoint_exists(self):
        """GET /api/v1/auth/social-accounts 엔드포인트 존재"""
        from app.main import app

        routes = [route.path for route in app.routes if hasattr(route, "path")]
        assert any("/auth/social-accounts" in r for r in routes)

    def test_social_accounts_delete_endpoint_exists(self):
        """DELETE /api/v1/auth/social-accounts/{provider} 엔드포인트 존재"""
        from app.main import app

        routes = [route.path for route in app.routes if hasattr(route, "path")]
        assert any("/auth/social-accounts/{provider}" in r for r in routes)


class TestProviderValidation:
    """프로바이더 유효성 검증 테스트"""

    def test_supported_providers_include_kakao(self):
        """카카오가 지원 프로바이더에 포함"""
        from app.api.v1.oauth import SUPPORTED_PROVIDERS
        assert "kakao" in SUPPORTED_PROVIDERS

    def test_supported_providers_include_naver(self):
        """네이버가 지원 프로바이더에 포함"""
        from app.api.v1.oauth import SUPPORTED_PROVIDERS
        assert "naver" in SUPPORTED_PROVIDERS

    def test_supported_providers_include_google(self):
        """구글이 지원 프로바이더에 포함"""
        from app.api.v1.oauth import SUPPORTED_PROVIDERS
        assert "google" in SUPPORTED_PROVIDERS

    def test_unsupported_provider_raises_400(self):
        """지원하지 않는 프로바이더에 400 에러"""
        from fastapi import HTTPException

        from app.api.v1.oauth import _validate_provider

        with pytest.raises(HTTPException) as exc_info:
            _validate_provider("apple")
        assert exc_info.value.status_code == 400

    def test_valid_provider_does_not_raise(self):
        """유효한 프로바이더는 에러 없이 통과"""
        from app.api.v1.oauth import _validate_provider

        # 예외 발생하지 않으면 성공
        _validate_provider("kakao")
        _validate_provider("naver")
        _validate_provider("google")


class TestOAuthDependencies:
    """OAuth 의존성 주입 함수 테스트"""

    def test_get_oauth_service_function_exists(self):
        """get_oauth_service 함수가 존재"""
        from app.api.v1.oauth import get_oauth_service
        assert callable(get_oauth_service)

    def test_get_redis_client_function_exists(self):
        """get_redis_client 함수가 존재"""
        from app.api.v1.oauth import get_redis_client
        assert callable(get_redis_client)
