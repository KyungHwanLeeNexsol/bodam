"""B2B 대시보드 서비스 (SPEC-B2B-001 Phase 5)

설계사 대시보드 및 조직 대시보드 데이터 조회 비즈니스 로직.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent_client import AgentClient, ConsentStatus
from app.models.organization import Organization
from app.models.organization_member import OrgMemberRole, OrganizationMember
from app.models.usage_record import UsageRecord


class DashboardService:
    """대시보드 비즈니스 로직 서비스"""

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def get_agent_dashboard(
        self,
        org_id: uuid.UUID,
        agent_id: uuid.UUID,
    ) -> dict:
        """설계사 대시보드 데이터를 조회한다 (AC-005).

        Args:
            org_id: 조직 UUID
            agent_id: 설계사 UUID

        Returns:
            {total_clients, active_clients, recent_queries, monthly_activity} 딕셔너리
        """
        # 전체 고객 수
        total_result = await self._db.execute(
            sa.select(sa.func.count(AgentClient.id)).where(
                AgentClient.organization_id == org_id,
                AgentClient.agent_id == agent_id,
            )
        )
        total_clients = total_result.scalar() or 0

        # 동의 완료(ACTIVE) 고객 수
        active_result = await self._db.execute(
            sa.select(sa.func.count(AgentClient.id)).where(
                AgentClient.organization_id == org_id,
                AgentClient.agent_id == agent_id,
                AgentClient.consent_status == ConsentStatus.ACTIVE,
            )
        )
        active_clients = active_result.scalar() or 0

        # 최근 질의 이력 조회 (UsageRecord 기반, 최대 10건)
        queries_result = await self._db.execute(
            sa.select(UsageRecord)
            .where(
                UsageRecord.organization_id == org_id,
                UsageRecord.user_id == agent_id,
            )
            .order_by(UsageRecord.created_at.desc())
            .limit(10)
        )
        query_records = queries_result.scalars().all()

        recent_queries = []
        for rec in query_records[:10]:
            recent_queries.append({
                "query": getattr(rec, "query", rec.endpoint),
                "result_summary": getattr(rec, "result", str(rec.status_code)),
                "created_at": rec.created_at,
            })

        # 이번 달 활동 수 (API 호출 수)
        now = datetime.now(UTC)
        month_start = datetime(now.year, now.month, 1, tzinfo=UTC)
        monthly_result = await self._db.execute(
            sa.select(sa.func.count(UsageRecord.id)).where(
                UsageRecord.organization_id == org_id,
                UsageRecord.user_id == agent_id,
                UsageRecord.created_at >= month_start,
            )
        )
        monthly_activity = monthly_result.scalar() or 0

        return {
            "total_clients": total_clients,
            "active_clients": active_clients,
            "recent_queries": recent_queries,
            "monthly_activity": monthly_activity,
        }

    async def get_org_dashboard(
        self,
        org_id: uuid.UUID,
    ) -> dict:
        """조직 대시보드 데이터를 조회한다 (AC-006).

        Args:
            org_id: 조직 UUID

        Returns:
            {total_agents, total_clients, monthly_api_calls, agent_statistics,
             usage_trend, plan_info} 딕셔너리
        """
        # 활성 설계사 수
        agents_result = await self._db.execute(
            sa.select(sa.func.count(OrganizationMember.id)).where(
                OrganizationMember.organization_id == org_id,
                OrganizationMember.is_active.is_(True),
                OrganizationMember.role == OrgMemberRole.AGENT,
            )
        )
        total_agents = agents_result.scalar() or 0

        # 전체 고객 수
        clients_result = await self._db.execute(
            sa.select(sa.func.count(AgentClient.id)).where(
                AgentClient.organization_id == org_id,
            )
        )
        total_clients = clients_result.scalar() or 0

        # 이번 달 API 호출 수
        now = datetime.now(UTC)
        month_start = datetime(now.year, now.month, 1, tzinfo=UTC)
        monthly_result = await self._db.execute(
            sa.select(sa.func.count(UsageRecord.id)).where(
                UsageRecord.organization_id == org_id,
                UsageRecord.created_at >= month_start,
            )
        )
        monthly_api_calls = monthly_result.scalar() or 0

        # 설계사별 통계 (agent_id별 고객 수)
        agent_stats_result = await self._db.execute(
            sa.select(
                AgentClient.agent_id,
                sa.func.count(AgentClient.id).label("client_count"),
            ).where(
                AgentClient.organization_id == org_id,
            ).group_by(AgentClient.agent_id)
        )
        agent_statistics = [
            {"agent_id": str(row[0]), "client_count": row[1]}
            for row in agent_stats_result.all()
        ]

        # 사용량 추이 (최근 6개월)
        usage_trend = []
        for i in range(5, -1, -1):
            # i개월 전 첫날 계산
            year = now.year
            month = now.month - i
            while month <= 0:
                month += 12
                year -= 1
            period_start = datetime(year, month, 1, tzinfo=UTC)
            from calendar import monthrange
            _, last_day = monthrange(year, month)
            period_end = datetime(year, month, last_day, 23, 59, 59, tzinfo=UTC)

            trend_result = await self._db.execute(
                sa.select(sa.func.count(UsageRecord.id)).where(
                    UsageRecord.organization_id == org_id,
                    UsageRecord.created_at >= period_start,
                    UsageRecord.created_at <= period_end,
                )
            )
            count = trend_result.scalar() or 0
            usage_trend.append({
                "period": f"{year}-{month:02d}",
                "api_calls": count,
            })

        # 조직 플랜 정보
        org_result = await self._db.execute(
            sa.select(Organization).where(Organization.id == org_id)
        )
        org = org_result.scalar_one_or_none()

        if org is not None:
            raw_limit = org.monthly_api_limit
            monthly_limit = int(raw_limit) if raw_limit is not None else 1000
            if monthly_limit <= 0:
                monthly_limit = 1000
            current_usage = monthly_api_calls
            usage_percentage = round(current_usage / monthly_limit * 100, 1) if monthly_limit > 0 else 0.0
            plan_info = {
                "plan_type": org.plan_type,
                "monthly_limit": monthly_limit,
                "current_usage": current_usage,
                "usage_percentage": usage_percentage,
            }
        else:
            plan_info = {
                "plan_type": None,
                "monthly_limit": 1000,
                "current_usage": monthly_api_calls,
                "usage_percentage": 0.0,
            }

        return {
            "total_agents": total_agents,
            "total_clients": total_clients,
            "monthly_api_calls": monthly_api_calls,
            "agent_statistics": agent_statistics,
            "usage_trend": usage_trend,
            "plan_info": plan_info,
        }
