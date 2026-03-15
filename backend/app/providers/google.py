"""구글 OAuth2 프로바이더 구현 (SPEC-OAUTH-001 TAG-006)

구글 OAuth2 API 연동:
- authorize_url: https://accounts.google.com/o/oauth2/v2/auth
- token_url: https://oauth2.googleapis.com/token
- userinfo_url: https://www.googleapis.com/oauth2/v2/userinfo
- scope: openid email profile
- 이메일 항상 필수 제공 (ACC-09)
"""

from __future__ import annotations

from urllib.parse import urlencode

import httpx

from app.providers.base import OAuthProvider
from app.schemas.oauth import OAuthToken, OAuthUserInfo


class GoogleOAuthProvider(OAuthProvider):
    """구글 OAuth2 프로바이더

    Google Identity Platform 기반.
    openid scope으로 표준 OIDC 플로우 사용.
    이메일은 항상 제공됨.
    """

    provider_name = "google"

    # 구글 인증 엔드포인트
    authorize_url = "https://accounts.google.com/o/oauth2/v2/auth"
    token_url = "https://oauth2.googleapis.com/token"
    userinfo_url = "https://www.googleapis.com/oauth2/v2/userinfo"

    # openid, email, profile 스코프
    scopes = ["openid", "email", "profile"]

    def __init__(self, settings: Settings) -> None:
        """구글 프로바이더 초기화

        Args:
            settings: 애플리케이션 설정 (google_client_id 등 포함)
        """
        self.client_id = settings.google_client_id
        self.client_secret = settings.google_client_secret
        self._redirect_uri = settings.google_redirect_uri

    def get_authorize_url(self, state: str, redirect_uri: str) -> str:
        """구글 인증 페이지 URL 생성 (ACC-08)

        Args:
            state: CSRF 방지용 랜덤 state 값
            redirect_uri: 콜백 URI

        Returns:
            구글 인증 페이지 URL
        """
        params = {
            "client_id": self.client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": " ".join(self.scopes),
            "state": state,
            "access_type": "offline",
        }
        return f"{self.authorize_url}?{urlencode(params)}"

    async def exchange_code(self, code: str, redirect_uri: str) -> OAuthToken:
        """구글 인가 코드로 액세스 토큰 교환 (ACC-09)

        구글은 POST + JSON 형식 사용.

        Args:
            code: 콜백에서 받은 인가 코드
            redirect_uri: 최초 요청과 동일한 콜백 URI

        Returns:
            OAuthToken
        """
        data = {
            "code": code,
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(self.token_url, json=data)
            response.raise_for_status()
            token_data = response.json()

        return OAuthToken(
            access_token=token_data["access_token"],
            refresh_token=token_data.get("refresh_token"),
            token_type=token_data.get("token_type", "bearer"),
            expires_in=token_data.get("expires_in"),
        )

    async def get_user_info(self, access_token: str) -> OAuthUserInfo:
        """구글 사용자 정보 조회 (ACC-09)

        구글은 이메일을 항상 제공.

        Args:
            access_token: 구글 액세스 토큰

        Returns:
            OAuthUserInfo (email 항상 제공됨)
        """
        async with httpx.AsyncClient() as client:
            response = await client.get(
                self.userinfo_url,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            response.raise_for_status()
            data = response.json()

        return OAuthUserInfo(
            provider=self.provider_name,
            provider_user_id=data["id"],
            email=data.get("email"),
            name=data.get("name"),
            profile_image=data.get("picture"),
        )


from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.core.config import Settings
