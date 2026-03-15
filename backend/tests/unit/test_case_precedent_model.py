"""CasePrecedent SQLAlchemy 모델 단위 테스트

SPEC-GUIDANCE-001 Phase G1: 판례 모델 필드, 테이블명, 제약조건 검증.
"""

from __future__ import annotations

import uuid

from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects.postgresql import JSONB

from app.models.case_precedent import CasePrecedent


class TestCasePrecedentTableMeta:
    """테이블 메타데이터 검증"""

    def test_tablename_is_case_precedents(self) -> None:
        """테이블명이 case_precedents인지 확인"""
        assert CasePrecedent.__tablename__ == "case_precedents"

    def test_has_primary_key_id(self) -> None:
        """id 컬럼이 primary key인지 확인"""
        table = CasePrecedent.__table__
        pk_cols = [c.name for c in table.primary_key.columns]
        assert "id" in pk_cols

    def test_id_has_server_default_gen_random_uuid(self) -> None:
        """id 컬럼에 gen_random_uuid() server_default 설정 확인"""
        col = CasePrecedent.__table__.c["id"]
        assert col.server_default is not None


class TestCasePrecedentRequiredFields:
    """필수(not null) 필드 검증"""

    def test_case_number_field_exists_and_not_nullable(self) -> None:
        """case_number 컬럼 존재 및 nullable=False 확인"""
        col = CasePrecedent.__table__.c["case_number"]
        assert col is not None
        assert col.nullable is False

    def test_case_number_max_length_100(self) -> None:
        """case_number 최대 길이 100 확인"""
        col = CasePrecedent.__table__.c["case_number"]
        assert col.type.length == 100

    def test_case_number_unique_constraint(self) -> None:
        """case_number 유니크 제약 조건 확인"""
        col = CasePrecedent.__table__.c["case_number"]
        assert col.unique is True

    def test_court_name_field_exists_and_not_nullable(self) -> None:
        """court_name 컬럼 존재 및 nullable=False 확인"""
        col = CasePrecedent.__table__.c["court_name"]
        assert col is not None
        assert col.nullable is False

    def test_court_name_max_length_200(self) -> None:
        """court_name 최대 길이 200 확인"""
        col = CasePrecedent.__table__.c["court_name"]
        assert col.type.length == 200

    def test_decision_date_field_exists_and_not_nullable(self) -> None:
        """decision_date 컬럼 존재 및 nullable=False 확인"""
        col = CasePrecedent.__table__.c["decision_date"]
        assert col is not None
        assert col.nullable is False

    def test_case_type_field_exists_and_not_nullable(self) -> None:
        """case_type 컬럼 존재 및 nullable=False 확인"""
        col = CasePrecedent.__table__.c["case_type"]
        assert col is not None
        assert col.nullable is False

    def test_case_type_max_length_100(self) -> None:
        """case_type 최대 길이 100 확인"""
        col = CasePrecedent.__table__.c["case_type"]
        assert col.type.length == 100

    def test_summary_field_exists_and_not_nullable(self) -> None:
        """summary 컬럼 존재 및 nullable=False 확인"""
        col = CasePrecedent.__table__.c["summary"]
        assert col is not None
        assert col.nullable is False

    def test_ruling_field_exists_and_not_nullable(self) -> None:
        """ruling 컬럼 존재 및 nullable=False 확인"""
        col = CasePrecedent.__table__.c["ruling"]
        assert col is not None
        assert col.nullable is False


class TestCasePrecedentNullableFields:
    """선택(nullable) 필드 검증"""

    def test_insurance_type_is_nullable(self) -> None:
        """insurance_type 컬럼 nullable 확인"""
        col = CasePrecedent.__table__.c["insurance_type"]
        assert col is not None
        assert col.nullable is True

    def test_key_clauses_is_nullable_jsonb(self) -> None:
        """key_clauses 컬럼이 JSONB nullable인지 확인"""
        col = CasePrecedent.__table__.c["key_clauses"]
        assert col is not None
        assert col.nullable is True
        assert isinstance(col.type, JSONB)

    def test_embedding_is_nullable(self) -> None:
        """embedding 컬럼이 nullable인지 확인"""
        col = CasePrecedent.__table__.c["embedding"]
        assert col is not None
        assert col.nullable is True

    def test_source_url_is_nullable(self) -> None:
        """source_url 컬럼이 nullable인지 확인"""
        col = CasePrecedent.__table__.c["source_url"]
        assert col is not None
        assert col.nullable is True

    def test_source_url_max_length_500(self) -> None:
        """source_url 최대 길이 500 확인"""
        col = CasePrecedent.__table__.c["source_url"]
        assert col.type.length == 500

    def test_metadata_is_nullable_jsonb(self) -> None:
        """metadata_ 컬럼이 JSONB nullable인지 확인"""
        col = CasePrecedent.__table__.c["metadata_"]
        assert col is not None
        assert col.nullable is True
        assert isinstance(col.type, JSONB)


class TestCasePrecedentEmbedding:
    """임베딩 벡터 타입 검증"""

    def test_embedding_vector_dimension_1536(self) -> None:
        """embedding 컬럼이 Vector(1536) 타입인지 확인"""
        col = CasePrecedent.__table__.c["embedding"]
        # pgvector Vector 타입 확인
        assert isinstance(col.type, Vector)
        assert col.type.dim == 1536


class TestCasePrecedentCreatedAt:
    """생성 시각 필드 검증"""

    def test_created_at_field_exists(self) -> None:
        """created_at 컬럼 존재 확인"""
        col = CasePrecedent.__table__.c["created_at"]
        assert col is not None

    def test_created_at_has_server_default(self) -> None:
        """created_at에 server_default 설정 확인"""
        col = CasePrecedent.__table__.c["created_at"]
        assert col.server_default is not None

    def test_created_at_timezone_aware(self) -> None:
        """created_at이 timezone-aware DateTime인지 확인"""
        col = CasePrecedent.__table__.c["created_at"]
        assert col.type.timezone is True


class TestCasePrecedentRepr:
    """__repr__ 메서드 검증"""

    def test_repr_contains_id_and_case_number(self) -> None:
        """__repr__에 id와 case_number 포함 확인"""
        instance = CasePrecedent()
        instance.id = uuid.uuid4()
        instance.case_number = "2024가합12345"
        repr_str = repr(instance)
        assert "CasePrecedent" in repr_str
        assert "2024가합12345" in repr_str
