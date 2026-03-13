"""임베딩 서비스 단위 테스트 (TAG-008)

EmbeddingService의 텍스트 임베딩 생성, 배치 처리,
재시도 로직, 입력 유효성 검사를 테스트.
실제 OpenAI API 호출 없이 mock 클라이언트를 주입.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def _make_service(mock_client):
    """mock 클라이언트를 주입한 EmbeddingService 생성 헬퍼"""
    from app.services.rag.embeddings import EmbeddingService

    return EmbeddingService(api_key="test-key", _client=mock_client)


class TestEmbedTextSingle:
    """단일 텍스트 임베딩 테스트"""

    async def test_embed_text_returns_1536_dim_vector(self):
        """단일 텍스트 임베딩이 1536차원 float 배열을 반환해야 한다"""
        # 1536차원 mock 응답 생성
        mock_embedding = [0.1] * 1536
        mock_response = MagicMock()
        mock_response.data = [MagicMock(embedding=mock_embedding)]

        mock_client = AsyncMock()
        mock_client.embeddings.create = AsyncMock(return_value=mock_response)

        service = _make_service(mock_client)
        result = await service.embed_text("보험 약관 텍스트 내용입니다. " * 5)

        assert isinstance(result, list)
        assert len(result) == 1536
        assert all(isinstance(v, float) for v in result)

    async def test_embed_text_values_in_range(self):
        """임베딩 벡터의 모든 값이 [-1.0, 1.0] 범위 내에 있어야 한다"""
        # 범위 내의 값으로 mock 생성
        mock_embedding = [0.5 * (i / 1536) for i in range(1536)]
        mock_response = MagicMock()
        mock_response.data = [MagicMock(embedding=mock_embedding)]

        mock_client = AsyncMock()
        mock_client.embeddings.create = AsyncMock(return_value=mock_response)

        service = _make_service(mock_client)
        result = await service.embed_text("충분한 길이의 텍스트입니다. 보험 상품 관련 내용.")

        assert all(-1.0 <= v <= 1.0 for v in result)

    async def test_embed_text_raises_error_when_api_key_empty(self):
        """OpenAI API 키가 빈 문자열이면 ValueError를 발생시켜야 한다"""
        from app.services.rag.embeddings import EmbeddingService

        with pytest.raises(ValueError, match="API"):
            EmbeddingService(api_key="")

    async def test_embed_text_raises_error_when_api_key_none(self):
        """OpenAI API 키가 None이면 ValueError를 발생시켜야 한다"""
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

        mock_embeddings = [[0.1] * 1536 for _ in texts]
        mock_response = MagicMock()
        mock_response.data = [MagicMock(embedding=e) for e in mock_embeddings]

        mock_client = AsyncMock()
        mock_client.embeddings.create = AsyncMock(return_value=mock_response)

        service = _make_service(mock_client)
        results = await service.embed_batch(texts)

        assert len(results) == 3
        assert all(len(r) == 1536 for r in results)

    async def test_embed_batch_optimizes_batch_size(self):
        """2048개 초과 텍스트는 여러 API 호출로 분할해야 한다"""
        # 2050개 텍스트 생성 (2048 배치 크기 초과, 각 텍스트 50자 이상 보장)
        base = "보험 약관 제1조 목적 이 약관은 피보험자의 상해 및 질병을 보장합니다."
        texts = [f"{base} 인덱스 번호: {i:04d}" for i in range(2050)]

        call_counts = []

        async def mock_create(model, input, dimensions=None):
            call_counts.append(len(input))
            r = MagicMock()
            r.data = [MagicMock(embedding=[0.1] * 1536) for _ in range(len(input))]
            return r

        mock_client = AsyncMock()
        mock_client.embeddings.create = mock_create

        service = _make_service(mock_client)
        results = await service.embed_batch(texts)

        # 2050개 텍스트 → 최소 2번의 API 호출 (배치 크기 2048)
        assert len(call_counts) >= 2
        # 각 배치는 2048개를 넘지 않아야 함
        assert all(c <= 2048 for c in call_counts)
        assert len(results) == 2050

    async def test_embed_batch_filters_short_texts(self):
        """50자 미만 텍스트는 필터링하고 빈 리스트를 반환해야 한다"""
        texts = [
            "짧은",  # 필터링 대상 (50자 미만, 3자)
            "충분히 긴 텍스트 내용입니다. 이것은 50자를 충분히 초과하는 텍스트입니다. 보험 약관 관련 내용.",
            "짧음",  # 필터링 대상 (50자 미만, 3자)
        ]

        mock_response = MagicMock()
        mock_response.data = [MagicMock(embedding=[0.2] * 1536)]

        mock_client = AsyncMock()
        mock_client.embeddings.create = AsyncMock(return_value=mock_response)

        service = _make_service(mock_client)
        results = await service.embed_batch(texts)

        # 긴 텍스트 1개만 임베딩됨, 짧은 텍스트는 빈 리스트로 반환
        assert len(results) == 3
        assert results[0] == []  # 짧은 텍스트
        assert len(results[1]) == 1536  # 긴 텍스트
        assert results[2] == []  # 짧은 텍스트

    async def test_embed_batch_empty_list_returns_empty(self):
        """빈 텍스트 리스트는 빈 결과를 반환해야 한다"""
        mock_client = AsyncMock()

        service = _make_service(mock_client)
        results = await service.embed_batch([])

        assert results == []


class TestRetryLogic:
    """재시도 로직 테스트"""

    async def test_retry_on_rate_limit_error(self):
        """RateLimitError 발생 시 최대 3회 재시도해야 한다"""
        from openai import RateLimitError

        mock_response = MagicMock()
        mock_response.data = [MagicMock(embedding=[0.1] * 1536)]

        # 처음 2번은 RateLimitError, 3번째는 성공
        call_count = 0

        async def mock_create(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise RateLimitError(
                    "Rate limit exceeded",
                    response=MagicMock(status_code=429, headers={}),
                    body=None,
                )
            return mock_response

        mock_client = AsyncMock()
        mock_client.embeddings.create = mock_create

        service = _make_service(mock_client)

        # 지수 백오프 대기 시간을 0으로 설정하여 빠른 테스트
        long_text = "보험 약관 제1조 목적 이 약관은 피보험자의 상해 및 질병을 보장합니다. 인덱스: 0000"
        with patch("app.services.rag.embeddings.asyncio.sleep", new_callable=AsyncMock):
            result = await service.embed_text(long_text)

        assert call_count == 3
        assert len(result) == 1536

    async def test_retry_raises_after_max_retries(self):
        """최대 재시도 횟수(3회) 초과 시 예외를 발생시켜야 한다"""
        from openai import RateLimitError

        async def mock_create(*args, **kwargs):
            raise RateLimitError(
                "Rate limit exceeded",
                response=MagicMock(status_code=429, headers={}),
                body=None,
            )

        mock_client = AsyncMock()
        mock_client.embeddings.create = mock_create

        service = _make_service(mock_client)

        long_text = "보험 약관 제1조 목적 이 약관은 피보험자의 상해 및 질병을 보장합니다. 인덱스: 0000"
        with patch("app.services.rag.embeddings.asyncio.sleep", new_callable=AsyncMock):
            with pytest.raises(RateLimitError):
                await service.embed_text(long_text)
