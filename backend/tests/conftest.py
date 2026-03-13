"""pytest 픽스처 설정 (TAG-007 업데이트)

테스트 격리를 위한 환경변수 설정 및 공통 픽스처 제공.
실제 DB 연결 없이 구조 테스트가 가능하도록 환경 구성.
"""

from __future__ import annotations

import os

import pytest
from httpx import ASGITransport, AsyncClient

# ─────────────────────────────────────────────
# 테스트 환경변수 기본값 설정
# ─────────────────────────────────────────────

# 데이터베이스 URL (테스트용 로컬 PostgreSQL)
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost/testdb")

# 보안 키 (테스트 전용, 프로덕션에서 사용 금지)
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-testing-purposes-only")

# OpenAI API 키 (단위 테스트에서는 빈 문자열로 설정)
os.environ.setdefault("OPENAI_API_KEY", "")


@pytest.fixture
async def async_client():
    """테스트용 비동기 HTTP 클라이언트 픽스처"""
    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
