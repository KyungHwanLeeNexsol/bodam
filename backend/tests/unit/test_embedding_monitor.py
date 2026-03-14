"""EmbeddingMonitorService 단위 테스트 (SPEC-EMBED-001 TASK-012)

get_missing_embeddings(), get_embedding_stats(), regenerate_missing()를 테스트.
SQLAlchemy AsyncSession을 mock으로 대체.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch


def _make_monitor(mock_session=None):
    """테스트용 EmbeddingMonitorService 생성 헬퍼"""
    from app.services.rag.embedding_monitor import EmbeddingMonitorService

    if mock_session is None:
        mock_session = AsyncMock()

    return EmbeddingMonitorService(session=mock_session)


class TestEmbeddingMonitorServiceBasic:
    """EmbeddingMonitorService 기본 동작 테스트"""

    def test_service_is_importable(self):
        """서비스 모듈이 임포트 가능해야 한다"""
        from app.services.rag.embedding_monitor import EmbeddingMonitorService

        assert EmbeddingMonitorService is not None

    def test_service_requires_session(self):
        """서비스 생성 시 session이 필요해야 한다"""
        from app.services.rag.embedding_monitor import EmbeddingMonitorService

        session = AsyncMock()
        monitor = EmbeddingMonitorService(session=session)
        assert monitor is not None


class TestGetEmbeddingStats:
    """get_embedding_stats() 테스트"""

    async def test_returns_stats_dict_with_required_keys(self):
        """통계 딕셔너리에 필수 키들이 포함되어야 한다"""
        mock_session = AsyncMock()

        # execute 결과 mock 설정 (total, embedded 쿼리)
        mock_result_total = MagicMock()
        mock_result_total.scalar_one_or_none = MagicMock(return_value=100)

        mock_result_embedded = MagicMock()
        mock_result_embedded.scalar_one_or_none = MagicMock(return_value=80)

        mock_session.execute = AsyncMock(
            side_effect=[mock_result_total, mock_result_embedded]
        )

        monitor = _make_monitor(mock_session)
        stats = await monitor.get_embedding_stats()

        required_keys = ["total_chunks", "embedded_chunks", "missing_chunks", "coverage_rate"]
        for key in required_keys:
            assert key in stats, f"필수 키 '{key}'가 누락됨"

    async def test_coverage_rate_is_correct(self):
        """coverage_rate가 올바르게 계산되어야 한다"""
        mock_session = AsyncMock()

        mock_result_total = MagicMock()
        mock_result_total.scalar_one_or_none = MagicMock(return_value=100)

        mock_result_embedded = MagicMock()
        mock_result_embedded.scalar_one_or_none = MagicMock(return_value=75)

        mock_session.execute = AsyncMock(
            side_effect=[mock_result_total, mock_result_embedded]
        )

        monitor = _make_monitor(mock_session)
        stats = await monitor.get_embedding_stats()

        assert stats["total_chunks"] == 100
        assert stats["embedded_chunks"] == 75
        assert stats["missing_chunks"] == 25
        assert abs(stats["coverage_rate"] - 0.75) < 0.001

    async def test_coverage_rate_is_zero_when_no_chunks(self):
        """청크가 없으면 coverage_rate는 0.0이어야 한다"""
        mock_session = AsyncMock()

        mock_result_total = MagicMock()
        mock_result_total.scalar_one_or_none = MagicMock(return_value=0)

        mock_result_embedded = MagicMock()
        mock_result_embedded.scalar_one_or_none = MagicMock(return_value=0)

        mock_session.execute = AsyncMock(
            side_effect=[mock_result_total, mock_result_embedded]
        )

        monitor = _make_monitor(mock_session)
        stats = await monitor.get_embedding_stats()

        assert stats["coverage_rate"] == 0.0


class TestGetMissingEmbeddings:
    """get_missing_embeddings() 테스트"""

    async def test_returns_list_of_chunk_ids(self):
        """임베딩 누락 청크 ID 목록을 반환해야 한다"""
        import uuid

        mock_session = AsyncMock()

        chunk_id_1 = uuid.uuid4()
        chunk_id_2 = uuid.uuid4()

        mock_row_1 = MagicMock()
        mock_row_1.id = chunk_id_1

        mock_row_2 = MagicMock()
        mock_row_2.id = chunk_id_2

        mock_result = MagicMock()
        mock_result.scalars = MagicMock(return_value=MagicMock(all=MagicMock(return_value=[mock_row_1, mock_row_2])))

        mock_session.execute = AsyncMock(return_value=mock_result)

        monitor = _make_monitor(mock_session)
        missing = await monitor.get_missing_embeddings()

        assert isinstance(missing, list)


class TestRegenerateMissing:
    """regenerate_missing() 테스트"""

    async def test_returns_task_id_string(self):
        """문자열 형식의 task_id를 반환해야 한다"""
        import uuid

        mock_session = AsyncMock()
        monitor = _make_monitor(mock_session)

        chunk_ids = [str(uuid.uuid4()), str(uuid.uuid4())]

        mock_get_ids = "app.services.rag.embedding_monitor.EmbeddingMonitorService._get_policy_ids_for_chunks"
        with patch("app.tasks.embedding_tasks.bulk_embed_policies") as mock_task, \
             patch(mock_get_ids, new_callable=AsyncMock, return_value=["policy-1"]):
            mock_async_result = MagicMock()
            mock_async_result.id = "test-task-id-123"
            mock_task.apply_async = MagicMock(return_value=mock_async_result)

            task_id = await monitor.regenerate_missing(chunk_ids)

        assert isinstance(task_id, str)
        assert len(task_id) > 0
