"""임베딩 서비스 단위 테스트 (TAG-008)

EmbeddingService의 텍스트 임베딩 생성, 배치 처리,
재시도 로직, 입력 유효성 검사를 테스트.
실제 Google Gemini API 호출 없이 mock 함수를 주입.

Google embed_content 응답 구조:
- 단일 텍스트: {"embedding": {"values": [float, ...]}}
- 배치 텍스트: {"embedding": [{"values": [...]}, ...]}
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from google.api_core import exceptions as google_exceptions


def _make_single_response(vector: list[float]) -> dict:
    """단일 텍스트 응답 mock 딕셔너리 생성 헬퍼"""
    return {"embedding": {"values": vector}}


def _make_batch_response(vectors: list[list[float]]) -> dict:
    """배치 텍스트 응답 mock 딕셔너리 생성 헬퍼"""
    return {"embedding": [{"values": v} for v in vectors]}


def _make_service(mock_embed_fn):
    """mock embed_fn을 주입한 EmbeddingService 생성 헬퍼"""
    from app.services.rag.embeddings import EmbeddingService

    return EmbeddingService(api_key="test-google-key", _embed_fn=mock_embed_fn)


class TestEmbedTextSingle:
    """단일 텍스트 임베딩 테스트"""

    async def test_embed_text_returns_768_dim_vector(self):
        """단일 텍스트 임베딩이 768차원 float 배열을 반환해야 한다"""
        # 768차원 mock 응답 생성
        mock_vector = [0.1] * 768
        mock_embed_fn = MagicMock(return_value=_make_single_response(mock_vector))

        service = _make_service(mock_embed_fn)
        result = await service.embed_text("보험 약관 텍스트 내용입니다. " * 5)

        assert isinstance(result, list)
        assert len(result) == 768
        assert all(isinstance(v, float) for v in result)

    async def test_embed_text_values_in_range(self):
        """임베딩 벡터의 모든 값이 [-1.0, 1.0] 범위 내에 있어야 한다"""
        mock_vector = [0.5 * (i / 768) for i in range(768)]
        mock_embed_fn = MagicMock(return_value=_make_single_response(mock_vector))

        service = _make_service(mock_embed_fn)
        result = await service.embed_text("충분한 길이의 텍스트입니다. 보험 상품 관련 내용.")

        assert all(-1.0 <= v <= 1.0 for v in result)

    async def test_embed_text_raises_error_when_api_key_empty(self):
        """Google API 키가 빈 문자열이면 ValueError를 발생시켜야 한다"""
        from app.services.rag.embeddings import EmbeddingService

        with pytest.raises(ValueError, match="API"):
            EmbeddingService(api_key="")

    async def test_embed_text_raises_error_when_api_key_none(self):
        """Google API 키가 None이면 ValueError를 발생시켜야 한다"""
        from app.services.rag.embeddings import EmbeddingService

        with pytest.raises(ValueError):
            EmbeddingService(api_key=None)


class TestEmbedBatch:
    """배치 임베딩 테스트"""

    async def test_embed_batch_processes_multiple_texts(self):
        """여러 텍스트를 배치로 임베딩 처리해야 한다"""
        # 각 텍스트는 50자 이상이어야 임베딩 대상 (필터링 기준)
        base = "보험 약관 제1조 목적 이 약관은 피보험자의 상해 및 질병을 보장합니다."
        texts = [f"{base} 인덱스 번호: {i:04d}" for i in range(1, 4)]

        mock_vectors = [[0.1] * 768 for _ in texts]
        mock_embed_fn = MagicMock(return_value=_make_batch_response(mock_vectors))

        service = _make_service(mock_embed_fn)
        results = await service.embed_batch(texts)

        assert len(results) == 3
        assert all(len(r) == 768 for r in results)

    async def test_embed_batch_optimizes_batch_size(self):
        """100개 초과 텍스트는 여러 API 호출로 분할해야 한다"""
        # 110개 텍스트 생성 (100 배치 크기 초과, 각 텍스트 50자 이상 보장)
        base = "보험 약관 제1조 목적 이 약관은 피보험자의 상해 및 질병을 보장합니다."
        texts = [f"{base} 인덱스 번호: {i:04d}" for i in range(110)]

        call_counts = []

        def mock_embed_fn(model, content, task_type):
            if isinstance(content, list):
                call_counts.append(len(content))
                return _make_batch_response([[0.1] * 768 for _ in content])
            else:
                call_counts.append(1)
                return _make_single_response([0.1] * 768)

        service = _make_service(mock_embed_fn)
        results = await service.embed_batch(texts)

        # 110개 텍스트 → 최소 2번의 API 호출 (배치 크기 100)
        assert len(call_counts) >= 2
        # 각 배치는 100개를 넘지 않아야 함
        assert all(c <= 100 for c in call_counts)
        assert len(results) == 110

    async def test_embed_batch_filters_short_texts(self):
        """50자 미만 텍스트는 필터링하고 빈 리스트를 반환해야 한다"""
        texts = [
            "짧은",  # 필터링 대상 (50자 미만, 3자)
            "충분히 긴 텍스트 내용입니다. 이것은 50자를 충분히 초과하는 텍스트입니다. 보험 약관 관련 내용.",
            "짧음",  # 필터링 대상 (50자 미만, 3자)
        ]

        mock_embed_fn = MagicMock(return_value=_make_single_response([0.2] * 768))

        service = _make_service(mock_embed_fn)
        results = await service.embed_batch(texts)

        # 긴 텍스트 1개만 임베딩됨, 짧은 텍스트는 빈 리스트로 반환
        assert len(results) == 3
        assert results[0] == []  # 짧은 텍스트
        assert len(results[1]) == 768  # 긴 텍스트
        assert results[2] == []  # 짧은 텍스트

    async def test_embed_batch_empty_list_returns_empty(self):
        """빈 텍스트 리스트는 빈 결과를 반환해야 한다"""
        mock_embed_fn = MagicMock()

        service = _make_service(mock_embed_fn)
        results = await service.embed_batch([])

        assert results == []


class TestRetryLogic:
    """재시도 로직 테스트"""

    async def test_retry_on_google_api_error(self):
        """GoogleAPIError 발생 시 최대 3회 재시도해야 한다"""
        mock_vector = [0.1] * 768

        # 처음 2번은 GoogleAPIError, 3번째는 성공
        call_count = 0

        def mock_embed_fn(model, content, task_type):
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise google_exceptions.GoogleAPIError("API error")
            if isinstance(content, list):
                return _make_batch_response([mock_vector])
            return _make_single_response(mock_vector)

        service = _make_service(mock_embed_fn)

        long_text = "보험 약관 제1조 목적 이 약관은 피보험자의 상해 및 질병을 보장합니다. 인덱스: 0000"
        with patch("app.services.rag.embeddings.asyncio.sleep", new_callable=AsyncMock):
            result = await service.embed_text(long_text)

        assert call_count == 3
        assert len(result) == 768

    async def test_retry_raises_after_max_retries(self):
        """최대 재시도 횟수(3회) 초과 시 예외를 발생시켜야 한다"""
        def mock_embed_fn(model, content, task_type):
            raise google_exceptions.GoogleAPIError("Persistent API error")

        service = _make_service(mock_embed_fn)

        long_text = "보험 약관 제1조 목적 이 약관은 피보험자의 상해 및 질병을 보장합니다. 인덱스: 0000"
        with patch("app.services.rag.embeddings.asyncio.sleep", new_callable=AsyncMock):
            with pytest.raises(google_exceptions.GoogleAPIError):
                await service.embed_text(long_text)
