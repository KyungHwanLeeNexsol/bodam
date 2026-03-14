"""보안 헤더 미들웨어 단위 테스트 (SPEC-SEC-001 M3)

RED phase: SecurityHeadersMiddleware 구현 전 실패하는 테스트.
모든 응답에 HSTS, CSP 등 보안 헤더가 포함되어야 한다.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient


class TestSecurityHeadersMiddleware:
    """SecurityHeadersMiddleware 테스트"""

    @pytest.fixture
    def test_app(self):
        """보안 헤더 미들웨어가 적용된 테스트 FastAPI 앱"""
        from app.core.security_headers import SecurityHeadersMiddleware

        app = FastAPI()

        @app.get("/test")
        async def test_endpoint():
            return {"status": "ok"}

        app.add_middleware(SecurityHeadersMiddleware)
        return app

    @pytest.mark.asyncio
    async def test_hsts_header_present(self, test_app):
        """Strict-Transport-Security 헤더가 포함되어야 한다"""
        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/test")

        assert response.status_code == 200
        assert "strict-transport-security" in response.headers
        assert "max-age=31536000" in response.headers["strict-transport-security"]
        assert "includeSubDomains" in response.headers["strict-transport-security"]

    @pytest.mark.asyncio
    async def test_x_content_type_options_nosniff(self, test_app):
        """X-Content-Type-Options: nosniff 헤더가 포함되어야 한다"""
        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/test")

        assert "x-content-type-options" in response.headers
        assert response.headers["x-content-type-options"] == "nosniff"

    @pytest.mark.asyncio
    async def test_x_frame_options_deny(self, test_app):
        """X-Frame-Options: DENY 헤더가 포함되어야 한다"""
        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/test")

        assert "x-frame-options" in response.headers
        assert response.headers["x-frame-options"] == "DENY"

    @pytest.mark.asyncio
    async def test_content_security_policy_present(self, test_app):
        """Content-Security-Policy 헤더가 포함되어야 한다"""
        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/test")

        assert "content-security-policy" in response.headers
        csp = response.headers["content-security-policy"]
        assert "default-src" in csp

    @pytest.mark.asyncio
    async def test_referrer_policy_present(self, test_app):
        """Referrer-Policy 헤더가 포함되어야 한다"""
        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/test")

        assert "referrer-policy" in response.headers
        assert response.headers["referrer-policy"] == "strict-origin-when-cross-origin"

    @pytest.mark.asyncio
    async def test_permissions_policy_present(self, test_app):
        """Permissions-Policy 헤더가 포함되어야 한다"""
        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/test")

        assert "permissions-policy" in response.headers

    @pytest.mark.asyncio
    async def test_all_required_security_headers(self, test_app):
        """모든 필수 보안 헤더가 한 번에 존재해야 한다 (SC-020)"""
        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/test")

        required_headers = [
            "strict-transport-security",
            "x-content-type-options",
            "x-frame-options",
            "content-security-policy",
            "referrer-policy",
            "permissions-policy",
        ]

        for header in required_headers:
            assert header in response.headers, f"Missing security header: {header}"

    @pytest.mark.asyncio
    async def test_security_headers_on_error_response(self, test_app):
        """에러 응답(404 등)에도 보안 헤더가 포함되어야 한다"""
        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/nonexistent")

        assert response.status_code == 404
        assert "x-content-type-options" in response.headers
        assert "x-frame-options" in response.headers
