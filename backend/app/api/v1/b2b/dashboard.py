"""B2B 대시보드 API 라우터 (SPEC-B2B-001 Phase 5)

설계사 대시보드 및 조직 대시보드 엔드포인트.
AC-005: 설계사 대시보드 데이터 조회
AC-006: 조직 대시보드 데이터 조회
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_org_user
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

# 대시보드 라우터
router = APIRouter(tags=["b2b-dashboard"])

# 설계사 이상 접근 가능 역할
_AGENT_ROLES = (
    UserRole.AGENT,
    UserRole.AGENT_ADMIN,
    UserRole.ORG_OWNER,
    UserRole.SYSTEM_ADMIN,
)

# 조직 관리자 이상 접근 가능 역할
_ORG_ADMIN_ROLES = (
    UserRole.ORG_OWNER,
    UserRole.AGENT_ADMIN,
    UserRole.SYSTEM_ADMIN,
)


# @MX:ANCHOR: 설계사 대시보드 엔드포인트
# @MX:REASON: AC-005 - 설계사별 고객 수, 최근 질의, 월간 활동 데이터 제공
@router.get("/dashboard/agent", response_model=AgentDashboardResponse)
async def get_agent_dashboard(
    db: AsyncSession = Depends(get_db),
    auth: tuple = Depends(get_current_org_user),
) -> AgentDashboardResponse:
    """설계사 대시보드 데이터를 반환한다 (AGENT 이상).

    Returns:
        AgentDashboardResponse: 담당 고객 수, 동의 완료 고객 수, 최근 질의, 월간 활동
    """
    user: User = auth[0]
    org_member = auth[1]

    # AGENT 이상 역할 검사
    if user.role not in _AGENT_ROLES:
        raise HTTPException(
            status_code=403,
            detail="설계사 대시보드 접근 권한이 없습니다.",
        )

    service = DashboardService(db=db)
    data = await service.get_agent_dashboard(
        org_id=org_member.organization_id,
        agent_id=user.id,
    )

    return AgentDashboardResponse(
        total_clients=data["total_clients"],
        active_clients=data["active_clients"],
        recent_queries=data["recent_queries"],
        monthly_activity=data["monthly_activity"],
    )


# @MX:ANCHOR: 조직 대시보드 엔드포인트
# @MX:REASON: AC-006 - 조직 전체 설계사 수, 고객 수, 월별 호출, 통계, 추이, 플랜 정보 제공
@router.get("/dashboard/organization", response_model=OrgDashboardResponse)
async def get_org_dashboard(
    db: AsyncSession = Depends(get_db),
    auth: tuple = Depends(get_current_org_user),
) -> OrgDashboardResponse:
    """조직 대시보드 데이터를 반환한다 (ORG_OWNER, AGENT_ADMIN).

    Returns:
        OrgDashboardResponse: 설계사 수, 고객 수, 월별 호출, 설계사별 통계, 사용량 추이, 플랜 정보
    """
    user: User = auth[0]
    org_member = auth[1]

    # ORG_OWNER, AGENT_ADMIN 이상 역할 검사
    if user.role not in _ORG_ADMIN_ROLES:
        raise HTTPException(
            status_code=403,
            detail="조직 대시보드 접근 권한이 없습니다.",
        )

    service = DashboardService(db=db)
    data = await service.get_org_dashboard(org_id=org_member.organization_id)

    agent_statistics = [
        AgentStatistic(
            agent_id=stat["agent_id"],
            agent_name=stat["agent_name"],
            client_count=stat["client_count"],
            query_count=stat["query_count"],
        )
        for stat in data["agent_statistics"]
    ]

    usage_trend = [
        UsageTrendItem(
            period=item["period"],
            request_count=item["request_count"],
        )
        for item in data["usage_trend"]
    ]

    plan_info = PlanInfo(
        plan_type=data["plan_info"]["plan_type"],
        monthly_limit=data["plan_info"]["monthly_limit"],
        current_usage=data["plan_info"]["current_usage"],
        usage_percentage=data["plan_info"]["usage_percentage"],
    )

    return OrgDashboardResponse(
        total_agents=data["total_agents"],
        total_clients=data["total_clients"],
        monthly_api_calls=data["monthly_api_calls"],
        agent_statistics=agent_statistics,
        usage_trend=usage_trend,
        plan_info=plan_info,
    )
