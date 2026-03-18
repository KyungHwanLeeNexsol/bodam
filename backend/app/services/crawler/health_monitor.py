"""CrawlerHealthMonitor - 크롤러 헬스 상태 모니터링 (SPEC-PIPELINE-001 REQ-03)

각 보험사별 크롤링 성공률, 마지막 성공 시각, 총 PDF 수, 상태를 추적.
CrawlResult 테이블을 기반으로 통계 계산.
"""

from __future__ import annotations

import dataclasses
import logging
from datetime import datetime
from enum import StrEnum
from typing import Any

import sqlalchemy as sa

logger = logging.getLogger(__name__)

# 헬스 통계 계산에 사용할 최근 실행 횟수
_WINDOW_SIZE = 10

# 연속 실패 임계값 (이 이상이면 FAILED 강제)
_CONSECUTIVE_FAILURE_THRESHOLD = 3


class HealthStatus(StrEnum):
    """크롤러 헬스 상태

    HEALTHY: 정상 (성공률 80% 이상)
    DEGRADED: 저하 (성공률 50-79%)
    FAILED: 실패 (성공률 50% 미만 또는 연속 3회 실패)
    """

    HEALTHY = "HEALTHY"
    DEGRADED = "DEGRADED"
    FAILED = "FAILED"


@dataclasses.dataclass
class CompanyHealthStatus:
    """개별 보험사 헬스 상태 정보

    SPEC-PIPELINE-001 AC-03: 회사별 헬스 모니터링 데이터.
    """

    # 보험사 코드
    company_code: str
    # 최근 N회 실행 기준 성공률 (0.0 ~ 100.0)
    success_rate: float
    # 마지막 성공 시각 (없으면 None)
    last_success_at: datetime | None
    # 총 성공적으로 처리된 PDF 수
    total_pdfs: int
    # 헬스 상태
    status: HealthStatus


# @MX:ANCHOR: [AUTO] CrawlerHealthMonitor - 크롤러 헬스 모니터링 진입점
# @MX:REASON: API 엔드포인트와 Celery 태스크에서 직접 호출됨
class CrawlerHealthMonitor:
    """크롤러 헬스 모니터링 클래스 (SPEC-PIPELINE-001 REQ-03)

    CrawlResult 테이블을 쿼리하여 각 보험사별 성공률과 상태를 계산.

    Args:
        db_session: SQLAlchemy 비동기 세션
    """

    def __init__(self, db_session: Any) -> None:
        self.db_session = db_session
        # 순환 임포트 및 pgvector 의존성 방지를 위해 지연 임포트
        self._models_loaded = False

    def _load_models(self) -> tuple:
        """CrawlResult, CrawlResultStatus 지연 로드"""
        if not self._models_loaded:
            import importlib
            crawler_models = importlib.import_module("app.models.crawler")
            self._CrawlResult = crawler_models.CrawlResult
            self._CrawlResultStatus = crawler_models.CrawlResultStatus
            self._models_loaded = True
        return self._CrawlResult, self._CrawlResultStatus

    def _calculate_status(self, success_rate: float, consecutive_failures: int) -> HealthStatus:
        """성공률과 연속 실패 횟수로 헬스 상태 계산

        Args:
            success_rate: 성공률 (0.0 ~ 100.0)
            consecutive_failures: 연속 실패 횟수

        Returns:
            HealthStatus 열거형 값
        """
        # 연속 실패 임계값 초과 시 강제 FAILED
        if consecutive_failures >= _CONSECUTIVE_FAILURE_THRESHOLD:
            return HealthStatus.FAILED

        if success_rate >= 80.0:
            return HealthStatus.HEALTHY
        elif success_rate >= 50.0:
            return HealthStatus.DEGRADED
        else:
            return HealthStatus.FAILED

    async def get_company_health(self, company_code: str) -> CompanyHealthStatus:
        """단일 보험사 헬스 상태 조회

        최근 _WINDOW_SIZE(10)개 CrawlResult를 기반으로 성공률 계산.

        Args:
            company_code: 조회할 보험사 코드

        Returns:
            CompanyHealthStatus 인스턴스
        """
        CrawlResult, CrawlResultStatus = self._load_models()  # noqa: N806

        # 최근 10개 결과 조회 (최신 순)
        recent_stmt = (
            sa.select(CrawlResult)
            .where(CrawlResult.company_code == company_code)
            .order_by(CrawlResult.created_at.desc())
            .limit(_WINDOW_SIZE)
        )
        recent_result = await self.db_session.execute(recent_stmt)
        recent_records = recent_result.scalars().all()

        if not recent_records:
            return CompanyHealthStatus(
                company_code=company_code,
                success_rate=0.0,
                last_success_at=None,
                total_pdfs=0,
                status=HealthStatus.FAILED,
            )

        # 성공률 계산 (FAILED, STRUCTURE_CHANGED를 제외한 나머지는 성공)
        failure_statuses = {CrawlResultStatus.FAILED, CrawlResultStatus.STRUCTURE_CHANGED}
        success_count = sum(
            1 for r in recent_records if r.status not in failure_statuses
        )
        success_rate = (success_count / len(recent_records)) * 100.0

        # 연속 실패 횟수 계산
        consecutive_failures = 0
        for record in recent_records:
            if record.status in failure_statuses:
                consecutive_failures += 1
            else:
                break

        # 마지막 성공 시각
        last_success_at: datetime | None = None
        for record in recent_records:
            if record.status not in failure_statuses:
                last_success_at = record.created_at
                break

        # 총 PDF 수 (FAILED, STRUCTURE_CHANGED 제외한 모든 결과)
        total_stmt = (
            sa.select(sa.func.count())
            .select_from(CrawlResult)
            .where(
                CrawlResult.company_code == company_code,
                CrawlResult.status.notin_([s.value for s in failure_statuses]),
            )
        )
        total_result = await self.db_session.execute(total_stmt)
        total_pdfs = total_result.scalar() or 0

        status = self._calculate_status(success_rate, consecutive_failures)

        return CompanyHealthStatus(
            company_code=company_code,
            success_rate=round(success_rate, 1),
            last_success_at=last_success_at,
            total_pdfs=total_pdfs,
            status=status,
        )

    async def get_all_health(self) -> dict[str, CompanyHealthStatus]:
        """모든 보험사 헬스 상태 일괄 조회

        CrawlResult 테이블에서 company_code 목록을 추출하여 각각 조회.

        Returns:
            {company_code: CompanyHealthStatus} 딕셔너리
        """
        CrawlResult, _ = self._load_models()  # noqa: N806

        # company_code 목록 조회
        distinct_stmt = sa.select(CrawlResult.company_code).distinct()
        list_result = await self.db_session.execute(distinct_stmt)
        rows = list_result.fetchall()

        if not rows:
            return {}

        result: dict[str, CompanyHealthStatus] = {}
        for row in rows:
            company_code = row[0]
            health = await self.get_company_health(company_code)
            result[company_code] = health

        return result
