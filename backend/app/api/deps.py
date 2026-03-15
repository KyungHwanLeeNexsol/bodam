"""API 의존성 함수 (SPEC-AUTH-001 Module 4, SPEC-B2B-001)

FastAPI 의존성 주입: 현재 인증된 사용자 조회 및 역할 기반 접근 제어.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import TYPE_CHECKING

import sqlalchemy as sa
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.user import User, UserRole

if TYPE_CHECKING:
    from app.models.organization_member import OrganizationMember

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


def require_role(*roles: UserRole) -> Callable:
    """역할 기반 접근 제어 의존성 (SPEC-B2B-001 RBAC)

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
                detail="B2B 기능에 접근 권한이 없습니다.",
            )
        return user

    return _check_role


async def get_current_org_user(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> tuple[User, OrganizationMember]:
    """현재 사용자의 조직 멤버십을 확인하는 의존성.

    Args:
        user: 현재 인증된 사용자
        db: 비동기 DB 세션

    Returns:
        (User, OrganizationMember) 튜플

    Raises:
        HTTPException 403: 조직에 속하지 않은 사용자
    """
    from app.models.organization_member import OrganizationMember

    result = await db.execute(
        sa.select(OrganizationMember).where(
            OrganizationMember.user_id == user.id,
            OrganizationMember.is_active.is_(True),
        )
    )
    org_member = result.scalar_one_or_none()

    if org_member is None:
        raise HTTPException(
            status_code=403,
            detail="조직에 속하지 않은 사용자입니다.",
        )

    return user, org_member
