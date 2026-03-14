"""API 의존성 함수 (SPEC-AUTH-001 Module 4)

FastAPI 의존성 주입: 현재 인증된 사용자 조회.
"""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.user import User

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
