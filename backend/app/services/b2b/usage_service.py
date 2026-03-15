"""B2B 사용량 추적 서비스 (SPEC-B2B-001 Phase 4)

API 사용량 기록, 할당량 확인, 요약 및 CSV 내보내기 담당.
AC-009: API 요청 시 사용량 자동 기록, 조직 사용량 요약 조회
AC-010: CSV 리포트 생성, 월 한도 초과 시 429
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

# Redis 월간 사용량 카운터 키 형식: b2b:usage:{org_id}:{YYYY-MM}
_REDIS_KEY_TTL_SECONDS = 35 * 24 * 3600  # 35일 TTL


class UsageService:
    """사용량 추적 서비스

    # @MX:ANCHOR: B2B 사용량 추적 서비스 - 과금 및 한도 관리의 핵심
    # @MX:REASON: 미들웨어, API 엔드포인트, 스케줄러 등 다수에서 호출됨
    """

    def __init__(self, db: AsyncSession, redis: Any) -> None:
        """UsageService 초기화

        Args:
            db: 비동기 DB 세션
            redis: redis.asyncio 클라이언트 인스턴스
        """
        self._db = db
        self._redis = redis

    # ─────────────────────────────────────────────
    # 사용량 기록 (AC-009)
    # ─────────────────────────────────────────────

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
    ) -> UsageRecord:
        """API 사용량을 기록한다.

        DB에 UsageRecord를 생성하고 Redis 월간 카운터를 증가시킨다.

        Args:
            org_id: 조직 UUID
            api_key_id: API 키 UUID (API 키 인증 시, 없으면 None)
            user_id: 사용자 UUID (JWT 인증 시, 없으면 None)
            endpoint: 호출된 엔드포인트
            method: HTTP 메서드
            status_code: HTTP 응답 코드
            tokens: 소비된 토큰 수
            response_time_ms: 응답 시간(밀리초)
            ip: 요청 IP 주소

        Returns:
            생성된 UsageRecord 객체
        """
        # DB에 사용량 기록 생성
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
        redis_key = self._build_usage_key(org_id)
        count = await self._redis.incr(redis_key)

        # 새 키이면 TTL 설정 (35일)
        if count == 1:
            await self._redis.expire(redis_key, _REDIS_KEY_TTL_SECONDS)

        return record

    # ─────────────────────────────────────────────
    # 할당량 확인 (AC-010)
    # ─────────────────────────────────────────────

    async def check_org_quota(
        self,
        org_id: uuid.UUID,
    ) -> tuple[int, int, bool]:
        """조직의 월간 API 사용량과 한도를 확인한다.

        Args:
            org_id: 조직 UUID

        Returns:
            (current_usage, limit, is_exceeded) 튜플
            - current_usage: 현재 월 사용량 (Redis에서 조회)
            - limit: 조직 월간 한도
            - is_exceeded: 한도 초과 여부
        """
        # Redis에서 현재 월 사용량 조회
        redis_key = self._build_usage_key(org_id)
        raw = await self._redis.get(redis_key)
        current_usage = int(raw) if raw is not None else 0

        # DB에서 조직 한도 조회
        result = await self._db.execute(
            sa.select(Organization).where(Organization.id == org_id)
        )
        org = result.scalar_one_or_none()
        limit = org.monthly_api_limit if org is not None else 0

        is_exceeded = current_usage > limit

        return current_usage, limit, is_exceeded

    # ─────────────────────────────────────────────
    # 사용량 요약 조회 (AC-009)
    # ─────────────────────────────────────────────

    async def get_usage_summary(
        self,
        org_id: uuid.UUID,
        period_start: datetime,
        period_end: datetime,
    ) -> dict[str, Any]:
        """조직의 사용량 요약을 반환한다.

        Args:
            org_id: 조직 UUID
            period_start: 집계 시작 일시
            period_end: 집계 종료 일시

        Returns:
            사용량 요약 딕셔너리:
            - total_requests: 전체 요청 수
            - by_endpoint: 엔드포인트별 요청 수
            - by_api_key: API 키별 요청 수
        """
        # 전체 요청 수 조회
        count_result = await self._db.execute(
            sa.select(sa.func.count(UsageRecord.id)).where(
                UsageRecord.organization_id == org_id,
                UsageRecord.created_at >= period_start,
                UsageRecord.created_at <= period_end,
            )
        )
        total_requests = count_result.scalar() or 0

        # 엔드포인트별 집계
        endpoint_result = await self._db.execute(
            sa.select(UsageRecord.endpoint, sa.func.count(UsageRecord.id))
            .where(
                UsageRecord.organization_id == org_id,
                UsageRecord.created_at >= period_start,
                UsageRecord.created_at <= period_end,
            )
            .group_by(UsageRecord.endpoint)
        )
        by_endpoint = {row[0]: row[1] for row in endpoint_result.all()}

        # API 키별 집계
        api_key_result = await self._db.execute(
            sa.select(UsageRecord.api_key_id, sa.func.count(UsageRecord.id))
            .where(
                UsageRecord.organization_id == org_id,
                UsageRecord.created_at >= period_start,
                UsageRecord.created_at <= period_end,
                UsageRecord.api_key_id.isnot(None),
            )
            .group_by(UsageRecord.api_key_id)
        )
        by_api_key = {str(row[0]): row[1] for row in api_key_result.all()}

        return {
            "total_requests": total_requests,
            "by_endpoint": by_endpoint,
            "by_agent": {},  # 향후 에이전트별 집계 확장용
            "by_api_key": by_api_key,
        }

    # ─────────────────────────────────────────────
    # 상세 사용량 조회 (페이지네이션)
    # ─────────────────────────────────────────────

    async def get_usage_details(
        self,
        org_id: uuid.UUID,
        period_start: datetime,
        period_end: datetime,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[UsageRecord], int]:
        """조직의 상세 사용량 기록을 페이지네이션으로 반환한다.

        Args:
            org_id: 조직 UUID
            period_start: 조회 시작 일시
            period_end: 조회 종료 일시
            page: 페이지 번호 (1-based)
            page_size: 페이지당 항목 수

        Returns:
            (records, total) 튜플
        """
        base_query = sa.select(UsageRecord).where(
            UsageRecord.organization_id == org_id,
            UsageRecord.created_at >= period_start,
            UsageRecord.created_at <= period_end,
        )

        # 전체 수 조회
        count_result = await self._db.execute(
            sa.select(sa.func.count()).select_from(base_query.subquery())
        )
        total = count_result.scalar() or 0

        # 페이지네이션 적용
        offset = (page - 1) * page_size
        records_result = await self._db.execute(
            base_query.order_by(UsageRecord.created_at.desc())
            .offset(offset)
            .limit(page_size)
        )
        records = list(records_result.scalars().all())

        return records, total

    # ─────────────────────────────────────────────
    # CSV 내보내기 (AC-010)
    # ─────────────────────────────────────────────

    async def export_usage_csv(
        self,
        org_id: uuid.UUID,
        period: str,
    ) -> str:
        """사용량 데이터를 CSV 형식으로 내보낸다.

        Args:
            org_id: 조직 UUID
            period: 기간 문자열 (YYYY-MM 형식)

        Returns:
            CSV 문자열 (헤더 포함)
        """
        # 기간 파싱 (YYYY-MM)
        year, month = period.split("-")
        period_start = datetime(int(year), int(month), 1, tzinfo=UTC)
        if int(month) == 12:
            period_end = datetime(int(year) + 1, 1, 1, tzinfo=UTC)
        else:
            period_end = datetime(int(year), int(month) + 1, 1, tzinfo=UTC)

        # 날짜별/엔드포인트별 집계
        agg_result = await self._db.execute(
            sa.select(
                sa.func.date(UsageRecord.created_at).label("date"),
                UsageRecord.endpoint,
                UsageRecord.method,
                sa.func.count(UsageRecord.id).label("count"),
                sa.func.sum(UsageRecord.tokens_consumed).label("tokens"),
                sa.func.avg(UsageRecord.response_time_ms).label("avg_response_time"),
            )
            .where(
                UsageRecord.organization_id == org_id,
                UsageRecord.created_at >= period_start,
                UsageRecord.created_at < period_end,
            )
            .group_by(
                sa.func.date(UsageRecord.created_at),
                UsageRecord.endpoint,
                UsageRecord.method,
            )
            .order_by(sa.func.date(UsageRecord.created_at))
        )
        rows = agg_result.all()

        # CSV 생성
        output = io.StringIO()
        writer = csv.writer(output)

        # 헤더 행
        writer.writerow(["date", "endpoint", "method", "count", "tokens", "avg_response_time"])

        # 데이터 행
        for row in rows:
            writer.writerow([
                str(row.date) if row.date else "",
                row.endpoint,
                row.method,
                row.count,
                row.tokens or 0,
                round(float(row.avg_response_time or 0), 2),
            ])

        return output.getvalue()

    # ─────────────────────────────────────────────
    # 사용량 임계값 확인
    # ─────────────────────────────────────────────

    async def check_usage_threshold(
        self,
        org_id: uuid.UUID,
    ) -> dict[str, Any]:
        """조직 사용량의 80% 임계값 초과 여부를 확인한다.

        Args:
            org_id: 조직 UUID

        Returns:
            딕셔너리:
            - warning: 80% 이상 사용 시 True
            - usage_percentage: 현재 사용 비율(%)
            - current_usage: 현재 사용량
            - limit: 월간 한도
        """
        current_usage, limit, _ = await self.check_org_quota(org_id)

        if limit == 0:
            usage_percentage = 0.0
        else:
            usage_percentage = round((current_usage / limit) * 100, 1)

        return {
            "warning": usage_percentage >= 80.0,
            "usage_percentage": usage_percentage,
            "current_usage": current_usage,
            "limit": limit,
        }

    # ─────────────────────────────────────────────
    # 내부 헬퍼
    # ─────────────────────────────────────────────

    def _build_usage_key(self, org_id: uuid.UUID) -> str:
        """Redis 월간 사용량 키를 생성한다.

        형식: b2b:usage:{org_id}:{YYYY-MM}
        """
        now = datetime.now(UTC)
        month_str = now.strftime("%Y-%m")
        return f"b2b:usage:{org_id}:{month_str}"
