"""카카오 OAuth2 프로바이더 구현 (SPEC-OAUTH-001 TAG-004)

카카오 로그인 API 연동:
- authorize_url: https://kauth.kakao.com/oauth/authorize
- token_url: https://kauth.kakao.com/oauth/token
- userinfo_url: https://kapi.kakao.com/v2/user/me
- 이메일 선택 동의 -> None 허용 (ACC-03)
- 사용자 ID는 정수형 -> str 변환
"""

from __future__ import annotations

from urllib.parse import urlencode

import httpx

from app.providers.base import OAuthProvider
from app.schemas.oauth import OAuthToken, OAuthUserInfo


class KakaoOAuthProvider(OAuthProvider):
    """카카오 OAuth2 프로바이더

    카카오 인증 API v2 기반.
    이메일은 사용자 선택 동의 항목이라 None이 될 수 있음.
    토큰 교환 요청은 Content-Type: application/x-www-form-urlencoded 사용.
    """

    provider_name = "kakao"

    # 카카오 인증 엔드포인트
    authorize_url = "https://kauth.kakao.com/oauth/authorize"
    token_url = "https://kauth.kakao.com/oauth/token"
    userinfo_url = "https://kapi.kakao.com/v2/user/me"

    # 요청 스코프 (이메일은 선택 동의)
    scopes = ["profile_nickname", "account_email"]

    def __init__(self, settings: Settings) -> None:
        """카카오 프로바이더 초기화

        Args:
            settings: 애플리케이션 설정 (kakao_client_id 등 포함)
        """
        self.client_id = settings.kakao_client_id
        self.client_secret = settings.kakao_client_secret
        self._redirect_uri = settings.kakao_redirect_uri

    def get_authorize_url(self, state: str, redirect_uri: str) -> str:
        """카카오 인증 페이지 URL 생성 (ACC-01)

        Args:
            state: CSRF 방지용 랜덤 state 값
            redirect_uri: 콜백 URI

        Returns:
            카카오 인증 페이지 URL
        """
        params = {
            "client_id": self.client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "state": state,
            "scope": " ".join(self.scopes),
        }
        return f"{self.authorize_url}?{urlencode(params)}"

    async def exchange_code(self, code: str, redirect_uri: str) -> OAuthToken:
        """카카오 인가 코드로 액세스 토큰 교환 (ACC-02)

        카카오는 POST + application/x-www-form-urlencoded 형식 사용.

        Args:
            code: 콜백에서 받은 인가 코드
            redirect_uri: 최초 요청과 동일한 콜백 URI

        Returns:
            OAuthToken
        """
        data = {
            "grant_type": "authorization_code",
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "redirect_uri": redirect_uri,
            "code": code,
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                self.token_url,
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            if response.status_code != 200:
                import logging
                logging.getLogger(__name__).error(
                    "카카오 토큰 교환 실패: status=%s body=%s redirect_uri=%s",
                    response.status_code,
                    response.text,
                    redirect_uri,
                )
            response.raise_for_status()
            token_data = response.json()

        return OAuthToken(
            access_token=token_data["access_token"],
            refresh_token=token_data.get("refresh_token"),
            token_type=token_data.get("token_type", "bearer"),
            expires_in=token_data.get("expires_in"),
        )

    async def get_user_info(self, access_token: str) -> OAuthUserInfo:
        """카카오 사용자 정보 조회 (ACC-02, ACC-03)

        이메일은 kakao_account.email에서 가져오며,
        이메일 동의를 하지 않은 경우 None 반환.

        Args:
            access_token: 카카오 액세스 토큰

        Returns:
            OAuthUserInfo (email은 None 가능)
        """
        async with httpx.AsyncClient() as client:
            response = await client.get(
                self.userinfo_url,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            response.raise_for_status()
            data = response.json()

        kakao_account = data.get("kakao_account", {})
        profile = kakao_account.get("profile", {})

        # 이메일은 선택 동의 항목 - email_needs_agreement가 True면 None
        email: str | None = None
        if not kakao_account.get("email_needs_agreement", True):
            email = kakao_account.get("email")

        return OAuthUserInfo(
            provider=self.provider_name,
            # 카카오 ID는 정수형이므로 str 변환
            provider_user_id=str(data["id"]),
            email=email,
            name=profile.get("nickname"),
            profile_image=profile.get("profile_image_url"),
        )


from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.core.config import Settings
