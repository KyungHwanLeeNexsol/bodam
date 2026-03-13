"""Admin API 통합 테스트 (TAG-018)

Companies, Policies, Coverages CRUD 엔드포인트 테스트.
실제 DB 없이 AsyncMock으로 세션을 모킹하여 API 동작을 검증.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.models.insurance import InsuranceCategory

# ─────────────────────────────────────────────
# 테스트 데이터 팩토리 헬퍼
# ─────────────────────────────────────────────


def _make_company(
    company_id: uuid.UUID | None = None,
    name: str = "삼성생명",
    code: str = "samsung-life",
    is_active: bool = True,
) -> MagicMock:
    """InsuranceCompany 모델 모킹 객체 생성"""
    obj = MagicMock()
    obj.id = company_id or uuid.uuid4()
    obj.name = name
    obj.code = code
    obj.logo_url = None
    obj.website_url = None
    obj.is_active = is_active
    obj.metadata_ = None
    obj.created_at = datetime(2024, 1, 1)
    obj.updated_at = datetime(2024, 1, 1)
    return obj


def _make_policy(
    policy_id: uuid.UUID | None = None,
    company_id: uuid.UUID | None = None,
    name: str = "삼성 종신보험",
    product_code: str = "POL-001",
    category: InsuranceCategory = InsuranceCategory.LIFE,
    is_discontinued: bool = False,
) -> MagicMock:
    """Policy 모델 모킹 객체 생성"""
    obj = MagicMock()
    obj.id = policy_id or uuid.uuid4()
    obj.company_id = company_id or uuid.uuid4()
    obj.name = name
    obj.product_code = product_code
    obj.category = category
    obj.effective_date = None
    obj.expiry_date = None
    obj.is_discontinued = is_discontinued
    obj.metadata_ = None
    obj.created_at = datetime(2024, 1, 1)
    obj.updated_at = datetime(2024, 1, 1)
    obj.coverages = []
    return obj


def _make_coverage(
    coverage_id: uuid.UUID | None = None,
    policy_id: uuid.UUID | None = None,
    name: str = "암 진단비",
    coverage_type: str = "진단비",
) -> MagicMock:
    """Coverage 모델 모킹 객체 생성"""
    obj = MagicMock()
    obj.id = coverage_id or uuid.uuid4()
    obj.policy_id = policy_id or uuid.uuid4()
    obj.name = name
    obj.coverage_type = coverage_type
    obj.eligibility_criteria = None
    obj.exclusions = None
    obj.compensation_rules = None
    obj.max_amount = None
    obj.metadata_ = None
    obj.created_at = datetime(2024, 1, 1)
    obj.updated_at = datetime(2024, 1, 1)
    return obj


def _make_mock_session(scalar_one_or_none=None, scalars_all=None) -> AsyncMock:
    """AsyncSession 모킹 객체 생성"""
    session = AsyncMock()

    # execute 결과 체인 설정
    execute_result = MagicMock()
    execute_result.scalar_one_or_none = MagicMock(return_value=scalar_one_or_none)

    scalars_result = MagicMock()
    scalars_result.all = MagicMock(return_value=scalars_all or [])
    execute_result.scalars = MagicMock(return_value=scalars_result)

    session.execute = AsyncMock(return_value=execute_result)
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    session.delete = AsyncMock()

    return session


# ─────────────────────────────────────────────
# 픽스처
# ─────────────────────────────────────────────


@pytest.fixture
async def admin_client():
    """Admin API 테스트용 비동기 HTTP 클라이언트"""
    from app.core.database import get_db
    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test", follow_redirects=True) as client:
        yield client, app, get_db


# ─────────────────────────────────────────────
# TAG-018: Companies CRUD 테스트
# ─────────────────────────────────────────────


class TestCompaniesCreate:
    """POST /api/v1/admin/companies 테스트"""

    async def test_create_company_returns_201(self, admin_client):
        """보험사 생성 시 201 상태코드와 생성된 보험사 정보 반환"""
        client, app, get_db = admin_client

        company = _make_company()
        mock_session = _make_mock_session()
        mock_session.refresh = AsyncMock(side_effect=lambda obj: None)

        # refresh 후 company 속성 설정
        async def mock_refresh(obj):
            obj.id = company.id
            obj.name = company.name
            obj.code = company.code
            obj.logo_url = company.logo_url
            obj.website_url = company.website_url
            obj.is_active = company.is_active
            obj.metadata_ = company.metadata_
            obj.created_at = company.created_at
            obj.updated_at = company.updated_at

        mock_session.refresh = AsyncMock(side_effect=mock_refresh)

        async def override_get_db():
            yield mock_session

        app.dependency_overrides[get_db] = override_get_db

        try:
            response = await client.post(
                "/api/v1/admin/companies",
                json={
                    "name": "삼성생명",
                    "code": "samsung-life",
                    "is_active": True,
                },
            )
            assert response.status_code == 201
            data = response.json()
            assert data["name"] == "삼성생명"
            assert data["code"] == "samsung-life"
        finally:
            app.dependency_overrides.pop(get_db, None)


class TestCompaniesList:
    """GET /api/v1/admin/companies 테스트"""

    async def test_list_companies_returns_200(self, admin_client):
        """보험사 목록 조회 시 200 상태코드와 목록 반환"""
        client, app, get_db = admin_client

        companies = [
            _make_company(name="삼성생명", code="samsung-life"),
            _make_company(name="한화생명", code="hanwha-life"),
        ]
        mock_session = _make_mock_session(scalars_all=companies)

        async def override_get_db():
            yield mock_session

        app.dependency_overrides[get_db] = override_get_db

        try:
            response = await client.get("/api/v1/admin/companies")
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)
            assert len(data) == 2
        finally:
            app.dependency_overrides.pop(get_db, None)


class TestCompaniesGet:
    """GET /api/v1/admin/companies/{id} 테스트"""

    async def test_get_company_returns_200(self, admin_client):
        """보험사 ID로 조회 시 200과 보험사 정보 반환"""
        client, app, get_db = admin_client

        company_id = uuid.uuid4()
        company = _make_company(company_id=company_id)
        mock_session = _make_mock_session(scalar_one_or_none=company)

        async def override_get_db():
            yield mock_session

        app.dependency_overrides[get_db] = override_get_db

        try:
            response = await client.get(f"/api/v1/admin/companies/{company_id}")
            assert response.status_code == 200
            data = response.json()
            assert data["id"] == str(company_id)
        finally:
            app.dependency_overrides.pop(get_db, None)

    async def test_get_company_not_found_returns_404(self, admin_client):
        """존재하지 않는 보험사 ID 조회 시 404 반환"""
        client, app, get_db = admin_client

        mock_session = _make_mock_session(scalar_one_or_none=None)

        async def override_get_db():
            yield mock_session

        app.dependency_overrides[get_db] = override_get_db

        try:
            response = await client.get(f"/api/v1/admin/companies/{uuid.uuid4()}")
            assert response.status_code == 404
        finally:
            app.dependency_overrides.pop(get_db, None)


class TestCompaniesUpdate:
    """PUT /api/v1/admin/companies/{id} 테스트"""

    async def test_update_company_returns_200(self, admin_client):
        """보험사 수정 시 200과 수정된 정보 반환"""
        client, app, get_db = admin_client

        company_id = uuid.uuid4()
        company = _make_company(company_id=company_id)
        mock_session = _make_mock_session(scalar_one_or_none=company)

        async def mock_refresh(obj):
            pass

        mock_session.refresh = AsyncMock(side_effect=mock_refresh)

        async def override_get_db():
            yield mock_session

        app.dependency_overrides[get_db] = override_get_db

        try:
            response = await client.put(
                f"/api/v1/admin/companies/{company_id}",
                json={"name": "삼성생명 (변경)"},
            )
            assert response.status_code == 200
        finally:
            app.dependency_overrides.pop(get_db, None)


class TestCompaniesDelete:
    """DELETE /api/v1/admin/companies/{id} 테스트"""

    async def test_delete_company_returns_204(self, admin_client):
        """보험사 삭제 시 204 상태코드 반환"""
        client, app, get_db = admin_client

        company_id = uuid.uuid4()
        company = _make_company(company_id=company_id)
        mock_session = _make_mock_session(scalar_one_or_none=company)

        async def override_get_db():
            yield mock_session

        app.dependency_overrides[get_db] = override_get_db

        try:
            response = await client.delete(f"/api/v1/admin/companies/{company_id}")
            assert response.status_code == 204
        finally:
            app.dependency_overrides.pop(get_db, None)


# ─────────────────────────────────────────────
# TAG-018: Policies CRUD 테스트
# ─────────────────────────────────────────────


class TestPoliciesCreate:
    """POST /api/v1/admin/policies 테스트"""

    async def test_create_policy_returns_201(self, admin_client):
        """보험 상품 생성 시 201 상태코드 반환"""
        client, app, get_db = admin_client

        company_id = uuid.uuid4()
        policy = _make_policy(company_id=company_id)
        mock_session = _make_mock_session()

        async def mock_refresh(obj):
            obj.id = policy.id
            obj.company_id = policy.company_id
            obj.name = policy.name
            obj.product_code = policy.product_code
            obj.category = policy.category
            obj.effective_date = policy.effective_date
            obj.expiry_date = policy.expiry_date
            obj.is_discontinued = policy.is_discontinued
            obj.metadata_ = policy.metadata_
            obj.created_at = policy.created_at
            obj.updated_at = policy.updated_at

        mock_session.refresh = AsyncMock(side_effect=mock_refresh)

        async def override_get_db():
            yield mock_session

        app.dependency_overrides[get_db] = override_get_db

        try:
            response = await client.post(
                "/api/v1/admin/policies",
                json={
                    "company_id": str(company_id),
                    "name": "삼성 종신보험",
                    "product_code": "POL-001",
                    "category": "LIFE",
                },
            )
            assert response.status_code == 201
        finally:
            app.dependency_overrides.pop(get_db, None)

    async def test_create_policy_with_raw_text_auto_embeds(self, admin_client):
        """raw_text 포함 상품 생성 시 DocumentProcessor가 호출됨 (임베딩 자동 처리)"""
        client, app, get_db = admin_client

        company_id = uuid.uuid4()
        policy = _make_policy(company_id=company_id)
        mock_session = _make_mock_session()

        async def mock_refresh(obj):
            obj.id = policy.id
            obj.company_id = policy.company_id
            obj.name = policy.name
            obj.product_code = policy.product_code
            obj.category = policy.category
            obj.effective_date = policy.effective_date
            obj.expiry_date = policy.expiry_date
            obj.is_discontinued = policy.is_discontinued
            obj.metadata_ = policy.metadata_
            obj.created_at = policy.created_at
            obj.updated_at = policy.updated_at

        mock_session.refresh = AsyncMock(side_effect=mock_refresh)

        async def override_get_db():
            yield mock_session

        app.dependency_overrides[get_db] = override_get_db

        # DocumentProcessor는 함수 내부 지연 임포트이므로
        # app.services.parser.document_processor 모듈의 DocumentProcessor를 패치
        mock_proc_instance = AsyncMock()
        mock_proc_instance.process_text = AsyncMock(return_value=[])

        with patch(
            "app.services.parser.document_processor.DocumentProcessor",
            return_value=mock_proc_instance,
        ):
            try:
                response = await client.post(
                    "/api/v1/admin/policies",
                    json={
                        "company_id": str(company_id),
                        "name": "삼성 종신보험",
                        "product_code": "POL-001",
                        "category": "LIFE",
                        "raw_text": "이 보험 상품은 종신 보장을 제공합니다.",
                    },
                )
                assert response.status_code == 201
            finally:
                app.dependency_overrides.pop(get_db, None)


class TestPoliciesList:
    """GET /api/v1/admin/policies 테스트"""

    async def test_list_policies_returns_200(self, admin_client):
        """보험 상품 목록 조회 시 200 반환"""
        client, app, get_db = admin_client

        policies = [_make_policy(product_code="POL-001"), _make_policy(product_code="POL-002")]
        mock_session = _make_mock_session(scalars_all=policies)

        async def override_get_db():
            yield mock_session

        app.dependency_overrides[get_db] = override_get_db

        try:
            response = await client.get("/api/v1/admin/policies")
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)
            assert len(data) == 2
        finally:
            app.dependency_overrides.pop(get_db, None)

    async def test_list_policies_filter_by_company_id(self, admin_client):
        """company_id 필터로 보험 상품 목록 조회"""
        client, app, get_db = admin_client

        company_id = uuid.uuid4()
        policies = [_make_policy(company_id=company_id)]
        mock_session = _make_mock_session(scalars_all=policies)

        async def override_get_db():
            yield mock_session

        app.dependency_overrides[get_db] = override_get_db

        try:
            response = await client.get(f"/api/v1/admin/policies?company_id={company_id}")
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)
        finally:
            app.dependency_overrides.pop(get_db, None)

    async def test_list_policies_filter_by_category(self, admin_client):
        """category 필터로 보험 상품 목록 조회"""
        client, app, get_db = admin_client

        policies = [_make_policy(category=InsuranceCategory.LIFE)]
        mock_session = _make_mock_session(scalars_all=policies)

        async def override_get_db():
            yield mock_session

        app.dependency_overrides[get_db] = override_get_db

        try:
            response = await client.get("/api/v1/admin/policies?category=LIFE")
            assert response.status_code == 200
        finally:
            app.dependency_overrides.pop(get_db, None)

    async def test_list_policies_filter_by_is_discontinued(self, admin_client):
        """is_discontinued 필터로 판매 중단 상품 목록 조회"""
        client, app, get_db = admin_client

        policies = [_make_policy(is_discontinued=True)]
        mock_session = _make_mock_session(scalars_all=policies)

        async def override_get_db():
            yield mock_session

        app.dependency_overrides[get_db] = override_get_db

        try:
            response = await client.get("/api/v1/admin/policies?is_discontinued=true")
            assert response.status_code == 200
        finally:
            app.dependency_overrides.pop(get_db, None)


class TestPoliciesGet:
    """GET /api/v1/admin/policies/{id} 테스트"""

    async def test_get_policy_returns_200_with_coverages(self, admin_client):
        """상품 ID로 조회 시 200과 보장 항목 포함 반환"""
        client, app, get_db = admin_client

        policy_id = uuid.uuid4()
        coverage = _make_coverage(policy_id=policy_id)
        policy = _make_policy(policy_id=policy_id)
        policy.coverages = [coverage]
        mock_session = _make_mock_session(scalar_one_or_none=policy)

        async def override_get_db():
            yield mock_session

        app.dependency_overrides[get_db] = override_get_db

        try:
            response = await client.get(f"/api/v1/admin/policies/{policy_id}")
            assert response.status_code == 200
            data = response.json()
            assert data["id"] == str(policy_id)
        finally:
            app.dependency_overrides.pop(get_db, None)


class TestPoliciesUpdate:
    """PUT /api/v1/admin/policies/{id} 테스트"""

    async def test_update_policy_returns_200(self, admin_client):
        """상품 수정 시 200 반환"""
        client, app, get_db = admin_client

        policy_id = uuid.uuid4()
        policy = _make_policy(policy_id=policy_id)
        mock_session = _make_mock_session(scalar_one_or_none=policy)
        mock_session.refresh = AsyncMock(side_effect=lambda obj: None)

        async def override_get_db():
            yield mock_session

        app.dependency_overrides[get_db] = override_get_db

        try:
            response = await client.put(
                f"/api/v1/admin/policies/{policy_id}",
                json={"name": "삼성 종신보험 (개정)"},
            )
            assert response.status_code == 200
        finally:
            app.dependency_overrides.pop(get_db, None)


class TestPoliciesDelete:
    """DELETE /api/v1/admin/policies/{id} 테스트"""

    async def test_delete_policy_cascade_returns_204(self, admin_client):
        """상품 삭제 시 cascade 204 반환"""
        client, app, get_db = admin_client

        policy_id = uuid.uuid4()
        policy = _make_policy(policy_id=policy_id)
        mock_session = _make_mock_session(scalar_one_or_none=policy)

        async def override_get_db():
            yield mock_session

        app.dependency_overrides[get_db] = override_get_db

        try:
            response = await client.delete(f"/api/v1/admin/policies/{policy_id}")
            assert response.status_code == 204
        finally:
            app.dependency_overrides.pop(get_db, None)


class TestPoliciesDuplicate:
    """중복 product_code 검증 테스트"""

    async def test_duplicate_product_code_same_company_returns_409(self, admin_client):
        """동일 보험사 내 중복 product_code 생성 시 409 반환"""
        client, app, get_db = admin_client

        company_id = uuid.uuid4()
        mock_session = _make_mock_session()

        # IntegrityError 발생 시나리오 시뮬레이션
        from sqlalchemy.exc import IntegrityError

        mock_session.commit = AsyncMock(side_effect=IntegrityError("UNIQUE constraint", {}, None))

        async def override_get_db():
            yield mock_session

        app.dependency_overrides[get_db] = override_get_db

        try:
            response = await client.post(
                "/api/v1/admin/policies",
                json={
                    "company_id": str(company_id),
                    "name": "중복 상품",
                    "product_code": "DUP-001",
                    "category": "LIFE",
                },
            )
            assert response.status_code == 409
        finally:
            app.dependency_overrides.pop(get_db, None)


# ─────────────────────────────────────────────
# TAG-018: Coverages CRUD 테스트
# ─────────────────────────────────────────────


class TestCoveragesCreate:
    """POST /api/v1/admin/policies/{id}/coverages 테스트"""

    async def test_create_coverage_returns_201(self, admin_client):
        """보장 항목 생성 시 201 반환"""
        client, app, get_db = admin_client

        policy_id = uuid.uuid4()
        coverage = _make_coverage(policy_id=policy_id)
        mock_session = _make_mock_session()

        async def mock_refresh(obj):
            obj.id = coverage.id
            obj.policy_id = coverage.policy_id
            obj.name = coverage.name
            obj.coverage_type = coverage.coverage_type
            obj.eligibility_criteria = coverage.eligibility_criteria
            obj.exclusions = coverage.exclusions
            obj.compensation_rules = coverage.compensation_rules
            obj.max_amount = coverage.max_amount
            obj.metadata_ = coverage.metadata_
            obj.created_at = coverage.created_at
            obj.updated_at = coverage.updated_at

        mock_session.refresh = AsyncMock(side_effect=mock_refresh)

        async def override_get_db():
            yield mock_session

        app.dependency_overrides[get_db] = override_get_db

        try:
            response = await client.post(
                f"/api/v1/admin/policies/{policy_id}/coverages",
                json={
                    "policy_id": str(policy_id),
                    "name": "암 진단비",
                    "coverage_type": "진단비",
                },
            )
            assert response.status_code == 201
        finally:
            app.dependency_overrides.pop(get_db, None)


class TestCoveragesList:
    """GET /api/v1/admin/policies/{id}/coverages 테스트"""

    async def test_list_coverages_for_policy_returns_200(self, admin_client):
        """특정 상품의 보장 항목 목록 조회 시 200 반환"""
        client, app, get_db = admin_client

        policy_id = uuid.uuid4()
        coverages = [
            _make_coverage(policy_id=policy_id, name="암 진단비"),
            _make_coverage(policy_id=policy_id, name="수술비"),
        ]
        mock_session = _make_mock_session(scalars_all=coverages)

        async def override_get_db():
            yield mock_session

        app.dependency_overrides[get_db] = override_get_db

        try:
            response = await client.get(f"/api/v1/admin/policies/{policy_id}/coverages")
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)
            assert len(data) == 2
        finally:
            app.dependency_overrides.pop(get_db, None)


class TestCoveragesUpdate:
    """PUT /api/v1/admin/coverages/{id} 테스트"""

    async def test_update_coverage_returns_200(self, admin_client):
        """보장 항목 수정 시 200 반환"""
        client, app, get_db = admin_client

        coverage_id = uuid.uuid4()
        coverage = _make_coverage(coverage_id=coverage_id)
        mock_session = _make_mock_session(scalar_one_or_none=coverage)
        mock_session.refresh = AsyncMock(side_effect=lambda obj: None)

        async def override_get_db():
            yield mock_session

        app.dependency_overrides[get_db] = override_get_db

        try:
            response = await client.put(
                f"/api/v1/admin/coverages/{coverage_id}",
                json={"name": "암 진단비 (개정)", "coverage_type": "진단비"},
            )
            assert response.status_code == 200
        finally:
            app.dependency_overrides.pop(get_db, None)


class TestCoveragesDelete:
    """DELETE /api/v1/admin/coverages/{id} 테스트"""

    async def test_delete_coverage_returns_204(self, admin_client):
        """보장 항목 삭제 시 204 반환"""
        client, app, get_db = admin_client

        coverage_id = uuid.uuid4()
        coverage = _make_coverage(coverage_id=coverage_id)
        mock_session = _make_mock_session(scalar_one_or_none=coverage)

        async def override_get_db():
            yield mock_session

        app.dependency_overrides[get_db] = override_get_db

        try:
            response = await client.delete(f"/api/v1/admin/coverages/{coverage_id}")
            assert response.status_code == 204
        finally:
            app.dependency_overrides.pop(get_db, None)
