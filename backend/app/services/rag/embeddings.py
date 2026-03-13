"""임베딩 서비스 모듈 (TAG-009)

OpenAI API를 사용하여 텍스트 임베딩 벡터를 생성.
배치 처리, 재시도 로직, 입력 유효성 검사 포함.
"""

from __future__ import annotations

import asyncio
import logging
import math
from typing import TYPE_CHECKING

import openai

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

# 최소 텍스트 길이 (50자 미만 텍스트는 임베딩 건너뜀)
MIN_TEXT_CHARS = 50

# OpenAI API 배치 크기 제한 (최대 2048개)
MAX_BATCH_SIZE = 2048

# 최대 재시도 횟수
MAX_RETRIES = 3

# 지수 백오프 기본 대기 시간(초)
BASE_RETRY_DELAY = 1.0


class EmbeddingService:
    """OpenAI 텍스트 임베딩 생성 서비스

    텍스트를 벡터 임베딩으로 변환하는 서비스.
    배치 처리 최적화 및 RateLimitError 재시도 로직 포함.
    """

    def __init__(
        self,
        api_key: str,
        model: str = "text-embedding-3-small",
        dimensions: int = 1536,
        _client=None,
    ) -> None:
        """임베딩 서비스 초기화

        Args:
            api_key: OpenAI API 키 (필수, 빈 문자열 불가)
            model: 사용할 임베딩 모델명
            dimensions: 출력 벡터 차원 수
            _client: 테스트용 클라이언트 주입 (None이면 실제 OpenAI 클라이언트 생성)

        Raises:
            ValueError: API 키가 없거나 빈 문자열인 경우
        """
        # API 키 유효성 검사
        if not api_key:
            raise ValueError("OpenAI API 키가 설정되지 않았습니다. OPENAI_API_KEY 환경변수를 설정하세요.")

        self._model = model
        self._dimensions = dimensions

        # 테스트에서 mock 클라이언트를 주입할 수 있도록 허용
        # # @MX:ANCHOR: [AUTO] EmbeddingService 핵심 클라이언트 초기화 지점
        # # @MX:REASON: RAG 파이프라인의 모든 임베딩 요청이 이 클라이언트를 사용함
        if _client is not None:
            self._client = _client
        else:
            self._client = openai.AsyncOpenAI(api_key=api_key)

    async def embed_text(self, text: str) -> list[float]:
        """단일 텍스트의 임베딩 벡터 생성

        Args:
            text: 임베딩할 텍스트

        Returns:
            임베딩 벡터 (float 리스트, 길이 = dimensions)

        Raises:
            openai.RateLimitError: 최대 재시도 후에도 속도 제한 초과 시
        """
        results = await self.embed_batch([text])
        # 짧은 텍스트인 경우 빈 리스트 반환됨
        if results and results[0]:
            return results[0]
        return []

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """여러 텍스트를 배치로 임베딩 벡터 생성

        50자 미만 텍스트는 필터링하고 빈 리스트로 대체.
        2048개 초과 시 여러 API 호출로 분할.

        Args:
            texts: 임베딩할 텍스트 목록

        Returns:
            임베딩 벡터 목록. 짧은 텍스트 위치에는 빈 리스트.
        """
        if not texts:
            return []

        # 결과 배열 초기화 (짧은 텍스트 위치는 빈 리스트)
        results: list[list[float]] = [[] for _ in texts]

        # 유효한 텍스트(50자 이상)의 인덱스와 내용 수집
        valid_indices = []
        valid_texts = []
        for i, text in enumerate(texts):
            if len(text) >= MIN_TEXT_CHARS:
                valid_indices.append(i)
                valid_texts.append(text)

        if not valid_texts:
            return results

        # 배치 크기로 분할하여 API 호출
        num_batches = math.ceil(len(valid_texts) / MAX_BATCH_SIZE)
        for batch_idx in range(num_batches):
            start = batch_idx * MAX_BATCH_SIZE
            end = start + MAX_BATCH_SIZE
            batch_texts = valid_texts[start:end]
            batch_indices = valid_indices[start:end]

            # 지수 백오프 재시도 로직
            embeddings = await self._call_with_retry(batch_texts)

            # 결과를 원래 인덱스에 배치
            for orig_idx, embedding in zip(batch_indices, embeddings):
                results[orig_idx] = embedding

        return results

    async def _call_with_retry(self, texts: list[str]) -> list[list[float]]:
        """재시도 로직이 포함된 OpenAI 임베딩 API 호출

        RateLimitError 및 APIError 발생 시 지수 백오프로 최대 3회 재시도.

        Args:
            texts: 임베딩할 텍스트 목록

        Returns:
            임베딩 벡터 목록

        Raises:
            openai.RateLimitError: 최대 재시도 후에도 속도 제한 초과 시
        """
        last_error: Exception | None = None

        for attempt in range(MAX_RETRIES):
            try:
                response = await self._client.embeddings.create(
                    model=self._model,
                    input=texts,
                    dimensions=self._dimensions,
                )
                return [item.embedding for item in response.data]

            except (openai.RateLimitError, openai.APIError) as e:
                last_error = e
                if attempt < MAX_RETRIES - 1:
                    # 지수 백오프: 1초, 2초, 4초...
                    wait_time = BASE_RETRY_DELAY * (2**attempt)
                    logger.warning(
                        "OpenAI API 오류 발생, %d초 후 재시도 (%d/%d): %s",
                        wait_time,
                        attempt + 1,
                        MAX_RETRIES,
                        str(e),
                    )
                    await asyncio.sleep(wait_time)

        raise last_error
