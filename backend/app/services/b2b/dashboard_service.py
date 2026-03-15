"""B2B 대시보드 서비스 (SPEC-B2B-001 Phase 5)

설계사 대시보드 및 조직 대시보드 데이터 집계.
AC-005: 설계사 대시보드 - 고객 수, 최근 질의, 월간 활동
AC-006: 조직 대시보드 - 설계사 수, 고객 수, 월별 호출, 설계사별 통계, 사용량 추이, 플랜 정보
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent_client import AgentClient, ConsentStatus
from app.models.organization import Organization
from app.models.organization_member import OrganizationMember, OrgMemberRole
from app.models.usage_record import UsageRecord
from app.models.user import User


# @MX:ANCHOR: DashboardService - 대시보드 집계 데이터의 단일 진입점
# @MX:REASON: 설계사 대시보드 및 조직 대시보드 엔드포인트에서 호출
class DashboardService:
    """대시보드 집계 서비스

    설계사 대시보드와 조직 대시보드에 필요한 데이터를 DB에서 집계하여 반환.
    """

    def __init__(self, db: AsyncSession) -> None:
        """DashboardService 초기화

        Args:
            db: 비동기 DB 세션
        """
        self._db = db

    async def get_agent_dashboard(
        self,
        org_id: uuid.UUID,
        agent_id: uuid.UUID,
    ) -> dict[str, Any]:
        """설계사 대시보드 데이터를 반환한다.

        Args:
            org_id: 조직 UUID
            agent_id: 설계사(사용자) UUID

        Returns:
            딕셔너리:
            - total_clients: 담당 고객 수
            - active_clients: 동의 완료 고객 수
            - recent_queries: 최근 분석 질의 이력 (최대 10건)
            - monthly_activity: 이번 달 API 호출 수
        """
        # 담당 고객 수 조회
        total_result = await self._db.execute(
            sa.select(sa.func.count(AgentClient.id)).where(
                AgentClient.organization_id == org_id,
                AgentClient.agent_id == agent_id,
            )
        )
        total_clients = total_result.scalar() or 0

        # 동의 완료 고객 수 조회
        active_result = await self._db.execute(
            sa.select(sa.func.count(AgentClient.id)).where(
                AgentClient.organization_id == org_id,
                AgentClient.agent_id == agent_id,
                AgentClient.consent_status == ConsentStatus.ACTIVE,
            )
        )
        active_clients = active_result.scalar() or 0

        # 이번 달 API 호출 수 (UsageRecord에서 집계)
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

        # 최근 분석 질의 이력 (UsageRecord에서 최대 10건)
        # 분석 관련 엔드포인트 요청만 필터링
        recent_result = await self._db.execute(
            sa.select(UsageRecord)
            .where(
                UsageRecord.organization_id == org_id,
                UsageRecord.user_id == agent_id,
                UsageRecord.endpoint.like("%analyze%"),
            )
            .order_by(UsageRecord.created_at.desc())
            .limit(10)
        )
        recent_records = recent_result.scalars().all()

        # 질의 이력 포맷 변환 (최대 10건 제한)
        recent_queries = [
            {
                "query": rec.endpoint,
                "result_summary": f"HTTP {rec.status_code}",
                "created_at": rec.created_at.isoformat() if rec.created_at else None,
            }
            for rec in recent_records[:10]
        ]

        return {
            "total_clients": total_clients,
            "active_clients": active_clients,
            "recent_queries": recent_queries,
            "monthly_activity": monthly_activity,
        }

    async def get_org_dashboard(
        self,
        org_id: uuid.UUID,
    ) -> dict[str, Any]:
        """조직 대시보드 데이터를 반환한다.

        Args:
            org_id: 조직 UUID

        Returns:
            딕셔너리:
            - total_agents: 소속 설계사 수
            - total_clients: 전체 고객 수
            - monthly_api_calls: 월별 API 호출 수
            - agent_statistics: 설계사별 고객/질의 통계
            - usage_trend: 최근 6개월 사용량 추이
            - plan_info: 현재 플랜 정보
        """
        # 소속 설계사 수 조회 (AGENT 역할만)
        agents_result = await self._db.execute(
            sa.select(sa.func.count(OrganizationMember.id)).where(
                OrganizationMember.organization_id == org_id,
                OrganizationMember.role == OrgMemberRole.AGENT,
                OrganizationMember.is_active.is_(True),
            )
        )
        total_agents = agents_result.scalar() or 0

        # 전체 고객 수 조회
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

        # 설계사별 고객/질의 통계
        agent_stats = await self._get_agent_statistics(org_id)

        # 최근 6개월 사용량 추이
        usage_trend = await self._get_usage_trend(org_id, now)

        # 플랜 정보 조회
        plan_info = await self._get_plan_info(org_id, monthly_api_calls)

        return {
            "total_agents": total_agents,
            "total_clients": total_clients,
            "monthly_api_calls": monthly_api_calls,
            "agent_statistics": agent_stats,
            "usage_trend": usage_trend,
            "plan_info": plan_info,
        }

    async def _get_agent_statistics(
        self,
        org_id: uuid.UUID,
    ) -> list[dict[str, Any]]:
        """설계사별 고객 수 및 질의 수 통계를 반환한다.

        Args:
            org_id: 조직 UUID

        Returns:
            설계사별 통계 목록 (agent_id, agent_name, client_count, query_count)
        """
        # 설계사별 고객 수 집계
        client_count_result = await self._db.execute(
            sa.select(
                AgentClient.agent_id,
                sa.func.count(AgentClient.id).label("client_count"),
            )
            .where(AgentClient.organization_id == org_id)
            .group_by(AgentClient.agent_id)
        )
        client_counts = {row[0]: row[1] for row in client_count_result.all()}

        # 설계사별 질의 수 집계 (UsageRecord에서)
        query_count_result = await self._db.execute(
            sa.select(
                UsageRecord.user_id,
                sa.func.count(UsageRecord.id).label("query_count"),
            )
            .where(
                UsageRecord.organization_id == org_id,
                UsageRecord.endpoint.like("%analyze%"),
            )
            .group_by(UsageRecord.user_id)
        )
        query_counts = {row[0]: row[1] for row in query_count_result.all()}

        # 조직 멤버(AGENT) 목록 조회
        members_result = await self._db.execute(
            sa.select(OrganizationMember, User)
            .join(User, User.id == OrganizationMember.user_id)
            .where(
                OrganizationMember.organization_id == org_id,
                OrganizationMember.role == OrgMemberRole.AGENT,
                OrganizationMember.is_active.is_(True),
            )
        )
        members = members_result.all()

        stats = []
        for member, user in members:
            stats.append({
                "agent_id": str(member.user_id),
                "agent_name": user.full_name or user.email,
                "client_count": client_counts.get(member.user_id, 0),
                "query_count": query_counts.get(member.user_id, 0),
            })

        return stats

    async def _get_usage_trend(
        self,
        org_id: uuid.UUID,
        now: datetime,
    ) -> list[dict[str, Any]]:
        """최근 6개월 사용량 추이를 반환한다.

        Args:
            org_id: 조직 UUID
            now: 현재 시각

        Returns:
            월별 사용량 목록 (period, request_count)
        """
        trend = []
        for i in range(5, -1, -1):
            # 현재 월 기준으로 i개월 전 계산
            year = now.year
            month = now.month - i
            while month <= 0:
                month += 12
                year -= 1

            period_start = datetime(year, month, 1, tzinfo=UTC)
            if month == 12:
                period_end = datetime(year + 1, 1, 1, tzinfo=UTC)
            else:
                period_end = datetime(year, month + 1, 1, tzinfo=UTC)

            count_result = await self._db.execute(
                sa.select(sa.func.count(UsageRecord.id)).where(
                    UsageRecord.organization_id == org_id,
                    UsageRecord.created_at >= period_start,
                    UsageRecord.created_at < period_end,
                )
            )
            count = count_result.scalar() or 0

            trend.append({
                "period": f"{year:04d}-{month:02d}",
                "request_count": count,
            })

        return trend

    async def _get_plan_info(
        self,
        org_id: uuid.UUID,
        current_usage: int,
    ) -> dict[str, Any]:
        """조직의 플랜 정보를 반환한다.

        Args:
            org_id: 조직 UUID
            current_usage: 현재 월 사용량

        Returns:
            플랜 정보 딕셔너리 (plan_type, monthly_limit, current_usage, usage_percentage)
        """
        org_result = await self._db.execute(
            sa.select(Organization).where(Organization.id == org_id)
        )
        org = org_result.scalar_one_or_none()

        # 조직 정보가 없거나 유효하지 않은 경우 기본값 반환
        if org is None or not hasattr(org, "__class__") or not hasattr(org, "plan_type"):
            return {
                "plan_type": "UNKNOWN",
                "monthly_limit": 0,
                "current_usage": current_usage,
                "usage_percentage": 0.0,
            }

        try:
            monthly_limit = int(org.monthly_api_limit)
            plan_type_str = str(org.plan_type)
        except (TypeError, ValueError):
            return {
                "plan_type": "UNKNOWN",
                "monthly_limit": 0,
                "current_usage": current_usage,
                "usage_percentage": 0.0,
            }

        if monthly_limit > 0:
            usage_percentage = round((current_usage / monthly_limit) * 100, 1)
        else:
            usage_percentage = 0.0

        return {
            "plan_type": plan_type_str,
            "monthly_limit": monthly_limit,
            "current_usage": current_usage,
            "usage_percentage": usage_percentage,
        }
