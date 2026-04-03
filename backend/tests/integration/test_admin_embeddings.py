"""Admin 임베딩 API 통합 테스트 (SPEC-EMBED-001 TASK-011, TASK-013)

POST /admin/embeddings/batch, GET /admin/embeddings/batch/{task_id},
GET /admin/embeddings/health, POST /admin/embeddings/regenerate 엔드포인트 테스트.
실제 DB/Redis 연결 없이 mock 사용.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

from httpx import ASGITransport, AsyncClient


def _make_app():
    """테스트용 FastAPI 앱 생성"""
    import os

    os.environ["TESTING"] = "true"
    os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost/bodam")
    os.environ.setdefault("SECRET_KEY", "test-secret-key")

    from app.main import create_app

    return create_app()


class TestBatchEmbeddingAPI:
    """POST /admin/embeddings/batch 테스트"""

    async def test_batch_returns_202_with_task_id(self):
        """배치 임베딩 시작 시 202와 task_id를 반환해야 한다"""
        app = _make_app()

        mock_task = MagicMock()
        mock_task.id = "test-task-id-123"

        with patch("app.tasks.embedding_tasks.bulk_embed_policies") as mock_bulk:
            mock_bulk.apply_async = MagicMock(return_value=mock_task)

            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                policy_ids = [str(uuid.uuid4()), str(uuid.uuid4())]
                response = await client.post(
                    "/api/v1/admin/embeddings/batch",
                    json={"policy_ids": policy_ids, "force": False},
                )

        assert response.status_code == 202
        data = response.json()
        assert "task_id" in data
        assert data["status"] == "accepted"
        assert data["policy_count"] == 2

    async def test_batch_empty_policy_ids_returns_422(self):
        """빈 policy_ids는 422 유효성 오류를 반환해야 한다"""
        app = _make_app()

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                "/api/v1/admin/embeddings/batch",
                json={"policy_ids": []},
            )

        assert response.status_code == 422


class TestBatchProgressAPI:
    """GET /admin/embeddings/batch/{task_id} 테스트"""

    async def test_progress_returns_task_info(self):
        """진행률 조회가 올바른 구조를 반환해야 한다"""
        import json

        from app.api.v1.admin.embeddings import get_redis_client

        app = _make_app()

        progress_data = {
            "status": "started",
            "total": 5,
            "completed": 2,
            "failed": 0,
        }

        mock_redis = MagicMock()
        mock_redis.get = MagicMock(return_value=json.dumps(progress_data))

        app.dependency_overrides[get_redis_client] = lambda: mock_redis

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/admin/embeddings/batch/test-task-id-123")

        app.dependency_overrides = {}

        assert response.status_code == 200
        data = response.json()
        assert data["task_id"] == "test-task-id-123"
        assert data["total"] == 5
        assert data["completed"] == 2


class TestEmbeddingHealthAPI:
    """GET /admin/embeddings/health 테스트"""

    async def test_health_returns_stats(self):
        """임베딩 상태 점검이 통계를 반환해야 한다"""
        app = _make_app()

        mock_stats = {
            "total_chunks": 100,
            "embedded_chunks": 85,
            "missing_chunks": 15,
            "coverage_rate": 0.85,
        }

        mock_monitor = AsyncMock()
        mock_monitor.get_embedding_stats = AsyncMock(return_value=mock_stats)

        with patch("app.api.v1.admin.embeddings.get_db") as mock_get_db, \
             patch("app.api.v1.admin.embeddings.EmbeddingMonitorService", return_value=mock_monitor):

            async def async_gen():
                yield MagicMock()

            mock_get_db.return_value = async_gen()

            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                response = await client.get("/api/v1/admin/embeddings/health")

        assert response.status_code == 200
        data = response.json()
        required_keys = ["total_chunks", "embedded_chunks", "missing_chunks", "coverage_rate"]
        for key in required_keys:
            assert key in data


class TestRegenerateAPI:
    """POST /admin/embeddings/regenerate 테스트"""

    async def test_regenerate_returns_202(self):
        """임베딩 재생성 요청 시 202를 반환해야 한다"""
        app = _make_app()

        chunk_ids = [str(uuid.uuid4()), str(uuid.uuid4())]

        mock_monitor = AsyncMock()
        mock_monitor.regenerate_missing = AsyncMock(return_value="regen-task-id-456")

        with patch("app.api.v1.admin.embeddings.get_db") as mock_get_db, \
             patch("app.api.v1.admin.embeddings.EmbeddingMonitorService", return_value=mock_monitor):

            async def async_gen():
                yield MagicMock()

            mock_get_db.return_value = async_gen()

            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/admin/embeddings/regenerate",
                    json={"chunk_ids": chunk_ids},
                )

        assert response.status_code == 202
        data = response.json()
        assert "task_id" in data
        assert data["chunk_count"] == 2
        assert data["status"] == "accepted"
