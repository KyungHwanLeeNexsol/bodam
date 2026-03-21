"""B2B 사용량 서비스 (SPEC-B2B-001 Phase 4)

사용량 기록, Redis 카운터 관리, 월 한도 검증, 집계 조회, CSV 내보내기.
"""

from __future__ import annotations

import csv
import io
import uuid
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.organization import Organization
from app.models.usage_record import UsageRecord


class UsageService:
    """사용량 비즈니스 로직 서비스"""

    # Redis 키 TTL (35일)
    _REDIS_TTL = 35 * 24 * 3600

    def __init__(self, db: AsyncSession, redis: Any) -> None:
        self._db = db
        self._redis = redis

    def _redis_key(self, org_id: uuid.UUID) -> str:
        """Redis 사용량 키를 생성한다.

        형식: b2b:usage:{org_id}:{YYYY-MM}

        Args:
            org_id: 조직 UUID

        Returns:
            Redis 키 문자열
        """
        month = datetime.now(UTC).strftime("%Y-%m")
        return f"b2b:usage:{org_id}:{month}"

    async def record_usage(
        self,
        org_id: uuid.UUID,
        api_key_id: uuid.UUID | None,
        user_id: uuid.UUID | None,
        endpoint: str,
        method: str,
        status_code: int,
        tokens: int,
        response_time_ms: int,
        ip: str,
    ) -> None:
        """API 사용량을 기록하고 Redis 카운터를 증가시킨다 (AC-009).

        Args:
            org_id: 조직 UUID
            api_key_id: API 키 UUID (선택)
            user_id: 사용자 UUID (선택)
            endpoint: 엔드포인트
            method: HTTP 메서드
            status_code: HTTP 응답 코드
            tokens: 소비된 토큰 수
            response_time_ms: 응답 시간(ms)
            ip: 요청 IP 주소
        """
        # DB에 사용량 기록 저장
        record = UsageRecord(
            organization_id=org_id,
            api_key_id=api_key_id,
            user_id=user_id,
            endpoint=endpoint,
            method=method,
            status_code=status_code,
            tokens_consumed=tokens,
            response_time_ms=response_time_ms,
            ip_address=ip,
        )
        self._db.add(record)
        await self._db.flush()

        # Redis 월간 카운터 증가
        key = self._redis_key(org_id)
        count = await self._redis.incr(key)

        # 새 키 생성 시 TTL 설정 (35일)
        if count == 1:
            await self._redis.expire(key, self._REDIS_TTL)

    async def check_org_quota(
        self,
        org_id: uuid.UUID,
    ) -> tuple[int, int, bool]:
        """조직의 월간 API 사용량과 한도를 확인한다.

        Args:
            org_id: 조직 UUID

        Returns:
            (현재 사용량, 월 한도, 초과 여부) 튜플
        """
        # Redis에서 현재 사용량 조회
        key = self._redis_key(org_id)
        count_str = await self._redis.get(key)
        current = int(count_str) if count_str is not None else 0

        # DB에서 조직 한도 조회
        result = await self._db.execute(
            sa.select(Organization).where(Organization.id == org_id)
        )
        org = result.scalar_one_or_none()
        limit = org.monthly_api_limit if org is not None else 1000

        is_exceeded = current >= limit
        return current, limit, is_exceeded

    async def get_usage_summary(
        self,
        org_id: uuid.UUID,
        period_start: datetime,
        period_end: datetime,
    ) -> dict:
        """기간별 사용량 요약을 조회한다.

        Args:
            org_id: 조직 UUID
            period_start: 기간 시작
            period_end: 기간 종료

        Returns:
            사용량 요약 딕셔너리
        """
        # 전체 요청 수 조회
        total_result = await self._db.execute(
            sa.select(sa.func.count(UsageRecord.id)).where(
                UsageRecord.organization_id == org_id,
                UsageRecord.created_at >= period_start,
                UsageRecord.created_at <= period_end,
            )
        )
        total_requests = total_result.scalar() or 0

        # 엔드포인트별 집계
        ep_result = await self._db.execute(
            sa.select(UsageRecord.endpoint, sa.func.count(UsageRecord.id)).where(
                UsageRecord.organization_id == org_id,
                UsageRecord.created_at >= period_start,
                UsageRecord.created_at <= period_end,
            ).group_by(UsageRecord.endpoint)
        )
        by_endpoint = {row[0]: row[1] for row in ep_result.all()}

        # API 키별 집계
        key_result = await self._db.execute(
            sa.select(UsageRecord.api_key_id, sa.func.count(UsageRecord.id)).where(
                UsageRecord.organization_id == org_id,
                UsageRecord.created_at >= period_start,
                UsageRecord.created_at <= period_end,
                UsageRecord.api_key_id.isnot(None),
            ).group_by(UsageRecord.api_key_id)
        )
        by_api_key = {str(row[0]): row[1] for row in key_result.all()}

        return {
            "total_requests": total_requests,
            "by_endpoint": by_endpoint,
            "by_api_key": by_api_key,
        }

    async def get_usage_details(
        self,
        org_id: uuid.UUID,
        page: int = 1,
        page_size: int = 20,
    ) -> dict:
        """사용량 상세 기록을 페이지네이션으로 조회한다.

        Args:
            org_id: 조직 UUID
            page: 페이지 번호
            page_size: 페이지당 항목 수

        Returns:
            페이지네이션된 사용량 기록 딕셔너리
        """
        offset = (page - 1) * page_size
        result = await self._db.execute(
            sa.select(UsageRecord)
            .where(UsageRecord.organization_id == org_id)
            .order_by(UsageRecord.created_at.desc())
            .offset(offset)
            .limit(page_size)
        )
        items = result.scalars().all()

        total_result = await self._db.execute(
            sa.select(sa.func.count(UsageRecord.id)).where(
                UsageRecord.organization_id == org_id
            )
        )
        total = total_result.scalar() or 0

        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    async def export_usage_csv(
        self,
        org_id: uuid.UUID,
        period: str,
    ) -> str:
        """사용량 기록을 CSV 형식으로 내보낸다.

        Args:
            org_id: 조직 UUID
            period: 기간 (YYYY-MM 형식)

        Returns:
            CSV 문자열
        """
        # 기간 파싱
        year, month = period.split("-")
        from calendar import monthrange
        _, last_day = monthrange(int(year), int(month))
        period_start = datetime(int(year), int(month), 1, tzinfo=UTC)
        period_end = datetime(int(year), int(month), last_day, 23, 59, 59, tzinfo=UTC)

        result = await self._db.execute(
            sa.select(UsageRecord).where(
                UsageRecord.organization_id == org_id,
                UsageRecord.created_at >= period_start,
                UsageRecord.created_at <= period_end,
            ).order_by(UsageRecord.created_at)
        )
        records = result.all()

        # CSV 생성
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "date", "endpoint", "method", "status_code",
            "tokens_consumed", "response_time_ms", "ip_address",
        ])
        for (record,) in records:
            writer.writerow([
                record.created_at.isoformat() if record.created_at else "",
                record.endpoint,
                record.method,
                record.status_code,
                record.tokens_consumed,
                record.response_time_ms,
                record.ip_address,
            ])

        return output.getvalue()

    async def check_usage_threshold(
        self,
        org_id: uuid.UUID,
        threshold: float = 0.8,
    ) -> dict:
        """사용량이 임계값(기본 80%)을 초과했는지 확인한다.

        Args:
            org_id: 조직 UUID
            threshold: 경고 임계값 (0~1, 기본 0.8)

        Returns:
            {warning: bool, usage_percentage: float, ...} 딕셔너리
        """
        current, limit, _ = await self.check_org_quota(org_id=org_id)
        usage_percentage = round(current / limit * 100, 1) if limit > 0 else 0.0
        warning = usage_percentage >= (threshold * 100)

        return {
            "warning": warning,
            "usage_percentage": usage_percentage,
            "current_usage": current,
            "monthly_limit": limit,
        }
