"""UsageRecord 모델 단위 테스트 (SPEC-B2B-001 Phase 4)

UsageRecord SQLAlchemy 모델 구조 및 제약 조건 검증.
AC-009: API 요청 시 사용량 자동 기록
"""

from __future__ import annotations


class TestUsageRecordModelStructure:
    """UsageRecord 모델 구조 테스트"""

    def test_usage_record_model_importable(self):
        """UsageRecord 모델이 임포트 가능해야 한다"""
        from app.models.usage_record import UsageRecord

        assert UsageRecord is not None

    def test_usage_record_model_tablename(self):
        """UsageRecord 모델의 테이블명은 'usage_records'여야 한다"""
        from app.models.usage_record import UsageRecord

        assert UsageRecord.__tablename__ == "usage_records"

    def test_usage_record_model_has_required_columns(self):
        """UsageRecord 모델은 필수 컬럼을 모두 가져야 한다"""
        from app.models.usage_record import UsageRecord

        mapper = UsageRecord.__mapper__
        column_names = {col.key for col in mapper.columns}

        assert "id" in column_names
        assert "organization_id" in column_names
        assert "api_key_id" in column_names
        assert "user_id" in column_names
        assert "endpoint" in column_names
        assert "method" in column_names
        assert "status_code" in column_names
        assert "tokens_consumed" in column_names
        assert "response_time_ms" in column_names
        assert "ip_address" in column_names
        assert "created_at" in column_names

    def test_usage_record_model_id_is_uuid_pk(self):
        """UsageRecord.id는 UUID PK여야 한다"""
        from sqlalchemy.dialects.postgresql import UUID

        from app.models.usage_record import UsageRecord

        id_col = UsageRecord.__mapper__.columns["id"]
        assert id_col.primary_key
        assert isinstance(id_col.type, UUID)

    def test_usage_record_organization_id_fk(self):
        """organization_id는 organizations.id를 참조하는 FK여야 한다"""
        from app.models.usage_record import UsageRecord

        org_col = UsageRecord.__mapper__.columns["organization_id"]
        fk_tables = {fk.column.table.name for fk in org_col.foreign_keys}
        assert "organizations" in fk_tables

    def test_usage_record_api_key_id_nullable(self):
        """api_key_id는 nullable이어야 한다 (JWT 인증 시 None)"""
        from app.models.usage_record import UsageRecord

        col = UsageRecord.__mapper__.columns["api_key_id"]
        assert col.nullable

    def test_usage_record_user_id_nullable(self):
        """user_id는 nullable이어야 한다 (API 키 인증 시 None)"""
        from app.models.usage_record import UsageRecord

        col = UsageRecord.__mapper__.columns["user_id"]
        assert col.nullable

    def test_usage_record_tokens_consumed_default_zero(self):
        """tokens_consumed의 기본값은 0이어야 한다"""
        from app.models.usage_record import UsageRecord

        col = UsageRecord.__mapper__.columns["tokens_consumed"]
        # 서버 기본값 또는 Python 기본값 확인
        assert col.server_default is not None or col.default is not None

    def test_usage_record_has_indexes(self):
        """UsageRecord는 인덱스를 가져야 한다"""
        from app.models.usage_record import UsageRecord

        # __table_args__가 정의되어 있어야 함
        assert hasattr(UsageRecord, "__table_args__")
        assert UsageRecord.__table_args__ is not None


class TestUsageRecordInit:
    """UsageRecord 초기화 테스트"""

    def test_usage_record_can_be_instantiated(self):
        """UsageRecord를 기본값으로 생성할 수 있어야 한다"""
        import uuid

        from app.models.usage_record import UsageRecord

        org_id = uuid.uuid4()
        record = UsageRecord(
            organization_id=org_id,
            endpoint="/api/v1/b2b/clients",
            method="GET",
            status_code=200,
            response_time_ms=150,
            ip_address="192.168.1.1",
        )

        assert record.organization_id == org_id
        assert record.endpoint == "/api/v1/b2b/clients"
        assert record.method == "GET"
        assert record.status_code == 200
        assert record.response_time_ms == 150
        assert record.ip_address == "192.168.1.1"

    def test_usage_record_api_key_id_defaults_none(self):
        """api_key_id가 지정되지 않으면 None이어야 한다"""
        import uuid

        from app.models.usage_record import UsageRecord

        record = UsageRecord(
            organization_id=uuid.uuid4(),
            endpoint="/api/v1/b2b/test",
            method="POST",
            status_code=201,
            response_time_ms=200,
            ip_address="10.0.0.1",
        )

        assert record.api_key_id is None

    def test_usage_record_user_id_defaults_none(self):
        """user_id가 지정되지 않으면 None이어야 한다"""
        import uuid

        from app.models.usage_record import UsageRecord

        record = UsageRecord(
            organization_id=uuid.uuid4(),
            endpoint="/api/v1/b2b/test",
            method="GET",
            status_code=200,
            response_time_ms=100,
            ip_address="10.0.0.1",
        )

        assert record.user_id is None

    def test_usage_record_repr(self):
        """UsageRecord __repr__이 의미있는 문자열을 반환해야 한다"""
        import uuid

        from app.models.usage_record import UsageRecord

        org_id = uuid.uuid4()
        record = UsageRecord(
            organization_id=org_id,
            endpoint="/api/v1/b2b/test",
            method="GET",
            status_code=200,
            response_time_ms=100,
            ip_address="127.0.0.1",
        )

        repr_str = repr(record)
        assert "UsageRecord" in repr_str


class TestUsageRecordModelsInit:
    """models/__init__.py UsageRecord export 테스트"""

    def test_usage_record_exported_from_models(self):
        """UsageRecord가 models 패키지에서 임포트 가능해야 한다"""
        from app.models import UsageRecord

        assert UsageRecord is not None
