"""OAuth2 프로바이더 패키지 (SPEC-OAUTH-001 TAG-003)

프로바이더 팩토리 함수와 베이스 클래스를 re-export.
"""

from __future__ import annotations

from app.providers.base import OAuthProvider


def get_provider(provider_name: str, settings: "Settings") -> OAuthProvider:
    """프로바이더 이름으로 OAuthProvider 인스턴스 반환

    Args:
        provider_name: 프로바이더 식별자 ('kakao', 'naver', 'google')
        settings: 애플리케이션 설정 (client_id 등 포함)

    Returns:
        해당 프로바이더의 OAuthProvider 구현체

    Raises:
        ValueError: 지원하지 않는 프로바이더인 경우
    """
    from app.providers.kakao import KakaoOAuthProvider
    from app.providers.naver import NaverOAuthProvider
    from app.providers.google import GoogleOAuthProvider

    providers: dict[str, type[OAuthProvider]] = {
        "kakao": KakaoOAuthProvider,
        "naver": NaverOAuthProvider,
        "google": GoogleOAuthProvider,
    }

    provider_cls = providers.get(provider_name)
    if provider_cls is None:
        raise ValueError(f"지원하지 않는 OAuth2 프로바이더입니다: {provider_name!r}")

    return provider_cls(settings=settings)


__all__ = ["OAuthProvider", "get_provider"]


from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.core.config import Settings
