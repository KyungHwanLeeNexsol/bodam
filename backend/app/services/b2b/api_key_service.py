"""B2B API 키 서비스 (SPEC-B2B-001 Module 4)

API 키 생성, 검증, 목록 조회, 폐기 비즈니스 로직.
SHA-256 해시 저장, bdk_ 접두사.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.api_key import APIKey
from app.models.organization import Organization


class APIKeyService:
    """API 키 비즈니스 로직 서비스"""

    # API 키 접두사
    _KEY_PREFIX = "bdk_"
    # 랜덤 부분 길이 (hex 문자 수)
    _RANDOM_LENGTH = 32

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def create_api_key(
        self,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        name: str,
        scopes: list[str],
        expires_at: datetime | None = None,
    ) -> tuple[APIKey, str]:
        """API 키를 생성한다.

        전체 키는 생성 시 한 번만 반환되며, DB에는 SHA-256 해시만 저장 (AC-007).

        Args:
            org_id: 조직 UUID
            user_id: 생성자 사용자 UUID
            name: 키 이름/설명
            scopes: 허용 스코프 목록
            expires_at: 만료 일시 (선택)

        Returns:
            (APIKey 객체, 전체 키 문자열) 튜플
        """
        # bdk_ + 32자리 hex 랜덤 키 생성
        random_part = secrets.token_hex(self._RANDOM_LENGTH // 2)
        full_key = f"{self._KEY_PREFIX}{random_part}"

        # SHA-256 해시
        key_hash = hashlib.sha256(full_key.encode()).hexdigest()
        key_last4 = full_key[-4:]

        api_key = APIKey(
            organization_id=org_id,
            created_by=user_id,
            key_prefix=self._KEY_PREFIX,
            key_hash=key_hash,
            key_last4=key_last4,
            name=name,
            scopes=scopes,
            is_active=True,
            expires_at=expires_at,
        )
        self._db.add(api_key)
        await self._db.flush()

        return api_key, full_key

    async def validate_api_key(
        self,
        raw_key: str,
    ) -> tuple[APIKey, Organization]:
        """API 키를 검증하고 해당 조직을 반환한다.

        Args:
            raw_key: 클라이언트가 제공한 원시 API 키

        Returns:
            (APIKey 객체, Organization 객체) 튜플

        Raises:
            HTTPException 401: 키가 유효하지 않거나 만료/비활성화된 경우
        """
        # SHA-256 해시로 DB 조회
        key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
        result = await self._db.execute(
            sa.select(APIKey).where(APIKey.key_hash == key_hash)
        )
        api_key = result.scalar_one_or_none()

        if api_key is None:
            raise HTTPException(status_code=401, detail="유효하지 않은 API 키입니다.")

        if not api_key.is_active:
            raise HTTPException(status_code=401, detail="비활성화된 API 키입니다.")

        if api_key.expires_at is not None:
            now = datetime.now(UTC)
            expires_at = api_key.expires_at
            # timezone-aware 비교
            if hasattr(expires_at, "tzinfo") and expires_at.tzinfo is None:
                from datetime import timezone
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at < now:
                raise HTTPException(status_code=401, detail="만료된 API 키입니다.")

        # last_used_at 갱신
        api_key.last_used_at = datetime.now(UTC)

        # 조직 조회
        org_result = await self._db.execute(
            sa.select(Organization).where(Organization.id == api_key.organization_id)
        )
        org = org_result.scalar_one_or_none()

        return api_key, org

    async def list_api_keys(
        self,
        org_id: uuid.UUID,
    ) -> list[APIKey]:
        """조직의 API 키 목록을 조회한다.

        Args:
            org_id: 조직 UUID

        Returns:
            APIKey 목록 (마스킹된 정보만 포함)
        """
        result = await self._db.execute(
            sa.select(APIKey).where(APIKey.organization_id == org_id)
        )
        return result.scalars().all()

    async def revoke_api_key(
        self,
        key_id: uuid.UUID,
        org_id: uuid.UUID,
    ) -> None:
        """API 키를 비활성화한다 (AC-008).

        Args:
            key_id: API 키 UUID
            org_id: 조직 UUID (소유 조직 검증용)

        Raises:
            HTTPException 404: 키를 찾을 수 없는 경우
            HTTPException 403: 다른 조직의 키인 경우
        """
        result = await self._db.execute(
            sa.select(APIKey).where(APIKey.id == key_id)
        )
        api_key = result.scalar_one_or_none()

        if api_key is None:
            raise HTTPException(status_code=404, detail="API 키를 찾을 수 없습니다.")

        if api_key.organization_id != org_id:
            raise HTTPException(status_code=403, detail="해당 API 키에 접근 권한이 없습니다.")

        api_key.is_active = False
