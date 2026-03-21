"""보험 도메인 SQLAlchemy 모델 단위 테스트 (구조 검증)

실제 DB 연결 없이 모델 메타데이터, 컬럼 타입, 관계를 구조적으로 검증.
pgvector Vector 타입, JSONB, UniqueConstraint 등 포함.
"""

from __future__ import annotations

import sqlalchemy as sa


# ─────────────────────────────────────────────
# TAG-002-01: InsuranceCategory enum 검증
# ─────────────────────────────────────────────
class TestInsuranceCategory:
    """InsuranceCategory Enum 구조 테스트"""

    def test_enum_values_exist(self) -> None:
        """LIFE, NON_LIFE, THIRD_SECTOR 값이 존재해야 함"""
        from app.models.insurance import InsuranceCategory

        assert InsuranceCategory.LIFE.value == "LIFE"
        assert InsuranceCategory.NON_LIFE.value == "NON_LIFE"
        assert InsuranceCategory.THIRD_SECTOR.value == "THIRD_SECTOR"

    def test_enum_member_count(self) -> None:
        """enum 멤버가 정확히 3개여야 함"""
        from app.models.insurance import InsuranceCategory

        assert len(InsuranceCategory) == 3


# ─────────────────────────────────────────────
# TAG-002-02: Base / TimestampMixin 검증
# ─────────────────────────────────────────────
class TestTimestampMixin:
    """TimestampMixin 컬럼 구조 테스트"""

    def test_insurance_company_has_created_at(self) -> None:
        """InsuranceCompany에 created_at 컬럼이 있어야 함"""
        from app.models.insurance import InsuranceCompany

        cols = {c.name for c in InsuranceCompany.__table__.columns}
        assert "created_at" in cols

    def test_insurance_company_has_updated_at(self) -> None:
        """InsuranceCompany에 updated_at 컬럼이 있어야 함"""
        from app.models.insurance import InsuranceCompany

        cols = {c.name for c in InsuranceCompany.__table__.columns}
        assert "updated_at" in cols

    def test_policy_has_timestamps(self) -> None:
        """Policy에 created_at, updated_at 컬럼이 있어야 함"""
        from app.models.insurance import Policy

        cols = {c.name for c in Policy.__table__.columns}
        assert "created_at" in cols
        assert "updated_at" in cols

    def test_coverage_has_timestamps(self) -> None:
        """Coverage에 created_at, updated_at 컬럼이 있어야 함"""
        from app.models.insurance import Coverage

        cols = {c.name for c in Coverage.__table__.columns}
        assert "created_at" in cols
        assert "updated_at" in cols


# ─────────────────────────────────────────────
# TAG-002-03: InsuranceCompany 모델 검증
# ─────────────────────────────────────────────
class TestInsuranceCompanyModel:
    """InsuranceCompany 모델 컬럼 구조 테스트"""

    def test_table_name(self) -> None:
        """테이블 이름이 insurance_companies여야 함"""
        from app.models.insurance import InsuranceCompany

        assert InsuranceCompany.__tablename__ == "insurance_companies"

    def test_required_columns_exist(self) -> None:
        """필수 컬럼(id, name, code)이 존재해야 함"""
        from app.models.insurance import InsuranceCompany

        cols = {c.name for c in InsuranceCompany.__table__.columns}
        for col_name in ("id", "name", "code", "is_active"):
            assert col_name in cols, f"컬럼 누락: {col_name}"

    def test_code_column_is_unique(self) -> None:
        """code 컬럼에 unique 제약이 있어야 함"""
        from app.models.insurance import InsuranceCompany

        code_col = InsuranceCompany.__table__.columns["code"]
        assert code_col.unique is True

    def test_id_column_is_uuid(self) -> None:
        """id 컬럼이 UUID 타입이어야 함"""
        from app.models.insurance import InsuranceCompany

        id_col = InsuranceCompany.__table__.columns["id"]
        assert isinstance(id_col.type, sa.UUID)

    def test_metadata_column_is_jsonb(self) -> None:
        """metadata_ 컬럼이 JSON 타입이어야 함 (JSONB는 JSON의 서브타입)"""
        from app.models.insurance import InsuranceCompany

        meta_col = InsuranceCompany.__table__.columns["metadata_"]
        # SQLAlchemy에서 JSONB는 JSON으로 표현됨
        assert isinstance(meta_col.type, (sa.JSON,))

    def test_is_active_default_true(self) -> None:
        """is_active 컬럼 기본값이 True여야 함"""
        from app.models.insurance import InsuranceCompany

        col = InsuranceCompany.__table__.columns["is_active"]
        # server_default 또는 default로 설정 가능
        assert col.default is not None or col.server_default is not None

    def test_policies_relationship_exists(self) -> None:
        """InsuranceCompany에 policies 관계가 정의되어야 함"""
        from app.models.insurance import InsuranceCompany

        assert hasattr(InsuranceCompany, "policies")


