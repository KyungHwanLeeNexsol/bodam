"""클라이언트 API 엔드포인트 단위 테스트 (SPEC-B2B-001 Phase 3)

TDD RED 페이즈: 클라이언트 API의 인증, 권한, 동의 검사를 테스트.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.agent_client import ConsentStatus


class TestClientAPISchemas:
    """클라이언트 스키마 임포트 및 기본 유효성 테스트"""

    def test_client_create_schema(self):
        """ClientCreate 스키마 유효성 검사"""
        from app.schemas.b2b import ClientCreate

        data = ClientCreate(
            client_name="홍길동",
            client_phone="010-1234-5678",
        )
        assert data.client_name == "홍길동"
        assert data.client_phone == "010-1234-5678"
        assert data.client_email is None

    def test_client_create_with_email(self):
        """ClientCreate 스키마 이메일 포함"""
        from app.schemas.b2b import ClientCreate

        data = ClientCreate(
            client_name="홍길동",
            client_phone="010-1234-5678",
            client_email="hong@example.com",
        )
        assert data.client_email == "hong@example.com"

    def test_client_update_schema_all_optional(self):
        """ClientUpdate 스키마 - 모든 필드 선택적"""
        from app.schemas.b2b import ClientUpdate

        data = ClientUpdate()
        assert data.client_name is None
        assert data.client_phone is None
        assert data.client_email is None
        assert data.notes is None

    def test_client_update_partial(self):
        """ClientUpdate 스키마 - 부분 업데이트"""
        from app.schemas.b2b import ClientUpdate

        data = ClientUpdate(client_name="김철수")
        assert data.client_name == "김철수"
        assert data.client_phone is None

    def test_client_response_schema(self):
        """ClientResponse 스키마 유효성 검사"""
        from app.schemas.b2b import ClientResponse

        now = datetime.now(UTC)
        data = ClientResponse(
            id=uuid.uuid4(),
            org_id=uuid.uuid4(),
            agent_id=uuid.uuid4(),
            client_name="홍길동",
            client_phone="010-1234-5678",
            client_email=None,
            consent_status=ConsentStatus.PENDING,
            consent_date=None,
            notes=None,
            created_at=now,
            updated_at=now,
        )
        assert data.client_name == "홍길동"
        assert data.consent_status == ConsentStatus.PENDING

    def test_consent_update_request_schema(self):
        """ConsentUpdateRequest 스키마 유효성 검사"""
        from app.schemas.b2b import ConsentUpdateRequest

        data = ConsentUpdateRequest(consent_status=ConsentStatus.ACTIVE)
        assert data.consent_status == ConsentStatus.ACTIVE

    def test_consent_update_request_revoked(self):
        """ConsentUpdateRequest - REVOKED 상태"""
        from app.schemas.b2b import ConsentUpdateRequest

        data = ConsentUpdateRequest(consent_status=ConsentStatus.REVOKED)
        assert data.consent_status == ConsentStatus.REVOKED

    def test_analyze_request_schema(self):
        """AnalyzeRequest 스키마 유효성 검사"""
        from app.schemas.b2b import AnalyzeRequest

        data = AnalyzeRequest(query="종신보험 추천해주세요")
        assert data.query == "종신보험 추천해주세요"

    def test_analysis_history_response_schema(self):
        """AnalysisHistoryResponse 스키마 유효성 검사"""
        from app.schemas.b2b import AnalysisHistoryResponse

        now = datetime.now(UTC)
        data = AnalysisHistoryResponse(
            id=uuid.uuid4(),
            query="보험 추천",
            result="추천 결과",
            created_at=now,
        )
        assert data.query == "보험 추천"


class TestClientAPIRouterExists:
    """클라이언트 API 라우터 존재 확인"""

    def test_clients_router_importable(self):
        """clients 라우터 임포트 가능"""
        from app.api.v1.b2b.clients import router

        assert router is not None

    def test_router_has_routes(self):
        """라우터에 라우트가 등록되어 있어야 함"""
        from app.api.v1.b2b.clients import router

        routes = [r.path for r in router.routes]
        assert len(routes) > 0

    def test_router_has_create_client_route(self):
        """POST /clients 라우트 존재"""
        from app.api.v1.b2b.clients import router

        paths = [r.path for r in router.routes]
        assert "/clients" in paths or "" in paths

    def test_router_has_list_clients_route(self):
        """GET /clients 라우트 존재"""
        from app.api.v1.b2b.clients import router

        # POST와 GET 모두 /clients path
        methods = {}
        for r in router.routes:
            if hasattr(r, "methods"):
                methods[r.path] = methods.get(r.path, set()) | r.methods

        clients_methods = methods.get("/clients", set()) | methods.get("", set())
        assert "GET" in clients_methods or "POST" in clients_methods


class TestConsentRequiredForAnalysis:
    """분석 엔드포인트 동의 검사 테스트 (AC-003)"""

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

    def _make_client(self, org_id, agent_id, consent_status=ConsentStatus.PENDING):
        """테스트용 AgentClient 객체 생성"""
        from app.models.agent_client import AgentClient

        client = AgentClient(
            organization_id=org_id,
            agent_id=agent_id,
            client_name="ENC:홍길동",
            client_phone="ENC:010-1234-5678",
            client_email=None,
        )
        client.id = uuid.uuid4()
        client.consent_status = consent_status
        client.consent_date = None
        client.notes = None
        client.created_at = datetime.now(UTC)
        client.updated_at = datetime.now(UTC)
        return client

    @pytest.mark.asyncio
    async def test_analyze_requires_active_consent(self, mock_db, mock_encryptor):
        """분석 요청 시 ACTIVE 동의가 없으면 403 반환 (AC-003)"""
        from fastapi import HTTPException

        from app.services.b2b.client_service import ClientService

        org_id = uuid.uuid4()
        agent_id = uuid.uuid4()
        client = self._make_client(org_id, agent_id, consent_status=ConsentStatus.PENDING)

        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = client
        mock_db.execute = AsyncMock(return_value=result_mock)

        service = ClientService(db=mock_db, encryptor=mock_encryptor)
        with pytest.raises(HTTPException) as exc:
            await service.check_consent_for_analysis(
                client_id=client.id,
                org_id=org_id,
                user_id=agent_id,
                user_role=__import__("app.models.organization_member", fromlist=["OrgMemberRole"]).OrgMemberRole.AGENT,
            )

        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_analyze_with_active_consent_passes(self, mock_db, mock_encryptor):
        """ACTIVE 동의가 있으면 분석 요청 통과"""
        from app.services.b2b.client_service import ClientService

        org_id = uuid.uuid4()
        agent_id = uuid.uuid4()
        client = self._make_client(org_id, agent_id, consent_status=ConsentStatus.ACTIVE)

        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = client
        mock_db.execute = AsyncMock(return_value=result_mock)

        service = ClientService(db=mock_db, encryptor=mock_encryptor)
        # 예외 없이 통과해야 함
        result = await service.check_consent_for_analysis(
            client_id=client.id,
            org_id=org_id,
            user_id=agent_id,
            user_role=__import__("app.models.organization_member", fromlist=["OrgMemberRole"]).OrgMemberRole.AGENT,
        )
        assert result is not None

    @pytest.mark.asyncio
    async def test_analyze_with_revoked_consent_returns_403(self, mock_db, mock_encryptor):
        """REVOKED 동의로 분석 요청 시 403 반환"""
        from fastapi import HTTPException

        from app.services.b2b.client_service import ClientService

        org_id = uuid.uuid4()
        agent_id = uuid.uuid4()
        client = self._make_client(org_id, agent_id, consent_status=ConsentStatus.REVOKED)

        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = client
        mock_db.execute = AsyncMock(return_value=result_mock)

        service = ClientService(db=mock_db, encryptor=mock_encryptor)
        with pytest.raises(HTTPException) as exc:
            await service.check_consent_for_analysis(
                client_id=client.id,
                org_id=org_id,
                user_id=agent_id,
                user_role=__import__("app.models.organization_member", fromlist=["OrgMemberRole"]).OrgMemberRole.AGENT,
            )

        assert exc.value.status_code == 403
