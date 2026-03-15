"""OAuth2 비즈니스 로직 서비스 (SPEC-OAUTH-001 TAG-007)

소셜 로그인 플로우의 핵심 비즈니스 로직:
- CSRF state 생성/검증 (Redis TTL 5분)
- 소셜 계정으로 사용자 조회/생성 (병합 로직 포함)
- 소셜 계정 목록 조회/해제
- 토큰 Fernet 대칭키 암호화
"""

from __future__ import annotations

import secrets
import uuid as uuid_module

import sqlalchemy as sa
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.security import create_access_token
from app.models.social_account import SocialAccount
from app.models.user import User
from app.schemas.oauth import OAuthUserInfo


class OAuthService:
    """OAuth2 소셜 로그인 서비스

    state 관리, 사용자 조회/생성, 계정 병합, 토큰 암호화 담당.
    """

    # @MX:ANCHOR: OAuth 서비스 - 다수의 API 엔드포인트에서 의존
    # @MX:REASON: 소셜 로그인 비즈니스 로직의 단일 진입점

    # Redis key 접두사
    _STATE_PREFIX = "oauth:state:"
    _MERGE_PREFIX = "oauth:merge:"

    # state TTL (초)
    _STATE_TTL = 300  # 5분

    # 병합 토큰 TTL (초)
    _MERGE_TTL = 600  # 10분

    def __init__(self, db: AsyncSession, redis: Redis, settings: Settings) -> None:
        """OAuthService 초기화

        Args:
            db: 비동기 DB 세션
            redis: Redis 클라이언트
            settings: 애플리케이션 설정
        """
        self._db = db
        self._redis = redis
        self._settings = settings
        self._fernet = self._build_fernet(settings.social_token_encryption_key)

    # ─────────────────────────────────────────────
    # CSRF state 관리 (ACC-22)
    # ─────────────────────────────────────────────

    async def generate_state(self) -> str:
        """CSRF 방지용 랜덤 state 생성 및 Redis 저장

        Returns:
            URL-safe 랜덤 state 문자열 (32자)
        """
        state = secrets.token_urlsafe(32)
        key = f"{self._STATE_PREFIX}{state}"
        await self._redis.setex(key, self._STATE_TTL, "1")
        return state

    async def validate_state(self, state: str) -> bool:
        """Redis에서 state 검증 후 삭제 (일회용)

        Args:
            state: 검증할 state 값

        Returns:
            True: 유효한 state / False: 유효하지 않은 state
        """
        key = f"{self._STATE_PREFIX}{state}"
        value = await self._redis.get(key)
        if value is None:
            return False
        await self._redis.delete(key)
        return True

    # ─────────────────────────────────────────────
    # 사용자 조회/생성 (ACC-17~19)
    # ─────────────────────────────────────────────

    async def get_or_create_user(self, user_info: OAuthUserInfo) -> dict:
        """소셜 로그인 사용자 조회 또는 생성

        3가지 시나리오:
        1. 기존 소셜 계정 존재 -> JWT 발급
        2. 이메일로 기존 계정 존재 -> 409 (병합 필요, ACC-18)
        3. 신규 사용자 -> User + SocialAccount 생성 후 JWT 발급 (ACC-19)

        Args:
            user_info: OAuth2 프로바이더에서 받은 사용자 정보

        Returns:
            {"access_token": str, "is_new_user": bool}

        Raises:
            HTTPException 409: 이메일이 이미 존재하는 경우
        """
        # 시나리오 1: 기존 소셜 계정으로 조회
        existing_social = await self._find_social_account(
            provider=user_info.provider,
            provider_user_id=user_info.provider_user_id,
        )
        if existing_social is not None:
            user = await self._get_user_by_id(existing_social.user_id)
            if user is None:
                raise HTTPException(status_code=404, detail="연결된 사용자를 찾을 수 없습니다.")
            token = self._issue_jwt(user)
            return {"access_token": token, "is_new_user": False}

        # 시나리오 2: 이메일로 기존 계정 조회 (이메일이 있는 경우만)
        if user_info.email:
            existing_user = await self._find_user_by_email(user_info.email)
            if existing_user is not None:
                # 병합 토큰 생성 및 Redis 저장
                merge_token = await self._store_merge_token(
                    provider=user_info.provider,
                    provider_user_id=user_info.provider_user_id,
                    provider_email=user_info.email,
                    provider_name=user_info.name,
                    existing_user_id=str(existing_user.id),
                )
                # ACC-18: 자동 병합 금지 - 409로 병합 필요 안내
                raise HTTPException(
                    status_code=409,
                    detail={
                        "message": "이미 해당 이메일로 가입된 계정이 있습니다. 계정을 연결하시겠습니까?",
                        "merge_token": merge_token,
                        "provider": user_info.provider,
                    },
                )

        # 시나리오 3: 신규 사용자 생성 (ACC-19)
        new_user, is_new = await self._create_user_with_social(user_info)
        token = self._issue_jwt(new_user)
        return {"access_token": token, "is_new_user": True}

    # ─────────────────────────────────────────────
    # 계정 병합 (ACC-17)
    # ─────────────────────────────────────────────

    async def merge_accounts(self, merge_token: str, password: str) -> dict:
        """병합 토큰과 비밀번호로 소셜 계정 연결

        Args:
            merge_token: get_or_create_user()에서 발급한 임시 병합 토큰
            password: 기존 계정 비밀번호

        Returns:
            {"access_token": str}

        Raises:
            HTTPException 400: 유효하지 않은 병합 토큰
            HTTPException 401: 비밀번호 불일치
        """
        from app.core.security import verify_password

        key = f"{self._MERGE_PREFIX}{merge_token}"
        merge_data_bytes = await self._redis.get(key)
        if merge_data_bytes is None:
            raise HTTPException(status_code=400, detail="유효하지 않거나 만료된 병합 토큰입니다.")

        import json
        merge_data = json.loads(merge_data_bytes)

        # 기존 사용자 조회
        user = await self._get_user_by_id(uuid_module.UUID(merge_data["existing_user_id"]))
        if user is None:
            raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

        # 비밀번호 확인
        if not user.hashed_password or not verify_password(password, user.hashed_password):
            raise HTTPException(status_code=401, detail="비밀번호가 올바르지 않습니다.")

        # 소셜 계정 연결
        social_account = SocialAccount(
            user_id=user.id,
            provider=merge_data["provider"],
            provider_user_id=merge_data["provider_user_id"],
            provider_email=merge_data.get("provider_email"),
            provider_name=merge_data.get("provider_name"),
        )
        self._db.add(social_account)
        await self._db.flush()

        # 병합 토큰 삭제
        await self._redis.delete(key)

        token = self._issue_jwt(user)
        return {"access_token": token}

    # ─────────────────────────────────────────────
    # 소셜 계정 목록/해제 (ACC-12~14)
    # ─────────────────────────────────────────────

    async def get_social_accounts(self, user_id: uuid_module.UUID) -> list[SocialAccount]:
        """연결된 소셜 계정 목록 조회 (ACC-14)

        Args:
            user_id: 사용자 UUID

        Returns:
            SocialAccount 목록
        """
        result = await self._db.execute(
            sa.select(SocialAccount).where(SocialAccount.user_id == user_id)
        )
        return result.scalars().all()

    async def unlink_social_account(
        self, user_id: uuid_module.UUID, provider: str
    ) -> None:
        """소셜 계정 해제 (ACC-12, ACC-13)

        마지막 인증 수단인 경우 삭제 방지.
        비밀번호가 없고 소셜 계정이 1개뿐이면 해제 불가.

        Args:
            user_id: 사용자 UUID
            provider: 해제할 프로바이더 식별자

        Raises:
            HTTPException 400: 마지막 인증 수단 삭제 시도 (ACC-13)
            HTTPException 404: 해당 소셜 계정 없음
        """
        # 사용자 조회
        user = await self._get_user_by_id(user_id)
        if user is None:
            raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

        # 해당 provider 소셜 계정 조회
        result = await self._db.execute(
            sa.select(SocialAccount).where(
                SocialAccount.user_id == user_id,
                SocialAccount.provider == provider,
            )
        )
        account = result.scalar_one_or_none()
        if account is None:
            raise HTTPException(status_code=404, detail="연결된 소셜 계정을 찾을 수 없습니다.")

        # 마지막 인증 수단 보호 (ACC-13)
        # 비밀번호 없는 계정에서 소셜 계정 해제 시 인증 수단 유무 확인
        if not user.hashed_password:
            # 소셜 계정 목록 확인
            all_social = await self.get_social_accounts(user_id)
            if len(all_social) <= 1:
                raise HTTPException(
                    status_code=400,
                    detail="마지막 인증 수단은 삭제할 수 없습니다. 비밀번호를 먼저 설정하세요.",
                )

        await self._db.delete(account)
        await self._db.flush()

    # ─────────────────────────────────────────────
    # 토큰 암호화 (ACC-22)
    # ─────────────────────────────────────────────

    def encrypt_token(self, token: str) -> str:
        """토큰 Fernet 암호화

        암호화 키가 없으면 원본 반환 (개발 환경 편의).

        Args:
            token: 평문 토큰

        Returns:
            암호화된 토큰 (또는 원본)
        """
        if self._fernet is None:
            return token
        return self._fernet.encrypt(token.encode()).decode()

    def decrypt_token(self, encrypted: str) -> str:
        """토큰 Fernet 복호화

        암호화 키가 없으면 원본 반환 (개발 환경 편의).

        Args:
            encrypted: 암호화된 토큰 (또는 원본)

        Returns:
            복호화된 평문 토큰
        """
        if self._fernet is None:
            return encrypted
        return self._fernet.decrypt(encrypted.encode()).decode()

    # ─────────────────────────────────────────────
    # 내부 헬퍼 메서드
    # ─────────────────────────────────────────────

    @staticmethod
    def _build_fernet(key: str) -> Fernet | None:
        """Fernet 인스턴스 생성 (키가 없으면 None)"""
        if not key:
            return None
        try:
            from cryptography.fernet import Fernet
            return Fernet(key.encode())
        except Exception:
            return None

    async def _find_social_account(
        self, provider: str, provider_user_id: str
    ) -> SocialAccount | None:
        """(provider, provider_user_id)로 소셜 계정 조회"""
        result = await self._db.execute(
            sa.select(SocialAccount).where(
                SocialAccount.provider == provider,
                SocialAccount.provider_user_id == provider_user_id,
            )
        )
        return result.scalar_one_or_none()

    async def _find_user_by_email(self, email: str) -> User | None:
        """이메일로 사용자 조회"""
        result = await self._db.execute(
            sa.select(User).where(User.email == email)
        )
        return result.scalar_one_or_none()

    async def _get_user_by_id(self, user_id: uuid_module.UUID) -> User | None:
        """UUID로 사용자 조회"""
        result = await self._db.execute(
            sa.select(User).where(User.id == user_id)
        )
        return result.scalar_one_or_none()

    async def _create_user_with_social(
        self, user_info: OAuthUserInfo
    ) -> tuple[User, bool]:
        """신규 User 및 SocialAccount 생성

        Args:
            user_info: OAuth2 사용자 정보

        Returns:
            (생성된 User, is_new=True)
        """
        # 소셜 전용 계정 - hashed_password=None
        user = User(
            email=user_info.email or f"{user_info.provider}_{user_info.provider_user_id}@social.bodam.kr",
            hashed_password=None,
            full_name=user_info.name,
        )
        self._db.add(user)
        await self._db.flush()

        # 소셜 계정 연결
        social_account = SocialAccount(
            user_id=user.id,
            provider=user_info.provider,
            provider_user_id=user_info.provider_user_id,
            provider_email=user_info.email,
            provider_name=user_info.name,
        )
        self._db.add(social_account)
        await self._db.flush()

        return user, True

    async def _store_merge_token(
        self,
        provider: str,
        provider_user_id: str,
        provider_email: str | None,
        provider_name: str | None,
        existing_user_id: str,
    ) -> str:
        """병합 토큰 생성 및 Redis 저장

        Returns:
            병합 토큰 문자열
        """
        import json

        merge_token = secrets.token_urlsafe(32)
        key = f"{self._MERGE_PREFIX}{merge_token}"
        data = {
            "provider": provider,
            "provider_user_id": provider_user_id,
            "provider_email": provider_email,
            "provider_name": provider_name,
            "existing_user_id": existing_user_id,
        }
        await self._redis.setex(key, self._MERGE_TTL, json.dumps(data))
        return merge_token

    def _issue_jwt(self, user: User) -> str:
        """사용자 JWT 발급"""
        return create_access_token(
            user_id=str(user.id),
            secret_key=self._settings.secret_key,
            algorithm=self._settings.jwt_algorithm,
            expire_minutes=self._settings.access_token_expire_minutes,
        )


from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from cryptography.fernet import Fernet
    from redis.asyncio import Redis
