"""Request ID 미들웨어 단위 테스트 (TDD RED Phase)

SPEC-INFRA-002 Milestone 5: 로그 관리
- X-Request-ID 헤더가 모든 응답에 포함된다
- Request ID 는 UUID 포맷이다
- 기존 X-Request-ID 헤더가 있으면 재사용된다 (덮어쓰지 않음)
- 다른 요청은 다른 ID 를 갖는다
"""

from __future__ import annotations

import re
import uuid

import pytest
from httpx import ASGITransport, AsyncClient

UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.IGNORECASE)


@pytest.fixture
def app():
    """테스트용 FastAPI 앱 인스턴스"""
    from app.main import app as _app

    return _app


@pytest.mark.asyncio
async def test_response_has_x_request_id_header(app):
    """모든 응답에 X-Request-ID 헤더가 포함된다"""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/health")
    assert "x-request-id" in response.headers


@pytest.mark.asyncio
async def test_request_id_is_uuid_format(app):
    """X-Request-ID 헤더 값은 UUID v4 포맷이다"""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/health")
    request_id = response.headers.get("x-request-id", "")
    assert UUID_PATTERN.match(request_id), f"'{request_id}' 는 UUID v4 포맷이 아닙니다"


@pytest.mark.asyncio
async def test_existing_request_id_is_preserved(app):
    """클라이언트가 X-Request-ID를 제공하면 그 값이 응답에 그대로 반환된다"""
    custom_id = str(uuid.uuid4())
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/health", headers={"X-Request-ID": custom_id})
    assert response.headers.get("x-request-id") == custom_id


@pytest.mark.asyncio
async def test_different_requests_get_different_ids(app):
    """서로 다른 요청은 서로 다른 Request ID를 받는다"""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response1 = await client.get("/api/v1/health")
        response2 = await client.get("/api/v1/health")

    id1 = response1.headers.get("x-request-id", "")
    id2 = response2.headers.get("x-request-id", "")
    assert id1 != id2, "서로 다른 요청이 동일한 Request ID를 받았습니다"
