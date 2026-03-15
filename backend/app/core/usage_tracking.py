"""B2B 사용량 추적 미들웨어 (SPEC-B2B-001 Phase 4)

/api/v1/b2b/ 경로의 API 요청에 대해 사용량을 기록하고
월간 한도 초과 시 429를 반환한다.
AC-010: 월 한도 초과 시 429
"""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

# 추적 대상 경로 접두사
_B2B_PATH_PREFIX = "/api/v1/b2b/"

# 추적 제외 경로 (사용량 조회/과금 자체 엔드포인트)
_EXCLUDED_PATHS = (
    "/api/v1/b2b/usage",
    "/api/v1/b2b/billing",
)


class UsageTrackingMiddleware(BaseHTTPMiddleware):
    """B2B API 사용량 추적 미들웨어

    # @MX:ANCHOR: B2B 사용량 추적 미들웨어 - 모든 B2B 요청의 진입점
    # @MX:REASON: AC-009/AC-010 구현체, RateLimitMiddleware 이후 등록
    """

    def __init__(self, app: Any, redis_client: Any = None) -> None:
        """미들웨어 초기화

        Args:
            app: ASGI 애플리케이션
            redis_client: Redis 클라이언트 (None이면 지연 초기화)
        """
        super().__init__(app)
        self._redis_client = redis_client

    def _should_track(self, path: str) -> bool:
        """주어진 경로가 추적 대상인지 확인한다.

        Args:
            path: 요청 URL 경로

        Returns:
            추적 대상이면 True
        """
        if not path.startswith(_B2B_PATH_PREFIX):
            return False

        # 사용량 조회/과금 엔드포인트는 제외 (무한 루프 방지)
        for excluded in _EXCLUDED_PATHS:
            if path.startswith(excluded):
                return False

        return True

    async def _get_org_id_from_request(self, request: Request) -> str | None:
        """요청에서 조직 ID를 추출한다.

        request.state.org_id가 설정되어 있으면 사용.
        없으면 None 반환.
        """
        try:
            org_id = getattr(request.state, "org_id", None)
            return str(org_id) if org_id is not None else None
        except Exception:
            return None

    async def _check_quota(
        self, org_id: str
    ) -> tuple[int, int, bool]:
        """조직 할당량을 확인한다.

        Redis와 DB를 사용하여 현재 사용량과 한도를 비교.

        Returns:
            (current_usage, limit, is_exceeded) 튜플
        """
        try:
            from app.core.config import get_settings
            from app.core.database import async_session_factory

            if self._redis_client is None:
                import redis.asyncio as aioredis

                settings = get_settings()
                self._redis_client = aioredis.from_url(settings.redis_url)

            # Redis에서 현재 월 사용량 조회
            from datetime import UTC, datetime

            now = datetime.now(UTC)
            month_str = now.strftime("%Y-%m")
            redis_key = f"b2b:usage:{org_id}:{month_str}"

            raw = await self._redis_client.get(redis_key)
            current_usage = int(raw) if raw is not None else 0

            # DB에서 조직 한도 조회
            import sqlalchemy as sa

            from app.models.organization import Organization

            async with async_session_factory() as db:
                result = await db.execute(
                    sa.select(Organization.monthly_api_limit).where(
                        Organization.id == uuid.UUID(org_id)
                    )
                )
                limit = result.scalar_one_or_none() or 0

            return current_usage, limit, current_usage >= limit

        except Exception as exc:
            logger.warning("사용량 한도 확인 오류 (fail-open): %s", exc)
            return 0, 0, False

    async def dispatch(self, request: Request, call_next: Any) -> Any:
        """요청 처리 및 사용량 추적 적용"""
        path = request.url.path

        # 비B2B 경로는 추적 없이 통과
        if not self._should_track(path):
            return await call_next(request)

        # 조직 ID 추출
        org_id = await self._get_org_id_from_request(request)

        # 조직 ID가 있으면 할당량 확인
        if org_id is not None:
            current_usage, limit, is_exceeded = await self._check_quota(org_id)

            if is_exceeded and limit > 0:
                return JSONResponse(
                    status_code=429,
                    content={
                        "detail": "월간 API 호출 한도를 초과했습니다.",
                        "current_usage": current_usage,
                        "limit": limit,
                    },
                )

        # 요청 처리 시간 측정
        start_time = time.time()
        response = await call_next(request)
        response_time_ms = int((time.time() - start_time) * 1000)

        # X-Usage-Remaining 헤더 추가
        if org_id is not None:
            try:
                current_usage, limit, _ = await self._check_quota(org_id)
                remaining = max(0, limit - current_usage)
                response.headers["X-Usage-Remaining"] = str(remaining)
            except Exception:
                pass

        # 비동기 사용량 기록 (응답 후, 논블로킹)
        if org_id is not None:
            try:
                await self._record_usage_async(
                    org_id=org_id,
                    request=request,
                    status_code=response.status_code,
                    response_time_ms=response_time_ms,
                )
            except Exception as exc:
                # 사용량 기록 실패는 요청을 차단하지 않음
                logger.warning("사용량 기록 오류 (무시): %s", exc)

        return response

    async def _record_usage_async(
        self,
        org_id: str,
        request: Request,
        status_code: int,
        response_time_ms: int,
    ) -> None:
        """사용량을 비동기로 기록한다.

        실패해도 요청을 차단하지 않음.
        """
        try:
            from app.core.config import get_settings
            from app.core.database import async_session_factory

            if self._redis_client is None:
                import redis.asyncio as aioredis

                settings = get_settings()
                self._redis_client = aioredis.from_url(settings.redis_url)

            # 클라이언트 IP 추출
            ip = self._get_client_ip(request)

            # API 키 ID와 사용자 ID 추출 (request.state에서)
            api_key_id = getattr(request.state, "api_key_id", None)
            user_id = getattr(request.state, "user_id", None)

            from app.services.b2b.usage_service import UsageService

            async with async_session_factory() as db:
                service = UsageService(db=db, redis=self._redis_client)
                await service.record_usage(
                    org_id=uuid.UUID(org_id),
                    api_key_id=api_key_id,
                    user_id=user_id,
                    endpoint=request.url.path,
                    method=request.method,
                    status_code=status_code,
                    tokens=0,  # 토큰 정보는 별도 처리 필요
                    response_time_ms=response_time_ms,
                    ip=ip,
                )
                await db.commit()

        except Exception as exc:
            logger.warning("비동기 사용량 기록 실패: %s", exc)

    def _get_client_ip(self, request: Request) -> str:
        """요청에서 클라이언트 IP를 추출한다."""
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            return forwarded_for.split(",")[0].strip()
        if request.client:
            return request.client.host
        return "unknown"
