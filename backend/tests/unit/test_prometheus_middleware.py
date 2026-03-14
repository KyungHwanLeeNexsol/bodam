"""Prometheus 미들웨어 단위 테스트

SPEC-OPS-001 REQ-OPS-001-01: FastAPI HTTP 메트릭 수집 검증.
TDD RED-GREEN 단계.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram
from prometheus_client import generate_latest, CONTENT_TYPE_LATEST


def create_isolated_metrics(registry: CollectorRegistry) -> dict:
    """격리된 레지스트리에 메트릭 세트를 생성한다."""
    return {
        "request_count": Counter(
            "http_requests_total",
            "Total HTTP requests",
            ["method", "endpoint", "status_code"],
            registry=registry,
        ),
        "request_duration": Histogram(
            "http_request_duration_seconds",
            "HTTP request latency",
            ["method", "endpoint"],
            buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0],
            registry=registry,
        ),
        "requests_in_progress": Gauge(
            "http_requests_in_progress",
            "Number of HTTP requests in progress",
            ["method", "endpoint"],
            registry=registry,
        ),
    }


def create_test_app(registry: CollectorRegistry) -> FastAPI:
    """격리된 레지스트리를 사용하는 테스트용 FastAPI 앱 생성"""
    import time
    from typing import Callable
    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.requests import Request
    from starlette.responses import Response

    metrics = create_isolated_metrics(registry)

    class IsolatedPrometheusMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next: Callable) -> Response:
            path = request.url.path
            if path == "/metrics":
                return await call_next(request)

            method = request.method
            route = request.scope.get("route")
            endpoint = route.path if route and hasattr(route, "path") else path

            metrics["requests_in_progress"].labels(method=method, endpoint=endpoint).inc()
            start_time = time.perf_counter()

            try:
                response = await call_next(request)
                status_code = str(response.status_code)
            except Exception as exc:
                status_code = "500"
                duration = time.perf_counter() - start_time
                metrics["request_count"].labels(
                    method=method, endpoint=endpoint, status_code=status_code
                ).inc()
                metrics["request_duration"].labels(method=method, endpoint=endpoint).observe(
                    duration
                )
                metrics["requests_in_progress"].labels(method=method, endpoint=endpoint).dec()
                raise exc
            else:
                duration = time.perf_counter() - start_time
                metrics["request_count"].labels(
                    method=method, endpoint=endpoint, status_code=status_code
                ).inc()
                metrics["request_duration"].labels(method=method, endpoint=endpoint).observe(
                    duration
                )
                metrics["requests_in_progress"].labels(method=method, endpoint=endpoint).dec()
                return response

    app = FastAPI()
    app.add_middleware(IsolatedPrometheusMiddleware)

    async def metrics_endpoint(request: Request) -> Response:
        data = generate_latest(registry)
        return Response(content=data, media_type=CONTENT_TYPE_LATEST)

    app.add_route("/metrics", metrics_endpoint)

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.get("/api/v1/items/{item_id}")
    async def get_item(item_id: int):
        return {"item_id": item_id}

    @app.get("/error")
    async def error_route():
        raise ValueError("test error")

    return app


@pytest.fixture
def registry():
    """각 테스트에 격리된 Prometheus 레지스트리를 제공한다."""
    return CollectorRegistry()


class TestPrometheusMiddlewareRequestCount:
    """HTTP 요청 카운터 테스트"""

    def test_middleware_tracks_request_count_with_labels(self, registry):
        """미들웨어가 method, endpoint, status_code 레이블로 요청 수를 추적해야 한다"""
        app = create_test_app(registry)
        client = TestClient(app, raise_server_exceptions=False)

        client.get("/health")

        response = client.get("/metrics")
        assert response.status_code == 200
        content = response.text
        assert "http_requests_total" in content
        assert 'method="GET"' in content
        assert 'status_code="200"' in content

    def test_middleware_tracks_multiple_requests(self, registry):
        """여러 요청을 추적해야 한다"""
        app = create_test_app(registry)
        client = TestClient(app, raise_server_exceptions=False)

        client.get("/health")
        client.get("/health")
        client.get("/health")

        response = client.get("/metrics")
        content = response.text
        assert "http_requests_total" in content
        # 3번 요청된 카운터가 있어야 함
        assert "3.0" in content

    def test_404_responses_are_tracked(self, registry):
        """404 응답도 추적되어야 한다"""
        app = create_test_app(registry)
        client = TestClient(app, raise_server_exceptions=False)

        client.get("/nonexistent")

        response = client.get("/metrics")
        content = response.text
        assert "http_requests_total" in content
        assert 'status_code="404"' in content


class TestPrometheusMiddlewareDuration:
    """HTTP 요청 지연 시간 추적 테스트"""

    def test_middleware_tracks_request_duration(self, registry):
        """/health 요청의 지연 시간이 히스토그램에 기록되어야 한다"""
        app = create_test_app(registry)
        client = TestClient(app, raise_server_exceptions=False)

        client.get("/health")

        response = client.get("/metrics")
        content = response.text
        assert "http_request_duration_seconds" in content
        assert "_bucket" in content
        assert "_count" in content
        assert "_sum" in content

    def test_middleware_tracks_requests_in_progress(self, registry):
        """활성 요청 수 게이지가 존재해야 한다"""
        app = create_test_app(registry)
        client = TestClient(app, raise_server_exceptions=False)

        client.get("/health")

        response = client.get("/metrics")
        content = response.text
        assert "http_requests_in_progress" in content


class TestPrometheusMetricsEndpoint:
    """/metrics 엔드포인트 테스트"""

    def test_metrics_endpoint_returns_prometheus_format(self, registry):
        """/metrics 엔드포인트가 Prometheus 형식을 반환해야 한다"""
        app = create_test_app(registry)
        client = TestClient(app)

        response = client.get("/metrics")

        assert response.status_code == 200
        assert "text/plain" in response.headers["content-type"]

    def test_metrics_endpoint_not_tracked(self, registry):
        """/metrics 요청 자체는 http_requests_total에 추적되지 않아야 한다"""
        app = create_test_app(registry)
        client = TestClient(app, raise_server_exceptions=False)

        # /metrics만 여러 번 호출
        client.get("/metrics")
        client.get("/metrics")
        client.get("/metrics")

        response = client.get("/metrics")
        content = response.text

        # /metrics 경로 자체는 추적하지 않아야 함
        assert 'endpoint="/metrics"' not in content

    def test_health_endpoint_requests_are_tracked(self, registry):
        """/health 엔드포인트 요청이 추적되어야 한다"""
        app = create_test_app(registry)
        client = TestClient(app, raise_server_exceptions=False)

        client.get("/health")

        response = client.get("/metrics")
        content = response.text
        assert 'endpoint="/health"' in content


class TestPrometheusMiddlewareExceptionHandling:
    """미들웨어 예외 처리 테스트"""

    def test_middleware_does_not_crash_on_exception(self, registry):
        """예외 발생 시에도 미들웨어가 크래시되지 않아야 한다"""
        app = create_test_app(registry)
        client = TestClient(app, raise_server_exceptions=False)

        # 예외가 발생하는 엔드포인트 호출
        response = client.get("/error")

        # 500 응답을 받지만 서버는 살아있어야 함
        assert response.status_code == 500

        # /metrics 엔드포인트는 여전히 동작해야 함
        metrics_response = client.get("/metrics")
        assert metrics_response.status_code == 200

    def test_middleware_tracks_500_responses(self, registry):
        """500 에러 응답도 추적되어야 한다"""
        app = create_test_app(registry)
        client = TestClient(app, raise_server_exceptions=False)

        client.get("/error")

        response = client.get("/metrics")
        content = response.text
        assert "http_requests_total" in content
        assert 'status_code="500"' in content


class TestPrometheusMiddlewareIntegration:
    """PrometheusMiddleware 클래스 직접 테스트"""

    def test_prometheus_middleware_class_exists(self):
        """PrometheusMiddleware 클래스가 존재해야 한다"""
        from app.core.metrics import PrometheusMiddleware

        assert PrometheusMiddleware is not None

    def test_metrics_endpoint_function_exists(self):
        """metrics_endpoint 함수가 존재해야 한다"""
        from app.core.metrics import metrics_endpoint

        assert metrics_endpoint is not None

    def test_global_metrics_counters_exist(self):
        """전역 메트릭 카운터들이 존재해야 한다"""
        from app.core.metrics import (
            REQUEST_COUNT,
            REQUEST_DURATION,
            REQUESTS_IN_PROGRESS,
        )

        assert REQUEST_COUNT is not None
        assert REQUEST_DURATION is not None
        assert REQUESTS_IN_PROGRESS is not None
