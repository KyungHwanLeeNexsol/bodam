"""Rate Limiter 단위 테스트 (SPEC-SEC-001 M1)

RED phase: 구현 전 실패하는 테스트.
슬라이딩 윈도우 Rate Limiting 동작 검증.
"""

from __future__ import annotations

import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestRateLimiterCore:
    """RateLimiter 핵심 로직 테스트"""

    @pytest.mark.asyncio
    async def test_ip_rate_limit_allows_within_limit(self):
        """IP 기반 속도 제한: 제한 이내 요청은 허용되어야 한다"""
        from app.core.rate_limit import RateLimiter

        mock_redis = AsyncMock()
        # 카운터가 1 (첫 번째 요청)
        mock_redis.incr.return_value = 1
        mock_redis.expire = AsyncMock()
        mock_redis.ttl = AsyncMock(return_value=55)

        limiter = RateLimiter(redis_client=mock_redis)
        result = await limiter.check_ip_limit("192.168.1.1", "general", limit=60, window=60)

        assert result.allowed is True
        assert result.limit == 60
        assert result.remaining == 59

    @pytest.mark.asyncio
    async def test_ip_rate_limit_blocks_over_limit(self):
        """IP 기반 속도 제한: 제한 초과 요청은 차단되어야 한다"""
        from app.core.rate_limit import RateLimiter

        mock_redis = AsyncMock()
        # 카운터가 61 (제한 초과)
        mock_redis.incr.return_value = 61
        mock_redis.expire = AsyncMock()
        mock_redis.ttl = AsyncMock(return_value=30)

        limiter = RateLimiter(redis_client=mock_redis)
        result = await limiter.check_ip_limit("192.168.1.1", "general", limit=60, window=60)

        assert result.allowed is False
        assert result.remaining == 0
        assert result.retry_after > 0

    @pytest.mark.asyncio
    async def test_auth_endpoint_stricter_limit(self):
        """인증 엔드포인트는 일반 API보다 엄격한 제한(10/분)을 적용해야 한다"""
        from app.core.rate_limit import RateLimiter

        mock_redis = AsyncMock()
        mock_redis.incr.return_value = 11  # 인증 제한(10) 초과
        mock_redis.expire = AsyncMock()
        mock_redis.ttl = AsyncMock(return_value=45)

        limiter = RateLimiter(redis_client=mock_redis)
        result = await limiter.check_ip_limit("192.168.1.1", "auth", limit=10, window=60)

        assert result.allowed is False
        assert result.remaining == 0

    @pytest.mark.asyncio
    async def test_rate_limit_headers_present(self):
        """Rate limit 헤더가 응답에 포함되어야 한다"""
        from app.core.rate_limit import RateLimitResult

        result = RateLimitResult(
            allowed=True,
            limit=60,
            remaining=50,
            reset_at=int(time.time()) + 30,
            retry_after=0,
        )

        headers = result.to_headers()

        assert "X-RateLimit-Limit" in headers
        assert "X-RateLimit-Remaining" in headers
        assert "X-RateLimit-Reset" in headers
        assert headers["X-RateLimit-Limit"] == "60"
        assert headers["X-RateLimit-Remaining"] == "50"

    @pytest.mark.asyncio
    async def test_rate_limit_429_includes_retry_after(self):
        """429 응답에는 Retry-After 헤더가 포함되어야 한다"""
        from app.core.rate_limit import RateLimitResult

        result = RateLimitResult(
            allowed=False,
            limit=60,
            remaining=0,
            reset_at=int(time.time()) + 30,
            retry_after=30,
        )

        headers = result.to_headers()

        assert "Retry-After" in headers
        assert int(headers["Retry-After"]) > 0

    @pytest.mark.asyncio
    async def test_different_ips_have_independent_limits(self):
        """서로 다른 IP는 독립적인 카운터를 가져야 한다"""
        from app.core.rate_limit import RateLimiter

        mock_redis = AsyncMock()
        # IP별로 다른 카운터 반환
        call_count = 0

        async def mock_incr(key):
            nonlocal call_count
            call_count += 1
            if "192.168.1.1" in key:
                return 60  # 제한에 도달
            return 1  # 첫 번째 요청

        mock_redis.incr = mock_incr
        mock_redis.expire = AsyncMock()
        mock_redis.ttl = AsyncMock(return_value=30)

        limiter = RateLimiter(redis_client=mock_redis)

        result_ip1 = await limiter.check_ip_limit("192.168.1.1", "general", limit=60, window=60)
        result_ip2 = await limiter.check_ip_limit("10.0.0.1", "general", limit=60, window=60)

        assert result_ip1.allowed is True  # 60번째 요청, 아직 허용
        assert result_ip2.allowed is True  # 1번째 요청, 허용
        assert result_ip1.remaining == 0  # IP1: 잔여 없음
        assert result_ip2.remaining == 59  # IP2: 잔여 많음

    @pytest.mark.asyncio
    async def test_redis_failure_fail_open(self):
        """Redis 장애 시 fail-open (요청 허용) 동작"""
        from app.core.rate_limit import RateLimiter

        mock_redis = AsyncMock()
        mock_redis.incr.side_effect = ConnectionError("Redis connection failed")

        limiter = RateLimiter(redis_client=mock_redis)
        result = await limiter.check_ip_limit("192.168.1.1", "general", limit=60, window=60)

        assert result.allowed is True
        assert result.redis_error is True

    @pytest.mark.asyncio
    async def test_expire_called_on_first_request(self):
        """첫 번째 요청 시 TTL 설정을 위해 EXPIRE가 호출되어야 한다"""
        from app.core.rate_limit import RateLimiter

        mock_redis = AsyncMock()
        mock_redis.incr.return_value = 1  # 첫 번째 요청
        mock_redis.expire = AsyncMock()
        mock_redis.ttl = AsyncMock(return_value=60)

        limiter = RateLimiter(redis_client=mock_redis)
        await limiter.check_ip_limit("192.168.1.1", "general", limit=60, window=60)

        mock_redis.expire.assert_called_once()

    @pytest.mark.asyncio
    async def test_no_expire_on_subsequent_requests(self):
        """이후 요청에서는 EXPIRE가 호출되지 않아야 한다 (TTL 재설정 방지)"""
        from app.core.rate_limit import RateLimiter

        mock_redis = AsyncMock()
        mock_redis.incr.return_value = 5  # 다섯 번째 요청
        mock_redis.expire = AsyncMock()
        mock_redis.ttl = AsyncMock(return_value=50)

        limiter = RateLimiter(redis_client=mock_redis)
        await limiter.check_ip_limit("192.168.1.1", "general", limit=60, window=60)

        mock_redis.expire.assert_not_called()


