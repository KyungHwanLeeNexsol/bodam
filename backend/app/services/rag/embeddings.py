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

# 연속 전체 실패 임계값 (이 횟수 이상 연속 실패 시 APIUnavailableError)
DEFAULT_MAX_CONSECUTIVE_FAILURES = 5


class APIUnavailableError(Exception):
    """OpenAI API 연속 실패로 서비스 불가 상태임을 나타내는 예외

    N회 연속으로 전체 배치 실패가 발생하면 이 예외가 발생.
    """


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

        # 연속 전체 실패 카운터 및 임계값
        self._consecutive_failures = 0
        self._max_consecutive_failures = DEFAULT_MAX_CONSECUTIVE_FAILURES

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

    async def embed_batch(
        self,
        texts: list[str],
        skip_on_failure: bool = False,
    ) -> list[list[float]] | tuple[list[list[float]], list[int]]:
        """여러 텍스트를 배치로 임베딩 벡터 생성

        50자 미만 텍스트는 필터링하고 빈 리스트로 대체.
        2048개 초과 시 여러 API 호출로 분할.

        Args:
            texts: 임베딩할 텍스트 목록
            skip_on_failure: True이면 개별 배치 실패 시 건너뛰고 계속 진행.
                             실패한 인덱스를 추적하여 (results, failed_indices) 튜플 반환.
                             False(기본값)이면 오류 시 예외 전파.

        Returns:
            skip_on_failure=False: 임베딩 벡터 목록. 짧은 텍스트 위치에는 빈 리스트.
            skip_on_failure=True: (임베딩 벡터 목록, 실패한 인덱스 목록) 튜플.

        Raises:
            APIUnavailableError: 연속 실패 횟수가 임계값 이상인 경우
            openai.APIError: skip_on_failure=False이고 API 오류 발생 시
        """
        if not texts:
            if skip_on_failure:
                return [], []
            return []

        # 결과 배열 초기화 (짧은 텍스트 위치는 빈 리스트)
        results: list[list[float]] = [[] for _ in texts]
        failed_indices: list[int] = []

        # 유효한 텍스트(50자 이상)의 인덱스와 내용 수집
        valid_indices = []
        valid_texts = []
        for i, text in enumerate(texts):
            if len(text) >= MIN_TEXT_CHARS:
                valid_indices.append(i)
                valid_texts.append(text)

        if not valid_texts:
            if skip_on_failure:
                return results, failed_indices
            return results

        # API 불가 상태 확인
        if self._consecutive_failures >= self._max_consecutive_failures:
            raise APIUnavailableError(
                f"OpenAI API 연속 실패 {self._consecutive_failures}회로 서비스 불가 상태입니다."
            )

        # 배치 크기로 분할하여 API 호출
        num_batches = math.ceil(len(valid_texts) / MAX_BATCH_SIZE)
        batch_all_failed = True

        for batch_idx in range(num_batches):
            start = batch_idx * MAX_BATCH_SIZE
            end = start + MAX_BATCH_SIZE
            batch_texts = valid_texts[start:end]
            batch_indices = valid_indices[start:end]

            try:
                # 지수 백오프 재시도 로직
                embeddings = await self._call_with_retry(batch_texts)

                # 결과를 원래 인덱스에 배치
                for orig_idx, embedding in zip(batch_indices, embeddings):
                    results[orig_idx] = embedding

                # 성공 시 연속 실패 카운터 초기화
                self._consecutive_failures = 0
                batch_all_failed = False

            except Exception:
                if not skip_on_failure:
                    raise
                # 실패한 인덱스 추적
                failed_indices.extend(batch_indices)
                logger.warning(
                    "배치 %d/%d 임베딩 실패 (skip_on_failure=True), 건너뜀",
                    batch_idx + 1,
                    num_batches,
                )

        if batch_all_failed and valid_texts:
            self._consecutive_failures += 1
        elif not batch_all_failed:
            self._consecutive_failures = 0

        if skip_on_failure:
            return results, failed_indices
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
