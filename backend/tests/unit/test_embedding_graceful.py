"""EmbeddingService 우아한 성능 저하 단위 테스트 (SPEC-EMBED-001 TASK-006, TASK-007)

embed_batch()의 skip_on_failure 파라미터 및
연속 실패 시 APIUnavailableError 발생 테스트.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import openai
import pytest


def _make_service(mock_client):
    """mock 클라이언트를 주입한 EmbeddingService 생성 헬퍼"""
    from app.services.rag.embeddings import EmbeddingService

    return EmbeddingService(api_key="test-key", _client=mock_client)


class TestSkipOnFailure:
    """embed_batch() skip_on_failure 파라미터 테스트"""

    async def test_individual_chunk_failure_does_not_stop_batch(self):
        """개별 청크 실패가 전체 배치를 중단시키지 않아야 한다"""
        base = "보험 약관 제1조 목적 이 약관은 피보험자의 상해 및 질병을 보장합니다."
        texts = [f"{base} 인덱스: {i:04d}" for i in range(3)]

        call_count = 0

        async def mock_create(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                # 첫 번째 배치만 실패
                raise openai.APIError("API 오류", request=MagicMock(), body=None)
            r = MagicMock()
            r.data = [MagicMock(embedding=[0.1] * 1536) for _ in range(len(kwargs.get("input", [])))]
            return r

        mock_client = AsyncMock()
        mock_client.embeddings.create = mock_create

        service = _make_service(mock_client)

        with patch("app.services.rag.embeddings.asyncio.sleep", new_callable=AsyncMock):
            results, failed_indices = await service.embed_batch(texts, skip_on_failure=True)

        # 실패한 인덱스가 추적되어야 함
        assert isinstance(failed_indices, list)
        # 결과 리스트의 길이는 입력과 동일해야 함
        assert len(results) == len(texts)

    async def test_failed_indices_are_tracked(self):
        """실패한 청크의 인덱스가 반환되어야 한다"""
        base = "보험 약관 제1조 목적 이 약관은 피보험자의 상해 및 질병을 보장합니다."
        texts = [f"{base} 인덱스: {i:04d}" for i in range(3)]

        async def mock_create_always_fail(*args, **kwargs):
            raise openai.APIError("API 오류", request=MagicMock(), body=None)

        mock_client = AsyncMock()
        mock_client.embeddings.create = mock_create_always_fail

        service = _make_service(mock_client)

        with patch("app.services.rag.embeddings.asyncio.sleep", new_callable=AsyncMock):
            results, failed_indices = await service.embed_batch(texts, skip_on_failure=True)

        # 모두 실패하면 failed_indices에 유효한 인덱스들이 포함되어야 함
        assert len(failed_indices) > 0
        # failed_indices의 값들은 유효한 인덱스 범위 내에 있어야 함
        for idx in failed_indices:
            assert 0 <= idx < len(texts)

    async def test_skip_on_failure_false_raises_on_error(self):
        """skip_on_failure=False(기본값)일 때 오류는 그대로 전파되어야 한다"""
        base = "보험 약관 제1조 목적 이 약관은 피보험자의 상해 및 질병을 보장합니다."
        texts = [f"{base} 인덱스: {i:04d}" for i in range(3)]

        async def mock_create_fail(*args, **kwargs):
            raise openai.APIError("API 오류", request=MagicMock(), body=None)

        mock_client = AsyncMock()
        mock_client.embeddings.create = mock_create_fail

        service = _make_service(mock_client)

        with patch("app.services.rag.embeddings.asyncio.sleep", new_callable=AsyncMock):
            with pytest.raises(Exception):
                await service.embed_batch(texts, skip_on_failure=False)

    async def test_successful_chunks_returned_when_skip_on_failure(self):
        """skip_on_failure=True 시 성공한 청크는 결과에 포함되어야 한다"""
        base = "보험 약관 제1조 목적 이 약관은 피보험자의 상해 및 질병을 보장합니다."
        texts = [f"{base} 인덱스: {i:04d}" for i in range(1)]

        async def mock_create_success(*args, **kwargs):
            r = MagicMock()
            r.data = [MagicMock(embedding=[0.5] * 1536)]
            return r

        mock_client = AsyncMock()
        mock_client.embeddings.create = mock_create_success

        service = _make_service(mock_client)

        results, failed_indices = await service.embed_batch(texts, skip_on_failure=True)

        assert len(results) == 1
        assert failed_indices == []
        assert len(results[0]) == 1536


class TestAPIUnavailableError:
    """연속 실패 시 APIUnavailableError 발생 테스트"""

    async def test_consecutive_full_failures_raise_api_unavailable(self):
        """N회 연속 전체 실패 시 APIUnavailableError가 발생해야 한다"""
        from app.services.rag.embeddings import APIUnavailableError

        base = "보험 약관 제1조 목적 이 약관은 피보험자의 상해 및 질병을 보장합니다."
        texts = [f"{base} 인덱스: {i:04d}" for i in range(1)]

        async def mock_create_fail(*args, **kwargs):
            raise openai.APIError("서비스 불가", request=MagicMock(), body=None)

        mock_client = AsyncMock()
        mock_client.embeddings.create = mock_create_fail

        service = _make_service(mock_client)
        # 연속 실패 횟수를 임계값 이상으로 설정
        service._consecutive_failures = service._max_consecutive_failures

        with patch("app.services.rag.embeddings.asyncio.sleep", new_callable=AsyncMock):
            with pytest.raises(APIUnavailableError):
                await service.embed_batch(texts, skip_on_failure=False)

    async def test_consecutive_failure_counter_resets_on_success(self):
        """성공 후 연속 실패 카운터가 초기화되어야 한다"""
        base = "보험 약관 제1조 목적 이 약관은 피보험자의 상해 및 질병을 보장합니다."
        texts = [f"{base} 인덱스: {i:04d}" for i in range(1)]

        async def mock_create_success(*args, **kwargs):
            r = MagicMock()
            r.data = [MagicMock(embedding=[0.1] * 1536)]
            return r

        mock_client = AsyncMock()
        mock_client.embeddings.create = mock_create_success

        service = _make_service(mock_client)
        # 연속 실패 횟수를 임계값 근처로 설정
        service._consecutive_failures = 2

        await service.embed_batch(texts, skip_on_failure=False)

        # 성공 후 카운터가 0으로 초기화되어야 함
        assert service._consecutive_failures == 0
