"""B2B 대시보드 API 라우터 (SPEC-B2B-001 Phase 5)

설계사 및 조직 대시보드 데이터 조회 엔드포인트.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_role
from app.core.database import get_db
from app.models.user import User, UserRole
from app.schemas.b2b import (
    AgentDashboardResponse,
    AgentStatistic,
    OrgDashboardResponse,
    PlanInfo,
    UsageTrendItem,
)
from app.services.b2b.dashboard_service import DashboardService

router = APIRouter(tags=["b2b-dashboard"])


@router.get("/dashboard/agent", response_model=AgentDashboardResponse)
async def get_agent_dashboard(
    current_user: User = Depends(require_role(UserRole.AGENT, UserRole.AGENT_ADMIN, UserRole.ORG_OWNER, UserRole.SYSTEM_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> AgentDashboardResponse:
    """설계사 대시보드 데이터를 조회한다 (AC-005)."""
    service = DashboardService(db=db)
    data = await service.get_agent_dashboard(
        org_id=current_user.id,
        agent_id=current_user.id,
    )
    return AgentDashboardResponse(
        total_clients=data["total_clients"],
        active_clients=data["active_clients"],
        recent_queries=data["recent_queries"],
        monthly_activity=data["monthly_activity"],
    )


@router.get("/dashboard/organization", response_model=OrgDashboardResponse)
async def get_org_dashboard(
    current_user: User = Depends(require_role(UserRole.ORG_OWNER, UserRole.AGENT_ADMIN, UserRole.SYSTEM_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> OrgDashboardResponse:
    """조직 대시보드 데이터를 조회한다 (AC-006)."""
    service = DashboardService(db=db)
    data = await service.get_org_dashboard(org_id=current_user.id)

    agent_stats = [
        AgentStatistic(
            agent_id=stat["agent_id"],
            agent_name=stat.get("agent_name", ""),
            client_count=stat["client_count"],
            query_count=stat.get("query_count", 0),
        )
        for stat in data["agent_statistics"]
    ]

    usage_trend = [
        UsageTrendItem(
            period=item["period"],
            request_count=item["api_calls"],
        )
        for item in data["usage_trend"]
    ]

    plan = data["plan_info"]
    plan_info = PlanInfo(
        plan_type=str(plan["plan_type"]) if plan["plan_type"] else "UNKNOWN",
        monthly_limit=plan["monthly_limit"],
        current_usage=plan["current_usage"],
        usage_percentage=plan["usage_percentage"],
    )

    return OrgDashboardResponse(
        total_agents=data["total_agents"],
        total_clients=data["total_clients"],
        monthly_api_calls=data["monthly_api_calls"],
        agent_statistics=agent_stats,
        usage_trend=usage_trend,
        plan_info=plan_info,
    )