class TestRateLimitMiddlewareIntegration:
    """Rate Limit Middleware 통합 테스트"""

    @pytest.mark.asyncio
    async def test_middleware_adds_rate_limit_headers(self):
        """미들웨어가 응답에 Rate Limit 헤더를 추가해야 한다"""
        from app.core.rate_limit import RateLimitMiddleware

        # FastAPI 테스트 앱 생성
        from fastapi import FastAPI
        from httpx import ASGITransport, AsyncClient

        test_app = FastAPI()

        @test_app.get("/test")
        async def test_endpoint():
            return {"status": "ok"}

        mock_redis = AsyncMock()
        mock_redis.incr.return_value = 1
        mock_redis.expire = AsyncMock()
        mock_redis.ttl = AsyncMock(return_value=55)

        # 미들웨어 추가 (Redis mock 주입)
        test_app.add_middleware(RateLimitMiddleware, redis_client=mock_redis)

        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/test")

        assert response.status_code == 200
        assert "x-ratelimit-limit" in response.headers
        assert "x-ratelimit-remaining" in response.headers
        assert "x-ratelimit-reset" in response.headers

    @pytest.mark.asyncio
    async def test_middleware_returns_429_when_exceeded(self):
        """제한 초과 시 미들웨어가 429를 반환해야 한다"""
        from app.core.rate_limit import RateLimitMiddleware

        from fastapi import FastAPI
        from httpx import ASGITransport, AsyncClient

        test_app = FastAPI()

        @test_app.get("/test")
        async def test_endpoint():
            return {"status": "ok"}

        mock_redis = AsyncMock()
        mock_redis.incr.return_value = 61  # 제한 초과
        mock_redis.expire = AsyncMock()
        mock_redis.ttl = AsyncMock(return_value=30)

        test_app.add_middleware(RateLimitMiddleware, redis_client=mock_redis)

        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/test")

        assert response.status_code == 429
        assert "retry-after" in response.headers
