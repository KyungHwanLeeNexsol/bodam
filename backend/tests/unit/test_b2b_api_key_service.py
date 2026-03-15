"""API Key 서비스 단위 테스트 (SPEC-B2B-001 Module 4)

APIKeyService 비즈니스 로직 검증:
- create_api_key: 키 생성 (bdk_ 접두사, SHA-256 해시)
- validate_api_key: 키 검증 (해시 비교, 활성 상태, 만료 확인)
- list_api_keys: 마스킹된 키 목록 조회
- revoke_api_key: 키 비활성화

AC-007: 전체 키는 생성 시 한 번만 반환, DB에는 해시만 저장
AC-008: 폐기된 키로 접근 시 401
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest


class TestAPIKeyServiceImport:
    """서비스 임포트 테스트"""

    def test_api_key_service_importable(self):
        """APIKeyService가 임포트 가능해야 한다"""
        from app.services.b2b.api_key_service import APIKeyService

        assert APIKeyService is not None


class TestCreateAPIKey:
    """create_api_key 메서드 테스트"""

    @pytest.fixture
    def mock_db(self):
        """모의 비동기 DB 세션"""
        db = AsyncMock()
        db.add = MagicMock()
        db.flush = AsyncMock()
        return db

    @pytest.fixture
    def mock_org_id(self):
        return uuid.uuid4()

    @pytest.fixture
    def mock_user_id(self):
        return uuid.uuid4()

    @pytest.mark.asyncio
    async def test_create_api_key_returns_full_key_once(self, mock_db, mock_org_id, mock_user_id):
        """create_api_key는 전체 키를 한 번만 반환해야 한다 (AC-007)"""
        from app.services.b2b.api_key_service import APIKeyService

        service = APIKeyService(db=mock_db)
        api_key_obj, full_key = await service.create_api_key(
            org_id=mock_org_id,
            user_id=mock_user_id,
            name="테스트 키",
            scopes=["read"],
        )

        # 전체 키가 반환되어야 함
        assert full_key is not None
        assert isinstance(full_key, str)
        assert len(full_key) > 0

    @pytest.mark.asyncio
    async def test_create_api_key_has_bdk_prefix(self, mock_db, mock_org_id, mock_user_id):
        """생성된 API 키는 'bdk_' 접두사로 시작해야 한다"""
        from app.services.b2b.api_key_service import APIKeyService

        service = APIKeyService(db=mock_db)
        api_key_obj, full_key = await service.create_api_key(
            org_id=mock_org_id,
            user_id=mock_user_id,
            name="테스트 키",
            scopes=["read"],
        )

        assert full_key.startswith("bdk_")

    @pytest.mark.asyncio
    async def test_create_api_key_stores_hash_not_plaintext(self, mock_db, mock_org_id, mock_user_id):
        """DB에는 평문 키가 아닌 SHA-256 해시만 저장되어야 한다 (AC-007)"""
        from app.services.b2b.api_key_service import APIKeyService

        service = APIKeyService(db=mock_db)
        api_key_obj, full_key = await service.create_api_key(
            org_id=mock_org_id,
            user_id=mock_user_id,
            name="테스트 키",
            scopes=["read"],
        )

        # key_hash는 full_key와 달라야 함 (평문이 아님)
        assert api_key_obj.key_hash != full_key
        # key_hash는 full_key의 SHA-256 해시여야 함
        expected_hash = hashlib.sha256(full_key.encode()).hexdigest()
        assert api_key_obj.key_hash == expected_hash

    @pytest.mark.asyncio
    async def test_create_api_key_stores_last4(self, mock_db, mock_org_id, mock_user_id):
        """key_last4는 전체 키의 마지막 4자리여야 한다"""
        from app.services.b2b.api_key_service import APIKeyService

        service = APIKeyService(db=mock_db)
        api_key_obj, full_key = await service.create_api_key(
            org_id=mock_org_id,
            user_id=mock_user_id,
            name="테스트 키",
            scopes=["read"],
        )

        assert api_key_obj.key_last4 == full_key[-4:]

    @pytest.mark.asyncio
    async def test_create_api_key_stores_prefix(self, mock_db, mock_org_id, mock_user_id):
        """key_prefix는 'bdk_'이어야 한다"""
        from app.services.b2b.api_key_service import APIKeyService

        service = APIKeyService(db=mock_db)
        api_key_obj, full_key = await service.create_api_key(
            org_id=mock_org_id,
            user_id=mock_user_id,
            name="테스트 키",
            scopes=["read"],
        )

        assert api_key_obj.key_prefix == "bdk_"

    @pytest.mark.asyncio
    async def test_create_api_key_sets_org_and_user(self, mock_db, mock_org_id, mock_user_id):
        """생성된 API 키에 organization_id와 created_by가 설정되어야 한다"""
        from app.services.b2b.api_key_service import APIKeyService

        service = APIKeyService(db=mock_db)
        api_key_obj, full_key = await service.create_api_key(
            org_id=mock_org_id,
            user_id=mock_user_id,
            name="테스트 키",
            scopes=["read"],
        )

        assert api_key_obj.organization_id == mock_org_id
        assert api_key_obj.created_by == mock_user_id

    @pytest.mark.asyncio
    async def test_create_api_key_is_active_by_default(self, mock_db, mock_org_id, mock_user_id):
        """생성된 API 키는 기본적으로 활성 상태여야 한다"""
        from app.services.b2b.api_key_service import APIKeyService

        service = APIKeyService(db=mock_db)
        api_key_obj, full_key = await service.create_api_key(
            org_id=mock_org_id,
            user_id=mock_user_id,
            name="테스트 키",
            scopes=["read", "write"],
        )

        assert api_key_obj.is_active is True

    @pytest.mark.asyncio
    async def test_create_api_key_stores_scopes(self, mock_db, mock_org_id, mock_user_id):
        """생성된 API 키에 스코프가 올바르게 저장되어야 한다"""
        from app.services.b2b.api_key_service import APIKeyService

        service = APIKeyService(db=mock_db)
        scopes = ["read", "write", "analysis"]
        api_key_obj, full_key = await service.create_api_key(
            org_id=mock_org_id,
            user_id=mock_user_id,
            name="멀티 스코프 키",
            scopes=scopes,
        )

        assert api_key_obj.scopes == scopes

    @pytest.mark.asyncio
    async def test_create_api_key_adds_to_db_session(self, mock_db, mock_org_id, mock_user_id):
        """create_api_key는 DB 세션에 객체를 추가해야 한다"""
        from app.services.b2b.api_key_service import APIKeyService

        service = APIKeyService(db=mock_db)
        await service.create_api_key(
            org_id=mock_org_id,
            user_id=mock_user_id,
            name="테스트 키",
            scopes=["read"],
        )

        # db.add가 호출되어야 함
        mock_db.add.assert_called_once()

    @pytest.mark.asyncio
    async def test_create_api_key_full_key_has_32_random_chars(self, mock_db, mock_org_id, mock_user_id):
        """생성된 전체 키는 'bdk_' + 32자리 랜덤 문자열이어야 한다"""
        from app.services.b2b.api_key_service import APIKeyService

        service = APIKeyService(db=mock_db)
        api_key_obj, full_key = await service.create_api_key(
            org_id=mock_org_id,
            user_id=mock_user_id,
            name="테스트 키",
            scopes=["read"],
        )

        # bdk_ 접두사 제거 후 32자리 확인
        random_part = full_key[len("bdk_"):]
        assert len(random_part) == 32


class TestValidateAPIKey:
    """validate_api_key 메서드 테스트"""

    @pytest.fixture
    def mock_db(self):
        db = AsyncMock()
        return db

    @pytest.fixture
    def sample_key_prefix(self):
        return "bdk_"

    @pytest.fixture
    def sample_raw_key(self):
        """테스트용 원시 API 키"""
        return "bdk_" + "a" * 32

    @pytest.mark.asyncio
    async def test_validate_api_key_returns_key_and_org(self, mock_db, sample_raw_key):
        """유효한 키 검증 시 (APIKey, Organization) 튜플을 반환해야 한다"""
        from app.models.api_key import APIKey
        from app.models.organization import Organization
        from app.services.b2b.api_key_service import APIKeyService

        # 모의 APIKey 객체 설정
        mock_api_key = MagicMock(spec=APIKey)
        mock_api_key.is_active = True
        mock_api_key.expires_at = None
        mock_api_key.key_hash = hashlib.sha256(sample_raw_key.encode()).hexdigest()
        mock_api_key.organization_id = uuid.uuid4()

        mock_org = MagicMock(spec=Organization)

        # DB 쿼리 모킹
        mock_result_key = MagicMock()
        mock_result_key.scalar_one_or_none = MagicMock(return_value=mock_api_key)

        mock_result_org = MagicMock()
        mock_result_org.scalar_one_or_none = MagicMock(return_value=mock_org)

        mock_db.execute = AsyncMock(side_effect=[mock_result_key, mock_result_org])

        service = APIKeyService(db=mock_db)
        result_key, result_org = await service.validate_api_key(raw_key=sample_raw_key)

        assert result_key == mock_api_key
        assert result_org == mock_org

    @pytest.mark.asyncio
    async def test_validate_api_key_raises_401_for_invalid_key(self, mock_db, sample_raw_key):
        """존재하지 않는 키로 검증 시 HTTPException 401을 발생시켜야 한다"""
        from fastapi import HTTPException

        from app.services.b2b.api_key_service import APIKeyService

        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=None)
        mock_db.execute = AsyncMock(return_value=mock_result)

        service = APIKeyService(db=mock_db)

        with pytest.raises(HTTPException) as exc_info:
            await service.validate_api_key(raw_key=sample_raw_key)

        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_validate_api_key_raises_401_for_inactive_key(self, mock_db, sample_raw_key):
        """비활성화된 키로 검증 시 HTTPException 401을 발생시켜야 한다 (AC-008)"""
        from fastapi import HTTPException

        from app.models.api_key import APIKey
        from app.services.b2b.api_key_service import APIKeyService

        mock_api_key = MagicMock(spec=APIKey)
        mock_api_key.is_active = False
        mock_api_key.expires_at = None
        mock_api_key.key_hash = hashlib.sha256(sample_raw_key.encode()).hexdigest()

        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=mock_api_key)
        mock_db.execute = AsyncMock(return_value=mock_result)

        service = APIKeyService(db=mock_db)

        with pytest.raises(HTTPException) as exc_info:
            await service.validate_api_key(raw_key=sample_raw_key)

        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_validate_api_key_raises_401_for_expired_key(self, mock_db, sample_raw_key):
        """만료된 키로 검증 시 HTTPException 401을 발생시켜야 한다"""
        from fastapi import HTTPException

        from app.models.api_key import APIKey
        from app.services.b2b.api_key_service import APIKeyService

        mock_api_key = MagicMock(spec=APIKey)
        mock_api_key.is_active = True
        # 과거 시간으로 만료 설정
        mock_api_key.expires_at = datetime.now(UTC) - timedelta(days=1)
        mock_api_key.key_hash = hashlib.sha256(sample_raw_key.encode()).hexdigest()

        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=mock_api_key)
        mock_db.execute = AsyncMock(return_value=mock_result)

        service = APIKeyService(db=mock_db)

        with pytest.raises(HTTPException) as exc_info:
            await service.validate_api_key(raw_key=sample_raw_key)

        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_validate_api_key_updates_last_used_at(self, mock_db, sample_raw_key):
        """유효한 키 검증 시 last_used_at이 업데이트되어야 한다"""
        from app.models.api_key import APIKey
        from app.models.organization import Organization
        from app.services.b2b.api_key_service import APIKeyService

        mock_api_key = MagicMock(spec=APIKey)
        mock_api_key.is_active = True
        mock_api_key.expires_at = None
        mock_api_key.key_hash = hashlib.sha256(sample_raw_key.encode()).hexdigest()
        mock_api_key.organization_id = uuid.uuid4()
        mock_api_key.last_used_at = None

        mock_org = MagicMock(spec=Organization)

        mock_result_key = MagicMock()
        mock_result_key.scalar_one_or_none = MagicMock(return_value=mock_api_key)

        mock_result_org = MagicMock()
        mock_result_org.scalar_one_or_none = MagicMock(return_value=mock_org)

        mock_db.execute = AsyncMock(side_effect=[mock_result_key, mock_result_org])

        service = APIKeyService(db=mock_db)
        await service.validate_api_key(raw_key=sample_raw_key)

        # last_used_at이 설정되어야 함
        assert mock_api_key.last_used_at is not None

    @pytest.mark.asyncio
    async def test_validate_api_key_with_future_expires_at(self, mock_db, sample_raw_key):
        """미래에 만료되는 키는 유효해야 한다"""
        from app.models.api_key import APIKey
        from app.models.organization import Organization
        from app.services.b2b.api_key_service import APIKeyService

        mock_api_key = MagicMock(spec=APIKey)
        mock_api_key.is_active = True
        # 미래 시간으로 만료 설정
        mock_api_key.expires_at = datetime.now(UTC) + timedelta(days=30)
        mock_api_key.key_hash = hashlib.sha256(sample_raw_key.encode()).hexdigest()
        mock_api_key.organization_id = uuid.uuid4()

        mock_org = MagicMock(spec=Organization)

        mock_result_key = MagicMock()
        mock_result_key.scalar_one_or_none = MagicMock(return_value=mock_api_key)

        mock_result_org = MagicMock()
        mock_result_org.scalar_one_or_none = MagicMock(return_value=mock_org)

        mock_db.execute = AsyncMock(side_effect=[mock_result_key, mock_result_org])

        service = APIKeyService(db=mock_db)
        result_key, result_org = await service.validate_api_key(raw_key=sample_raw_key)

        assert result_key == mock_api_key


class TestListAPIKeys:
    """list_api_keys 메서드 테스트"""

    @pytest.fixture
    def mock_db(self):
        return AsyncMock()

    @pytest.fixture
    def mock_org_id(self):
        return uuid.uuid4()

    @pytest.mark.asyncio
    async def test_list_api_keys_returns_list(self, mock_db, mock_org_id):
        """list_api_keys는 리스트를 반환해야 한다"""
        from app.services.b2b.api_key_service import APIKeyService

        mock_result = MagicMock()
        mock_result.scalars = MagicMock(return_value=MagicMock(all=MagicMock(return_value=[])))
        mock_db.execute = AsyncMock(return_value=mock_result)

        service = APIKeyService(db=mock_db)
        result = await service.list_api_keys(org_id=mock_org_id)

        assert isinstance(result, list)

    @pytest.mark.asyncio
    async def test_list_api_keys_returns_only_org_keys(self, mock_db, mock_org_id):
        """list_api_keys는 해당 조직의 키만 반환해야 한다"""
        from app.models.api_key import APIKey
        from app.services.b2b.api_key_service import APIKeyService

        mock_key = MagicMock(spec=APIKey)
        mock_key.organization_id = mock_org_id

        mock_result = MagicMock()
        mock_result.scalars = MagicMock(
            return_value=MagicMock(all=MagicMock(return_value=[mock_key]))
        )
        mock_db.execute = AsyncMock(return_value=mock_result)

        service = APIKeyService(db=mock_db)
        result = await service.list_api_keys(org_id=mock_org_id)

        assert len(result) == 1
        assert result[0].organization_id == mock_org_id


class TestRevokeAPIKey:
    """revoke_api_key 메서드 테스트"""

    @pytest.fixture
    def mock_db(self):
        return AsyncMock()

    @pytest.mark.asyncio
    async def test_revoke_api_key_sets_is_active_false(self, mock_db):
        """revoke_api_key는 is_active를 False로 설정해야 한다"""
        from app.models.api_key import APIKey
        from app.services.b2b.api_key_service import APIKeyService

        key_id = uuid.uuid4()
        org_id = uuid.uuid4()

        mock_api_key = MagicMock(spec=APIKey)
        mock_api_key.is_active = True
        mock_api_key.organization_id = org_id
        mock_api_key.id = key_id

        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=mock_api_key)
        mock_db.execute = AsyncMock(return_value=mock_result)

        service = APIKeyService(db=mock_db)
        await service.revoke_api_key(key_id=key_id, org_id=org_id)

        assert mock_api_key.is_active is False

    @pytest.mark.asyncio
    async def test_revoke_api_key_raises_404_if_not_found(self, mock_db):
        """존재하지 않는 키 폐기 시 HTTPException 404를 발생시켜야 한다"""
        from fastapi import HTTPException

        from app.services.b2b.api_key_service import APIKeyService

        key_id = uuid.uuid4()
        org_id = uuid.uuid4()

        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=None)
        mock_db.execute = AsyncMock(return_value=mock_result)

        service = APIKeyService(db=mock_db)

        with pytest.raises(HTTPException) as exc_info:
            await service.revoke_api_key(key_id=key_id, org_id=org_id)

        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_revoke_api_key_raises_403_for_wrong_org(self, mock_db):
        """다른 조직의 키 폐기 시 HTTPException 403을 발생시켜야 한다"""
        from fastapi import HTTPException

        from app.models.api_key import APIKey
        from app.services.b2b.api_key_service import APIKeyService

        key_id = uuid.uuid4()
        org_id = uuid.uuid4()
        different_org_id = uuid.uuid4()

        mock_api_key = MagicMock(spec=APIKey)
        mock_api_key.organization_id = different_org_id
        mock_api_key.id = key_id

        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=mock_api_key)
        mock_db.execute = AsyncMock(return_value=mock_result)

        service = APIKeyService(db=mock_db)

        with pytest.raises(HTTPException) as exc_info:
            await service.revoke_api_key(key_id=key_id, org_id=org_id)

        assert exc_info.value.status_code == 403
