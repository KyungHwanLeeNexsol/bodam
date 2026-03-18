"""크롤러 API 엔드포인트 (SPEC-PIPELINE-001 REQ-03)

GET /api/v1/crawler/health - 보험사별 크롤러 헬스 상태 조회
"""

from __future__ import annotations

import dataclasses
import logging
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.services.crawler.health_monitor import CrawlerHealthMonitor

logger = logging.getLogger(__name__)

router = APIRouter(tags=["crawler"])


async def get_crawler_health(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """크롤러 헬스 데이터 조회 (의존성으로도 사용 가능)

    Args:
        db: SQLAlchemy 비동기 세션

    Returns:
        {company_code: health_dict} 딕셔너리
    """
    monitor = CrawlerHealthMonitor(db_session=db)
    health_map = await monitor.get_all_health()

    # dataclass를 직렬화 가능한 딕셔너리로 변환
    result: dict[str, Any] = {}
    for company_code, health_status in health_map.items():
        d = dataclasses.asdict(health_status)
        # datetime은 ISO 포맷 문자열로 변환
        if d.get("last_success_at") is not None:
            d["last_success_at"] = d["last_success_at"].isoformat()
        result[company_code] = d

    return result


@router.get("/crawler/health")
async def crawler_health(
    health_data: dict[str, Any] = Depends(get_crawler_health),
) -> dict[str, Any]:
    """보험사별 크롤러 헬스 상태 조회 (SPEC-PIPELINE-001 AC-03)

    각 보험사의 최근 크롤링 성공률, 마지막 성공 시각, 총 PDF 수, 상태를 반환.

    Returns:
        {
            "company-code": {
                "company_code": str,
                "success_rate": float,      # 0.0 ~ 100.0
                "last_success_at": str|null, # ISO 8601 형식
                "total_pdfs": int,
                "status": "HEALTHY"|"DEGRADED"|"FAILED"
            },
            ...
        }
    """
    return health_data
