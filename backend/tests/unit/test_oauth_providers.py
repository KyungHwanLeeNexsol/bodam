"""OAuth2 프로바이더 단위 테스트 (TAG-004~006 RED)

SPEC-OAUTH-001:
- ACC-01: 카카오 인증 URL 생성
- ACC-02: 카카오 콜백 처리
- ACC-03: 카카오 이메일 미동의 처리
- ACC-05: 네이버 인증 URL 생성
- ACC-06: 네이버 콜백 처리
- ACC-08: 구글 인증 URL 생성
- ACC-09: 구글 콜백 처리
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.schemas.oauth import OAuthToken, OAuthUserInfo


# ─────────────────────────────────────────────
# 공통 픽스처
# ─────────────────────────────────────────────

@pytest.fixture
def mock_settings():
    """테스트용 Settings 모의 객체"""
    settings = MagicMock()
    settings.kakao_client_id = "kakao_test_client_id"
    settings.kakao_client_secret = "kakao_test_secret"
    settings.kakao_redirect_uri = "http://localhost:8000/api/v1/auth/oauth/kakao/callback"
    settings.naver_client_id = "naver_test_client_id"
    settings.naver_client_secret = "naver_test_secret"
    settings.naver_redirect_uri = "http://localhost:8000/api/v1/auth/oauth/naver/callback"
    settings.google_client_id = "google_test_client_id"
    settings.google_client_secret = "google_test_secret"
    settings.google_redirect_uri = "http://localhost:8000/api/v1/auth/oauth/google/callback"
    return settings


# ─────────────────────────────────────────────
# 카카오 프로바이더 테스트 (TAG-004)
# ─────────────────────────────────────────────

class TestKakaoOAuthProvider:
    """카카오 OAuth2 프로바이더 테스트"""

    def test_kakao_provider_name(self, mock_settings):
        """카카오 프로바이더 이름 확인"""
        from app.providers.kakao import KakaoOAuthProvider
        provider = KakaoOAuthProvider(settings=mock_settings)
        assert provider.provider_name == "kakao"

    def test_kakao_authorize_url_contains_client_id(self, mock_settings):
        """인증 URL에 client_id가 포함되어 있는지 확인 (ACC-01)"""
        from app.providers.kakao import KakaoOAuthProvider
        provider = KakaoOAuthProvider(settings=mock_settings)
        url = provider.get_authorize_url(state="test_state", redirect_uri=mock_settings.kakao_redirect_uri)
        assert "kakao_test_client_id" in url
        assert "kauth.kakao.com" in url

    def test_kakao_authorize_url_contains_state(self, mock_settings):
        """인증 URL에 state 값이 포함되어 있는지 확인 (CSRF 방지, ACC-22)"""
        from app.providers.kakao import KakaoOAuthProvider
        provider = KakaoOAuthProvider(settings=mock_settings)
        url = provider.get_authorize_url(state="my_state_123", redirect_uri=mock_settings.kakao_redirect_uri)
        assert "my_state_123" in url

    async def test_kakao_exchange_code_returns_token(self, mock_settings):
        """인가 코드로 토큰 교환 성공 확인 (ACC-02)"""
        from app.providers.kakao import KakaoOAuthProvider
        provider = KakaoOAuthProvider(settings=mock_settings)

        # 카카오 토큰 응답 모의
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "access_token": "kakao_access_token_123",
            "refresh_token": "kakao_refresh_token_123",
            "token_type": "bearer",
            "expires_in": 21599,
        }
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            token = await provider.exchange_code(
                code="test_code",
                redirect_uri=mock_settings.kakao_redirect_uri,
            )

        assert isinstance(token, OAuthToken)
        assert token.access_token == "kakao_access_token_123"

    async def test_kakao_get_user_info_with_email(self, mock_settings):
        """이메일 동의한 카카오 사용자 정보 조회 (ACC-02)"""
        from app.providers.kakao import KakaoOAuthProvider
        provider = KakaoOAuthProvider(settings=mock_settings)

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "id": 12345678,
            "kakao_account": {
                "email": "user@kakao.com",
                "email_needs_agreement": False,
                "profile": {
                    "nickname": "카카오유저",
                },
            },
        }
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            user_info = await provider.get_user_info("kakao_access_token")

        assert isinstance(user_info, OAuthUserInfo)
        assert user_info.provider == "kakao"
        assert user_info.provider_user_id == "12345678"
        assert user_info.email == "user@kakao.com"

    async def test_kakao_get_user_info_without_email(self, mock_settings):
        """이메일 미동의 카카오 사용자 정보 조회 - email None (ACC-03)"""
        from app.providers.kakao import KakaoOAuthProvider
        provider = KakaoOAuthProvider(settings=mock_settings)

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "id": 87654321,
            "kakao_account": {
                "email_needs_agreement": True,
                "profile": {
                    "nickname": "이메일미동의",
                },
            },
        }
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            user_info = await provider.get_user_info("kakao_access_token")

        assert user_info.email is None
        assert user_info.provider_user_id == "87654321"


# ─────────────────────────────────────────────
# 네이버 프로바이더 테스트 (TAG-005)
# ─────────────────────────────────────────────

class TestNaverOAuthProvider:
    """네이버 OAuth2 프로바이더 테스트"""

    def test_naver_provider_name(self, mock_settings):
        """네이버 프로바이더 이름 확인"""
        from app.providers.naver import NaverOAuthProvider
        provider = NaverOAuthProvider(settings=mock_settings)
        assert provider.provider_name == "naver"

    def test_naver_authorize_url_contains_client_id(self, mock_settings):
        """인증 URL에 client_id가 포함되어 있는지 확인 (ACC-05)"""
        from app.providers.naver import NaverOAuthProvider
        provider = NaverOAuthProvider(settings=mock_settings)
        url = provider.get_authorize_url(state="test_state", redirect_uri=mock_settings.naver_redirect_uri)
        assert "naver_test_client_id" in url
        assert "nid.naver.com" in url

    async def test_naver_exchange_code_returns_token(self, mock_settings):
        """네이버 인가 코드로 토큰 교환 성공 (ACC-06)"""
        from app.providers.naver import NaverOAuthProvider
        provider = NaverOAuthProvider(settings=mock_settings)

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "access_token": "naver_access_token_123",
            "refresh_token": "naver_refresh_token_123",
            "token_type": "bearer",
            "expires_in": "3600",
        }
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            token = await provider.exchange_code(
                code="naver_code",
                redirect_uri=mock_settings.naver_redirect_uri,
            )

        assert isinstance(token, OAuthToken)
        assert token.access_token == "naver_access_token_123"

    async def test_naver_get_user_info(self, mock_settings):
        """네이버 사용자 정보 조회 - response 객체 파싱 (ACC-06)"""
        from app.providers.naver import NaverOAuthProvider
        provider = NaverOAuthProvider(settings=mock_settings)

        mock_response = MagicMock()
        # 네이버는 사용자 정보가 response 객체로 감싸져 있음
        mock_response.json.return_value = {
            "resultcode": "00",
            "message": "success",
            "response": {
                "id": "naver_user_001",
                "email": "user@naver.com",
                "name": "네이버유저",
                "profile_image": "https://profile.naver.com/img.jpg",
            },
        }
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            user_info = await provider.get_user_info("naver_access_token")

        assert user_info.provider == "naver"
        assert user_info.provider_user_id == "naver_user_001"
        assert user_info.email == "user@naver.com"


# ─────────────────────────────────────────────
# 구글 프로바이더 테스트 (TAG-006)
# ─────────────────────────────────────────────

class TestGoogleOAuthProvider:
    """구글 OAuth2 프로바이더 테스트"""

    def test_google_provider_name(self, mock_settings):
        """구글 프로바이더 이름 확인"""
        from app.providers.google import GoogleOAuthProvider
        provider = GoogleOAuthProvider(settings=mock_settings)
        assert provider.provider_name == "google"

    def test_google_authorize_url_contains_client_id(self, mock_settings):
        """인증 URL에 client_id가 포함되어 있는지 확인 (ACC-08)"""
        from app.providers.google import GoogleOAuthProvider
        provider = GoogleOAuthProvider(settings=mock_settings)
        url = provider.get_authorize_url(state="test_state", redirect_uri=mock_settings.google_redirect_uri)
        assert "google_test_client_id" in url
        assert "accounts.google.com" in url

    def test_google_authorize_url_has_openid_scope(self, mock_settings):
        """구글 인증 URL에 openid 스코프 포함 확인"""
        from app.providers.google import GoogleOAuthProvider
        provider = GoogleOAuthProvider(settings=mock_settings)
        url = provider.get_authorize_url(state="test_state", redirect_uri=mock_settings.google_redirect_uri)
        assert "openid" in url

    async def test_google_exchange_code_returns_token(self, mock_settings):
        """구글 인가 코드로 토큰 교환 성공 (ACC-09)"""
        from app.providers.google import GoogleOAuthProvider
        provider = GoogleOAuthProvider(settings=mock_settings)

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "access_token": "google_access_token_123",
            "token_type": "Bearer",
            "expires_in": 3599,
            "refresh_token": "google_refresh_token",
        }
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            token = await provider.exchange_code(
                code="google_code",
                redirect_uri=mock_settings.google_redirect_uri,
            )

        assert isinstance(token, OAuthToken)
        assert token.access_token == "google_access_token_123"

    async def test_google_get_user_info(self, mock_settings):
        """구글 사용자 정보 조회 (ACC-09)"""
        from app.providers.google import GoogleOAuthProvider
        provider = GoogleOAuthProvider(settings=mock_settings)

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "id": "google_user_001",
            "email": "user@gmail.com",
            "name": "구글유저",
            "picture": "https://lh3.googleusercontent.com/photo.jpg",
            "verified_email": True,
        }
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            user_info = await provider.get_user_info("google_access_token")

        assert user_info.provider == "google"
        assert user_info.provider_user_id == "google_user_001"
        assert user_info.email == "user@gmail.com"


# ─────────────────────────────────────────────
# 프로바이더 팩토리 테스트
# ─────────────────────────────────────────────

class TestProviderFactory:
    """get_provider 팩토리 함수 테스트"""

    def test_get_kakao_provider(self, mock_settings):
        """카카오 프로바이더 팩토리 반환"""
        from app.providers import get_provider
        from app.providers.kakao import KakaoOAuthProvider
        provider = get_provider("kakao", mock_settings)
        assert isinstance(provider, KakaoOAuthProvider)

    def test_get_naver_provider(self, mock_settings):
        """네이버 프로바이더 팩토리 반환"""
        from app.providers import get_provider
        from app.providers.naver import NaverOAuthProvider
        provider = get_provider("naver", mock_settings)
        assert isinstance(provider, NaverOAuthProvider)

    def test_get_google_provider(self, mock_settings):
        """구글 프로바이더 팩토리 반환"""
        from app.providers import get_provider
        from app.providers.google import GoogleOAuthProvider
        provider = get_provider("google", mock_settings)
        assert isinstance(provider, GoogleOAuthProvider)

    def test_get_unknown_provider_raises_value_error(self, mock_settings):
        """지원하지 않는 프로바이더 요청 시 ValueError"""
        from app.providers import get_provider
        with pytest.raises(ValueError, match="지원하지 않는"):
            get_provider("twitter", mock_settings)
