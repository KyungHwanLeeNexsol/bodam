"""OAuth2 프로바이더 추상 베이스 클래스 (SPEC-OAUTH-001 TAG-003)

카카오/네이버/구글 OAuth2 프로바이더의 공통 인터페이스 정의.
모든 프로바이더는 이 클래스를 상속하여 구현해야 함.
"""

from __future__ import annotations

from abc import ABC, abstractmethod


class OAuthProvider(ABC):
    """OAuth2 프로바이더 추상 베이스 클래스

    인증 URL 생성, 코드 교환, 사용자 정보 조회의 세 단계를 추상화.
    각 프로바이더별 API 형식 차이를 캡슐화.
    """

    # 프로바이더 식별자 ('kakao', 'naver', 'google')
    provider_name: str

    # OAuth2 클라이언트 자격증명
    client_id: str
    client_secret: str

    # OAuth2 엔드포인트 URL
    authorize_url: str
    token_url: str
    userinfo_url: str

    # 요청할 권한 범위
    scopes: list[str]

    @abstractmethod
    def get_authorize_url(self, state: str, redirect_uri: str) -> str:
        """인증 URL 생성

        사용자를 OAuth2 프로바이더 로그인 페이지로 리다이렉트할 URL 반환.

        Args:
            state: CSRF 방지용 랜덤 state 값
            redirect_uri: 인증 완료 후 돌아올 콜백 URI

        Returns:
            프로바이더 인증 페이지 URL
        """
        ...

    @abstractmethod
    async def exchange_code(self, code: str, redirect_uri: str) -> OAuthToken:
        """인가 코드로 액세스 토큰 교환

        프로바이더에서 받은 일회용 코드를 액세스 토큰으로 교환.

        Args:
            code: 콜백 요청에서 받은 인가 코드
            redirect_uri: 최초 요청과 동일한 콜백 URI

        Returns:
            OAuthToken (access_token, refresh_token 등 포함)
        """
        ...

    @abstractmethod
    async def get_user_info(self, access_token: str) -> OAuthUserInfo:
        """액세스 토큰으로 사용자 정보 조회

        Args:
            access_token: 토큰 교환으로 얻은 액세스 토큰

        Returns:
            OAuthUserInfo (provider_user_id, email, name 등)
        """
        ...


# 순환 임포트 방지를 위해 타입 힌트에서만 사용
# 실제 구현은 app.schemas.oauth 에 정의
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.schemas.oauth import OAuthToken, OAuthUserInfo
