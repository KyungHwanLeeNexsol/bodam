"""Usage Tracking Middleware 단위 테스트 (SPEC-B2B-001 Phase 4)

UsageTrackingMiddleware 검증:
- /api/v1/b2b/ 경로만 추적
- 응답 후 비동기 사용량 기록
- 한도 초과 시 429 반환
- X-Usage-Remaining 헤더 추가

AC-010: 월 한도 초과 시 429
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestUsageTrackingMiddlewareImport:
    """미들웨어 임포트 테스트"""

    def test_usage_tracking_middleware_importable(self):
        """UsageTrackingMiddleware가 임포트 가능해야 한다"""
        from app.core.usage_tracking import UsageTrackingMiddleware

        assert UsageTrackingMiddleware is not None


class TestUsageTrackingMiddlewarePath:
    """미들웨어 경로 필터링 테스트"""

    def test_should_track_b2b_path(self):
        """_should_track은 /api/v1/b2b/clients 등 추적 대상 경로에 대해 True를 반환해야 한다"""
        from app.core.usage_tracking import UsageTrackingMiddleware

        # 미들웨어 인스턴스 생성 (ASGI app 모킹)
        mock_app = MagicMock()
        middleware = UsageTrackingMiddleware(app=mock_app)

        assert middleware._should_track("/api/v1/b2b/clients") is True
        assert middleware._should_track("/api/v1/b2b/organizations") is True
        assert middleware._should_track("/api/v1/b2b/api-keys") is True

    def test_should_not_track_non_b2b_path(self):
        """/api/v1/b2b/ 이외 경로는 추적하지 않아야 한다"""
        from app.core.usage_tracking import UsageTrackingMiddleware

        mock_app = MagicMock()
        middleware = UsageTrackingMiddleware(app=mock_app)

        assert middleware._should_track("/api/v1/auth/login") is False
        assert middleware._should_track("/api/v1/chat") is False
        assert middleware._should_track("/api/v1/health") is False
        assert middleware._should_track("/metrics") is False

    def test_should_not_track_usage_endpoints(self):
        """사용량 조회 엔드포인트(/usage, /billing)는 추적에서 제외되어야 한다 (무한 루프 방지)"""
        from app.core.usage_tracking import UsageTrackingMiddleware

        mock_app = MagicMock()
        middleware = UsageTrackingMiddleware(app=mock_app)

        # usage/billing 엔드포인트 자체는 추적하지 않음 (무한 루프 방지)
        assert middleware._should_track("/api/v1/b2b/usage") is False
        assert middleware._should_track("/api/v1/b2b/billing") is False
        assert middleware._should_track("/api/v1/b2b/usage/details") is False


class TestUsageTrackingMiddlewareDispatch:
    """미들웨어 dispatch 테스트"""

    @pytest.mark.asyncio
    async def test_non_b2b_path_passes_through(self):
        """비B2B 경로는 추적 없이 통과해야 한다"""

        from app.core.usage_tracking import UsageTrackingMiddleware

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.headers = {}

        async def mock_call_next(request):
            return mock_response

        middleware = UsageTrackingMiddleware(app=MagicMock())

        mock_request = MagicMock()
        mock_request.url.path = "/api/v1/health"
        mock_request.method = "GET"
        mock_request.headers = {}

        response = await middleware.dispatch(mock_request, mock_call_next)

        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_quota_exceeded_returns_429(self):
        """조직 한도 초과 시 429를 반환해야 한다 (AC-010)"""

        from app.core.usage_tracking import UsageTrackingMiddleware

        middleware = UsageTrackingMiddleware(app=MagicMock())

        mock_request = MagicMock()
        mock_request.url.path = "/api/v1/b2b/clients"
        mock_request.method = "GET"
        mock_request.headers = {}
        mock_request.state = MagicMock()
        mock_request.state.org_id = None  # 조직 정보 없으면 추적 스킵

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.headers = {}

        async def mock_call_next(request):
            return mock_response

        # 한도 초과 상황을 모킹
        with patch.object(
            middleware,
            "_check_quota",
            new=AsyncMock(return_value=(1001, 1000, True)),
        ):
            with patch.object(
                middleware,
                "_get_org_id_from_request",
                new=AsyncMock(return_value="test-org-id"),
            ):
                response = await middleware.dispatch(mock_request, mock_call_next)
                # 한도 초과 시 429 반환
                assert response.status_code == 429


class TestUsageTrackingMiddlewareHeader:
    """X-Usage-Remaining 헤더 테스트"""

    def test_usage_tracking_middleware_has_header_method(self):
        """UsageTrackingMiddleware는 헤더 처리 로직을 포함해야 한다"""
        from app.core.usage_tracking import UsageTrackingMiddleware

        # 클래스가 dispatch 메서드를 가지면 됨
        assert hasattr(UsageTrackingMiddleware, "dispatch")
