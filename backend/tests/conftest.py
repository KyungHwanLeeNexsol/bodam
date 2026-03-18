"""pytest 픽스처 설정 (TAG-007 업데이트)

테스트 격리를 위한 환경변수 설정 및 공통 픽스처 제공.
실제 DB 연결 없이 구조 테스트가 가능하도록 환경 구성.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock

import pytest

# openai가 설치되지 않은 환경(로컬 테스트)에서 모킹
if "openai" not in sys.modules:
    openai_mock = MagicMock()
    openai_mock.AsyncOpenAI = MagicMock
    openai_mock.BadRequestError = Exception
    sys.modules["openai"] = openai_mock

# jose가 설치되지 않은 환경(로컬 테스트)에서 모킹
if "jose" not in sys.modules:
    jose_mock = MagicMock()
    jose_mock.JWTError = Exception
    jose_mock.jwt = MagicMock()
    sys.modules["jose"] = jose_mock

# pgvector가 설치되지 않은 환경(로컬 테스트)에서 모킹
# 프로덕션 환경에는 pgvector가 설치되어 있으므로 영향 없음
if "pgvector" not in sys.modules:
    import sqlalchemy as _sa

    # SQLAlchemy TypeDecorator를 상속하는 Vector 목 클래스 생성
    class _VectorType(_sa.types.TypeDecorator):
        """pgvector Vector 타입 대체 mock (테스트용)"""
        impl = _sa.Text
        cache_ok = True

        def __init__(self, dim: int = 1536) -> None:
            super().__init__()
            self.dim = dim

        def process_bind_param(self, value, dialect):
            return str(value) if value is not None else None

        def process_result_value(self, value, dialect):
            return value

    pgvector_mock = MagicMock()
    pgvector_mock.sqlalchemy = MagicMock()
    pgvector_mock.sqlalchemy.Vector = _VectorType
    sys.modules["pgvector"] = pgvector_mock
    sys.modules["pgvector.sqlalchemy"] = pgvector_mock.sqlalchemy
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
