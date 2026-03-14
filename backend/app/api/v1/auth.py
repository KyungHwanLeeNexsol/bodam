"""인증 API 라우터 (SPEC-AUTH-001 Module 3)

회원가입, 로그인, 내 정보 조회 엔드포인트.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.models.user import User
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserResponse
from app.services.auth_service import AuthService

# 인증 라우터 (prefix: /auth)
router = APIRouter(prefix="/auth", tags=["auth"])


def get_auth_service(
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> AuthService:
    """AuthService 의존성 주입 팩토리

    Args:
        db: 비동기 DB 세션
        settings: 애플리케이션 설정

    Returns:
        AuthService 인스턴스
    """
    return AuthService(db=db, settings=settings)


@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="회원가입",
)
async def register(
    body: RegisterRequest,
    auth_service: AuthService = Depends(get_auth_service),
) -> UserResponse:
    """새 사용자를 등록합니다."""
    return await auth_service.register(body)


@router.post(
    "/login",
    response_model=TokenResponse,
    status_code=status.HTTP_200_OK,
    summary="로그인",
)
async def login(
    body: LoginRequest,
    auth_service: AuthService = Depends(get_auth_service),
) -> TokenResponse:
    """이메일과 비밀번호로 로그인하여 JWT 토큰을 발급합니다."""
    return await auth_service.login(body)


@router.get(
    "/me",
    response_model=UserResponse,
    status_code=status.HTTP_200_OK,
    summary="내 정보 조회",
)
async def get_me(
    current_user: User = Depends(get_current_user),
) -> UserResponse:
    """현재 인증된 사용자의 정보를 반환합니다."""
    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        full_name=current_user.full_name,
        is_active=current_user.is_active,
    )
