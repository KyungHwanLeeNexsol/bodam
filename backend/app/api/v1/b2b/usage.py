"""B2B 사용량/과금 API 라우터 (SPEC-B2B-001 Phase 4)

사용량 요약, 상세 조회, CSV 내보내기, 청구 예상 엔드포인트.
AC-009: 조직 사용량 요약 조회
AC-010: CSV 리포트 생성
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_role
from app.core.database import get_db
from app.models.user import User, UserRole
from app.schemas.b2b import (
    BillingEstimateResponse,
    UsageDetailResponse,
    UsageExportResponse,
    UsageSummaryResponse,
)
from app.services.b2b.usage_service import UsageService

# B2B 사용량 라우터
router = APIRouter(tags=["b2b-usage"])

# 요청당 예상 단가 (원, placeholder)
_COST_PER_REQUEST = 10


def _get_usage_service(db: AsyncSession) -> UsageService:
    """UsageService 인스턴스를 생성한다.

    Redis 클라이언트는 지연 초기화로 생성.
    """
    try:
        import redis.asyncio as aioredis

        from app.core.config import get_settings

        settings = get_settings()
        redis_client = aioredis.from_url(settings.redis_url)
    except Exception:
        # Redis 연결 실패 시 더미 클라이언트
        redis_client = _DummyRedis()

    return UsageService(db=db, redis=redis_client)


class _DummyRedis:
    """Redis 연결 실패 시 사용하는 더미 클라이언트 (fail-open)"""

    async def incr(self, key: str) -> int:
        return 0

    async def expire(self, key: str, seconds: int) -> None:
        pass

    async def get(self, key: str) -> None:
        return None


@router.get("/usage", response_model=UsageSummaryResponse)
async def get_usage_summary(
    org_id: uuid.UUID = Query(..., description="조직 UUID"),
    period: str = Query(
        default=None,
        description="조회 기간 (YYYY-MM 형식, 기본값: 현재 월)",
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_role(UserRole.ORG_OWNER, UserRole.AGENT_ADMIN, UserRole.SYSTEM_ADMIN)
    ),
) -> UsageSummaryResponse:
    """조직 사용량 요약을 반환한다 (ORG_OWNER, AGENT_ADMIN, SYSTEM_ADMIN).

    Args:
        org_id: 조직 UUID
        period: 조회 기간 (YYYY-MM, 기본값: 현재 월)
        db: DB 세션
        current_user: 현재 인증된 사용자

    Returns:
        조직 사용량 요약
    """
    # 기간 설정 (기본값: 현재 월)
    if period is None:
        now = datetime.now(UTC)
        period = now.strftime("%Y-%m")

    year, month = period.split("-")
    period_start = datetime(int(year), int(month), 1, tzinfo=UTC)
    if int(month) == 12:
        period_end = datetime(int(year) + 1, 1, 1, tzinfo=UTC)
    else:
        period_end = datetime(int(year), int(month) + 1, 1, tzinfo=UTC)

    service = _get_usage_service(db)

    # 사용량 요약 조회
    summary = await service.get_usage_summary(
        org_id=org_id,
        period_start=period_start,
        period_end=period_end,
    )

    # 조직 한도 조회
    current_usage, limit, _ = await service.check_org_quota(org_id)
    usage_percentage = round((current_usage / limit * 100), 1) if limit > 0 else 0.0

    return UsageSummaryResponse(
        total_requests=summary["total_requests"],
        plan_limit=limit,
        usage_percentage=usage_percentage,
        by_endpoint=summary["by_endpoint"],
        by_agent=summary["by_agent"],
    )


@router.get("/usage/details", response_model=UsageDetailResponse)
async def get_usage_details(
    org_id: uuid.UUID = Query(..., description="조직 UUID"),
    period: str = Query(
        default=None,
        description="조회 기간 (YYYY-MM 형식, 기본값: 현재 월)",
    ),
    page: int = Query(default=1, ge=1, description="페이지 번호"),
    page_size: int = Query(default=50, ge=1, le=200, description="페이지당 항목 수"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ORG_OWNER, UserRole.SYSTEM_ADMIN)),
) -> UsageDetailResponse:
    """조직의 상세 사용량 기록을 반환한다 (ORG_OWNER, SYSTEM_ADMIN).

    Args:
        org_id: 조직 UUID
        period: 조회 기간 (YYYY-MM)
        page: 페이지 번호
        page_size: 페이지당 항목 수
        db: DB 세션
        current_user: 현재 인증된 사용자

    Returns:
        페이지네이션 사용량 기록
    """
    if period is None:
        now = datetime.now(UTC)
        period = now.strftime("%Y-%m")

    year, month = period.split("-")
    period_start = datetime(int(year), int(month), 1, tzinfo=UTC)
    if int(month) == 12:
        period_end = datetime(int(year) + 1, 1, 1, tzinfo=UTC)
    else:
        period_end = datetime(int(year), int(month) + 1, 1, tzinfo=UTC)

    service = _get_usage_service(db)
    records, total = await service.get_usage_details(
        org_id=org_id,
        period_start=period_start,
        period_end=period_end,
        page=page,
        page_size=page_size,
    )

    from app.schemas.b2b import UsageRecordItem

    return UsageDetailResponse(
        items=[UsageRecordItem.model_validate(r) for r in records],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/usage/export", response_model=UsageExportResponse)
async def export_usage_csv(
    org_id: uuid.UUID = Query(..., description="조직 UUID"),
    period: str = Query(
        default=None,
        description="내보내기 기간 (YYYY-MM 형식, 기본값: 현재 월)",
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ORG_OWNER, UserRole.SYSTEM_ADMIN)),
) -> UsageExportResponse:
    """사용량 데이터를 CSV로 내보낸다 (ORG_OWNER, SYSTEM_ADMIN).

    Args:
        org_id: 조직 UUID
        period: 내보내기 기간 (YYYY-MM)
        db: DB 세션
        current_user: 현재 인증된 사용자

    Returns:
        CSV 내용 및 파일명
    """
    if period is None:
        now = datetime.now(UTC)
        period = now.strftime("%Y-%m")

    service = _get_usage_service(db)
    csv_content = await service.export_usage_csv(org_id=org_id, period=period)

    filename = f"usage_{period}_{org_id}.csv"

    return UsageExportResponse(
        csv_content=csv_content,
        filename=filename,
    )


@router.get("/billing/current", response_model=BillingEstimateResponse)
async def get_billing_estimate(
    org_id: uuid.UUID = Query(..., description="조직 UUID"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ORG_OWNER, UserRole.SYSTEM_ADMIN)),
) -> BillingEstimateResponse:
    """현재 월 청구 예상 금액을 반환한다 (ORG_OWNER, SYSTEM_ADMIN).

    Args:
        org_id: 조직 UUID
        db: DB 세션
        current_user: 현재 인증된 사용자

    Returns:
        현재 월 청구 예상 정보
    """
    service = _get_usage_service(db)

    current_usage, limit, _ = await service.check_org_quota(org_id)

    now = datetime.now(UTC)
    period = now.strftime("%Y-%m")

    usage_percentage = round((current_usage / limit * 100), 1) if limit > 0 else 0.0

    # placeholder: 요청당 10원
    estimated_cost = current_usage * _COST_PER_REQUEST

    return BillingEstimateResponse(
        period=period,
        total_requests=current_usage,
        plan_limit=limit,
        usage_percentage=usage_percentage,
        estimated_cost=estimated_cost,
    )
