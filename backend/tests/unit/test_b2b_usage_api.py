"""Usage/Billing API 엔드포인트 단위 테스트 (SPEC-B2B-001 Phase 4)

Usage/Billing API 엔드포인트 검증:
- GET /api/v1/b2b/usage - 조직 사용량 요약 (ORG_OWNER, AGENT_ADMIN)
- GET /api/v1/b2b/usage/details - 상세 사용량 (ORG_OWNER)
- GET /api/v1/b2b/usage/export - CSV 다운로드 (ORG_OWNER)
- GET /api/v1/b2b/billing/current - 현재 월 청구 예상 (ORG_OWNER)

AC-009: 조직 사용량 요약 조회
AC-010: CSV 리포트 생성
"""

from __future__ import annotations


class TestUsageApiImport:
    """API 라우터 임포트 테스트"""

    def test_usage_router_importable(self):
        """usage 라우터가 임포트 가능해야 한다"""
        from app.api.v1.b2b.usage import router

        assert router is not None

    def test_usage_router_has_routes(self):
        """usage 라우터는 라우트를 가져야 한다"""
        from app.api.v1.b2b.usage import router

        assert len(router.routes) > 0


class TestUsageApiRoutes:
    """API 라우터 경로 테스트"""

    def test_usage_summary_route_exists(self):
        """GET /usage 라우트가 존재해야 한다"""
        from app.api.v1.b2b.usage import router

        paths = [route.path for route in router.routes]
        assert "/usage" in paths

    def test_usage_details_route_exists(self):
        """GET /usage/details 라우트가 존재해야 한다"""
        from app.api.v1.b2b.usage import router

        paths = [route.path for route in router.routes]
        assert "/usage/details" in paths

    def test_usage_export_route_exists(self):
        """GET /usage/export 라우트가 존재해야 한다"""
        from app.api.v1.b2b.usage import router

        paths = [route.path for route in router.routes]
        assert "/usage/export" in paths

    def test_billing_current_route_exists(self):
        """GET /billing/current 라우트가 존재해야 한다"""
        from app.api.v1.b2b.usage import router

        paths = [route.path for route in router.routes]
        assert "/billing/current" in paths


class TestUsageSchemasImport:
    """사용량 관련 스키마 임포트 테스트"""

    def test_usage_summary_response_importable(self):
        """UsageSummaryResponse가 임포트 가능해야 한다"""
        from app.schemas.b2b import UsageSummaryResponse

        assert UsageSummaryResponse is not None

    def test_usage_detail_response_importable(self):
        """UsageDetailResponse가 임포트 가능해야 한다"""
        from app.schemas.b2b import UsageDetailResponse

        assert UsageDetailResponse is not None

    def test_usage_export_response_importable(self):
        """UsageExportResponse가 임포트 가능해야 한다"""
        from app.schemas.b2b import UsageExportResponse

        assert UsageExportResponse is not None

    def test_billing_estimate_response_importable(self):
        """BillingEstimateResponse가 임포트 가능해야 한다"""
        from app.schemas.b2b import BillingEstimateResponse

        assert BillingEstimateResponse is not None


class TestUsageSummarySchemaFields:
    """UsageSummaryResponse 스키마 필드 테스트"""

    def test_usage_summary_response_has_required_fields(self):
        """UsageSummaryResponse는 필수 필드를 가져야 한다"""
        from app.schemas.b2b import UsageSummaryResponse

        fields = UsageSummaryResponse.model_fields
        assert "total_requests" in fields
        assert "plan_limit" in fields
        assert "usage_percentage" in fields
        assert "by_endpoint" in fields

    def test_usage_summary_response_can_be_instantiated(self):
        """UsageSummaryResponse를 생성할 수 있어야 한다"""
        from app.schemas.b2b import UsageSummaryResponse

        schema = UsageSummaryResponse(
            total_requests=100,
            plan_limit=1000,
            usage_percentage=10.0,
            by_endpoint={"/api/v1/b2b/clients": 50},
            by_agent={},
        )

        assert schema.total_requests == 100
        assert schema.plan_limit == 1000
        assert schema.usage_percentage == 10.0


class TestBillingEstimateSchemaFields:
    """BillingEstimateResponse 스키마 필드 테스트"""

    def test_billing_estimate_response_has_required_fields(self):
        """BillingEstimateResponse는 필수 필드를 가져야 한다"""
        from app.schemas.b2b import BillingEstimateResponse

        fields = BillingEstimateResponse.model_fields
        assert "period" in fields
        assert "total_requests" in fields
        assert "plan_limit" in fields
        assert "usage_percentage" in fields
        assert "estimated_cost" in fields

    def test_billing_estimate_response_can_be_instantiated(self):
        """BillingEstimateResponse를 생성할 수 있어야 한다"""
        from app.schemas.b2b import BillingEstimateResponse

        schema = BillingEstimateResponse(
            period="2026-03",
            total_requests=500,
            plan_limit=1000,
            usage_percentage=50.0,
            estimated_cost=5000,
        )

        assert schema.period == "2026-03"
        assert schema.estimated_cost == 5000


class TestUsageExportSchemaFields:
    """UsageExportResponse 스키마 필드 테스트"""

    def test_usage_export_response_has_required_fields(self):
        """UsageExportResponse는 필수 필드를 가져야 한다"""
        from app.schemas.b2b import UsageExportResponse

        fields = UsageExportResponse.model_fields
        assert "csv_content" in fields
        assert "filename" in fields

    def test_usage_export_response_can_be_instantiated(self):
        """UsageExportResponse를 생성할 수 있어야 한다"""
        from app.schemas.b2b import UsageExportResponse

        schema = UsageExportResponse(
            csv_content="date,endpoint,method,count\n2026-03-01,/api/v1/b2b/clients,GET,10",
            filename="usage_2026-03.csv",
        )

        assert "date" in schema.csv_content
        assert schema.filename == "usage_2026-03.csv"


class TestUsageDetailResponseSchemaFields:
    """UsageDetailResponse 스키마 필드 테스트"""

    def test_usage_detail_response_has_required_fields(self):
        """UsageDetailResponse는 필수 필드를 가져야 한다"""
        from app.schemas.b2b import UsageDetailResponse

        fields = UsageDetailResponse.model_fields
        assert "items" in fields
        assert "total" in fields
        assert "page" in fields
        assert "page_size" in fields
