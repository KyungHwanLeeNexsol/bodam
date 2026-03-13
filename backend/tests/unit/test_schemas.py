"""보험 도메인 Pydantic 스키마 단위 테스트 (TAG-004)

스키마 필드, 기본값, 유효성 검사를 테스트.
"""

from __future__ import annotations

import uuid


# ─────────────────────────────────────────────
# TAG-004-01: InsuranceCompany 스키마 검증
# ─────────────────────────────────────────────
class TestInsuranceCompanySchemas:
    """InsuranceCompany 스키마 테스트"""

    def test_create_schema_required_fields(self) -> None:
        """InsuranceCompanyCreate는 name, code가 필수여야 함"""
        from app.schemas.insurance import InsuranceCompanyCreate

        obj = InsuranceCompanyCreate(name="삼성생명", code="samsung-life")
        assert obj.name == "삼성생명"
        assert obj.code == "samsung-life"

    def test_create_schema_optional_fields(self) -> None:
        """InsuranceCompanyCreate의 선택 필드 기본값 검증"""
        from app.schemas.insurance import InsuranceCompanyCreate

        obj = InsuranceCompanyCreate(name="삼성생명", code="samsung-life")
        assert obj.logo_url is None
        assert obj.website_url is None
        assert obj.is_active is True

    def test_update_schema_all_optional(self) -> None:
        """InsuranceCompanyUpdate는 모든 필드가 선택사항이어야 함"""
        from app.schemas.insurance import InsuranceCompanyUpdate

        # 아무 필드 없이 인스턴스 생성 가능해야 함
        obj = InsuranceCompanyUpdate()
        assert obj is not None

    def test_response_schema_has_id(self) -> None:
        """InsuranceCompanyResponse는 id 필드가 있어야 함"""
        from app.schemas.insurance import InsuranceCompanyResponse

        company_id = uuid.uuid4()
        obj = InsuranceCompanyResponse(
            id=company_id,
            name="삼성생명",
            code="samsung-life",
            is_active=True,
        )
        assert obj.id == company_id


# ─────────────────────────────────────────────
# TAG-004-02: Policy 스키마 검증
# ─────────────────────────────────────────────
class TestPolicySchemas:
    """Policy 스키마 테스트"""

    def test_create_schema_required_fields(self) -> None:
        """PolicyCreate는 company_id, name, product_code, category가 필수여야 함"""
        from app.models.insurance import InsuranceCategory
        from app.schemas.insurance import PolicyCreate

        company_id = uuid.uuid4()
        obj = PolicyCreate(
            company_id=company_id,
            name="종신보험",
            product_code="P001",
            category=InsuranceCategory.LIFE,
        )
        assert obj.company_id == company_id
        assert obj.category == InsuranceCategory.LIFE

    def test_response_schema_has_id_and_company_id(self) -> None:
        """PolicyResponse는 id, company_id 필드가 있어야 함"""
        from app.models.insurance import InsuranceCategory
        from app.schemas.insurance import PolicyResponse

        policy_id = uuid.uuid4()
        company_id = uuid.uuid4()
        obj = PolicyResponse(
            id=policy_id,
            company_id=company_id,
            name="종신보험",
            product_code="P001",
            category=InsuranceCategory.LIFE,
            is_discontinued=False,
        )
        assert obj.id == policy_id
        assert obj.company_id == company_id


# ─────────────────────────────────────────────
# TAG-004-03: Coverage 스키마 검증
# ─────────────────────────────────────────────
class TestCoverageSchemas:
    """Coverage 스키마 테스트"""

    def test_create_schema_required_fields(self) -> None:
        """CoverageCreate는 policy_id, name, coverage_type이 필수여야 함"""
        from app.schemas.insurance import CoverageCreate

        policy_id = uuid.uuid4()
        obj = CoverageCreate(
            policy_id=policy_id,
            name="암 진단비",
            coverage_type="진단비",
        )
        assert obj.policy_id == policy_id
        assert obj.name == "암 진단비"


# ─────────────────────────────────────────────
# TAG-004-04: SemanticSearch 스키마 검증
# ─────────────────────────────────────────────
class TestSemanticSearchSchemas:
    """SemanticSearchRequest/Response 스키마 테스트"""

    def test_request_defaults(self) -> None:
        """SemanticSearchRequest 기본값 검증"""
        from app.schemas.insurance import SemanticSearchRequest

        req = SemanticSearchRequest(query="암 진단비 보장 범위")
        assert req.query == "암 진단비 보장 범위"
        assert req.top_k == 5
        assert req.threshold == 0.8
        assert req.company_id is None
        assert req.category is None

    def test_request_custom_values(self) -> None:
        """SemanticSearchRequest 커스텀 값 설정 검증"""
        from app.models.insurance import InsuranceCategory
        from app.schemas.insurance import SemanticSearchRequest

        company_id = uuid.uuid4()
        req = SemanticSearchRequest(
            query="사망 보험금",
            top_k=10,
            threshold=0.7,
            company_id=company_id,
            category=InsuranceCategory.LIFE,
        )
        assert req.top_k == 10
        assert req.threshold == 0.7
        assert req.company_id == company_id

    def test_search_result_schema(self) -> None:
        """SearchResult 스키마 필드 검증"""
        from app.schemas.insurance import SearchResult

        chunk_id = uuid.uuid4()
        policy_id = uuid.uuid4()
        result = SearchResult(
            chunk_id=chunk_id,
            policy_id=policy_id,
            chunk_text="암 진단비는 최초 진단 시 지급됩니다.",
            similarity=0.92,
        )
        assert result.chunk_id == chunk_id
        assert result.similarity == 0.92

    def test_semantic_search_response_schema(self) -> None:
        """SemanticSearchResponse 스키마 필드 검증"""
        from app.schemas.insurance import SearchResult, SemanticSearchResponse

        chunk_id = uuid.uuid4()
        policy_id = uuid.uuid4()
        results = [
            SearchResult(
                chunk_id=chunk_id,
                policy_id=policy_id,
                chunk_text="테스트",
                similarity=0.9,
            )
        ]
        response = SemanticSearchResponse(results=results, total=1)
        assert len(response.results) == 1
        assert response.total == 1
