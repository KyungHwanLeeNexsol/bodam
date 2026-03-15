"""OAuth 스키마 및 설정 테스트 (TAG-003 RED)

SPEC-OAUTH-001:
- Settings에 OAuth 환경변수 추가 검증 (ACC-04, ACC-07, ACC-10)
- OAuthProvider 베이스 클래스 추상 메서드 확인
- OAuth Pydantic 스키마 검증
"""

from __future__ import annotations

import pytest


class TestOAuthSettings:
    """Settings 클래스 OAuth 환경변수 테스트"""

    def test_settings_has_kakao_client_id(self):
        """Settings에 kakao_client_id가 있는지 확인"""
        from app.core.config import Settings
        assert hasattr(Settings.model_fields, "kakao_client_id") or "kakao_client_id" in Settings.model_fields

    def test_settings_has_kakao_client_secret(self):
        """Settings에 kakao_client_secret가 있는지 확인"""
        from app.core.config import Settings
        assert "kakao_client_secret" in Settings.model_fields

    def test_settings_has_kakao_redirect_uri(self):
        """Settings에 kakao_redirect_uri 기본값이 있는지 확인"""
        from app.core.config import Settings
        assert "kakao_redirect_uri" in Settings.model_fields

    def test_settings_has_naver_client_id(self):
        """Settings에 naver_client_id가 있는지 확인"""
        from app.core.config import Settings
        assert "naver_client_id" in Settings.model_fields

    def test_settings_has_naver_client_secret(self):
        """Settings에 naver_client_secret가 있는지 확인"""
        from app.core.config import Settings
        assert "naver_client_secret" in Settings.model_fields

    def test_settings_has_google_client_id(self):
        """Settings에 google_client_id가 있는지 확인"""
        from app.core.config import Settings
        assert "google_client_id" in Settings.model_fields

    def test_settings_has_google_client_secret(self):
        """Settings에 google_client_secret가 있는지 확인"""
        from app.core.config import Settings
        assert "google_client_secret" in Settings.model_fields

    def test_settings_has_social_token_encryption_key(self):
        """Settings에 social_token_encryption_key가 있는지 확인"""
        from app.core.config import Settings
        assert "social_token_encryption_key" in Settings.model_fields

    def test_settings_oauth_defaults_are_empty_strings(self):
        """OAuth 설정 기본값이 빈 문자열인지 확인"""
        import os
        # 테스트 환경에서 직접 인스턴스 생성 (DATABASE_URL, SECRET_KEY 필요)
        os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost/testdb")
        os.environ.setdefault("SECRET_KEY", "test-secret-key-for-testing-purposes-only")
        from app.core.config import Settings
        s = Settings()
        assert s.kakao_client_id == ""
        assert s.naver_client_id == ""
        assert s.google_client_id == ""

    def test_settings_kakao_redirect_uri_default(self):
        """카카오 리다이렉트 URI 기본값 확인"""
        import os
        os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost/testdb")
        os.environ.setdefault("SECRET_KEY", "test-secret-key-for-testing-purposes-only")
        from app.core.config import Settings
        s = Settings()
        assert "kakao" in s.kakao_redirect_uri


class TestOAuthProviderBase:
    """OAuthProvider 베이스 클래스 추상 메서드 테스트"""

    def test_oauth_provider_base_is_abstract(self):
        """OAuthProvider가 ABC 추상 클래스인지 확인"""
        from app.providers.base import OAuthProvider
        import inspect
        assert inspect.isabstract(OAuthProvider)

    def test_oauth_provider_has_get_authorize_url(self):
        """get_authorize_url 추상 메서드가 있는지 확인"""
        from app.providers.base import OAuthProvider
        assert hasattr(OAuthProvider, "get_authorize_url")

    def test_oauth_provider_has_exchange_code(self):
        """exchange_code 추상 메서드가 있는지 확인"""
        from app.providers.base import OAuthProvider
        assert hasattr(OAuthProvider, "exchange_code")

    def test_oauth_provider_has_get_user_info(self):
        """get_user_info 추상 메서드가 있는지 확인"""
        from app.providers.base import OAuthProvider
        assert hasattr(OAuthProvider, "get_user_info")

    def test_oauth_provider_cannot_be_instantiated(self):
        """추상 클래스라 직접 인스턴스화 불가 확인"""
        from app.providers.base import OAuthProvider
        with pytest.raises(TypeError):
            OAuthProvider()


class TestOAuthSchemas:
    """OAuth Pydantic 스키마 테스트"""

    def test_oauth_user_info_schema(self):
        """OAuthUserInfo 스키마 생성 가능 확인"""
        from app.schemas.oauth import OAuthUserInfo
        info = OAuthUserInfo(
            provider="kakao",
            provider_user_id="12345",
            email="test@kakao.com",
            name="테스트",
        )
        assert info.provider == "kakao"
        assert info.provider_user_id == "12345"

    def test_oauth_user_info_email_optional(self):
        """OAuthUserInfo 이메일이 선택 항목인지 확인"""
        from app.schemas.oauth import OAuthUserInfo
        info = OAuthUserInfo(
            provider="kakao",
            provider_user_id="12345",
        )
        assert info.email is None

    def test_oauth_token_schema(self):
        """OAuthToken 스키마 생성 확인"""
        from app.schemas.oauth import OAuthToken
        token = OAuthToken(access_token="test_token")
        assert token.access_token == "test_token"
        assert token.token_type == "bearer"

    def test_oauth_callback_response_schema(self):
        """OAuthCallbackResponse 스키마 생성 확인"""
        from app.schemas.oauth import OAuthCallbackResponse
        resp = OAuthCallbackResponse(access_token="jwt_token")
        assert resp.access_token == "jwt_token"
        assert resp.is_new_user is False

    def test_oauth_merge_request_schema(self):
        """OAuthMergeRequest 스키마 생성 확인"""
        from app.schemas.oauth import OAuthMergeRequest
        req = OAuthMergeRequest(
            provider="kakao",
            merge_token="merge_token_123",
            password="MyP@ssw0rd!",
        )
        assert req.provider == "kakao"

    def test_social_account_response_schema(self):
        """SocialAccountResponse 스키마 생성 확인"""
        from datetime import datetime
        from app.schemas.oauth import SocialAccountResponse
        resp = SocialAccountResponse(
            provider="kakao",
            provider_email="test@kakao.com",
            provider_name="카카오 유저",
            connected_at=datetime.now(),
        )
        assert resp.provider == "kakao"
