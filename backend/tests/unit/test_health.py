"""헬스체크 엔드포인트 단위 테스트 (TDD RED Phase)

SPEC-INFRA-002 Milestone 3: 헬스체크 엔드포인트
- GET /api/v1/health: 기본 liveness (항상 200 반환)
- GET /api/v1/health/ready: readiness 체크 (DB, Redis, Celery)
- GET /api/v1/health/live: 컨테이너 오케스트레이션용 liveness
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture
def app():
    """테스트용 FastAPI 앱 인스턴스"""
    from app.main import app as _app

    return _app


@pytest.mark.asyncio
async def test_health_basic_returns_200(app):
    """GET /api/v1/health 는 항상 HTTP 200을 반환한다"""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/health")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_health_basic_returns_status_ok(app):
    """GET /api/v1/health 응답 JSON에 status: 'ok' 가 포함된다"""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/health")
    data = response.json()
    assert data["status"] == "ok"


@pytest.mark.asyncio
async def test_health_basic_returns_version(app):
    """GET /api/v1/health 응답 JSON에 version 필드가 포함된다"""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/health")
    data = response.json()
    assert "version" in data


@pytest.mark.asyncio
async def test_health_live_returns_200(app):
    """GET /api/v1/health/live 는 항상 HTTP 200을 반환한다"""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/health/live")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_health_live_returns_alive_status(app):
    """GET /api/v1/health/live 응답 JSON에 status: 'alive' 가 포함된다"""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/health/live")
    data = response.json()
    assert data["status"] == "alive"


@pytest.mark.asyncio
async def test_health_ready_returns_200_when_all_healthy(app):
    """모든 컴포넌트가 정상일 때 GET /api/v1/health/ready 는 HTTP 200을 반환한다"""
    mock_db_healthy = AsyncMock(return_value={"status": "healthy", "latency_ms": 5.0, "details": "connected"})
    mock_redis_healthy = AsyncMock(return_value={"status": "healthy", "latency_ms": 1.0, "details": "connected"})
    mock_celery_healthy = AsyncMock(
        return_value={"status": "healthy", "active_workers": 1, "details": "1 workers active"}
    )

    with (
        patch("app.api.v1.health.check_database", mock_db_healthy),
        patch("app.api.v1.health.check_redis", mock_redis_healthy),
        patch("app.api.v1.health.check_celery", mock_celery_healthy),
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/api/v1/health/ready")

    assert response.status_code == 200


@pytest.mark.asyncio
async def test_health_ready_returns_healthy_status_when_all_ok(app):
    """모든 컴포넌트가 정상일 때 status 가 'healthy' 이다"""
    mock_db_healthy = AsyncMock(return_value={"status": "healthy", "latency_ms": 5.0, "details": "connected"})
    mock_redis_healthy = AsyncMock(return_value={"status": "healthy", "latency_ms": 1.0, "details": "connected"})
    mock_celery_healthy = AsyncMock(
        return_value={"status": "healthy", "active_workers": 1, "details": "1 workers active"}
    )

    with (
        patch("app.api.v1.health.check_database", mock_db_healthy),
        patch("app.api.v1.health.check_redis", mock_redis_healthy),
        patch("app.api.v1.health.check_celery", mock_celery_healthy),
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/api/v1/health/ready")

    data = response.json()
    assert data["status"] == "healthy"


@pytest.mark.asyncio
async def test_health_ready_returns_503_when_db_unreachable(app):
    """DB가 비정상일 때 GET /api/v1/health/ready 는 HTTP 503을 반환한다"""
    mock_db_unhealthy = AsyncMock(return_value={"status": "unhealthy", "latency_ms": None, "details": "connection failed"})
    mock_redis_healthy = AsyncMock(return_value={"status": "healthy", "latency_ms": 1.0, "details": "connected"})
    mock_celery_healthy = AsyncMock(
        return_value={"status": "healthy", "active_workers": 1, "details": "1 workers active"}
    )

    with (
        patch("app.api.v1.health.check_database", mock_db_unhealthy),
        patch("app.api.v1.health.check_redis", mock_redis_healthy),
        patch("app.api.v1.health.check_celery", mock_celery_healthy),
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/api/v1/health/ready")

    assert response.status_code == 503


@pytest.mark.asyncio
async def test_health_ready_returns_503_when_redis_unreachable(app):
    """Redis가 비정상일 때 GET /api/v1/health/ready 는 HTTP 503을 반환한다"""
    mock_db_healthy = AsyncMock(return_value={"status": "healthy", "latency_ms": 5.0, "details": "connected"})
    mock_redis_unhealthy = AsyncMock(
        return_value={"status": "unhealthy", "latency_ms": None, "details": "connection refused"}
    )
    mock_celery_healthy = AsyncMock(
        return_value={"status": "healthy", "active_workers": 1, "details": "1 workers active"}
    )

    with (
        patch("app.api.v1.health.check_database", mock_db_healthy),
        patch("app.api.v1.health.check_redis", mock_redis_unhealthy),
        patch("app.api.v1.health.check_celery", mock_celery_healthy),
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/api/v1/health/ready")

    assert response.status_code == 503


@pytest.mark.asyncio
async def test_health_ready_includes_component_details(app):
    """GET /api/v1/health/ready 응답에 components 필드가 포함된다"""
    mock_db_healthy = AsyncMock(return_value={"status": "healthy", "latency_ms": 5.0, "details": "connected"})
    mock_redis_healthy = AsyncMock(return_value={"status": "healthy", "latency_ms": 1.0, "details": "connected"})
    mock_celery_healthy = AsyncMock(
        return_value={"status": "healthy", "active_workers": 1, "details": "1 workers active"}
    )

    with (
        patch("app.api.v1.health.check_database", mock_db_healthy),
        patch("app.api.v1.health.check_redis", mock_redis_healthy),
        patch("app.api.v1.health.check_celery", mock_celery_healthy),
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/api/v1/health/ready")

    data = response.json()
    assert "components" in data
    assert "database" in data["components"]
    assert "redis" in data["components"]
    assert "celery" in data["components"]


@pytest.mark.asyncio
async def test_health_ready_includes_required_fields(app):
    """GET /api/v1/health/ready 응답에 필수 필드가 포함된다 (status, version, timestamp, environment, components)"""
    mock_db_healthy = AsyncMock(return_value={"status": "healthy", "latency_ms": 5.0, "details": "connected"})
    mock_redis_healthy = AsyncMock(return_value={"status": "healthy", "latency_ms": 1.0, "details": "connected"})
    mock_celery_healthy = AsyncMock(
        return_value={"status": "healthy", "active_workers": 1, "details": "1 workers active"}
    )

    with (
        patch("app.api.v1.health.check_database", mock_db_healthy),
        patch("app.api.v1.health.check_redis", mock_redis_healthy),
        patch("app.api.v1.health.check_celery", mock_celery_healthy),
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/api/v1/health/ready")

    data = response.json()
    assert "status" in data
    assert "version" in data
    assert "timestamp" in data
    assert "environment" in data
    assert "components" in data
