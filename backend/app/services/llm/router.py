"""LLM 라우터 및 폴백 체인 서비스

SPEC-LLM-001 TASK-005: 의도 기반 모델 선택, API 오류 폴백 처리.
"""

from __future__ import annotations

import time
from abc import ABC, abstractmethod

import structlog
from openai import AsyncOpenAI

from app.services.llm.metrics import LLMMetrics
from app.services.llm.models import IntentResult, LLMResponse, QueryIntent

logger = structlog.get_logger()


class BaseLLMProvider(ABC):
    """LLM 제공자 추상 기반 클래스"""

    @abstractmethod
    async def generate(self, messages: list[dict]) -> LLMResponse:
        """텍스트 생성

        Args:
            messages: 메시지 딕셔너리 목록 (role, content 포함)

        Returns:
            LLMResponse: 생성된 응답
        """

    @abstractmethod
    async def generate_stream(self, messages: list[dict]):
        """스트리밍 텍스트 생성

        Args:
            messages: 메시지 딕셔너리 목록

        Yields:
            텍스트 청크
        """


class GeminiProvider(BaseLLMProvider):
    """Google Gemini 제공자

    langchain-google-genai를 사용한 Gemini 모델 접근 클래스.
    """

    def __init__(self, api_key: str, model: str = "gemini-2.0-flash") -> None:
        """Gemini 제공자 초기화

        Args:
            api_key: Gemini API 키
            model: 사용할 Gemini 모델명
        """
        from langchain_google_genai import ChatGoogleGenerativeAI

        self._model_name = model
        self._api_key = api_key
        # langchain-google-genai를 통한 Gemini 클라이언트 초기화
        self._llm = ChatGoogleGenerativeAI(
            model=model,
            google_api_key=api_key or "dummy",
            temperature=0.3,
        )
        self._metrics = LLMMetrics()

    async def generate(self, messages: list[dict]) -> LLMResponse:
        """Gemini를 통한 텍스트 생성

        Args:
            messages: 메시지 목록

        Returns:
            LLMResponse: 생성된 응답 (토큰 수, 비용 포함)
        """
        from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

        start_time = time.time()

        # 메시지를 langchain 형식으로 변환
        lc_messages = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role == "system":
                lc_messages.append(SystemMessage(content=content))
            elif role == "assistant":
                lc_messages.append(AIMessage(content=content))
            else:
                lc_messages.append(HumanMessage(content=content))

        response = await self._llm.ainvoke(lc_messages)

        latency_ms = (time.time() - start_time) * 1000

        # 토큰 정보 추출
        input_tokens = 0
        output_tokens = 0
        if hasattr(response, "usage_metadata") and response.usage_metadata:
            input_tokens = getattr(response.usage_metadata, "input_tokens", 0) or 0
            output_tokens = getattr(response.usage_metadata, "output_tokens", 0) or 0

        estimated_cost = self._metrics.calculate_cost(self._model_name, input_tokens, output_tokens)
        content = response.content if hasattr(response, "content") else str(response)

        return LLMResponse(
            content=content,
            model_used=self._model_name,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            estimated_cost_usd=estimated_cost,
            latency_ms=latency_ms,
        )

    async def generate_stream(self, messages: list[dict]):
        """Gemini 스트리밍 생성

        Args:
            messages: 메시지 목록

        Yields:
            텍스트 청크
        """
        from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

        lc_messages = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role == "system":
                lc_messages.append(SystemMessage(content=content))
            elif role == "assistant":
                lc_messages.append(AIMessage(content=content))
            else:
                lc_messages.append(HumanMessage(content=content))

        async for chunk in self._llm.astream(lc_messages):
            if chunk.content:
                yield chunk.content


class OpenAIProvider(BaseLLMProvider):
    """OpenAI GPT 제공자

    langchain-openai를 사용한 GPT 모델 접근 클래스.
    """

    def __init__(self, api_key: str, model: str = "gpt-4o") -> None:
        """OpenAI 제공자 초기화

        Args:
            api_key: OpenAI API 키
            model: 사용할 GPT 모델명
        """
        self._model_name = model
        self._client = AsyncOpenAI(api_key=api_key or "dummy")
        self._metrics = LLMMetrics()

    async def generate(self, messages: list[dict]) -> LLMResponse:
        """GPT를 통한 텍스트 생성

        Args:
            messages: 메시지 목록 (role, content 딕셔너리)

        Returns:
            LLMResponse: 생성된 응답 (토큰 수, 비용 포함)
        """
        start_time = time.time()

        response = await self._client.chat.completions.create(
            model=self._model_name,
            messages=messages,
            temperature=0.3,
        )

        latency_ms = (time.time() - start_time) * 1000

        content = response.choices[0].message.content or ""
        input_tokens = response.usage.prompt_tokens if response.usage else 0
        output_tokens = response.usage.completion_tokens if response.usage else 0
        estimated_cost = self._metrics.calculate_cost(self._model_name, input_tokens, output_tokens)

        return LLMResponse(
            content=content,
            model_used=self._model_name,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            estimated_cost_usd=estimated_cost,
            latency_ms=latency_ms,
        )

    async def generate_stream(self, messages: list[dict]):
        """GPT 스트리밍 생성

        Args:
            messages: 메시지 목록

        Yields:
            텍스트 청크
        """
        async with self._client.chat.completions.stream(
            model=self._model_name,
            messages=messages,
        ) as stream:
            async for chunk in stream:
                delta = chunk.choices[0].delta.content
                if delta:
                    yield delta


