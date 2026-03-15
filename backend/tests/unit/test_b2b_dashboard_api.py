"""Dashboard API 엔드포인트 단위 테스트 (SPEC-B2B-001 Phase 5)

Dashboard API 엔드포인트 검증:
- GET /api/v1/b2b/dashboard/agent - 설계사 대시보드 (AGENT+)
- GET /api/v1/b2b/dashboard/organization - 조직 대시보드 (ORG_OWNER, AGENT_ADMIN)

AC-005: 설계사 대시보드 데이터 조회
AC-006: 조직 대시보드 데이터 조회
"""

from __future__ import annotations


class TestDashboardApiImport:
    """API 라우터 임포트 테스트"""

    def test_dashboard_router_importable(self):
        """dashboard 라우터가 임포트 가능해야 한다"""
        from app.api.v1.b2b.dashboard import router

        assert router is not None

    def test_dashboard_router_has_routes(self):
        """dashboard 라우터는 라우트를 가져야 한다"""
        from app.api.v1.b2b.dashboard import router

        assert len(router.routes) > 0


class TestDashboardApiRoutes:
    """API 라우터 경로 테스트"""

    def test_agent_dashboard_route_exists(self):
        """GET /dashboard/agent 라우트가 존재해야 한다"""
        from app.api.v1.b2b.dashboard import router

        paths = [route.path for route in router.routes]
        assert "/dashboard/agent" in paths

    def test_org_dashboard_route_exists(self):
        """GET /dashboard/organization 라우트가 존재해야 한다"""
        from app.api.v1.b2b.dashboard import router

        paths = [route.path for route in router.routes]
        assert "/dashboard/organization" in paths


class TestDashboardSchemasImport:
    """대시보드 관련 스키마 임포트 테스트"""

    def test_agent_dashboard_response_importable(self):
        """AgentDashboardResponse가 임포트 가능해야 한다"""
        from app.schemas.b2b import AgentDashboardResponse

        assert AgentDashboardResponse is not None

    def test_org_dashboard_response_importable(self):
        """OrgDashboardResponse가 임포트 가능해야 한다"""
        from app.schemas.b2b import OrgDashboardResponse

        assert OrgDashboardResponse is not None

    def test_agent_statistic_importable(self):
        """AgentStatistic이 임포트 가능해야 한다"""
        from app.schemas.b2b import AgentStatistic

        assert AgentStatistic is not None

    def test_usage_trend_item_importable(self):
        """UsageTrendItem이 임포트 가능해야 한다"""
        from app.schemas.b2b import UsageTrendItem

        assert UsageTrendItem is not None

    def test_plan_info_importable(self):
        """PlanInfo가 임포트 가능해야 한다"""
        from app.schemas.b2b import PlanInfo

        assert PlanInfo is not None


class TestAgentDashboardSchemaFields:
    """AgentDashboardResponse 스키마 필드 테스트"""

    def test_agent_dashboard_has_total_clients_field(self):
        """AgentDashboardResponse는 total_clients 필드를 가져야 한다"""
        from app.schemas.b2b import AgentDashboardResponse

        fields = AgentDashboardResponse.model_fields
        assert "total_clients" in fields

    def test_agent_dashboard_has_active_clients_field(self):
        """AgentDashboardResponse는 active_clients 필드를 가져야 한다"""
        from app.schemas.b2b import AgentDashboardResponse

        fields = AgentDashboardResponse.model_fields
        assert "active_clients" in fields

    def test_agent_dashboard_has_recent_queries_field(self):
        """AgentDashboardResponse는 recent_queries 필드를 가져야 한다"""
        from app.schemas.b2b import AgentDashboardResponse

        fields = AgentDashboardResponse.model_fields
        assert "recent_queries" in fields

    def test_agent_dashboard_has_monthly_activity_field(self):
        """AgentDashboardResponse는 monthly_activity 필드를 가져야 한다"""
        from app.schemas.b2b import AgentDashboardResponse

        fields = AgentDashboardResponse.model_fields
        assert "monthly_activity" in fields

    def test_agent_dashboard_instantiation(self):
        """AgentDashboardResponse 인스턴스 생성이 가능해야 한다"""
        from app.schemas.b2b import AgentDashboardResponse

        response = AgentDashboardResponse(
            total_clients=10,
            active_clients=7,
            recent_queries=[],
            monthly_activity=50,
        )
        assert response.total_clients == 10
        assert response.active_clients == 7
        assert response.monthly_activity == 50


