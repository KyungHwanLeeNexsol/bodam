"""임베딩 서비스 모듈 (TAG-009)

로컬 BAAI/bge-m3 sentence-transformers 모델을 사용하여 텍스트 임베딩 벡터를 생성.
배치 처리, 싱글턴 패턴, 입력 유효성 검사 포함.
레거시 Gemini 제공자는 하위 호환성 유지를 위해 폴백으로 보존.
"""

from __future__ import annotations

import asyncio
import logging
import warnings
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

# 최소 텍스트 길이 (50자 미만 텍스트는 임베딩 건너뜀)
MIN_TEXT_CHARS = 50

# 로컬 모델 배치 크기 (CPU 2코어 기준 최적값)
LOCAL_BATCH_SIZE = 32

# 싱글턴 로컬 모델 인스턴스 (애플리케이션 수명 동안 한 번만 로드)
# # @MX:ANCHOR: [AUTO] 로컬 임베딩 모델 싱글턴 — 전체 RAG 파이프라인이 이 인스턴스를 공유
# # @MX:REASON: BAAI/bge-m3 모델 로드는 ~600MB 메모리 소비, 요청마다 재로드 불가
_local_model_instance: object | None = None


class LocalEmbeddingService:
    """BAAI/bge-m3 로컬 sentence-transformers 임베딩 서비스

    모델을 싱글턴으로 로드하여 메모리 효율을 보장.
    asyncio.to_thread로 동기 추론을 비동기 루프에서 비블로킹 실행.
    cosine 유사도(pgvector <=> 연산자) 사용을 위해 normalize_embeddings=True.
    """

    def __init__(self, model_name: str = "BAAI/bge-m3") -> None:
        """로컬 임베딩 서비스 초기화

        Args:
            model_name: HuggingFace 모델 이름 (기본값: BAAI/bge-m3)
        """
        self._model_name = model_name
        self._model = self._get_or_load_model()

    def _get_or_load_model(self) -> object:
        """싱글턴 모델 인스턴스를 반환 (없으면 로드)"""
        global _local_model_instance
        if _local_model_instance is None:
            from sentence_transformers import SentenceTransformer  # type: ignore[import-untyped]
            logger.info("BAAI/bge-m3 모델 로드 중 (최초 1회, ~600MB)...")
            _local_model_instance = SentenceTransformer(self._model_name)
            logger.info("BAAI/bge-m3 모델 로드 완료")
        return _local_model_instance

    def _encode_sync(self, texts: list[str]) -> list[list[float]]:
        """동기 인코딩 (asyncio.to_thread에서 호출)

        Args:
            texts: 인코딩할 텍스트 목록

        Returns:
            정규화된 임베딩 벡터 목록
        """
        from sentence_transformers import SentenceTransformer  # type: ignore[import-untyped]
        model: SentenceTransformer = self._model  # type: ignore[assignment]
        embeddings = model.encode(
            texts,
            batch_size=LOCAL_BATCH_SIZE,
            normalize_embeddings=True,  # cosine 유사도를 위한 L2 정규화
            show_progress_bar=False,
        )
        # numpy array → list[list[float]] 변환
        return [emb.tolist() for emb in embeddings]

    async def embed_text(self, text: str) -> list[float]:
        """단일 텍스트의 임베딩 벡터 생성

        Args:
            text: 임베딩할 텍스트

        Returns:
            임베딩 벡터 (float 리스트, 길이 = 1024) 또는 빈 리스트 (50자 미만)
        """
        if len(text) < MIN_TEXT_CHARS:
            return []
        results = await asyncio.to_thread(self._encode_sync, [text])
        return results[0] if results else []

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """여러 텍스트를 배치로 임베딩 벡터 생성

        50자 미만 텍스트는 필터링하고 빈 리스트로 대체.

        Args:
            texts: 임베딩할 텍스트 목록

        Returns:
            임베딩 벡터 목록. 짧은 텍스트 위치에는 빈 리스트.
        """
        if not texts:
            return []

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

        embeddings = await asyncio.to_thread(self._encode_sync, valid_texts)
        for orig_idx, embedding in zip(valid_indices, embeddings):
            results[orig_idx] = embedding

        return results


