"""EmbeddingService 우아한 성능 저하 단위 테스트 (SPEC-EMBED-001 TASK-006, TASK-007)

embed_batch()의 skip_on_failure 파라미터 및
연속 실패 시 APIUnavailableError 발생 테스트.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from google.api_core import exceptions as google_exceptions


def _make_service(mock_embed_fn):
    """mock embed_fn을 주입한 EmbeddingService 생성 헬퍼"""
    from app.services.rag.embeddings import EmbeddingService

    return EmbeddingService(api_key="test-google-key", _embed_fn=mock_embed_fn)


def _make_single_response(vector: list[float]) -> dict:
    """단일 텍스트 응답 mock 딕셔너리"""
    return {"embedding": vector}


def _make_batch_response(vectors: list[list[float]]) -> dict:
    """배치 텍스트 응답 mock 딕셔너리"""
    return {"embedding": [v for v in vectors]}


class TestSkipOnFailure:
    """embed_batch() skip_on_failure 파라미터 테스트"""

    async def test_individual_chunk_failure_does_not_stop_batch(self):
        """개별 청크 실패가 전체 배치를 중단시키지 않아야 한다"""
        base = "보험 약관 제1조 목적 이 약관은 피보험자의 상해 및 질병을 보장합니다."
        texts = [f"{base} 인덱스: {i:04d}" for i in range(3)]

        call_count = 0

        def mock_embed_fn(**kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise google_exceptions.GoogleAPIError("API 오류")
            content = kwargs.get("content", [])
            if isinstance(content, list):
                return _make_batch_response([[0.1] * 768 for _ in content])
            return _make_single_response([0.1] * 768)

        service = _make_service(mock_embed_fn)

        with patch("app.services.rag.embeddings.asyncio.sleep", new_callable=AsyncMock):
            results, failed_indices = await service.embed_batch(texts, skip_on_failure=True)

        assert isinstance(failed_indices, list)
        assert len(results) == len(texts)

    async def test_failed_indices_are_tracked(self):
        """실패한 청크의 인덱스가 반환되어야 한다"""
        base = "보험 약관 제1조 목적 이 약관은 피보험자의 상해 및 질병을 보장합니다."
        texts = [f"{base} 인덱스: {i:04d}" for i in range(3)]

        def mock_embed_fn_fail(**kwargs):
            raise google_exceptions.GoogleAPIError("API 오류")

        service = _make_service(mock_embed_fn_fail)

        with patch("app.services.rag.embeddings.asyncio.sleep", new_callable=AsyncMock):
            results, failed_indices = await service.embed_batch(texts, skip_on_failure=True)

        assert len(failed_indices) > 0
        for idx in failed_indices:
            assert 0 <= idx < len(texts)

    async def test_skip_on_failure_false_raises_on_error(self):
        """skip_on_failure=False(기본값)일 때 오류는 그대로 전파되어야 한다"""
        base = "보험 약관 제1조 목적 이 약관은 피보험자의 상해 및 질병을 보장합니다."
        texts = [f"{base} 인덱스: {i:04d}" for i in range(3)]

        def mock_embed_fn_fail(**kwargs):
            raise google_exceptions.GoogleAPIError("API 오류")

        service = _make_service(mock_embed_fn_fail)

        with patch("app.services.rag.embeddings.asyncio.sleep", new_callable=AsyncMock):
            with pytest.raises(Exception):
                await service.embed_batch(texts, skip_on_failure=False)

    async def test_successful_chunks_returned_when_skip_on_failure(self):
        """skip_on_failure=True 시 성공한 청크는 결과에 포함되어야 한다"""
        base = "보험 약관 제1조 목적 이 약관은 피보험자의 상해 및 질병을 보장합니다."
        texts = [f"{base} 인덱스: {i:04d}" for i in range(1)]

        def mock_embed_fn_success(**kwargs):
            content = kwargs.get("content", [])
            if isinstance(content, list):
                return _make_batch_response([[0.5] * 768 for _ in content])
            return _make_single_response([0.5] * 768)

        service = _make_service(mock_embed_fn_success)

        results, failed_indices = await service.embed_batch(texts, skip_on_failure=True)

        assert len(results) == 1
        assert failed_indices == []
        assert len(results[0]) == 768


class TestAPIUnavailableError:
    """연속 실패 시 APIUnavailableError 발생 테스트"""

    async def test_consecutive_full_failures_raise_api_unavailable(self):
        """N회 연속 전체 실패 시 APIUnavailableError가 발생해야 한다"""
        from app.services.rag.embeddings import APIUnavailableError

        base = "보험 약관 제1조 목적 이 약관은 피보험자의 상해 및 질병을 보장합니다."
        texts = [f"{base} 인덱스: {i:04d}" for i in range(1)]

        def mock_embed_fn_fail(**kwargs):
            raise google_exceptions.GoogleAPIError("서비스 불가")

        service = _make_service(mock_embed_fn_fail)
        service._consecutive_failures = service._max_consecutive_failures

        with patch("app.services.rag.embeddings.asyncio.sleep", new_callable=AsyncMock):
            with pytest.raises(APIUnavailableError):
                await service.embed_batch(texts, skip_on_failure=False)

    async def test_consecutive_failure_counter_resets_on_success(self):
        """성공 후 연속 실패 카운터가 초기화되어야 한다"""
        base = "보험 약관 제1조 목적 이 약관은 피보험자의 상해 및 질병을 보장합니다."
        texts = [f"{base} 인덱스: {i:04d}" for i in range(1)]

        def mock_embed_fn_success(**kwargs):
            content = kwargs.get("content", [])
            if isinstance(content, list):
                return _make_batch_response([[0.1] * 768 for _ in content])
            return _make_single_response([0.1] * 768)

        service = _make_service(mock_embed_fn_success)
        service._consecutive_failures = 2

        await service.embed_batch(texts, skip_on_failure=False)

        assert service._consecutive_failures == 0