class TestAgentStatisticSchemaFields:
    """AgentStatistic 스키마 필드 테스트"""

    def test_agent_statistic_has_agent_id_field(self):
        """AgentStatistic은 agent_id 필드를 가져야 한다"""
        from app.schemas.b2b import AgentStatistic

        fields = AgentStatistic.model_fields
        assert "agent_id" in fields

    def test_agent_statistic_has_agent_name_field(self):
        """AgentStatistic은 agent_name 필드를 가져야 한다"""
        from app.schemas.b2b import AgentStatistic

        fields = AgentStatistic.model_fields
        assert "agent_name" in fields

    def test_agent_statistic_has_client_count_field(self):
        """AgentStatistic은 client_count 필드를 가져야 한다"""
        from app.schemas.b2b import AgentStatistic

        fields = AgentStatistic.model_fields
        assert "client_count" in fields

    def test_agent_statistic_has_query_count_field(self):
        """AgentStatistic은 query_count 필드를 가져야 한다"""
        from app.schemas.b2b import AgentStatistic

        fields = AgentStatistic.model_fields
        assert "query_count" in fields

    def test_agent_statistic_instantiation(self):
        """AgentStatistic 인스턴스 생성이 가능해야 한다"""
        import uuid

        from app.schemas.b2b import AgentStatistic

        stat = AgentStatistic(
            agent_id=uuid.uuid4(),
            agent_name="테스트 설계사",
            client_count=5,
            query_count=20,
        )
        assert stat.client_count == 5
        assert stat.query_count == 20


class TestUsageTrendItemSchemaFields:
    """UsageTrendItem 스키마 필드 테스트"""

    def test_usage_trend_item_has_period_field(self):
        """UsageTrendItem은 period 필드를 가져야 한다"""
        from app.schemas.b2b import UsageTrendItem

        fields = UsageTrendItem.model_fields
        assert "period" in fields

    def test_usage_trend_item_has_request_count_field(self):
        """UsageTrendItem은 request_count 필드를 가져야 한다"""
        from app.schemas.b2b import UsageTrendItem

        fields = UsageTrendItem.model_fields
        assert "request_count" in fields

    def test_usage_trend_item_instantiation(self):
        """UsageTrendItem 인스턴스 생성이 가능해야 한다"""
        from app.schemas.b2b import UsageTrendItem

        item = UsageTrendItem(period="2026-01", request_count=150)
        assert item.period == "2026-01"
        assert item.request_count == 150


class TestPlanInfoSchemaFields:
    """PlanInfo 스키마 필드 테스트"""

    def test_plan_info_has_plan_type_field(self):
        """PlanInfo는 plan_type 필드를 가져야 한다"""
        from app.schemas.b2b import PlanInfo

        fields = PlanInfo.model_fields
        assert "plan_type" in fields

    def test_plan_info_has_monthly_limit_field(self):
        """PlanInfo는 monthly_limit 필드를 가져야 한다"""
        from app.schemas.b2b import PlanInfo

        fields = PlanInfo.model_fields
        assert "monthly_limit" in fields

    def test_plan_info_has_current_usage_field(self):
        """PlanInfo는 current_usage 필드를 가져야 한다"""
        from app.schemas.b2b import PlanInfo

        fields = PlanInfo.model_fields
        assert "current_usage" in fields

    def test_plan_info_has_usage_percentage_field(self):
        """PlanInfo는 usage_percentage 필드를 가져야 한다"""
        from app.schemas.b2b import PlanInfo

        fields = PlanInfo.model_fields
        assert "usage_percentage" in fields

    def test_plan_info_instantiation(self):
        """PlanInfo 인스턴스 생성이 가능해야 한다"""
        from app.schemas.b2b import PlanInfo

        info = PlanInfo(
            plan_type="BASIC",
            monthly_limit=1000,
            current_usage=800,
            usage_percentage=80.0,
        )
        assert info.monthly_limit == 1000
        assert info.usage_percentage == 80.0