class LLMRouter:
    """의도 기반 LLM 모델 라우터

    쿼리 의도와 신뢰도에 따라 적절한 LLM 제공자를 선택합니다:
    - policy_lookup/general_qa: Gemini Flash
    - claim_guidance + 높은 신뢰도: Gemini Flash
    - claim_guidance + 낮은 신뢰도: GPT-4o로 폴백
    """

    def __init__(self, settings: object) -> None:
        """LLM 라우터 초기화

        Args:
            settings: 애플리케이션 설정
        """
        self._settings = settings
        gemini_key = getattr(settings, "gemini_api_key", "") or ""
        openai_key = getattr(settings, "openai_api_key", "") or ""
        primary_model = getattr(settings, "llm_primary_model", "gemini-2.0-flash")
        fallback_model = getattr(settings, "llm_fallback_model", "gpt-4o")
        self._confidence_threshold = getattr(settings, "llm_confidence_threshold", 0.7)

        self._gemini_provider = GeminiProvider(api_key=gemini_key, model=primary_model)
        self._openai_provider = OpenAIProvider(api_key=openai_key, model=fallback_model)

    async def route(self, messages: list[dict], intent_result: IntentResult) -> LLMResponse:
        """의도 기반 LLM 모델 선택 및 응답 생성

        Args:
            messages: LLM 입력 메시지 목록
            intent_result: 분류된 의도 결과

        Returns:
            LLMResponse: 선택된 모델의 응답
        """
        intent = intent_result.intent
        confidence = intent_result.confidence

        # claim_guidance에서 신뢰도가 낮으면 GPT-4o 사용
        if intent == QueryIntent.CLAIM_GUIDANCE and confidence < self._confidence_threshold:
            logger.info(
                "낮은 신뢰도로 GPT-4o 사용",
                intent=intent,
                confidence=confidence,
                threshold=self._confidence_threshold,
            )
            return await self._openai_provider.generate(messages)

        # 기본: Gemini Flash 사용
        logger.info("Gemini Flash 사용", intent=intent, confidence=confidence)
        return await self._gemini_provider.generate(messages)


class FallbackChain:
    """API 오류 시 순차 폴백 체인

    Gemini → GPT-4o → GPT-4o-mini 순서로 폴백합니다.
    """

    def __init__(self, settings: object) -> None:
        """폴백 체인 초기화

        Args:
            settings: 애플리케이션 설정
        """
        gemini_key = getattr(settings, "gemini_api_key", "") or ""
        openai_key = getattr(settings, "openai_api_key", "") or ""

        # 폴백 순서: Gemini Flash → GPT-4o → GPT-4o-mini
        self._providers: list[BaseLLMProvider] = [
            GeminiProvider(api_key=gemini_key, model="gemini-2.0-flash"),
            OpenAIProvider(api_key=openai_key, model="gpt-4o"),
            OpenAIProvider(api_key=openai_key, model="gpt-4o-mini"),
        ]

    async def generate(self, messages: list[dict]) -> LLMResponse:
        """폴백 체인을 통한 텍스트 생성

        각 제공자를 순서대로 시도하고, 오류 발생 시 다음 제공자로 폴백합니다.

        Args:
            messages: LLM 입력 메시지 목록

        Returns:
            LLMResponse: 최초 성공한 제공자의 응답

        Raises:
            Exception: 모든 제공자가 실패한 경우
        """
        last_error: Exception | None = None

        for i, provider in enumerate(self._providers):
            try:
                logger.info("제공자 시도", provider_index=i, provider_type=type(provider).__name__)
                return await provider.generate(messages)
            except Exception as e:
                last_error = e
                logger.warning(
                    "제공자 오류, 다음 폴백으로 전환",
                    provider_index=i,
                    error=str(e),
                )

        raise Exception(f"모든 LLM 제공자 실패: {str(last_error)}")
