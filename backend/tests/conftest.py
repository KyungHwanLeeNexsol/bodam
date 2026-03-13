# pytest 픽스처 설정
import os

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture
async def async_client():
    """테스트용 비동기 HTTP 클라이언트 픽스처"""
    # 테스트용 환경변수 설정
    os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost/testdb")
    os.environ.setdefault("SECRET_KEY", "test-secret-key-for-testing-purposes-only")

    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
