"""API 의존성 함수 (SPEC-AUTH-001 Module 4)

FastAPI 의존성 주입: 현재 인증된 사용자 조회 및 역할 기반 접근 제어.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable

import sqlalchemy as sa
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.user import User, UserRole

# Bearer 토큰 추출기 (auto_error=False: 401 자동 반환 대신 None 반환)
_bearer_scheme = HTTPBearer(auto_error=False)


async def _get_user_from_token(
    credentials: HTTPAuthorizationCredentials | None,
    db: AsyncSession,
    settings: Settings,
) -> User:
    """Bearer 토큰에서 사용자를 조회합니다.

    Args:
        credentials: HTTP Bearer 자격증명
        db: 비동기 DB 세션
        settings: 애플리케이션 설정

    Returns:
        인증된 User 객체

    Raises:
        HTTPException 401: 토큰 없음, 유효하지 않음, 사용자 없음, 비활성 계정
    """
    if credentials is None:
        raise HTTPException(status_code=401, detail="인증이 필요합니다.")

    # 토큰 디코딩
    try:
        user_id_str = decode_access_token(
            token=credentials.credentials,
            secret_key=settings.secret_key,
            algorithm=settings.jwt_algorithm,
        )
    except JWTError:
        raise HTTPException(status_code=401, detail="유효하지 않거나 만료된 토큰입니다.")

    # DB에서 사용자 조회
    try:
        user_uuid = uuid.UUID(user_id_str)
    except ValueError:
        raise HTTPException(status_code=401, detail="유효하지 않은 토큰입니다.")

    result = await db.execute(sa.select(User).where(User.id == user_uuid))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(status_code=401, detail="사용자를 찾을 수 없습니다.")

    if not user.is_active:
        raise HTTPException(status_code=401, detail="비활성화된 계정입니다.")

    return user


# @MX:ANCHOR: 인증 의존성 - 보호된 모든 엔드포인트에서 사용
# @MX:REASON: 인증 검사의 단일 진입점으로 일관성 보장
async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    """현재 인증된 사용자를 반환하는 FastAPI 의존성.

    Args:
        credentials: HTTP Bearer 자격증명 (자동 추출)
        db: 비동기 DB 세션
        settings: 애플리케이션 설정

    Returns:
        인증된 User 객체
    """
    return await _get_user_from_token(credentials=credentials, db=db, settings=settings)


def require_scope(scope: str) -> Callable:
    """스코프 기반 접근 제어 의존성 (AC-008)

    API 키의 허용 스코프를 검사하는 의존성을 반환한다.
    JWT 인증(api_key=None)이면 스코프 검사를 건너뛴다.

    Args:
        scope: 필요한 스코프 이름

    Returns:
        스코프 검사 의존성 함수
    """
    from app.models.api_key import APIKey

    async def _check_scope(api_key: APIKey | None = None) -> APIKey | None:
        """API 키 스코프를 검사한다.

        Args:
            api_key: 현재 인증된 API 키 (JWT 인증 시 None)

        Returns:
            스코프 검증을 통과한 APIKey 또는 None

        Raises:
            HTTPException 403: 스코프 없음
        """
        if api_key is None:
            # JWT 인증된 사용자는 스코프 검사 없이 통과
            return None
        if scope not in (api_key.scopes or []):
            raise HTTPException(
                status_code=403,
                detail=f"'{scope}' 스코프 권한이 없습니다.",
            )
        return api_key

    return _check_scope


async def get_current_user_or_api_key(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    x_api_key: str | None = None,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> tuple:
    """JWT 또는 X-API-Key 헤더로 인증하는 의존성 (AC-007).

    Args:
        credentials: HTTP Bearer 자격증명
        x_api_key: X-API-Key 헤더 값
        db: 비동기 DB 세션
        settings: 애플리케이션 설정

    Returns:
        (User | None, APIKey | None, Organization | None) 튜플

    Raises:
        HTTPException 401: 인증 수단 없음 또는 유효하지 않음
    """
    from app.services.b2b.api_key_service import APIKeyService

    if x_api_key is not None:
        # X-API-Key 헤더로 인증
        service = APIKeyService(db=db)
        api_key, org = await service.validate_api_key(raw_key=x_api_key)
        return None, api_key, org

    if credentials is not None:
        # Bearer JWT 토큰으로 인증
        user = await _get_user_from_token(
            credentials=credentials,
            db=db,
            settings=settings,
        )
        return user, None, None

    raise HTTPException(status_code=401, detail="인증이 필요합니다.")


def require_role(*roles: UserRole) -> Callable:
    """역할 기반 접근 제어 의존성

    허용된 역할 목록을 받아 현재 사용자의 역할을 검사하는 의존성을 반환한다.

    Args:
        *roles: 허용할 UserRole 목록

    Returns:
        역할 검사 의존성 함수

    Example:
        @router.get("/admin", dependencies=[Depends(require_role(UserRole.SYSTEM_ADMIN))])
    """

    async def _check_role(user: User = Depends(get_current_user)) -> User:
        """사용자 역할을 검사한다.

        Args:
            user: 현재 인증된 사용자

        Returns:
            역할 검증을 통과한 User 객체

        Raises:
            HTTPException 403: 허용되지 않은 역할
        """
        if user.role not in roles:
            raise HTTPException(
                status_code=403,
                detail="접근 권한이 없습니다.",
            )
        return user

    return _check_role
