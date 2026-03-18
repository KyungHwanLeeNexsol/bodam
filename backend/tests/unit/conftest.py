"""단위 테스트 픽스처 설정

FastAPI 의존성 오버라이드로 DB 없이 엔드포인트 테스트 가능하도록 구성.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest


@pytest.fixture(autouse=True)
def override_get_db(monkeypatch):
    """get_db 의존성을 mock으로 교체 (DB 초기화 없이 API 테스트 가능)"""
    try:
        from app.core.database import get_db
        from app.main import app

        from unittest.mock import MagicMock
        import uuid as _uuid
        from datetime import datetime, timezone

        mock_run = MagicMock()
        mock_run.id = _uuid.uuid4()
        mock_run.status = "PENDING"
        mock_run.trigger_type = "MANUAL"
        mock_run.started_at = None
        mock_run.completed_at = None
        mock_run.stats = {}
        mock_run.error_details = []

        mock_scalars = MagicMock()
        mock_scalars.all.return_value = []
        mock_scalars.scalar_one_or_none.return_value = mock_run

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_run
        mock_result.scalars.return_value = mock_scalars

        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.add = MagicMock()
        mock_session.commit = AsyncMock()
        mock_session.refresh = AsyncMock()

        async def mock_get_db():
            yield mock_session

        app.dependency_overrides[get_db] = mock_get_db
        yield
        app.dependency_overrides.pop(get_db, None)
    except Exception:
        yield