class TestOrgDashboardSchemaFields:
    """OrgDashboardResponse 스키마 필드 테스트"""

    def test_org_dashboard_has_total_agents_field(self):
        """OrgDashboardResponse는 total_agents 필드를 가져야 한다"""
        from app.schemas.b2b import OrgDashboardResponse

        fields = OrgDashboardResponse.model_fields
        assert "total_agents" in fields

    def test_org_dashboard_has_total_clients_field(self):
        """OrgDashboardResponse는 total_clients 필드를 가져야 한다"""
        from app.schemas.b2b import OrgDashboardResponse

        fields = OrgDashboardResponse.model_fields
        assert "total_clients" in fields

    def test_org_dashboard_has_monthly_api_calls_field(self):
        """OrgDashboardResponse는 monthly_api_calls 필드를 가져야 한다"""
        from app.schemas.b2b import OrgDashboardResponse

        fields = OrgDashboardResponse.model_fields
        assert "monthly_api_calls" in fields

    def test_org_dashboard_has_agent_statistics_field(self):
        """OrgDashboardResponse는 agent_statistics 필드를 가져야 한다"""
        from app.schemas.b2b import OrgDashboardResponse

        fields = OrgDashboardResponse.model_fields
        assert "agent_statistics" in fields

    def test_org_dashboard_has_usage_trend_field(self):
        """OrgDashboardResponse는 usage_trend 필드를 가져야 한다"""
        from app.schemas.b2b import OrgDashboardResponse

        fields = OrgDashboardResponse.model_fields
        assert "usage_trend" in fields

    def test_org_dashboard_has_plan_info_field(self):
        """OrgDashboardResponse는 plan_info 필드를 가져야 한다"""
        from app.schemas.b2b import OrgDashboardResponse

        fields = OrgDashboardResponse.model_fields
        assert "plan_info" in fields

    def test_org_dashboard_instantiation(self):
        """OrgDashboardResponse 인스턴스 생성이 가능해야 한다"""
        import uuid

        from app.schemas.b2b import (
            AgentStatistic,
            OrgDashboardResponse,
            PlanInfo,
            UsageTrendItem,
        )

        response = OrgDashboardResponse(
            total_agents=5,
            total_clients=50,
            monthly_api_calls=1000,
            agent_statistics=[
                AgentStatistic(
                    agent_id=uuid.uuid4(),
                    agent_name="설계사A",
                    client_count=10,
                    query_count=100,
                )
            ],
            usage_trend=[
                UsageTrendItem(period="2026-01", request_count=100),
            ],
            plan_info=PlanInfo(
                plan_type="BASIC",
                monthly_limit=5000,
                current_usage=1000,
                usage_percentage=20.0,
            ),
        )
        assert response.total_agents == 5
        assert response.total_clients == 50


class TestDashboardMainRegistration:
    """main.py 라우터 등록 테스트"""

    def test_dashboard_router_registered_in_main(self):
        """dashboard 라우터가 main.py에 등록되어야 한다"""
        from app.main import app

        # /api/v1/b2b/dashboard 경로가 있는 라우트가 존재해야 함
        paths = []
        for route in app.routes:
            if hasattr(route, "path"):
                paths.append(route.path)

        # 라우트 경로 중 dashboard 포함 경로 확인
        dashboard_routes = [p for p in paths if "dashboard" in p]
        assert len(dashboard_routes) > 0 or any(
            "dashboard" in str(route) for route in app.routes
        )
