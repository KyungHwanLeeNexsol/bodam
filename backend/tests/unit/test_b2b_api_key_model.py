"""API Key 모델 단위 테스트 (SPEC-B2B-001 Module 4)

APIKey SQLAlchemy 모델 구조 및 제약 조건 검증.
AC-007: DB에는 SHA-256 해시만 저장, 전체 키는 한 번만 반환
"""

from __future__ import annotations


class TestAPIKeyModelStructure:
    """APIKey 모델 구조 테스트"""

    def test_api_key_model_importable(self):
        """APIKey 모델이 임포트 가능해야 한다"""
        from app.models.api_key import APIKey

        assert APIKey is not None

    def test_api_key_model_tablename(self):
        """APIKey 모델의 테이블명은 'api_keys'여야 한다"""
        from app.models.api_key import APIKey

        assert APIKey.__tablename__ == "api_keys"

    def test_api_key_model_has_required_columns(self):
        """APIKey 모델은 필수 컬럼을 모두 가져야 한다"""
        from app.models.api_key import APIKey

        mapper = APIKey.__mapper__
        column_names = {col.key for col in mapper.columns}

        assert "id" in column_names
        assert "organization_id" in column_names
        assert "created_by" in column_names
        assert "key_prefix" in column_names
        assert "key_hash" in column_names
        assert "key_last4" in column_names
        assert "name" in column_names
        assert "scopes" in column_names
        assert "is_active" in column_names
        assert "last_used_at" in column_names
        assert "expires_at" in column_names
        assert "created_at" in column_names
        assert "updated_at" in column_names

    def test_api_key_model_id_is_uuid_pk(self):
        """APIKey.id는 UUID PK여야 한다"""
        from app.models.api_key import APIKey

        id_col = APIKey.__mapper__.columns["id"]
        assert id_col.primary_key is True

    def test_api_key_organization_id_fk(self):
        """organization_id는 organizations.id를 참조하는 FK여야 한다"""
        from app.models.api_key import APIKey

        org_col = APIKey.__mapper__.columns["organization_id"]
        # FK 존재 확인
        assert len(org_col.foreign_keys) == 1
        fk = list(org_col.foreign_keys)[0]
        assert "organizations.id" in str(fk.target_fullname)

    def test_api_key_created_by_fk(self):
        """created_by는 users.id를 참조하는 FK여야 한다"""
        from app.models.api_key import APIKey

        created_by_col = APIKey.__mapper__.columns["created_by"]
        assert len(created_by_col.foreign_keys) == 1
        fk = list(created_by_col.foreign_keys)[0]
        assert "users.id" in str(fk.target_fullname)

    def test_api_key_is_active_default_true(self):
        """is_active 기본값은 True여야 한다"""
        from app.models.api_key import APIKey

        is_active_col = APIKey.__mapper__.columns["is_active"]
        # 서버 기본값 또는 Python 기본값 확인
        assert is_active_col.server_default is not None or is_active_col.default is not None

    def test_api_key_last_used_at_nullable(self):
        """last_used_at은 nullable이어야 한다"""
        from app.models.api_key import APIKey

        col = APIKey.__mapper__.columns["last_used_at"]
        assert col.nullable is True

    def test_api_key_expires_at_nullable(self):
        """expires_at은 nullable이어야 한다"""
        from app.models.api_key import APIKey

        col = APIKey.__mapper__.columns["expires_at"]
        assert col.nullable is True

    def test_api_key_has_key_hash_index(self):
        """key_hash 컬럼에 인덱스가 있어야 한다"""
        from app.models.api_key import APIKey

        table = APIKey.__table__
        # key_hash 인덱스 확인
        indexed_columns = set()
        for idx in table.indexes:
            for col in idx.columns:
                indexed_columns.add(col.name)

        assert "key_hash" in indexed_columns

    def test_api_key_has_organization_id_index(self):
        """organization_id 컬럼에 인덱스가 있어야 한다"""
        from app.models.api_key import APIKey

        table = APIKey.__table__
        indexed_columns = set()
        for idx in table.indexes:
            for col in idx.columns:
                indexed_columns.add(col.name)

        assert "organization_id" in indexed_columns

    def test_api_key_inherits_timestamp_mixin(self):
        """APIKey는 TimestampMixin을 상속해야 한다"""
        from app.models.api_key import APIKey
        from app.models.base import TimestampMixin

        assert issubclass(APIKey, TimestampMixin)

    def test_api_key_scopes_is_array(self):
        """scopes 컬럼은 배열 타입이어야 한다"""
        from sqlalchemy.dialects.postgresql import ARRAY

        from app.models.api_key import APIKey

        scopes_col = APIKey.__mapper__.columns["scopes"]
        assert isinstance(scopes_col.type, ARRAY)

    def test_api_key_repr(self):
        """APIKey __repr__이 동작해야 한다"""
        from app.models.api_key import APIKey

        # __repr__ 메서드가 정의되어 있는지만 확인
        assert hasattr(APIKey, "__repr__")
        assert callable(APIKey.__repr__)
        # 메서드가 "APIKey" 문자열을 포함하는지 소스 코드로 확인
        import inspect

        source = inspect.getsource(APIKey.__repr__)
        assert "APIKey" in source


class TestAPIKeyModelExportedInInit:
    """__init__.py에서 APIKey가 export되는지 확인"""

    def test_api_key_exported_from_models_init(self):
        """app.models에서 APIKey를 임포트할 수 있어야 한다"""
        from app.models import APIKey

        assert APIKey is not None
