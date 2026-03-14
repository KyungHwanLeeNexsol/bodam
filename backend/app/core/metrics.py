"""Prometheus 메트릭 미들웨어 및 비즈니스 메트릭

SPEC-OPS-001 REQ-OPS-001-01, REQ-OPS-001-04:
- FastAPI HTTP 메트릭 자동 수집 (PrometheusMiddleware)
- 커스텀 비즈니스 메트릭 (chat_sessions, rag_query, embedding, llm_cost)
"""

from __future__ import annotations

import time
from collections.abc import Callable

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

# ---------------------------------------------------------------------------
# HTTP 메트릭
# ---------------------------------------------------------------------------

# # @MX:ANCHOR: HTTP 메트릭 전역 싱글톤 - 앱 전체에서 공유되는 Prometheus Counter
# # @MX:REASON: fan_in >= 3 (middleware, tests, main.py)
REQUEST_COUNT = Counter(
    "http_requests_total",
    "Total HTTP requests",
    ["method", "endpoint", "status_code"],
)

# # @MX:NOTE: Histogram 버킷은 일반적인 웹 API 응답 시간을 커버하도록 설정
REQUEST_DURATION = Histogram(
    "http_request_duration_seconds",
    "HTTP request latency in seconds",
    ["method", "endpoint"],
    buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0],
)

REQUESTS_IN_PROGRESS = Gauge(
    "http_requests_in_progress",
    "Number of HTTP requests currently in progress",
    ["method", "endpoint"],
)

# ---------------------------------------------------------------------------
# 비즈니스 메트릭
# ---------------------------------------------------------------------------

# # @MX:ANCHOR: 비즈니스 메트릭 전역 싱글톤
# # @MX:REASON: fan_in >= 3 (tests, chat_service, main.py)
CHAT_SESSIONS = Counter(
    "bodam_chat_sessions_total",
    "Total chat sessions created",
    ["session_type"],
)

RAG_QUERY_DURATION = Histogram(
    "bodam_rag_query_duration_seconds",
    "RAG query latency in seconds",
    buckets=[0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0],
)

EMBEDDING_PROCESSED = Counter(
    "bodam_embedding_processed_total",
    "Total embeddings processed",
    ["status"],
)

LLM_COST = Counter(
    "bodam_llm_cost_usd_total",
    "Total LLM API cost in USD",
    ["model"],
)

LLM_RESPONSE_DURATION = Histogram(
    "bodam_llm_response_duration_seconds",
    "LLM API response time in seconds",
    ["model", "intent"],
    buckets=[0.5, 1.0, 2.0, 5.0, 10.0, 30.0],
)


# ---------------------------------------------------------------------------
# 미들웨어
# ---------------------------------------------------------------------------


class PrometheusMiddleware(BaseHTTPMiddleware):
    """/metrics를 제외한 모든 HTTP 요청의 메트릭을 자동으로 수집하는 미들웨어.

    추적 항목:
    - http_requests_total (method, endpoint, status_code)
    - http_request_duration_seconds (method, endpoint)
    - http_requests_in_progress (method, endpoint)
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """요청을 가로채고 메트릭을 기록한다.

        /metrics 경로는 추적에서 제외한다.
        """
        path = request.url.path

        # /metrics 엔드포인트 자체는 추적 제외
        if path == "/metrics":
            return await call_next(request)

        method = request.method
        endpoint = self._get_endpoint(request)

        REQUESTS_IN_PROGRESS.labels(method=method, endpoint=endpoint).inc()
        start_time = time.perf_counter()

        try:
            response = await call_next(request)
            status_code = str(response.status_code)
        except Exception as exc:
            # 예외 발생 시 500으로 기록하고 다시 raise
            status_code = "500"
            duration = time.perf_counter() - start_time
            REQUEST_COUNT.labels(method=method, endpoint=endpoint, status_code=status_code).inc()
            REQUEST_DURATION.labels(method=method, endpoint=endpoint).observe(duration)
            REQUESTS_IN_PROGRESS.labels(method=method, endpoint=endpoint).dec()
            raise exc
        else:
            duration = time.perf_counter() - start_time
            REQUEST_COUNT.labels(method=method, endpoint=endpoint, status_code=status_code).inc()
            REQUEST_DURATION.labels(method=method, endpoint=endpoint).observe(duration)
            REQUESTS_IN_PROGRESS.labels(method=method, endpoint=endpoint).dec()
            return response

    @staticmethod
    def _get_endpoint(request: Request) -> str:
        """요청 경로를 정규화된 엔드포인트 식별자로 변환한다.

        경로 파라미터를 제거하여 기수성(cardinality)을 낮춘다.
        예: /api/v1/items/123 -> /api/v1/items/{item_id}
        """
        route = request.scope.get("route")
        if route and hasattr(route, "path"):
            return route.path
        return request.url.path


# ---------------------------------------------------------------------------
# /metrics 엔드포인트 핸들러
# ---------------------------------------------------------------------------


async def metrics_endpoint(request: Request) -> Response:
    """Prometheus 형식의 메트릭 데이터를 반환하는 엔드포인트."""
    data = generate_latest()
    return Response(
        content=data,
        media_type=CONTENT_TYPE_LATEST,
    )


# ---------------------------------------------------------------------------
# 비즈니스 메트릭 헬퍼 함수
# ---------------------------------------------------------------------------


def increment_chat_session(session_type: str = "default") -> None:
    """채팅 세션 카운터를 증가시킨다.

    Args:
        session_type: 세션 유형 (예: "insurance_query", "general")
    """
    CHAT_SESSIONS.labels(session_type=session_type).inc()


def observe_rag_query_duration(duration_seconds: float) -> None:
    """RAG 쿼리 지속 시간을 히스토그램에 기록한다.

    Args:
        duration_seconds: RAG 쿼리 처리 시간 (초 단위)
    """
    RAG_QUERY_DURATION.observe(duration_seconds)


def increment_embedding_processed(status: str = "success") -> None:
    """임베딩 처리 카운터를 증가시킨다.

    Args:
        status: 처리 상태 ("success" 또는 "failure")
    """
    EMBEDDING_PROCESSED.labels(status=status).inc()


def increment_llm_cost(model: str, cost_usd: float) -> None:
    """LLM API 비용 카운터를 증가시킨다.

    Args:
        model: LLM 모델 식별자 (예: "gpt-4o", "gemini-2.0-flash")
        cost_usd: 비용 (USD 단위)
    """
    LLM_COST.labels(model=model).inc(cost_usd)


def observe_llm_response_duration(model: str, intent: str, duration: float) -> None:
    """LLM API 응답 지속 시간을 히스토그램에 기록한다.

    Args:
        model: LLM 모델 식별자
        intent: 요청 인텐트 (예: "search", "chat", "classify")
        duration: 응답 시간 (초 단위)
    """
    LLM_RESPONSE_DURATION.labels(model=model, intent=intent).observe(duration)