class EmbeddingService:
    """Google Gemini 텍스트 임베딩 생성 서비스 (레거시 — deprecated)

    하위 호환성을 위해 보존. 새 코드에는 LocalEmbeddingService를 사용할 것.
    텍스트를 벡터 임베딩으로 변환하는 서비스.
    배치 처리 최적화 및 GoogleAPIError 재시도 로직 포함.
    """

    # Google Gemini API 배치 크기 제한 (최대 100개)
    MAX_BATCH_SIZE = 100
    # 최대 재시도 횟수
    MAX_RETRIES = 3
    # 지수 백오프 기본 대기 시간(초)
    BASE_RETRY_DELAY = 1.0
    # 연속 전체 실패 임계값
    DEFAULT_MAX_CONSECUTIVE_FAILURES = 5

    def __init__(
        self,
        api_key: str,
        model: str = "text-embedding-004",
        dimensions: int = 768,
        _embed_fn: object = None,
    ) -> None:
        """임베딩 서비스 초기화

        Args:
            api_key: Google API 키 (필수, 빈 문자열 불가)
            model: 사용할 임베딩 모델명
            dimensions: 출력 벡터 차원 수
            _embed_fn: 테스트용 embed_content 함수 주입 (None이면 genai.embed_content 사용)

        Raises:
            ValueError: API 키가 없거나 빈 문자열인 경우
        """
        warnings.warn(
            "EmbeddingService(Gemini)는 deprecated입니다. LocalEmbeddingService를 사용하세요.",
            FutureWarning,
            stacklevel=2,
        )

        import google.generativeai as genai  # type: ignore[import-untyped]

        # API 키 유효성 검사
        if not api_key:
            raise ValueError("Google API 키가 설정되지 않았습니다. GOOGLE_API_KEY 환경변수를 설정하세요.")

        self._model = f"models/{model}"
        self._dimensions = dimensions

        # 연속 전체 실패 카운터 및 임계값
        self._consecutive_failures = 0
        self._max_consecutive_failures = self.DEFAULT_MAX_CONSECUTIVE_FAILURES

        # Google Generative AI 클라이언트 설정
        # @MX:ANCHOR: [AUTO] EmbeddingService 핵심 클라이언트 초기화 지점 (레거시)
        # @MX:REASON: RAG 파이프라인의 레거시 Gemini 임베딩 요청이 이 클라이언트를 사용함
        genai.configure(api_key=api_key)

        # 테스트에서 mock 함수를 주입할 수 있도록 허용
        if _embed_fn is not None:
            self._embed_fn = _embed_fn
        else:
            self._embed_fn = genai.embed_content

    async def embed_text(self, text: str) -> list[float]:
        """단일 텍스트의 임베딩 벡터 생성"""
        results = await self.embed_batch([text])
        if results and results[0]:
            return results[0]
        return []

    async def embed_batch(
        self,
        texts: list[str],
        skip_on_failure: bool = False,
    ) -> list[list[float]] | tuple[list[list[float]], list[int]]:
        """여러 텍스트를 배치로 임베딩 벡터 생성"""
        import math

        from google.api_core import exceptions as google_exceptions  # type: ignore[import-untyped]

        if not texts:
            if skip_on_failure:
                return [], []
            return []

        results: list[list[float]] = [[] for _ in texts]
        failed_indices: list[int] = []

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

        if self._consecutive_failures >= self._max_consecutive_failures:
            from app.services.rag.embeddings import APIUnavailableError
            raise APIUnavailableError(
                f"Google Gemini API 연속 실패 {self._consecutive_failures}회로 서비스 불가 상태입니다."
            )

        num_batches = math.ceil(len(valid_texts) / self.MAX_BATCH_SIZE)
        batch_all_failed = True

        for batch_idx in range(num_batches):
            start = batch_idx * self.MAX_BATCH_SIZE
            end = start + self.MAX_BATCH_SIZE
            batch_texts = valid_texts[start:end]
            batch_indices = valid_indices[start:end]

            try:
                embeddings = await self._call_with_retry(batch_texts)
                for orig_idx, embedding in zip(batch_indices, embeddings):
                    results[orig_idx] = embedding
                self._consecutive_failures = 0
                batch_all_failed = False
            except Exception:
                if not skip_on_failure:
                    raise
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
        """재시도 로직이 포함된 Google Gemini 임베딩 API 호출"""
        from google.api_core import exceptions as google_exceptions  # type: ignore[import-untyped]

        last_error: Exception | None = None

        for attempt in range(self.MAX_RETRIES):
            try:
                if len(texts) == 1:
                    response = await asyncio.to_thread(
                        self._embed_fn,
                        model=self._model,
                        content=texts[0],
                        task_type="RETRIEVAL_DOCUMENT",
                        output_dimensionality=self._dimensions,
                    )
                    embedding_values = response["embedding"]
                    return [embedding_values]
                else:
                    response = await asyncio.to_thread(
                        self._embed_fn,
                        model=self._model,
                        content=texts,
                        task_type="RETRIEVAL_DOCUMENT",
                        output_dimensionality=self._dimensions,
                    )
                    return response["embedding"]

            except google_exceptions.GoogleAPIError as e:
                last_error = e
                if attempt < self.MAX_RETRIES - 1:
                    error_str = str(e)
                    if "429" in error_str or "quota" in error_str.lower():
                        import re as _re
                        retry_match = _re.search(r"retry in (\d+(?:\.\d+)?)", error_str, _re.IGNORECASE)
                        wait_time = float(retry_match.group(1)) + 5.0 if retry_match else 35.0
                    else:
                        wait_time = self.BASE_RETRY_DELAY * (2**attempt)
                    logger.warning(
                        "Google Gemini API 오류 발생, %.0f초 후 재시도 (%d/%d): %s",
                        wait_time,
                        attempt + 1,
                        self.MAX_RETRIES,
                        str(e)[:200],
                    )
                    await asyncio.sleep(wait_time)

        raise last_error  # type: ignore[misc]


