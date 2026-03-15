"""OAuth2 소셜 로그인 API 라우터 (SPEC-OAUTH-001 TAG-008)

카카오, 네이버, 구글 OAuth2 인증 엔드포인트.
GET /auth/oauth/{provider}/authorize - 인증 URL 리다이렉트 (ACC-01, ACC-05, ACC-08)
GET /auth/oauth/{provider}/callback - 콜백 처리 (ACC-02, ACC-06, ACC-09)
POST /auth/oauth/merge - 계정 병합 (ACC-17, ACC-18)
GET /auth/social-accounts - 연결된 소셜 계정 목록 (ACC-14)
DELETE /auth/social-accounts/{provider} - 소셜 계정 해제 (ACC-12, ACC-13)
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

import redis.asyncio as redis_module
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.models.user import User
from app.providers import get_provider
from app.schemas.oauth import (
    OAuthCallbackResponse,
    OAuthMergeRequest,
    SocialAccountResponse,
)
from app.services.oauth_service import OAuthService

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

# OAuth2 라우터 (prefix: /auth, main.py에서 /api/v1 prefix와 결합)
router = APIRouter(prefix="/auth", tags=["oauth"])

# 지원하는 프로바이더 목록
SUPPORTED_PROVIDERS = {"kakao", "naver", "google"}


# ─────────────────────────────────────────────
# 의존성 주입
# ─────────────────────────────────────────────


def get_redis_client(settings: Settings = Depends(get_settings)) -> redis_module.Redis:
    """Redis 클라이언트 의존성"""
    return redis_module.from_url(settings.redis_url, decode_responses=True)


def get_oauth_service(
    db: AsyncSession = Depends(get_db),
    redis: redis_module.Redis = Depends(get_redis_client),
    settings: Settings = Depends(get_settings),
) -> OAuthService:
    """OAuthService 의존성 주입 팩토리"""
    return OAuthService(db=db, redis=redis, settings=settings)


def _validate_provider(provider: str) -> None:
    """프로바이더 유효성 검증 (ACC-16)"""
    if provider not in SUPPORTED_PROVIDERS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="지원하지 않는 소셜 로그인 제공자입니다",
        )


# ─────────────────────────────────────────────
# OAuth2 인증 흐름 엔드포인트
# ─────────────────────────────────────────────


@router.get(
    "/oauth/{provider}/authorize",
    summary="소셜 로그인 인증 URL 리다이렉트",
    status_code=status.HTTP_307_TEMPORARY_REDIRECT,
)
async def oauth_authorize(
    provider: str,
    redirect_uri: str | None = Query(None, description="프론트엔드 최종 리다이렉트 URL"),
    oauth_service: OAuthService = Depends(get_oauth_service),
    settings: Settings = Depends(get_settings),
) -> RedirectResponse:
    """OAuth2 인증 URL 생성 및 307 리다이렉트 (ACC-01, ACC-05, ACC-08)

    state 파라미터를 생성하여 Redis에 저장(TTL 5분)하고,
    해당 프로바이더의 인증 URL로 리다이렉트합니다.
    """
    _validate_provider(provider)

    # CSRF state 생성 (ACC-22)
    state = await oauth_service.generate_state()

    # 프로바이더 인스턴스 생성
    oauth_provider = get_provider(provider, settings)

    # 프로바이더별 redirect_uri 결정
    provider_redirect_uri = getattr(settings, f"{provider}_redirect_uri")

    # 인증 URL 생성
    authorize_url = oauth_provider.get_authorize_url(
        state=state,
        redirect_uri=provider_redirect_uri,
    )

    return RedirectResponse(url=authorize_url, status_code=status.HTTP_307_TEMPORARY_REDIRECT)


@router.get(
    "/oauth/{provider}/callback",
    response_model=OAuthCallbackResponse,
    summary="소셜 로그인 콜백 처리",
)
async def oauth_callback(
    provider: str,
    code: str = Query(..., description="인가 코드"),
    state: str = Query(..., description="CSRF 검증용 state"),
    oauth_service: OAuthService = Depends(get_oauth_service),
    settings: Settings = Depends(get_settings),
) -> OAuthCallbackResponse:
    """OAuth2 콜백 처리 (ACC-02, ACC-06, ACC-09)

    1. state 검증 (ACC-22)
    2. 인가 코드로 access token 교환
    3. 사용자 정보 조회
    4. 사용자 조회/생성 및 JWT 발급
    """
    _validate_provider(provider)

    # state 검증 (ACC-22)
    if not await oauth_service.validate_state(state):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="유효하지 않은 state 값입니다",
        )

    # 프로바이더 인스턴스 생성
    oauth_provider = get_provider(provider, settings)
    provider_redirect_uri = getattr(settings, f"{provider}_redirect_uri")

    try:
        # 인가 코드로 access token 교환
        token_data = await oauth_provider.exchange_code(
            code=code,
            redirect_uri=provider_redirect_uri,
        )

        # 사용자 정보 조회
        user_info = await oauth_provider.get_user_info(token_data.access_token)

    except Exception as e:
        # ACC-25: 소셜 제공자 API 오류 처리
        logger.error(
            "소셜 로그인 API 호출 실패",
            extra={
                "provider": provider,
                "error_type": type(e).__name__,
                "error_detail": str(e),
            },
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="소셜 로그인 서비스에 일시적 오류가 발생했습니다",
        )

    # 사용자 조회/생성 (409 병합 필요 시 그대로 전파)
    result = await oauth_service.get_or_create_user(user_info)

    return OAuthCallbackResponse(
        access_token=result["access_token"],
        token_type="bearer",
        is_new_user=result.get("is_new_user", False),
    )


# ─────────────────────────────────────────────
# 계정 병합 엔드포인트
# ─────────────────────────────────────────────


@router.post(
    "/oauth/merge",
    response_model=OAuthCallbackResponse,
    summary="기존 계정과 소셜 계정 병합",
)
async def oauth_merge(
    body: OAuthMergeRequest,
    oauth_service: OAuthService = Depends(get_oauth_service),
) -> OAuthCallbackResponse:
    """기존 이메일 계정과 소셜 계정 병합 (ACC-17, ACC-18)

    병합 토큰과 비밀번호를 검증한 후 소셜 계정을 연결합니다.
    """
    result = await oauth_service.merge_accounts(
        merge_token=body.merge_token,
        password=body.password,
    )

    return OAuthCallbackResponse(
        access_token=result["access_token"],
        token_type="bearer",
        is_new_user=False,
    )


# ─────────────────────────────────────────────
# 소셜 계정 관리 엔드포인트
# ─────────────────────────────────────────────


@router.get(
    "/social-accounts",
    response_model=list[SocialAccountResponse],
    summary="연결된 소셜 계정 목록",
)
async def get_social_accounts(
    current_user: User = Depends(get_current_user),
    oauth_service: OAuthService = Depends(get_oauth_service),
) -> list[SocialAccountResponse]:
    """인증된 사용자의 연결된 소셜 계정 목록 조회 (ACC-14)"""
    accounts = await oauth_service.get_social_accounts(current_user.id)
    return [
        SocialAccountResponse(
            provider=acc.provider,
            provider_email=acc.provider_email,
            provider_name=acc.provider_name,
            connected_at=acc.created_at,
        )
        for acc in accounts
    ]


@router.delete(
    "/social-accounts/{provider}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="소셜 계정 연결 해제",
)
async def unlink_social_account(
    provider: str,
    current_user: User = Depends(get_current_user),
    oauth_service: OAuthService = Depends(get_oauth_service),
) -> None:
    """소셜 계정 연결 해제 (ACC-12, ACC-13)

    마지막 인증 수단인 경우 400 에러를 반환합니다 (ACC-15).
    """
    _validate_provider(provider)
    await oauth_service.unlink_social_account(current_user.id, provider)
