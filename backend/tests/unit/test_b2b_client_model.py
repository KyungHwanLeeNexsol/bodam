"""AgentClient 모델 단위 테스트 (SPEC-B2B-001 Phase 3)

TDD RED 페이즈: AgentClient 모델의 예상 동작을 테스트로 정의.
"""

from __future__ import annotations

import uuid


class TestConsentStatusEnum:
    """ConsentStatus 열거형 테스트"""

    def test_consent_status_values(self):
        """ConsentStatus 열거형 값 확인"""
        from app.models.agent_client import ConsentStatus

        assert ConsentStatus.PENDING == "PENDING"
        assert ConsentStatus.ACTIVE == "ACTIVE"
        assert ConsentStatus.REVOKED == "REVOKED"

    def test_consent_status_members(self):
        """ConsentStatus 열거형 멤버 수 확인"""
        from app.models.agent_client import ConsentStatus

        members = list(ConsentStatus)
        assert len(members) == 3


class TestAgentClientModel:
    """AgentClient 모델 구조 테스트"""

    def test_tablename(self):
        """테이블명이 agent_clients여야 함"""
        from app.models.agent_client import AgentClient

        assert AgentClient.__tablename__ == "agent_clients"

    def test_model_has_required_columns(self):
        """필수 컬럼이 모두 존재해야 함"""
        from app.models.agent_client import AgentClient

        columns = {c.key for c in AgentClient.__table__.columns}
        required = {
            "id",
            "organization_id",
            "agent_id",
            "client_name",
            "client_phone",
            "client_email",
            "consent_status",
            "consent_date",
            "notes",
            "created_at",
            "updated_at",
        }
        assert required.issubset(columns)

    def test_id_is_uuid(self):
        """id 컬럼이 UUID 타입이어야 함"""
        from sqlalchemy.dialects.postgresql import UUID

        from app.models.agent_client import AgentClient

        id_col = AgentClient.__table__.columns["id"]
        assert isinstance(id_col.type, UUID)

    def test_organization_id_has_fk(self):
        """organization_id가 organizations.id를 참조해야 함"""
        from app.models.agent_client import AgentClient

        col = AgentClient.__table__.columns["organization_id"]
        fk_targets = {fk.target_fullname for fk in col.foreign_keys}
        assert "organizations.id" in fk_targets

    def test_agent_id_has_fk(self):
        """agent_id가 users.id를 참조해야 함"""
        from app.models.agent_client import AgentClient

        col = AgentClient.__table__.columns["agent_id"]
        fk_targets = {fk.target_fullname for fk in col.foreign_keys}
        assert "users.id" in fk_targets

    def test_consent_status_default_is_pending(self):
        """consent_status 기본값이 PENDING이어야 함"""
        from app.models.agent_client import AgentClient

        col = AgentClient.__table__.columns["consent_status"]
        # 기본값이 PENDING
        assert col.default is not None or col.server_default is not None

    def test_client_email_is_nullable(self):
        """client_email 컬럼은 nullable이어야 함"""
        from app.models.agent_client import AgentClient

        col = AgentClient.__table__.columns["client_email"]
        assert col.nullable is True

    def test_consent_date_is_nullable(self):
        """consent_date 컬럼은 nullable이어야 함"""
        from app.models.agent_client import AgentClient

        col = AgentClient.__table__.columns["consent_date"]
        assert col.nullable is True

    def test_notes_is_nullable(self):
        """notes 컬럼은 nullable이어야 함"""
        from app.models.agent_client import AgentClient

        col = AgentClient.__table__.columns["notes"]
        assert col.nullable is True

    def test_has_timestamp_mixin_columns(self):
        """TimestampMixin 컬럼(created_at, updated_at)이 존재해야 함"""
        from app.models.agent_client import AgentClient

        columns = {c.key for c in AgentClient.__table__.columns}
        assert "created_at" in columns
        assert "updated_at" in columns

    def test_has_composite_index(self):
        """(organization_id, agent_id) 복합 인덱스가 존재해야 함"""
        from app.models.agent_client import AgentClient

        index_columns = set()
        for idx in AgentClient.__table__.indexes:
            cols = frozenset(c.key for c in idx.columns)
            index_columns.add(cols)

        # (organization_id, agent_id) 복합 인덱스
        assert frozenset({"organization_id", "agent_id"}) in index_columns

    def test_has_organization_id_index(self):
        """organization_id 단일 인덱스가 존재해야 함"""
        from app.models.agent_client import AgentClient

        index_columns = set()
        for idx in AgentClient.__table__.indexes:
            cols = frozenset(c.key for c in idx.columns)
            index_columns.add(cols)

        # organization_id 단일 인덱스
        assert frozenset({"organization_id"}) in index_columns


class TestAgentClientInstantiation:
    """AgentClient 인스턴스 생성 테스트"""

    def test_create_instance_with_required_fields(self):
        """필수 필드로 AgentClient 인스턴스 생성"""
        from app.models.agent_client import AgentClient, ConsentStatus

        org_id = uuid.uuid4()
        agent_id = uuid.uuid4()

        client = AgentClient(
            organization_id=org_id,
            agent_id=agent_id,
            client_name="encrypted_name_token",
            client_phone="encrypted_phone_token",
        )

        assert client.organization_id == org_id
        assert client.agent_id == agent_id
        assert client.client_name == "encrypted_name_token"
        assert client.client_phone == "encrypted_phone_token"
        assert client.consent_status == ConsentStatus.PENDING

    def test_create_instance_with_optional_fields(self):
        """선택 필드 포함 AgentClient 인스턴스 생성"""
        from app.models.agent_client import AgentClient

        org_id = uuid.uuid4()
        agent_id = uuid.uuid4()

        client = AgentClient(
            organization_id=org_id,
            agent_id=agent_id,
            client_name="encrypted_name",
            client_phone="encrypted_phone",
            client_email="encrypted_email",
            notes="상담 메모",
        )

        assert client.client_email == "encrypted_email"
        assert client.notes == "상담 메모"

    def test_repr(self):
        """__repr__ 메서드가 정의되어야 함"""
        from app.models.agent_client import AgentClient

        org_id = uuid.uuid4()
        agent_id = uuid.uuid4()

        client = AgentClient(
            organization_id=org_id,
            agent_id=agent_id,
            client_name="enc_name",
            client_phone="enc_phone",
        )

        repr_str = repr(client)
        assert "AgentClient" in repr_str
