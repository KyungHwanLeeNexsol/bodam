"""Request ID 미들웨어 (SPEC-INFRA-002 M5)

각 HTTP 요청에 고유한 UUID v4 request_id 를 생성하여
structlog context 에 바인딩하고 X-Request-ID 응답 헤더에 추가.
클라이언트가 X-Request-ID 헤더를 제공하면 해당 값을 재사용.
"""

from __future__ import annotations

import uuid

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

# # @MX:NOTE: [AUTO] structlog contextvars 사용 - async 환경에서 요청 단위 컨텍스트 격리
logger = structlog.get_logger(__name__)


class RequestIdMiddleware(BaseHTTPMiddleware):
    """X-Request-ID 헤더 처리 미들웨어

    - 클라이언트가 X-Request-ID 헤더를 제공하면 해당 값 사용
    - 없으면 새 UUID v4 생성
    - structlog 컨텍스트에 request_id 바인딩
    - X-Request-ID 응답 헤더에 포함
    """

    async def dispatch(self, request: Request, call_next) -> Response:  # type: ignore[override]
        # 기존 헤더 확인 또는 새 UUID 생성
        request_id = request.headers.get("X-Request-ID") or request.headers.get("x-request-id")
        if not request_id:
            request_id = str(uuid.uuid4())

        # structlog 컨텍스트에 request_id 바인딩
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)

        # 요청 처리
        response = await call_next(request)

        # 응답 헤더에 X-Request-ID 추가
        response.headers["X-Request-ID"] = request_id

        return response
