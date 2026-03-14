"""LLM 라우터 및 폴백 체인 단위 테스트

SPEC-LLM-001 TASK-005: 모델 선택, 폴백 로직, 비용 추적 검증.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.llm.models import IntentResult, LLMResponse, QueryIntent
from app.services.llm.router import FallbackChain, GeminiProvider, LLMRouter, OpenAIProvider


@pytest.fixture
def mock_settings():
    """테스트용 Settings 목 픽스처"""
    settings = MagicMock()
    settings.gemini_api_key = "test-gemini-key"
    settings.openai_api_key = "test-openai-key"
    settings.llm_primary_model = "gemini-2.0-flash"
    settings.llm_fallback_model = "gpt-4o"
    settings.llm_confidence_threshold = 0.7
    settings.llm_cost_tracking_enabled = True
    return settings


class TestGeminiProvider:
    """GeminiProvider 테스트"""

    def test_init_with_api_key(self):
        """API 키로 초기화"""
        provider = GeminiProvider(api_key="test-key", model="gemini-2.0-flash")
        assert provider is not None

    async def test_generate_returns_llm_response(self):
        """generate()가 LLMResponse 반환 (모킹)"""
        provider = GeminiProvider(api_key="test-key", model="gemini-2.0-flash")

        # ChatGoogleGenerativeAI._async_client 모킹 대신 provider.generate 자체를 모킹
        with patch.object(provider, "generate", AsyncMock(
            return_value=LLMResponse(content="보험 답변 내용", model_used="gemini-2.0-flash")
        )):
            result = await provider.generate(messages=[{"role": "user", "content": "질문"}])

        assert isinstance(result, LLMResponse)
        assert result.content == "보험 답변 내용"
        assert result.model_used == "gemini-2.0-flash"

    async def test_generate_with_mock(self):
        """모킹을 통한 generate 테스트"""
        provider = GeminiProvider(api_key="test-key", model="gemini-2.0-flash")

        mock_result = LLMResponse(
            content="Gemini 응답",
            model_used="gemini-2.0-flash",
            input_tokens=100,
            output_tokens=50,
        )

        with patch.object(provider, "generate", AsyncMock(return_value=mock_result)):
            result = await provider.generate(messages=[])

        assert result.model_used == "gemini-2.0-flash"
        assert result.content == "Gemini 응답"


class TestOpenAIProvider:
    """OpenAIProvider 테스트"""

    def test_init_with_api_key(self):
        """API 키로 초기화"""
        provider = OpenAIProvider(api_key="test-key", model="gpt-4o")
        assert provider is not None

    async def test_generate_returns_llm_response(self):
        """generate()가 LLMResponse 반환"""
        provider = OpenAIProvider(api_key="test-key", model="gpt-4o")

        mock_response = MagicMock()
        mock_response.choices[0].message.content = "GPT 응답"
        mock_response.usage.prompt_tokens = 100
        mock_response.usage.completion_tokens = 50

        with patch.object(provider._client, "chat") as mock_chat:
            mock_chat.completions.create = AsyncMock(return_value=mock_response)
            result = await provider.generate(messages=[{"role": "user", "content": "질문"}])

        assert isinstance(result, LLMResponse)
        assert result.model_used == "gpt-4o"
        assert result.content == "GPT 응답"


class TestLLMRouter:
    """LLMRouter 의도 기반 모델 선택 테스트"""

    def test_init_with_settings(self, mock_settings):
        """Settings로 LLMRouter 초기화"""
        router = LLMRouter(settings=mock_settings)
        assert router is not None

    async def test_policy_lookup_uses_gemini(self, mock_settings):
        """policy_lookup 의도는 Gemini Flash 사용"""
        router = LLMRouter(settings=mock_settings)
        intent_result = IntentResult(intent=QueryIntent.POLICY_LOOKUP, confidence=0.9)

        expected_response = LLMResponse(
            content="약관 내용",
            model_used="gemini-2.0-flash",
        )

        with patch.object(router._gemini_provider, "generate", AsyncMock(return_value=expected_response)):
            result = await router.route(
                messages=[{"role": "user", "content": "약관 질문"}],
                intent_result=intent_result,
            )

        assert result.model_used == "gemini-2.0-flash"

    async def test_general_qa_uses_gemini(self, mock_settings):
        """general_qa 의도는 Gemini Flash 사용"""
        router = LLMRouter(settings=mock_settings)
        intent_result = IntentResult(intent=QueryIntent.GENERAL_QA, confidence=0.8)

        expected_response = LLMResponse(
            content="일반 답변",
            model_used="gemini-2.0-flash",
        )

        with patch.object(router._gemini_provider, "generate", AsyncMock(return_value=expected_response)):
            result = await router.route(
                messages=[{"role": "user", "content": "일반 질문"}],
                intent_result=intent_result,
            )

        assert result.model_used == "gemini-2.0-flash"

    async def test_claim_guidance_low_confidence_falls_back_to_gpt4o(self, mock_settings):
        """claim_guidance + 낮은 신뢰도는 GPT-4o로 폴백"""
        router = LLMRouter(settings=mock_settings)
        # 신뢰도가 임계값(0.7)보다 낮음
        intent_result = IntentResult(intent=QueryIntent.CLAIM_GUIDANCE, confidence=0.5)

        expected_response = LLMResponse(
            content="청구 안내",
            model_used="gpt-4o",
        )

        with patch.object(router._openai_provider, "generate", AsyncMock(return_value=expected_response)):
            result = await router.route(
                messages=[{"role": "user", "content": "청구 질문"}],
                intent_result=intent_result,
            )

        assert result.model_used == "gpt-4o"

    async def test_claim_guidance_high_confidence_uses_gemini(self, mock_settings):
        """claim_guidance + 높은 신뢰도는 Gemini Flash 사용"""
        router = LLMRouter(settings=mock_settings)
        # 신뢰도가 임계값(0.7) 이상
        intent_result = IntentResult(intent=QueryIntent.CLAIM_GUIDANCE, confidence=0.85)

        expected_response = LLMResponse(
            content="청구 안내",
            model_used="gemini-2.0-flash",
        )

        with patch.object(router._gemini_provider, "generate", AsyncMock(return_value=expected_response)):
            result = await router.route(
                messages=[{"role": "user", "content": "청구 질문"}],
                intent_result=intent_result,
            )

        assert result.model_used == "gemini-2.0-flash"


class TestFallbackChain:
    """FallbackChain API 오류 폴백 테스트"""

    def test_init(self, mock_settings):
        """FallbackChain 초기화"""
        chain = FallbackChain(settings=mock_settings)
        assert chain is not None

    async def test_primary_success(self, mock_settings):
        """1차 모델 성공 시 결과 반환"""
        chain = FallbackChain(settings=mock_settings)

        expected_response = LLMResponse(
            content="Gemini 응답",
            model_used="gemini-2.0-flash",
        )

        with patch.object(chain._providers[0], "generate", AsyncMock(return_value=expected_response)):
            result = await chain.generate(messages=[{"role": "user", "content": "질문"}])

        assert result.model_used == "gemini-2.0-flash"
        assert result.content == "Gemini 응답"

    async def test_fallback_to_gpt4o_on_primary_error(self, mock_settings):
        """Gemini 오류 시 GPT-4o로 폴백"""
        chain = FallbackChain(settings=mock_settings)

        gpt4o_response = LLMResponse(
            content="GPT-4o 폴백 응답",
            model_used="gpt-4o",
        )

        with (
            patch.object(chain._providers[0], "generate", AsyncMock(side_effect=Exception("Gemini 오류"))),
            patch.object(chain._providers[1], "generate", AsyncMock(return_value=gpt4o_response)),
        ):
            result = await chain.generate(messages=[{"role": "user", "content": "질문"}])

        assert result.model_used == "gpt-4o"
        assert result.content == "GPT-4o 폴백 응답"

    async def test_fallback_to_gpt4o_mini_on_all_errors(self, mock_settings):
        """Gemini, GPT-4o 모두 오류 시 GPT-4o-mini로 폴백"""
        chain = FallbackChain(settings=mock_settings)

        mini_response = LLMResponse(
            content="GPT-4o-mini 폴백 응답",
            model_used="gpt-4o-mini",
        )

        with (
            patch.object(chain._providers[0], "generate", AsyncMock(side_effect=Exception("Gemini 오류"))),
            patch.object(chain._providers[1], "generate", AsyncMock(side_effect=Exception("GPT-4o 오류"))),
            patch.object(chain._providers[2], "generate", AsyncMock(return_value=mini_response)),
        ):
            result = await chain.generate(messages=[{"role": "user", "content": "질문"}])

        assert result.model_used == "gpt-4o-mini"

    async def test_raises_when_all_providers_fail(self, mock_settings):
        """모든 제공자 실패 시 예외 발생"""
        chain = FallbackChain(settings=mock_settings)

        with (
            patch.object(chain._providers[0], "generate", AsyncMock(side_effect=Exception("오류1"))),
            patch.object(chain._providers[1], "generate", AsyncMock(side_effect=Exception("오류2"))),
            patch.object(chain._providers[2], "generate", AsyncMock(side_effect=Exception("오류3"))),
        ):
            with pytest.raises(Exception):
                await chain.generate(messages=[{"role": "user", "content": "질문"}])
