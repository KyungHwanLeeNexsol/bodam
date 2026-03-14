"""Redis 기반 슬라이딩 윈도우 Rate Limiting 모듈 (SPEC-SEC-001 M1)

IP 기반 및 사용자 기반 속도 제한을 구현한다.
Redis INCR + EXPIRE 패턴을 사용하는 슬라이딩 윈도우 카운터.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

# 엔드포인트 그룹별 기본 제한 설정
DEFAULT_LIMITS: dict[str, tuple[int, int]] = {
    "general": (60, 60),   # (요청수, 윈도우초)
    "auth": (10, 60),
    "chat": (60, 60),
    "admin": (30, 60),
}


@dataclass
class RateLimitResult:
    """Rate Limiting 검사 결과

    Attributes:
        allowed: 요청 허용 여부
        limit: 윈도우 내 최대 허용 요청 수
        remaining: 남은 요청 수
        reset_at: 제한 초기화 Unix timestamp
        retry_after: 재시도 가능까지 남은 초
        redis_error: Redis 오류 발생 여부 (fail-open 상태)
    """

    allowed: bool
    limit: int
    remaining: int
    reset_at: int
    retry_after: int = 0
    redis_error: bool = False

    def to_headers(self) -> dict[str, str]:
        """HTTP 응답 헤더 딕셔너리 반환"""
        headers = {
            "X-RateLimit-Limit": str(self.limit),
            "X-RateLimit-Remaining": str(max(0, self.remaining)),
            "X-RateLimit-Reset": str(self.reset_at),
        }
        if not self.allowed and self.retry_after > 0:
            headers["Retry-After"] = str(self.retry_after)
        return headers


class RateLimiter:
    """Redis 기반 슬라이딩 윈도우 Rate Limiter

    # @MX:ANCHOR: IP 기반 속도 제한의 핵심 진입점
    # @MX:REASON: SPEC-SEC-001 REQ-SEC-001~006 구현체, 다수 미들웨어에서 호출됨
    """

    def __init__(self, redis_client: Any) -> None:
        """초기화

        Args:
            redis_client: redis.asyncio 클라이언트 인스턴스
        """
        self._redis = redis_client

    async def check_ip_limit(
        self,
        client_ip: str,
        endpoint_group: str,
        limit: int,
        window: int,
    ) -> RateLimitResult:
        """IP 기반 속도 제한 검사

        슬라이딩 윈도우 카운터 패턴:
        1. INCR로 카운터 증가
        2. 첫 요청(count==1)이면 EXPIRE 설정
        3. 카운터가 제한 초과면 429 반환

        Args:
            client_ip: 클라이언트 IP 주소
            endpoint_group: 엔드포인트 그룹 (general/auth/chat/admin)
            limit: 윈도우 내 최대 요청 수
            window: 윈도우 크기 (초)

        Returns:
            RateLimitResult: 제한 검사 결과
        """
        # Redis 키: ratelimit:{ip}:{group}:{window_timestamp}
        window_ts = int(time.time()) // window
        key = f"ratelimit:{client_ip}:{endpoint_group}:{window_ts}"

        try:
            count = await self._redis.incr(key)

            if count == 1:
                # 첫 번째 요청: TTL 설정
                await self._redis.expire(key, window)
                ttl = window
            else:
                ttl = await self._redis.ttl(key)
                if ttl < 0:
                    ttl = window

            reset_at = int(time.time()) + max(0, ttl)

            if count > limit:
                return RateLimitResult(
                    allowed=False,
                    limit=limit,
                    remaining=0,
                    reset_at=reset_at,
                    retry_after=max(0, ttl),
                )

            return RateLimitResult(
                allowed=True,
                limit=limit,
                remaining=limit - count,
                reset_at=reset_at,
                retry_after=0,
            )

        except Exception as exc:
            # Redis 장애 시 fail-open: 요청 허용, 경고 로그 기록
            logger.warning("Rate limiting Redis error (fail-open): %s", exc)
            return RateLimitResult(
                allowed=True,
                limit=limit,
                remaining=limit,
                reset_at=int(time.time()) + window,
                retry_after=0,
                redis_error=True,
            )

    async def check_user_daily_limit(
        self,
        user_id: str,
        resource: str,
        limit: int,
    ) -> RateLimitResult:
        """사용자별 일일 제한 검사 (Free Tier 채팅 100회/일)

        Args:
            user_id: 사용자 UUID
            resource: 리소스 유형 (예: 'chat')
            limit: 일일 최대 요청 수

        Returns:
            RateLimitResult: 제한 검사 결과
        """
        from datetime import date

        today = date.today().isoformat()
        key = f"ratelimit:user:{user_id}:{resource}:{today}"

        # 일일 윈도우: 다음날 자정까지 남은 초
        now = time.time()
        tomorrow_start = (int(now) // 86400 + 1) * 86400
        ttl = int(tomorrow_start - now)

        try:
            count = await self._redis.incr(key)

            if count == 1:
                await self._redis.expire(key, ttl)

            reset_at = int(tomorrow_start)

            if count > limit:
                return RateLimitResult(
                    allowed=False,
                    limit=limit,
                    remaining=0,
                    reset_at=reset_at,
                    retry_after=ttl,
                )

            return RateLimitResult(
                allowed=True,
                limit=limit,
                remaining=limit - count,
                reset_at=reset_at,
                retry_after=0,
            )

        except Exception as exc:
            logger.warning("User daily rate limit Redis error (fail-open): %s", exc)
            return RateLimitResult(
                allowed=True,
                limit=limit,
                remaining=limit,
                reset_at=int(time.time()) + 86400,
                redis_error=True,
            )


def _get_client_ip(request: Request) -> str:
    """요청에서 클라이언트 IP 추출

    X-Forwarded-For 헤더(프록시/로드밸런서 환경) 지원.

    Args:
        request: Starlette Request 객체

    Returns:
        str: 클라이언트 IP 주소
    """
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        # X-Forwarded-For: client, proxy1, proxy2 형식에서 첫 번째 IP
        return forwarded_for.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


def _get_endpoint_group(path: str) -> str:
    """URL 경로에서 엔드포인트 그룹 결정

    Args:
        path: 요청 URL 경로

    Returns:
        str: 엔드포인트 그룹명
    """
    if path.startswith("/api/v1/auth"):
        return "auth"
    if path.startswith("/api/v1/chat"):
        return "chat"
    if path.startswith("/api/v1/admin"):
        return "admin"
    return "general"


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Rate Limiting Starlette 미들웨어

    모든 요청에 대해 IP 기반 속도 제한을 적용하고
    응답 헤더에 rate limit 정보를 주입한다.

    # @MX:ANCHOR: 모든 HTTP 요청의 속도 제한 처리 진입점
    # @MX:REASON: SPEC-SEC-001 REQ-SEC-001 - 모든 API 요청에 IP 기반 제한 적용
    """

    def __init__(self, app: Any, redis_client: Any = None) -> None:
        """미들웨어 초기화

        Args:
            app: ASGI 애플리케이션
            redis_client: Redis 클라이언트 (None이면 자동 생성)
        """
        super().__init__(app)
        self._redis_client = redis_client
        self._limiter: RateLimiter | None = None
        if redis_client is not None:
            self._limiter = RateLimiter(redis_client=redis_client)

    def _get_limiter(self) -> RateLimiter:
        """RateLimiter 인스턴스 반환 (지연 초기화)"""
        if self._limiter is None:
            try:
                from app.core.config import get_settings

                settings = get_settings()
                import redis.asyncio as aioredis

                self._redis_client = aioredis.from_url(settings.redis_url)
                self._limiter = RateLimiter(redis_client=self._redis_client)
            except Exception as exc:
                logger.warning("Failed to initialize rate limiter: %s", exc)
                # 더미 Redis로 fail-open
                mock = _FailOpenRedis()
                self._limiter = RateLimiter(redis_client=mock)
        return self._limiter

    async def dispatch(self, request: Request, call_next: Any) -> Any:
        """요청 처리 및 Rate Limit 적용"""
        client_ip = _get_client_ip(request)
        endpoint_group = _get_endpoint_group(request.url.path)

        limit, window = DEFAULT_LIMITS.get(endpoint_group, DEFAULT_LIMITS["general"])

        limiter = self._get_limiter()
        result = await limiter.check_ip_limit(client_ip, endpoint_group, limit, window)

        if not result.allowed:
            headers = result.to_headers()
            return JSONResponse(
                status_code=429,
                content={
                    "detail": "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
                    "retry_after": result.retry_after,
                },
                headers=headers,
            )

        response = await call_next(request)

        # Rate Limit 헤더를 응답에 추가 (Redis 오류 시 제외)
        if not result.redis_error:
            for key, value in result.to_headers().items():
                response.headers[key] = value

        return response


class _FailOpenRedis:
    """Redis 초기화 실패 시 사용하는 더미 구현체 (fail-open)"""

    async def incr(self, key: str) -> int:
        raise ConnectionError("Redis not available")

    async def expire(self, key: str, seconds: int) -> None:
        pass

    async def ttl(self, key: str) -> int:
        return 60
