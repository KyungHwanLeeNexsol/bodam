"""ClientService 단위 테스트 (SPEC-B2B-001 Phase 3)

TDD RED 페이즈: 클라이언트 서비스의 CRUD, 암호화, 동의 관리, 멀티테넌트 격리를 테스트.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.agent_client import AgentClient, ConsentStatus
from app.models.organization_member import OrgMemberRole
from app.schemas.b2b import ClientCreate, ClientUpdate, ConsentUpdateRequest


class TestClientServiceCreate:
    """create_client 메서드 테스트"""

    @pytest.fixture
    def mock_db(self):
        """모의 비동기 DB 세션"""
        db = AsyncMock()
        db.add = MagicMock()
        db.flush = AsyncMock()
        db.refresh = AsyncMock()
        return db

    @pytest.fixture
    def mock_encryptor(self):
        """모의 FieldEncryptor"""
        enc = MagicMock()
        enc.encrypt_field = MagicMock(side_effect=lambda x: f"ENC:{x}" if x else x)
        enc.decrypt_field = MagicMock(side_effect=lambda x: x.replace("ENC:", "") if x.startswith("ENC:") else x)
        return enc

    @pytest.mark.asyncio
    async def test_create_client_encrypts_pii(self, mock_db, mock_encryptor):
        """고객 생성 시 PII(이름, 전화, 이메일) 암호화"""
        from app.services.b2b.client_service import ClientService

        org_id = uuid.uuid4()
        agent_id = uuid.uuid4()
        data = ClientCreate(
            client_name="홍길동",
            client_phone="010-1234-5678",
            client_email="hong@example.com",
        )

        # 저장된 객체를 refresh에서 세팅
        saved_client = AgentClient(
            organization_id=org_id,
            agent_id=agent_id,
            client_name="ENC:홍길동",
            client_phone="ENC:010-1234-5678",
            client_email="ENC:hong@example.com",
        )
        saved_client.id = uuid.uuid4()
        saved_client.consent_status = ConsentStatus.PENDING
        saved_client.consent_date = None
        saved_client.notes = None
        saved_client.created_at = datetime.now(UTC)
        saved_client.updated_at = datetime.now(UTC)

        async def fake_refresh(obj):
            obj.id = saved_client.id
            obj.consent_status = ConsentStatus.PENDING
            obj.consent_date = None
            obj.notes = None
            obj.created_at = saved_client.created_at
            obj.updated_at = saved_client.updated_at

        mock_db.refresh = fake_refresh

        service = ClientService(db=mock_db, encryptor=mock_encryptor)
        result = await service.create_client(org_id=org_id, agent_id=agent_id, data=data)

        # PII 필드가 암호화되었는지 확인
        mock_encryptor.encrypt_field.assert_any_call("홍길동")
        mock_encryptor.encrypt_field.assert_any_call("010-1234-5678")
        mock_encryptor.encrypt_field.assert_any_call("hong@example.com")

        # DB에 add 호출
        mock_db.add.assert_called_once()

    @pytest.mark.asyncio
    async def test_create_client_sets_consent_pending(self, mock_db, mock_encryptor):
        """고객 생성 시 consent_status가 PENDING으로 설정"""
        from app.services.b2b.client_service import ClientService

        org_id = uuid.uuid4()
        agent_id = uuid.uuid4()
        data = ClientCreate(
            client_name="홍길동",
            client_phone="010-1234-5678",
        )

        async def fake_refresh(obj):
            obj.id = uuid.uuid4()
            obj.consent_status = ConsentStatus.PENDING
            obj.consent_date = None
            obj.notes = None
            obj.created_at = datetime.now(UTC)
            obj.updated_at = datetime.now(UTC)

        mock_db.refresh = fake_refresh

        service = ClientService(db=mock_db, encryptor=mock_encryptor)
        result = await service.create_client(org_id=org_id, agent_id=agent_id, data=data)

        assert result.consent_status == ConsentStatus.PENDING

    @pytest.mark.asyncio
    async def test_create_client_without_email(self, mock_db, mock_encryptor):
        """이메일 없이 고객 생성 가능"""
        from app.services.b2b.client_service import ClientService

        org_id = uuid.uuid4()
        agent_id = uuid.uuid4()
        data = ClientCreate(
            client_name="홍길동",
            client_phone="010-1234-5678",
        )

        async def fake_refresh(obj):
            obj.id = uuid.uuid4()
            obj.consent_status = ConsentStatus.PENDING
            obj.consent_date = None
            obj.notes = None
            obj.created_at = datetime.now(UTC)
            obj.updated_at = datetime.now(UTC)

        mock_db.refresh = fake_refresh

        service = ClientService(db=mock_db, encryptor=mock_encryptor)
        result = await service.create_client(org_id=org_id, agent_id=agent_id, data=data)

        # 이메일 미제공 시 encrypt_field 호출 안 함
        call_args = [str(c) for c in mock_encryptor.encrypt_field.call_args_list]
        assert all("hong@" not in arg for arg in call_args)


class TestClientServiceGet:
    """get_client 메서드 테스트"""

    @pytest.fixture
    def mock_db(self):
        """모의 비동기 DB 세션"""
        db = AsyncMock()
        return db

    @pytest.fixture
    def mock_encryptor(self):
        """모의 FieldEncryptor"""
        enc = MagicMock()
        enc.decrypt_field = MagicMock(side_effect=lambda x: x.replace("ENC:", "") if x and x.startswith("ENC:") else x)
        return enc

    def _make_client(self, org_id, agent_id):
        """테스트용 AgentClient 객체 생성"""
        client = AgentClient(
            organization_id=org_id,
            agent_id=agent_id,
            client_name="ENC:홍길동",
            client_phone="ENC:010-1234-5678",
            client_email="ENC:hong@example.com",
        )
        client.id = uuid.uuid4()
        client.consent_status = ConsentStatus.PENDING
        client.consent_date = None
        client.notes = None
        client.created_at = datetime.now(UTC)
        client.updated_at = datetime.now(UTC)
        return client

    @pytest.mark.asyncio
    async def test_agent_can_get_own_client(self, mock_db, mock_encryptor):
        """AGENT는 자신의 고객 조회 가능"""
        from app.services.b2b.client_service import ClientService

        org_id = uuid.uuid4()
        agent_id = uuid.uuid4()
        client = self._make_client(org_id, agent_id)

        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = client
        mock_db.execute = AsyncMock(return_value=result_mock)

        service = ClientService(db=mock_db, encryptor=mock_encryptor)
        result = await service.get_client(
            client_id=client.id,
            org_id=org_id,
            user_id=agent_id,
            user_role=OrgMemberRole.AGENT,
        )

        assert result is not None
        assert result.client_name == "홍길동"  # 복호화됨

    @pytest.mark.asyncio
    async def test_agent_cannot_get_other_agent_client(self, mock_db, mock_encryptor):
        """AGENT는 다른 설계사의 고객 조회 불가 (404)"""
        from fastapi import HTTPException

        from app.services.b2b.client_service import ClientService

        org_id = uuid.uuid4()
        agent_id = uuid.uuid4()
        other_agent_id = uuid.uuid4()
        client = self._make_client(org_id, agent_id)

        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = None  # 필터에 의해 없음
        mock_db.execute = AsyncMock(return_value=result_mock)

        service = ClientService(db=mock_db, encryptor=mock_encryptor)
        with pytest.raises(HTTPException) as exc:
            await service.get_client(
                client_id=client.id,
                org_id=org_id,
                user_id=other_agent_id,
                user_role=OrgMemberRole.AGENT,
            )

        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_agent_admin_can_get_any_org_client(self, mock_db, mock_encryptor):
        """AGENT_ADMIN은 조직 내 모든 고객 조회 가능"""
        from app.services.b2b.client_service import ClientService

        org_id = uuid.uuid4()
        agent_id = uuid.uuid4()
        admin_id = uuid.uuid4()
        client = self._make_client(org_id, agent_id)

        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = client
        mock_db.execute = AsyncMock(return_value=result_mock)

        service = ClientService(db=mock_db, encryptor=mock_encryptor)
        result = await service.get_client(
            client_id=client.id,
            org_id=org_id,
            user_id=admin_id,
            user_role=OrgMemberRole.AGENT_ADMIN,
        )

        assert result is not None

    @pytest.mark.asyncio
    async def test_get_client_different_org_returns_404(self, mock_db, mock_encryptor):
        """다른 조직 고객 접근 시 404 반환 (AC-004)"""
        from fastapi import HTTPException

        from app.services.b2b.client_service import ClientService

        org_id = uuid.uuid4()
        other_org_id = uuid.uuid4()
        agent_id = uuid.uuid4()
        client = self._make_client(org_id, agent_id)

        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = None  # 다른 조직이므로 없음
        mock_db.execute = AsyncMock(return_value=result_mock)

        service = ClientService(db=mock_db, encryptor=mock_encryptor)
        with pytest.raises(HTTPException) as exc:
            await service.get_client(
                client_id=client.id,
                org_id=other_org_id,
                user_id=agent_id,
                user_role=OrgMemberRole.AGENT,
            )

        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_get_client_decrypts_pii(self, mock_db, mock_encryptor):
        """조회 시 PII 필드 복호화"""
        from app.services.b2b.client_service import ClientService

        org_id = uuid.uuid4()
        agent_id = uuid.uuid4()
        client = self._make_client(org_id, agent_id)

        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = client
        mock_db.execute = AsyncMock(return_value=result_mock)

        service = ClientService(db=mock_db, encryptor=mock_encryptor)
        result = await service.get_client(
            client_id=client.id,
            org_id=org_id,
            user_id=agent_id,
            user_role=OrgMemberRole.AGENT,
        )

        # 복호화가 호출되었는지 확인
        mock_encryptor.decrypt_field.assert_called()
        assert result.client_name == "홍길동"
        assert result.client_phone == "010-1234-5678"


class TestClientServiceList:
    """list_clients 메서드 테스트"""

    @pytest.fixture
    def mock_db(self):
        """모의 비동기 DB 세션"""
        db = AsyncMock()
        return db

    @pytest.fixture
    def mock_encryptor(self):
        """모의 FieldEncryptor"""
        enc = MagicMock()
        enc.decrypt_field = MagicMock(side_effect=lambda x: x.replace("ENC:", "") if x and x.startswith("ENC:") else x)
        return enc

    def _make_client(self, org_id, agent_id):
        """테스트용 AgentClient 객체 생성"""
        client = AgentClient(
            organization_id=org_id,
            agent_id=agent_id,
            client_name="ENC:홍길동",
            client_phone="ENC:010-1234-5678",
            client_email=None,
        )
        client.id = uuid.uuid4()
        client.consent_status = ConsentStatus.PENDING
        client.consent_date = None
        client.notes = None
        client.created_at = datetime.now(UTC)
        client.updated_at = datetime.now(UTC)
        return client

    @pytest.mark.asyncio
    async def test_agent_sees_only_own_clients(self, mock_db, mock_encryptor):
        """AGENT는 자신의 고객만 목록 조회"""
        from app.services.b2b.client_service import ClientService

        org_id = uuid.uuid4()
        agent_id = uuid.uuid4()
        clients = [self._make_client(org_id, agent_id) for _ in range(3)]

        result_mock = MagicMock()
        result_mock.scalars.return_value.all.return_value = clients
        mock_db.execute = AsyncMock(return_value=result_mock)

        service = ClientService(db=mock_db, encryptor=mock_encryptor)
        results = await service.list_clients(
            org_id=org_id,
            user_id=agent_id,
            user_role=OrgMemberRole.AGENT,
        )

        assert len(results) == 3

    @pytest.mark.asyncio
    async def test_agent_admin_sees_all_org_clients(self, mock_db, mock_encryptor):
        """AGENT_ADMIN은 조직 전체 고객 목록 조회"""
        from app.services.b2b.client_service import ClientService

        org_id = uuid.uuid4()
        agent1_id = uuid.uuid4()
        agent2_id = uuid.uuid4()
        admin_id = uuid.uuid4()

        clients = [
            self._make_client(org_id, agent1_id),
            self._make_client(org_id, agent2_id),
        ]

        result_mock = MagicMock()
        result_mock.scalars.return_value.all.return_value = clients
        mock_db.execute = AsyncMock(return_value=result_mock)

        service = ClientService(db=mock_db, encryptor=mock_encryptor)
        results = await service.list_clients(
            org_id=org_id,
            user_id=admin_id,
            user_role=OrgMemberRole.AGENT_ADMIN,
        )

        assert len(results) == 2

    @pytest.mark.asyncio
    async def test_list_clients_returns_decrypted_pii(self, mock_db, mock_encryptor):
        """목록 조회 시 PII 복호화"""
        from app.services.b2b.client_service import ClientService

        org_id = uuid.uuid4()
        agent_id = uuid.uuid4()
        clients = [self._make_client(org_id, agent_id)]

        result_mock = MagicMock()
        result_mock.scalars.return_value.all.return_value = clients
        mock_db.execute = AsyncMock(return_value=result_mock)

        service = ClientService(db=mock_db, encryptor=mock_encryptor)
        results = await service.list_clients(
            org_id=org_id,
            user_id=agent_id,
            user_role=OrgMemberRole.AGENT,
        )

        assert results[0].client_name == "홍길동"


class TestClientServiceUpdate:
    """update_client 메서드 테스트"""

    @pytest.fixture
    def mock_db(self):
        """모의 비동기 DB 세션"""
        db = AsyncMock()
        db.flush = AsyncMock()
        db.refresh = AsyncMock()
        return db

    @pytest.fixture
    def mock_encryptor(self):
        """모의 FieldEncryptor"""
        enc = MagicMock()
        enc.encrypt_field = MagicMock(side_effect=lambda x: f"ENC:{x}" if x else x)
        enc.decrypt_field = MagicMock(side_effect=lambda x: x.replace("ENC:", "") if x and x.startswith("ENC:") else x)
        return enc

    def _make_client(self, org_id, agent_id):
        """테스트용 AgentClient 객체 생성"""
        client = AgentClient(
            organization_id=org_id,
            agent_id=agent_id,
            client_name="ENC:홍길동",
            client_phone="ENC:010-1234-5678",
            client_email=None,
        )
        client.id = uuid.uuid4()
        client.consent_status = ConsentStatus.PENDING
        client.consent_date = None
        client.notes = None
        client.created_at = datetime.now(UTC)
        client.updated_at = datetime.now(UTC)
        return client

    @pytest.mark.asyncio
    async def test_update_client_encrypts_updated_pii(self, mock_db, mock_encryptor):
        """업데이트 시 변경된 PII 필드 재암호화"""
        from app.services.b2b.client_service import ClientService

        org_id = uuid.uuid4()
        agent_id = uuid.uuid4()
        client = self._make_client(org_id, agent_id)

        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = client
        mock_db.execute = AsyncMock(return_value=result_mock)

        data = ClientUpdate(client_name="김철수")

        service = ClientService(db=mock_db, encryptor=mock_encryptor)
        result = await service.update_client(
            client_id=client.id,
            org_id=org_id,
            agent_id=agent_id,
            data=data,
        )

        mock_encryptor.encrypt_field.assert_any_call("김철수")

    @pytest.mark.asyncio
    async def test_update_client_only_owning_agent(self, mock_db, mock_encryptor):
        """소유 설계사만 업데이트 가능"""
        from fastapi import HTTPException

        from app.services.b2b.client_service import ClientService

        org_id = uuid.uuid4()
        agent_id = uuid.uuid4()
        other_agent_id = uuid.uuid4()
        client = self._make_client(org_id, agent_id)

        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = None  # 다른 설계사는 못 찾음
        mock_db.execute = AsyncMock(return_value=result_mock)

        data = ClientUpdate(client_name="김철수")

        service = ClientService(db=mock_db, encryptor=mock_encryptor)
        with pytest.raises(HTTPException) as exc:
            await service.update_client(
                client_id=client.id,
                org_id=org_id,
                agent_id=other_agent_id,
                data=data,
            )

        assert exc.value.status_code == 404


class TestClientServiceConsent:
    """update_consent 메서드 테스트"""

    @pytest.fixture
    def mock_db(self):
        """모의 비동기 DB 세션"""
        db = AsyncMock()
        db.flush = AsyncMock()
        return db

    @pytest.fixture
    def mock_encryptor(self):
        """모의 FieldEncryptor"""
        enc = MagicMock()
        enc.decrypt_field = MagicMock(side_effect=lambda x: x.replace("ENC:", "") if x and x.startswith("ENC:") else x)
        return enc

    def _make_client(self, org_id, agent_id):
        """테스트용 AgentClient 객체 생성"""
        client = AgentClient(
            organization_id=org_id,
            agent_id=agent_id,
            client_name="ENC:홍길동",
            client_phone="ENC:010-1234-5678",
            client_email=None,
        )
        client.id = uuid.uuid4()
        client.consent_status = ConsentStatus.PENDING
        client.consent_date = None
        client.notes = None
        client.created_at = datetime.now(UTC)
        client.updated_at = datetime.now(UTC)
        return client

    @pytest.mark.asyncio
    async def test_update_consent_to_active(self, mock_db, mock_encryptor):
        """동의 상태를 ACTIVE로 변경"""
        from app.services.b2b.client_service import ClientService

        org_id = uuid.uuid4()
        agent_id = uuid.uuid4()
        client = self._make_client(org_id, agent_id)

        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = client
        mock_db.execute = AsyncMock(return_value=result_mock)

        request = ConsentUpdateRequest(consent_status=ConsentStatus.ACTIVE)

        service = ClientService(db=mock_db, encryptor=mock_encryptor)
        result = await service.update_consent(
            client_id=client.id,
            org_id=org_id,
            consent_request=request,
        )

        assert result.consent_status == ConsentStatus.ACTIVE
        assert result.consent_date is not None

    @pytest.mark.asyncio
    async def test_update_consent_to_revoked_sets_date(self, mock_db, mock_encryptor):
        """동의 상태를 REVOKED로 변경 시 동의 날짜 설정"""
        from app.services.b2b.client_service import ClientService

        org_id = uuid.uuid4()
        agent_id = uuid.uuid4()
        client = self._make_client(org_id, agent_id)
        client.consent_status = ConsentStatus.ACTIVE

        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = client
        mock_db.execute = AsyncMock(return_value=result_mock)

        request = ConsentUpdateRequest(consent_status=ConsentStatus.REVOKED)

        service = ClientService(db=mock_db, encryptor=mock_encryptor)
        result = await service.update_consent(
            client_id=client.id,
            org_id=org_id,
            consent_request=request,
        )

        assert result.consent_status == ConsentStatus.REVOKED
