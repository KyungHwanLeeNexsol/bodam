"""보안 헤더 Middleware 모듈 (SPEC-SEC-001 M3)

모든 HTTP 응답에 OWASP 권장 보안 헤더를 추가한다.
HSTS, CSP, X-Frame-Options 등 표준 보안 헤더 집합 구현.
"""

from __future__ import annotations

from typing import Any

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

# 보안 헤더 상수 정의
SECURITY_HEADERS: dict[str, str] = {
    # HTTPS 강제 (1년, 서브도메인 포함)
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    # MIME 타입 스니핑 방지
    "X-Content-Type-Options": "nosniff",
    # 클릭재킹 방지
    "X-Frame-Options": "DENY",
    # XSS 보호 (CSP 사용 시 0으로 비활성화)
    "X-XSS-Protection": "0",
    # Referer 정보 제한
    "Referrer-Policy": "strict-origin-when-cross-origin",
    # 불필요한 브라우저 기능 비활성화
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    # Content Security Policy (API 서버 기준)
    "Content-Security-Policy": (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "font-src 'self'; "
        "object-src 'none'; "
        "base-uri 'self'"
    ),
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """보안 헤더 주입 Starlette 미들웨어

    모든 HTTP 응답에 OWASP 권장 보안 헤더를 자동으로 추가한다.

    # @MX:ANCHOR: 모든 응답의 보안 헤더 주입 진입점
    # @MX:REASON: SPEC-SEC-001 REQ-SEC-020 - 모든 응답에 보안 헤더 포함
    """

    async def dispatch(self, request: Request, call_next: Any) -> Any:
        """요청 처리 후 응답에 보안 헤더 추가"""
        response = await call_next(request)

        for header_name, header_value in SECURITY_HEADERS.items():
            response.headers[header_name] = header_value

        return response
