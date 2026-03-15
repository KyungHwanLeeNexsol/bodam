"""네이버 OAuth2 프로바이더 구현 (SPEC-OAUTH-001 TAG-005)

네이버 로그인 API 연동:
- authorize_url: https://nid.naver.com/oauth2.0/authorize
- token_url: https://nid.naver.com/oauth2.0/token
- userinfo_url: https://openapi.naver.com/v1/nid/me
- 사용자 정보 응답이 response 객체로 감싸져 있음
- 이메일 필수 동의 (ACC-06)
"""

from __future__ import annotations

from urllib.parse import urlencode

import httpx

from app.providers.base import OAuthProvider
from app.schemas.oauth import OAuthToken, OAuthUserInfo


class NaverOAuthProvider(OAuthProvider):
    """네이버 OAuth2 프로바이더

    네이버 로그인 API 기반.
    사용자 정보는 response 키로 감싸진 중첩 구조.
    토큰 교환은 GET 방식(query string) 사용.
    """

    provider_name = "naver"

    # 네이버 인증 엔드포인트
    authorize_url = "https://nid.naver.com/oauth2.0/authorize"
    token_url = "https://nid.naver.com/oauth2.0/token"
    userinfo_url = "https://openapi.naver.com/v1/nid/me"

    # 네이버는 스코프를 별도로 지정하지 않음
    scopes: list[str] = []

    def __init__(self, settings: Settings) -> None:
        """네이버 프로바이더 초기화

        Args:
            settings: 애플리케이션 설정 (naver_client_id 등 포함)
        """
        self.client_id = settings.naver_client_id
        self.client_secret = settings.naver_client_secret
        self._redirect_uri = settings.naver_redirect_uri

    def get_authorize_url(self, state: str, redirect_uri: str) -> str:
        """네이버 인증 페이지 URL 생성 (ACC-05)

        Args:
            state: CSRF 방지용 랜덤 state 값
            redirect_uri: 콜백 URI

        Returns:
            네이버 인증 페이지 URL
        """
        params = {
            "client_id": self.client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "state": state,
        }
        return f"{self.authorize_url}?{urlencode(params)}"

    async def exchange_code(self, code: str, redirect_uri: str) -> OAuthToken:
        """네이버 인가 코드로 액세스 토큰 교환 (ACC-06)

        네이버는 GET 방식으로 토큰 교환 요청.

        Args:
            code: 콜백에서 받은 인가 코드
            redirect_uri: 최초 요청과 동일한 콜백 URI

        Returns:
            OAuthToken
        """
        params = {
            "grant_type": "authorization_code",
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "redirect_uri": redirect_uri,
            "code": code,
        }

        async with httpx.AsyncClient() as client:
            response = await client.get(self.token_url, params=params)
            response.raise_for_status()
            token_data = response.json()

        return OAuthToken(
            access_token=token_data["access_token"],
            refresh_token=token_data.get("refresh_token"),
            token_type=token_data.get("token_type", "bearer"),
            expires_in=int(token_data["expires_in"]) if token_data.get("expires_in") else None,
        )

    async def get_user_info(self, access_token: str) -> OAuthUserInfo:
        """네이버 사용자 정보 조회 (ACC-06)

        네이버 API 응답 구조:
        {
          "resultcode": "00",
          "message": "success",
          "response": {
            "id": "...",
            "email": "...",
            "name": "...",
            "profile_image": "..."
          }
        }

        Args:
            access_token: 네이버 액세스 토큰

        Returns:
            OAuthUserInfo
        """
        async with httpx.AsyncClient() as client:
            response = await client.get(
                self.userinfo_url,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            response.raise_for_status()
            data = response.json()

        # 네이버는 response 키 안에 실제 사용자 정보가 있음
        user_data = data.get("response", {})

        return OAuthUserInfo(
            provider=self.provider_name,
            provider_user_id=user_data["id"],
            email=user_data.get("email"),
            name=user_data.get("name"),
            profile_image=user_data.get("profile_image"),
        )


from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.core.config import Settings