class APIUnavailableError(Exception):
    """Google Gemini API 연속 실패로 서비스 불가 상태임을 나타내는 예외

    N회 연속으로 전체 배치 실패가 발생하면 이 예외가 발생.
    """


def get_embedding_service(provider: str | None = None) -> LocalEmbeddingService | EmbeddingService:
    """설정에 따라 적절한 임베딩 서비스 인스턴스를 반환

    # @MX:ANCHOR: [AUTO] 임베딩 서비스 팩토리 — 검색/백필 전 경로에서 호출
    # @MX:REASON: embedding_provider 설정으로 로컬/레거시 Gemini 분기 처리

    Args:
        provider: "local" 또는 "gemini". None이면 settings.embedding_provider 사용.

    Returns:
        LocalEmbeddingService (provider="local") 또는
        EmbeddingService (provider="gemini", deprecated)
    """
    from app.core.config import get_settings

    settings = get_settings()
    resolved_provider = provider or settings.embedding_provider

    if resolved_provider == "local":
        return LocalEmbeddingService(model_name=settings.embedding_model)
    elif resolved_provider == "gemini":
        import os
        api_key = settings.gemini_api_key or os.environ.get("GEMINI_API_KEY", "")
        return EmbeddingService(
            api_key=api_key,
            model=settings.embedding_model,
            dimensions=settings.embedding_dimensions,
        )
    else:
        raise ValueError(f"지원하지 않는 embedding_provider: {resolved_provider!r}. 'local' 또는 'gemini'를 사용하세요.")