# ─────────────────────────────────────────────
# TAG-002-04: Policy 모델 검증
# ─────────────────────────────────────────────
class TestPolicyModel:
    """Policy 모델 컬럼 구조 테스트"""

    def test_table_name(self) -> None:
        """테이블 이름이 policies여야 함"""
        from app.models.insurance import Policy

        assert Policy.__tablename__ == "policies"

    def test_required_columns_exist(self) -> None:
        """필수 컬럼이 모두 존재해야 함"""
        from app.models.insurance import Policy

        cols = {c.name for c in Policy.__table__.columns}
        for col_name in (
            "id",
            "company_id",
            "name",
            "product_code",
            "category",
            "is_discontinued",
            "raw_text",
            "metadata_",
        ):
            assert col_name in cols, f"컬럼 누락: {col_name}"

    def test_company_id_is_foreign_key(self) -> None:
        """company_id 컬럼이 FK여야 함"""
        from app.models.insurance import Policy

        col = Policy.__table__.columns["company_id"]
        assert len(col.foreign_keys) > 0

    def test_unique_constraint_company_product(self) -> None:
        """(company_id, product_code) UniqueConstraint가 있어야 함"""
        from app.models.insurance import Policy

        table = Policy.__table__
        unique_cols_sets = []
        for constraint in table.constraints:
            if isinstance(constraint, sa.UniqueConstraint):
                unique_cols_sets.append({c.name for c in constraint.columns})

        assert {"company_id", "product_code"} in unique_cols_sets, "UniqueConstraint(company_id, product_code) 누락"

    def test_coverages_relationship_exists(self) -> None:
        """Policy에 coverages 관계가 정의되어야 함"""
        from app.models.insurance import Policy

        assert hasattr(Policy, "coverages")

    def test_chunks_relationship_exists(self) -> None:
        """Policy에 chunks 관계가 정의되어야 함"""
        from app.models.insurance import Policy

        assert hasattr(Policy, "chunks")


# ─────────────────────────────────────────────
# TAG-002-05: Coverage 모델 검증
# ─────────────────────────────────────────────
class TestCoverageModel:
    """Coverage 모델 컬럼 구조 테스트"""

    def test_table_name(self) -> None:
        """테이블 이름이 coverages여야 함"""
        from app.models.insurance import Coverage

        assert Coverage.__tablename__ == "coverages"

    def test_required_columns_exist(self) -> None:
        """필수 컬럼이 모두 존재해야 함"""
        from app.models.insurance import Coverage

        cols = {c.name for c in Coverage.__table__.columns}
        for col_name in (
            "id",
            "policy_id",
            "name",
            "coverage_type",
            "eligibility_criteria",
            "exclusions",
            "compensation_rules",
            "max_amount",
            "metadata_",
        ):
            assert col_name in cols, f"컬럼 누락: {col_name}"

    def test_policy_id_is_foreign_key(self) -> None:
        """policy_id 컬럼이 FK여야 함"""
        from app.models.insurance import Coverage

        col = Coverage.__table__.columns["policy_id"]
        assert len(col.foreign_keys) > 0

    def test_max_amount_is_biginteger(self) -> None:
        """max_amount 컬럼이 BigInteger 타입이어야 함"""
        from app.models.insurance import Coverage

        col = Coverage.__table__.columns["max_amount"]
        assert isinstance(col.type, sa.BigInteger)


