"""API Key 비즈니스 로직 서비스 (SPEC-B2B-001 Module 4)

API 키 생성, 검증, 목록 조회, 폐기 담당.
AC-007: 전체 키는 생성 시 한 번만 반환, DB에는 SHA-256 해시만 저장
AC-008: 폐기된 키로 접근 시 401
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.api_key import APIKey
from app.models.organization import Organization


class APIKeyService:
    """API Key 서비스

    API 키 생성, 검증, 목록 조회, 폐기 담당.
    """

    # @MX:ANCHOR: API 키 서비스 - API 키 인증 흐름의 핵심 서비스
    # @MX:REASON: 다수의 엔드포인트와 인증 의존성에서 사용

    # API 키 접두사
    _KEY_PREFIX = "bdk_"

    # 랜덤 키 길이 (문자 수)
    _KEY_RANDOM_LENGTH = 32

    def __init__(self, db: AsyncSession) -> None:
        """APIKeyService 초기화

        Args:
            db: 비동기 DB 세션
        """
        self._db = db

    # ─────────────────────────────────────────────
    # API 키 생성 (AC-007)
    # ─────────────────────────────────────────────

    async def create_api_key(
        self,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        name: str,
        scopes: list[str],
    ) -> tuple[APIKey, str]:
        """API 키를 생성한다.

        전체 키는 생성 시 한 번만 반환되며, DB에는 SHA-256 해시만 저장.

        Args:
            org_id: 조직 UUID
            user_id: 생성자 사용자 UUID
            name: 키 이름/설명
            scopes: 허용할 스코프 목록

        Returns:
            (APIKey 객체, 전체 키 문자열) 튜플
            전체 키는 이 시점에만 반환되므로 안전하게 보관 필요
        """
        # 랜덤 32자리 생성 후 접두사 결합
        random_part = secrets.token_urlsafe(self._KEY_RANDOM_LENGTH)[:self._KEY_RANDOM_LENGTH]
        full_key = f"{self._KEY_PREFIX}{random_part}"

        # SHA-256 해시 계산 (평문 키 대신 저장)
        key_hash = hashlib.sha256(full_key.encode()).hexdigest()

        # 마지막 4자리 저장 (사용자 확인용)
        key_last4 = full_key[-4:]

        # APIKey 모델 생성 (DB에는 해시만 저장)
        api_key = APIKey(
            organization_id=org_id,
            created_by=user_id,
            key_prefix=self._KEY_PREFIX,
            key_hash=key_hash,
            key_last4=key_last4,
            name=name,
            scopes=scopes,
            is_active=True,
        )

        self._db.add(api_key)
        await self._db.flush()

        return api_key, full_key

    # ─────────────────────────────────────────────
    # API 키 검증 (AC-007, AC-008)
    # ─────────────────────────────────────────────

    async def validate_api_key(self, raw_key: str) -> tuple[APIKey, Organization]:
        """API 키를 검증하고 관련 조직을 반환한다.

        키를 해시하여 DB에서 조회한 후 활성 상태 및 만료 여부를 확인.

        Args:
            raw_key: 원시 API 키 (전체 키 문자열)

        Returns:
            (APIKey 객체, Organization 객체) 튜플

        Raises:
            HTTPException 401: 유효하지 않거나 비활성화된 키, 만료된 키
        """
        # 키 해시 계산
        key_hash = hashlib.sha256(raw_key.encode()).hexdigest()

        # DB에서 키 조회
        result = await self._db.execute(
            sa.select(APIKey).where(APIKey.key_hash == key_hash)
        )
        api_key = result.scalar_one_or_none()

        if api_key is None:
            raise HTTPException(status_code=401, detail="유효하지 않은 API 키입니다.")

        # 활성 상태 확인 (AC-008)
        if not api_key.is_active:
            raise HTTPException(status_code=401, detail="비활성화된 API 키입니다.")

        # 만료 여부 확인
        if api_key.expires_at is not None:
            now = datetime.now(UTC)
            # timezone-aware 비교를 위해 expires_at에 timezone 정보가 없으면 UTC로 처리
            expires_at = api_key.expires_at
            if hasattr(expires_at, "tzinfo") and expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=UTC)
            if now > expires_at:
                raise HTTPException(status_code=401, detail="만료된 API 키입니다.")

        # last_used_at 업데이트
        api_key.last_used_at = datetime.now(UTC)

        # 조직 조회
        org_result = await self._db.execute(
            sa.select(Organization).where(Organization.id == api_key.organization_id)
        )
        organization = org_result.scalar_one_or_none()

        return api_key, organization

    # ─────────────────────────────────────────────
    # API 키 목록 조회
    # ─────────────────────────────────────────────

    async def list_api_keys(self, org_id: uuid.UUID) -> list[APIKey]:
        """조직의 API 키 목록을 반환한다.

        마스킹된 키 정보만 반환 (key_hash 제외).

        Args:
            org_id: 조직 UUID

        Returns:
            APIKey 객체 목록
        """
        result = await self._db.execute(
            sa.select(APIKey)
            .where(APIKey.organization_id == org_id)
            .order_by(APIKey.created_at.desc())
        )
        return result.scalars().all()

    # ─────────────────────────────────────────────
    # API 키 폐기 (AC-008)
    # ─────────────────────────────────────────────

    async def revoke_api_key(
        self,
        key_id: uuid.UUID,
        org_id: uuid.UUID,
    ) -> APIKey:
        """API 키를 폐기한다 (is_active=False).

        Args:
            key_id: 폐기할 키의 UUID
            org_id: 요청 조직 UUID (소유권 확인용)

        Returns:
            폐기된 APIKey 객체

        Raises:
            HTTPException 404: 키를 찾을 수 없음
            HTTPException 403: 다른 조직의 키에 접근 시도
        """
        result = await self._db.execute(
            sa.select(APIKey).where(APIKey.id == key_id)
        )
        api_key = result.scalar_one_or_none()

        if api_key is None:
            raise HTTPException(status_code=404, detail="API 키를 찾을 수 없습니다.")

        # 조직 소유권 확인
        if api_key.organization_id != org_id:
            raise HTTPException(
                status_code=403,
                detail="해당 API 키에 접근할 권한이 없습니다.",
            )

        api_key.is_active = False
        return api_key
