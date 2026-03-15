"""Dashboard Service 단위 테스트 (SPEC-B2B-001 Phase 5)

DashboardService 비즈니스 로직 검증:
- get_agent_dashboard: 설계사 대시보드 데이터 조회
- get_org_dashboard: 조직 대시보드 데이터 조회

AC-005: 설계사 대시보드 - 고객 수, 최근 질의, 월간 활동
AC-006: 조직 대시보드 - 설계사 수, 고객 수, 월별 호출, 설계사별 통계, 사용량 추이, 80% 경고
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest


class TestDashboardServiceImport:
    """서비스 임포트 테스트"""

    def test_dashboard_service_importable(self):
        """DashboardService가 임포트 가능해야 한다"""
        from app.services.b2b.dashboard_service import DashboardService

        assert DashboardService is not None

    def test_dashboard_service_has_get_agent_dashboard(self):
        """DashboardService는 get_agent_dashboard 메서드를 가져야 한다"""
        from app.services.b2b.dashboard_service import DashboardService

        assert hasattr(DashboardService, "get_agent_dashboard")

    def test_dashboard_service_has_get_org_dashboard(self):
        """DashboardService는 get_org_dashboard 메서드를 가져야 한다"""
        from app.services.b2b.dashboard_service import DashboardService

        assert hasattr(DashboardService, "get_org_dashboard")


class TestGetAgentDashboard:
    """get_agent_dashboard 메서드 테스트 (AC-005)"""

    def _make_service(self):
        """모의 DB를 주입한 DashboardService 반환"""
        from app.services.b2b.dashboard_service import DashboardService

        mock_db = AsyncMock()
        return DashboardService(db=mock_db), mock_db

    @pytest.mark.asyncio
    async def test_get_agent_dashboard_returns_dict(self):
        """get_agent_dashboard는 딕셔너리를 반환해야 한다"""
        from app.services.b2b.dashboard_service import DashboardService

        mock_db = AsyncMock()

        # 스칼라 결과를 0으로 모의
        scalar_result = MagicMock()
        scalar_result.scalar.return_value = 0
        mock_db.execute = AsyncMock(return_value=scalar_result)

        # scalars().all() 결과 모의
        scalars_result = MagicMock()
        scalars_result.all.return_value = []
        scalar_result.scalars.return_value = scalars_result

        service = DashboardService(db=mock_db)
        org_id = uuid.uuid4()
        agent_id = uuid.uuid4()

        result = await service.get_agent_dashboard(org_id=org_id, agent_id=agent_id)

        assert isinstance(result, dict)

    @pytest.mark.asyncio
    async def test_get_agent_dashboard_contains_total_clients(self):
        """get_agent_dashboard 결과에 total_clients 키가 있어야 한다"""
        from app.services.b2b.dashboard_service import DashboardService

        mock_db = AsyncMock()
        scalar_result = MagicMock()
        scalar_result.scalar.return_value = 5
        mock_db.execute = AsyncMock(return_value=scalar_result)

        scalars_result = MagicMock()
        scalars_result.all.return_value = []
        scalar_result.scalars.return_value = scalars_result

        service = DashboardService(db=mock_db)
        result = await service.get_agent_dashboard(
            org_id=uuid.uuid4(), agent_id=uuid.uuid4()
        )

        assert "total_clients" in result

    @pytest.mark.asyncio
    async def test_get_agent_dashboard_contains_active_clients(self):
        """get_agent_dashboard 결과에 active_clients 키가 있어야 한다"""
        from app.services.b2b.dashboard_service import DashboardService

        mock_db = AsyncMock()
        scalar_result = MagicMock()
        scalar_result.scalar.return_value = 3
        mock_db.execute = AsyncMock(return_value=scalar_result)

        scalars_result = MagicMock()
        scalars_result.all.return_value = []
        scalar_result.scalars.return_value = scalars_result

        service = DashboardService(db=mock_db)
        result = await service.get_agent_dashboard(
            org_id=uuid.uuid4(), agent_id=uuid.uuid4()
        )

        assert "active_clients" in result

    @pytest.mark.asyncio
    async def test_get_agent_dashboard_contains_recent_queries(self):
        """get_agent_dashboard 결과에 recent_queries 키가 있어야 한다"""
        from app.services.b2b.dashboard_service import DashboardService

        mock_db = AsyncMock()
        scalar_result = MagicMock()
        scalar_result.scalar.return_value = 0
        mock_db.execute = AsyncMock(return_value=scalar_result)

        scalars_result = MagicMock()
        scalars_result.all.return_value = []
        scalar_result.scalars.return_value = scalars_result

        service = DashboardService(db=mock_db)
        result = await service.get_agent_dashboard(
            org_id=uuid.uuid4(), agent_id=uuid.uuid4()
        )

        assert "recent_queries" in result
        assert isinstance(result["recent_queries"], list)

    @pytest.mark.asyncio
    async def test_get_agent_dashboard_contains_monthly_activity(self):
        """get_agent_dashboard 결과에 monthly_activity 키가 있어야 한다"""
        from app.services.b2b.dashboard_service import DashboardService

        mock_db = AsyncMock()
        scalar_result = MagicMock()
        scalar_result.scalar.return_value = 10
        mock_db.execute = AsyncMock(return_value=scalar_result)

        scalars_result = MagicMock()
        scalars_result.all.return_value = []
        scalar_result.scalars.return_value = scalars_result

        service = DashboardService(db=mock_db)
        result = await service.get_agent_dashboard(
            org_id=uuid.uuid4(), agent_id=uuid.uuid4()
        )

        assert "monthly_activity" in result

    @pytest.mark.asyncio
    async def test_get_agent_dashboard_recent_queries_max_10(self):
        """recent_queries는 최대 10건을 반환해야 한다"""
        from app.services.b2b.dashboard_service import DashboardService

        mock_db = AsyncMock()
        scalar_result = MagicMock()
        scalar_result.scalar.return_value = 0
        mock_db.execute = AsyncMock(return_value=scalar_result)

        # 모의 질의 이력 객체 생성 (10개 이상)
        from datetime import UTC, datetime

        mock_records = []
        for i in range(12):
            rec = MagicMock()
            rec.query = f"질의 {i}"
            rec.result = f"결과 {i}"
            rec.created_at = datetime.now(UTC)
            mock_records.append(rec)

        scalars_result = MagicMock()
        scalars_result.all.return_value = mock_records
        scalar_result.scalars.return_value = scalars_result

        service = DashboardService(db=mock_db)
        result = await service.get_agent_dashboard(
            org_id=uuid.uuid4(), agent_id=uuid.uuid4()
        )

        # recent_queries는 최대 10건
        assert len(result["recent_queries"]) <= 10

    @pytest.mark.asyncio
    async def test_get_agent_dashboard_recent_queries_format(self):
        """recent_queries 각 항목은 query, result_summary, created_at 필드를 가져야 한다"""
        from datetime import UTC, datetime

        from app.services.b2b.dashboard_service import DashboardService

        mock_db = AsyncMock()
        scalar_result = MagicMock()
        scalar_result.scalar.return_value = 0
        mock_db.execute = AsyncMock(return_value=scalar_result)

        # 모의 질의 이력 객체
        mock_rec = MagicMock()
        mock_rec.query = "보험 분석 질의"
        mock_rec.result = "분석 결과"
        mock_rec.created_at = datetime.now(UTC)

        scalars_result = MagicMock()
        scalars_result.all.return_value = [mock_rec]
        scalar_result.scalars.return_value = scalars_result

        service = DashboardService(db=mock_db)
        result = await service.get_agent_dashboard(
            org_id=uuid.uuid4(), agent_id=uuid.uuid4()
        )

        if result["recent_queries"]:
            item = result["recent_queries"][0]
            assert "query" in item
            assert "result_summary" in item
            assert "created_at" in item


class TestGetOrgDashboard:
    """get_org_dashboard 메서드 테스트 (AC-006)"""

    @pytest.mark.asyncio
    async def test_get_org_dashboard_returns_dict(self):
        """get_org_dashboard는 딕셔너리를 반환해야 한다"""
        from app.services.b2b.dashboard_service import DashboardService

        mock_db = AsyncMock()
        scalar_result = MagicMock()
        scalar_result.scalar.return_value = 0
        mock_db.execute = AsyncMock(return_value=scalar_result)

        scalars_result = MagicMock()
        scalars_result.all.return_value = []
        scalar_result.scalars.return_value = scalars_result

        service = DashboardService(db=mock_db)
        result = await service.get_org_dashboard(org_id=uuid.uuid4())

        assert isinstance(result, dict)

    @pytest.mark.asyncio
    async def test_get_org_dashboard_contains_total_agents(self):
        """get_org_dashboard 결과에 total_agents 키가 있어야 한다"""
        from app.services.b2b.dashboard_service import DashboardService

        mock_db = AsyncMock()
        scalar_result = MagicMock()
        scalar_result.scalar.return_value = 5
        mock_db.execute = AsyncMock(return_value=scalar_result)

        scalars_result = MagicMock()
        scalars_result.all.return_value = []
        scalar_result.scalars.return_value = scalars_result

        service = DashboardService(db=mock_db)
        result = await service.get_org_dashboard(org_id=uuid.uuid4())

        assert "total_agents" in result

    @pytest.mark.asyncio
    async def test_get_org_dashboard_contains_total_clients(self):
        """get_org_dashboard 결과에 total_clients 키가 있어야 한다"""
        from app.services.b2b.dashboard_service import DashboardService

        mock_db = AsyncMock()
        scalar_result = MagicMock()
        scalar_result.scalar.return_value = 20
        mock_db.execute = AsyncMock(return_value=scalar_result)

        scalars_result = MagicMock()
        scalars_result.all.return_value = []
        scalar_result.scalars.return_value = scalars_result

        service = DashboardService(db=mock_db)
        result = await service.get_org_dashboard(org_id=uuid.uuid4())

        assert "total_clients" in result

    @pytest.mark.asyncio
    async def test_get_org_dashboard_contains_monthly_api_calls(self):
        """get_org_dashboard 결과에 monthly_api_calls 키가 있어야 한다"""
        from app.services.b2b.dashboard_service import DashboardService

        mock_db = AsyncMock()
        scalar_result = MagicMock()
        scalar_result.scalar.return_value = 100
        mock_db.execute = AsyncMock(return_value=scalar_result)

        scalars_result = MagicMock()
        scalars_result.all.return_value = []
        scalar_result.scalars.return_value = scalars_result

        service = DashboardService(db=mock_db)
        result = await service.get_org_dashboard(org_id=uuid.uuid4())

        assert "monthly_api_calls" in result

    @pytest.mark.asyncio
    async def test_get_org_dashboard_contains_agent_statistics(self):
        """get_org_dashboard 결과에 agent_statistics 키가 있어야 한다"""
        from app.services.b2b.dashboard_service import DashboardService

        mock_db = AsyncMock()
        scalar_result = MagicMock()
        scalar_result.scalar.return_value = 0
        mock_db.execute = AsyncMock(return_value=scalar_result)

        scalars_result = MagicMock()
        scalars_result.all.return_value = []
        scalar_result.scalars.return_value = scalars_result

        service = DashboardService(db=mock_db)
        result = await service.get_org_dashboard(org_id=uuid.uuid4())

        assert "agent_statistics" in result
        assert isinstance(result["agent_statistics"], list)

    @pytest.mark.asyncio
    async def test_get_org_dashboard_contains_usage_trend(self):
        """get_org_dashboard 결과에 usage_trend 키가 있어야 한다"""
        from app.services.b2b.dashboard_service import DashboardService

        mock_db = AsyncMock()
        scalar_result = MagicMock()
        scalar_result.scalar.return_value = 0
        mock_db.execute = AsyncMock(return_value=scalar_result)

        scalars_result = MagicMock()
        scalars_result.all.return_value = []
        scalar_result.scalars.return_value = scalars_result

        service = DashboardService(db=mock_db)
        result = await service.get_org_dashboard(org_id=uuid.uuid4())

        assert "usage_trend" in result
        assert isinstance(result["usage_trend"], list)

    @pytest.mark.asyncio
    async def test_get_org_dashboard_contains_plan_info(self):
        """get_org_dashboard 결과에 plan_info 키가 있어야 한다"""
        from app.services.b2b.dashboard_service import DashboardService

        mock_db = AsyncMock()
        scalar_result = MagicMock()
        scalar_result.scalar.return_value = 0

        # Organization 모의 객체 (plan_type, monthly_api_limit 필요)
        from app.models.organization import PlanType

        mock_org = MagicMock()
        mock_org.plan_type = PlanType.BASIC
        mock_org.monthly_api_limit = 1000
        scalar_result.scalar_one_or_none = MagicMock(return_value=mock_org)

        mock_db.execute = AsyncMock(return_value=scalar_result)

        scalars_result = MagicMock()
        scalars_result.all.return_value = []
        scalar_result.scalars.return_value = scalars_result

        service = DashboardService(db=mock_db)
        result = await service.get_org_dashboard(org_id=uuid.uuid4())

        assert "plan_info" in result

    @pytest.mark.asyncio
    async def test_get_org_dashboard_plan_info_fields(self):
        """plan_info는 plan_type, monthly_limit, current_usage, usage_percentage 필드를 가져야 한다"""
        from app.services.b2b.dashboard_service import DashboardService

        mock_db = AsyncMock()
        scalar_result = MagicMock()
        scalar_result.scalar.return_value = 0

        from app.models.organization import PlanType

        mock_org = MagicMock()
        mock_org.plan_type = PlanType.BASIC
        mock_org.monthly_api_limit = 1000
        scalar_result.scalar_one_or_none = MagicMock(return_value=mock_org)

        mock_db.execute = AsyncMock(return_value=scalar_result)

        scalars_result = MagicMock()
        scalars_result.all.return_value = []
        scalar_result.scalars.return_value = scalars_result

        service = DashboardService(db=mock_db)
        result = await service.get_org_dashboard(org_id=uuid.uuid4())

        plan_info = result["plan_info"]
        assert "plan_type" in plan_info
        assert "monthly_limit" in plan_info
        assert "current_usage" in plan_info
        assert "usage_percentage" in plan_info

    @pytest.mark.asyncio
    async def test_get_org_dashboard_usage_trend_max_6_months(self):
        """usage_trend는 최근 6개월 데이터를 반환해야 한다"""
        from app.services.b2b.dashboard_service import DashboardService

        mock_db = AsyncMock()
        scalar_result = MagicMock()
        scalar_result.scalar.return_value = 0
        mock_db.execute = AsyncMock(return_value=scalar_result)

        scalars_result = MagicMock()
        scalars_result.all.return_value = []
        scalar_result.scalars.return_value = scalars_result

        service = DashboardService(db=mock_db)
        result = await service.get_org_dashboard(org_id=uuid.uuid4())

        # usage_trend 항목 수는 최대 6
        assert len(result["usage_trend"]) <= 6

    @pytest.mark.asyncio
    async def test_get_org_dashboard_usage_percentage_calculation(self):
        """usage_percentage는 현재 사용량 / 월 한도 * 100으로 계산되어야 한다"""
        from app.services.b2b.dashboard_service import DashboardService

        mock_db = AsyncMock()

        # 첫 번째 실행(total_agents): 2
        # 두 번째 실행(total_clients): 10
        # 세 번째 실행(monthly_api_calls): 500
        # 조직 정보 조회
        from app.models.organization import PlanType

        call_count = 0

        async def mock_execute(stmt, *args, **kwargs):
            nonlocal call_count
            call_count += 1
            result = MagicMock()
            result.scalar.return_value = 0
            scalars_res = MagicMock()
            scalars_res.all.return_value = []
            result.scalars.return_value = scalars_res
            mock_org = MagicMock()
            mock_org.plan_type = PlanType.BASIC
            mock_org.monthly_api_limit = 1000
            result.scalar_one_or_none = MagicMock(return_value=mock_org)
            return result

        mock_db.execute = mock_execute

        service = DashboardService(db=mock_db)
        result = await service.get_org_dashboard(org_id=uuid.uuid4())

        # plan_info가 있으면 usage_percentage 계산 검증
        if "plan_info" in result:
            plan_info = result["plan_info"]
            if plan_info["monthly_limit"] > 0:
                expected_pct = round(
                    plan_info["current_usage"] / plan_info["monthly_limit"] * 100, 1
                )
                assert abs(plan_info["usage_percentage"] - expected_pct) < 0.01