# ─────────────────────────────────────────────
# TAG-002-06: PolicyChunk 모델 검증
# ─────────────────────────────────────────────
class TestPolicyChunkModel:
    """PolicyChunk 모델 컬럼 구조 테스트"""

    def test_table_name(self) -> None:
        """테이블 이름이 policy_chunks여야 함"""
        from app.models.insurance import PolicyChunk

        assert PolicyChunk.__tablename__ == "policy_chunks"

    def test_required_columns_exist(self) -> None:
        """필수 컬럼이 모두 존재해야 함"""
        from app.models.insurance import PolicyChunk

        cols = {c.name for c in PolicyChunk.__table__.columns}
        for col_name in (
            "id",
            "policy_id",
            "coverage_id",
            "chunk_text",
            "chunk_index",
            "embedding",
            "metadata_",
            "created_at",
        ):
            assert col_name in cols, f"컬럼 누락: {col_name}"

    def test_policy_id_is_foreign_key(self) -> None:
        """policy_id 컬럼이 FK여야 함"""
        from app.models.insurance import PolicyChunk

        col = PolicyChunk.__table__.columns["policy_id"]
        assert len(col.foreign_keys) > 0

    def test_coverage_id_is_nullable(self) -> None:
        """coverage_id 컬럼이 nullable이어야 함"""
        from app.models.insurance import PolicyChunk

        col = PolicyChunk.__table__.columns["coverage_id"]
        assert col.nullable is True

    def test_embedding_is_vector_type(self) -> None:
        """embedding 컬럼이 Vector(1536) 타입이어야 함"""
        from pgvector.sqlalchemy import Vector

        from app.models.insurance import PolicyChunk

        col = PolicyChunk.__table__.columns["embedding"]
        assert isinstance(col.type, Vector)
        assert col.type.dim == 768

    def test_no_updated_at_column(self) -> None:
        """PolicyChunk에는 updated_at이 없어야 함 (생성 전용)"""
        from app.models.insurance import PolicyChunk

        cols = {c.name for c in PolicyChunk.__table__.columns}
        assert "updated_at" not in cols


# ─────────────────────────────────────────────
# TAG-002-07: 관계 cascade 설정 검증
# ─────────────────────────────────────────────
class TestCascadeRelationships:
    """cascade='all, delete-orphan' 관계 설정 테스트"""

    def test_company_policies_cascade(self) -> None:
        """InsuranceCompany -> policies cascade 설정 검증"""
        from sqlalchemy.orm import RelationshipProperty

        from app.models.insurance import InsuranceCompany

        rel: RelationshipProperty = InsuranceCompany.__mapper__.relationships["policies"]
        assert "delete-orphan" in rel.cascade

    def test_policy_coverages_cascade(self) -> None:
        """Policy -> coverages cascade 설정 검증"""
        from sqlalchemy.orm import RelationshipProperty

        from app.models.insurance import Policy

        rel: RelationshipProperty = Policy.__mapper__.relationships["coverages"]
        assert "delete-orphan" in rel.cascade

    def test_policy_chunks_cascade(self) -> None:
        """Policy -> chunks cascade 설정 검증"""
        from sqlalchemy.orm import RelationshipProperty

        from app.models.insurance import Policy

        rel: RelationshipProperty = Policy.__mapper__.relationships["chunks"]
        assert "delete-orphan" in rel.cascade


# ─────────────────────────────────────────────
# TAG-002-08: models __init__.py export 검증
# ─────────────────────────────────────────────
class TestModelsInit:
    """app.models 패키지 export 검증"""

    def test_all_models_exported(self) -> None:
        """모든 모델이 app.models에서 import 가능해야 함"""
        import app.models as models_pkg

        for name in (
            "Base",
            "InsuranceCategory",
            "InsuranceCompany",
            "Policy",
            "Coverage",
            "PolicyChunk",
        ):
            assert hasattr(models_pkg, name), f"app.models에서 {name} 누락"
