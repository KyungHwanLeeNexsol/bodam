"""인증 서비스 (SPEC-AUTH-001 Module 2)

회원가입, 로그인 비즈니스 로직 처리.
"""

from __future__ import annotations

import sqlalchemy as sa
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.security import create_access_token, hash_password, validate_password_strength, verify_password
from app.models.user import User
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserResponse


class AuthService:
    """사용자 인증 서비스

    회원가입, 로그인, 사용자 조회 담당.
    """

    # @MX:ANCHOR: 인증 서비스 - 다수의 API 엔드포인트에서 의존
    # @MX:REASON: 인증 로직의 단일 진입점으로 일관성 보장

    def __init__(self, db: AsyncSession, settings: Settings) -> None:
        """AuthService 초기화

        Args:
            db: 비동기 DB 세션
            settings: 애플리케이션 설정
        """
        self._db = db
        self._settings = settings

    async def register(self, req: RegisterRequest) -> UserResponse:
        """사용자 회원가입

        Args:
            req: 회원가입 요청 (이메일, 비밀번호, 이름)

        Returns:
            생성된 UserResponse

        Raises:
            HTTPException 409: 이메일 중복
            HTTPException 422: 비밀번호 강도 부족
        """
        # 비밀번호 강도 검증
        try:
            validate_password_strength(req.password)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))

        # 이메일 중복 확인
        existing = await self._db.execute(
            sa.select(User).where(User.email == req.email)
        )
        if existing.scalar_one_or_none() is not None:
            raise HTTPException(status_code=409, detail="이미 사용 중인 이메일입니다.")

        # 비밀번호 해시 및 사용자 생성
        hashed_pw = hash_password(req.password)
        user = User(
            email=req.email,
            hashed_password=hashed_pw,
            full_name=req.full_name,
        )
        self._db.add(user)
        await self._db.flush()

        return UserResponse(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            is_active=user.is_active,
        )

    async def login(self, req: LoginRequest) -> TokenResponse:
        """사용자 로그인

        Args:
            req: 로그인 요청 (이메일, 비밀번호)

        Returns:
            JWT TokenResponse

        Raises:
            HTTPException 401: 이메일/비밀번호 불일치
            HTTPException 403: 비활성 계정
        """
        # 사용자 조회
        result = await self._db.execute(
            sa.select(User).where(User.email == req.email)
        )
        user = result.scalar_one_or_none()

        # 사용자 없거나 비밀번호 불일치 (보안: 동일 메시지)
        if user is None or not verify_password(req.password, user.hashed_password):
            raise HTTPException(
                status_code=401,
                detail="이메일 또는 비밀번호가 올바르지 않습니다",
            )

        # 비활성 계정 확인
        if not user.is_active:
            raise HTTPException(status_code=403, detail="비활성화된 계정입니다.")

        # JWT 발급
        token = create_access_token(
            user_id=str(user.id),
            secret_key=self._settings.secret_key,
            algorithm=self._settings.jwt_algorithm,
            expire_minutes=self._settings.access_token_expire_minutes,
        )

        return TokenResponse(access_token=token, token_type="bearer")

    async def get_user_by_id(self, user_id: str) -> User | None:
        """ID로 사용자 조회

        Args:
            user_id: 사용자 UUID 문자열

        Returns:
            User 또는 None
        """
        import uuid as uuid_module

        result = await self._db.execute(
            sa.select(User).where(User.id == uuid_module.UUID(user_id))
        )
        return result.scalar_one_or_none()
