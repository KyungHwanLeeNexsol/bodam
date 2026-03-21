"""B2B 사용량/과금 API 라우터 (SPEC-B2B-001 Phase 4)

사용량 요약, 상세, CSV 내보내기, 청구 예상 엔드포인트.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_role
from app.core.database import get_db
from app.models.user import User, UserRole
from app.schemas.b2b import (
    BillingEstimateResponse,
    UsageDetailResponse,
    UsageExportResponse,
    UsageRecordItem,
    UsageSummaryResponse,
)
from app.services.b2b.usage_service import UsageService

router = APIRouter(tags=["b2b-usage"])


def _get_redis():
    """Redis 클라이언트를 반환한다 (placeholder)."""
    return None


@router.get("/usage", response_model=UsageSummaryResponse)
async def get_usage_summary(
    period_start: datetime | None = Query(default=None),
    period_end: datetime | None = Query(default=None),
    current_user: User = Depends(require_role(UserRole.ORG_OWNER, UserRole.AGENT_ADMIN, UserRole.SYSTEM_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> UsageSummaryResponse:
    """조직 사용량 요약을 조회한다 (AC-009)."""
    now = datetime.now(UTC)
    if period_start is None:
        period_start = datetime(now.year, now.month, 1, tzinfo=UTC)
    if period_end is None:
        period_end = now

    service = UsageService(db=db, redis=_get_redis())
    summary = await service.get_usage_summary(
        org_id=current_user.id,
        period_start=period_start,
        period_end=period_end,
    )
    current, limit, _ = await service.check_org_quota(org_id=current_user.id)
    usage_pct = round(current / limit * 100, 1) if limit > 0 else 0.0

    return UsageSummaryResponse(
        total_requests=summary["total_requests"],
        plan_limit=limit,
        usage_percentage=usage_pct,
        by_endpoint=summary["by_endpoint"],
        by_agent=summary["by_api_key"],
    )


@router.get("/usage/details", response_model=UsageDetailResponse)
async def get_usage_details(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    current_user: User = Depends(require_role(UserRole.ORG_OWNER, UserRole.SYSTEM_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> UsageDetailResponse:
    """사용량 상세 기록을 페이지네이션으로 조회한다."""
    service = UsageService(db=db, redis=_get_redis())
    details = await service.get_usage_details(
        org_id=current_user.id,
        page=page,
        page_size=page_size,
    )
    items = [UsageRecordItem.model_validate(item) for item in details["items"]]
    return UsageDetailResponse(
        items=items,
        total=details["total"],
        page=details["page"],
        page_size=details["page_size"],
    )


@router.get("/usage/export", response_model=UsageExportResponse)
async def export_usage(
    period: str = Query(default=None, description="YYYY-MM 형식"),
    current_user: User = Depends(require_role(UserRole.ORG_OWNER, UserRole.SYSTEM_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> UsageExportResponse:
    """사용량 기록을 CSV로 내보낸다 (AC-010)."""
    now = datetime.now(UTC)
    if period is None:
        period = now.strftime("%Y-%m")

    service = UsageService(db=db, redis=_get_redis())
    csv_content = await service.export_usage_csv(org_id=current_user.id, period=period)
    filename = f"usage_{period}.csv"
    return UsageExportResponse(csv_content=csv_content, filename=filename)


@router.get("/billing/current", response_model=BillingEstimateResponse)
async def get_billing_estimate(
    current_user: User = Depends(require_role(UserRole.ORG_OWNER, UserRole.SYSTEM_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> BillingEstimateResponse:
    """현재 월 청구 예상 금액을 조회한다."""
    now = datetime.now(UTC)
    period = now.strftime("%Y-%m")

    service = UsageService(db=db, redis=_get_redis())
    current, limit, _ = await service.check_org_quota(org_id=current_user.id)
    usage_pct = round(current / limit * 100, 1) if limit > 0 else 0.0
    # 요청당 10원 기준
    estimated_cost = current * 10

    return BillingEstimateResponse(
        period=period,
        total_requests=current,
        plan_limit=limit,
        usage_percentage=usage_pct,
        estimated_cost=estimated_cost,
    )
