"""의도 분류기 단위 테스트

SPEC-LLM-001 TASK-004: GPT-4o-mini 기반 의도 분류 검증.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.llm.classifier import IntentClassifier
from app.services.llm.models import IntentResult, QueryIntent


@pytest.fixture
def mock_settings():
    """테스트용 Settings 목 픽스처"""
    settings = MagicMock()
    settings.openai_api_key = "test-api-key"
    settings.llm_classifier_model = "gpt-4o-mini"
    settings.llm_confidence_threshold = 0.7
    return settings


@pytest.fixture
def classifier(mock_settings):
    """IntentClassifier 픽스처"""
    return IntentClassifier(settings=mock_settings)


class TestIntentClassifierInit:
    """IntentClassifier 초기화 테스트"""

    def test_init_with_settings(self, mock_settings):
        """Settings로 초기화"""
        classifier = IntentClassifier(settings=mock_settings)
        assert classifier is not None


class TestIntentClassifierClassify:
    """의도 분류 테스트"""

    async def test_classify_policy_lookup(self, classifier):
        """보험 약관 조회 의도 분류"""
        mock_response = MagicMock()
        mock_response.choices[0].message.content = (
            '{"intent": "policy_lookup", "confidence": 0.92, "reasoning": "약관 조회 관련 질문"}'
        )

        with patch.object(classifier._client, "chat") as mock_chat:
            mock_chat.completions.create = AsyncMock(return_value=mock_response)
            result = await classifier.classify("실손보험 약관에서 통원치료 한도가 어떻게 되나요?")

        assert isinstance(result, IntentResult)
        assert result.intent == QueryIntent.POLICY_LOOKUP
        assert result.confidence == pytest.approx(0.92, abs=1e-6)

    async def test_classify_claim_guidance(self, classifier):
        """보험금 청구 안내 의도 분류"""
        mock_response = MagicMock()
        mock_response.choices[0].message.content = (
            '{"intent": "claim_guidance", "confidence": 0.88, "reasoning": "보험금 청구 절차 문의"}'
        )

        with patch.object(classifier._client, "chat") as mock_chat:
            mock_chat.completions.create = AsyncMock(return_value=mock_response)
            result = await classifier.classify("교통사고 후 보험금 청구 절차를 알고 싶어요")

        assert result.intent == QueryIntent.CLAIM_GUIDANCE
        assert result.confidence == pytest.approx(0.88, abs=1e-6)

    async def test_classify_general_qa(self, classifier):
        """일반 질의응답 의도 분류"""
        mock_response = MagicMock()
        mock_response.choices[0].message.content = (
            '{"intent": "general_qa", "confidence": 0.75, "reasoning": "일반적인 보험 질문"}'
        )

        with patch.object(classifier._client, "chat") as mock_chat:
            mock_chat.completions.create = AsyncMock(return_value=mock_response)
            result = await classifier.classify("보험이 뭔가요?")

        assert result.intent == QueryIntent.GENERAL_QA

    async def test_fallback_on_error(self, classifier):
        """API 오류 시 general_qa로 폴백"""
        with patch.object(classifier._client, "chat") as mock_chat:
            mock_chat.completions.create = AsyncMock(side_effect=Exception("API 오류"))
            result = await classifier.classify("보험 질문")

        assert result.intent == QueryIntent.GENERAL_QA
        assert result.confidence == 0.0

    async def test_fallback_on_invalid_json(self, classifier):
        """잘못된 JSON 응답 시 general_qa로 폴백"""
        mock_response = MagicMock()
        mock_response.choices[0].message.content = "유효하지 않은 JSON 응답"

        with patch.object(classifier._client, "chat") as mock_chat:
            mock_chat.completions.create = AsyncMock(return_value=mock_response)
            result = await classifier.classify("보험 질문")

        assert result.intent == QueryIntent.GENERAL_QA

    async def test_classify_returns_intent_result(self, classifier):
        """반환 타입이 IntentResult인지 확인"""
        mock_response = MagicMock()
        mock_response.choices[0].message.content = (
            '{"intent": "policy_lookup", "confidence": 0.85, "reasoning": "약관 관련"}'
        )

        with patch.object(classifier._client, "chat") as mock_chat:
            mock_chat.completions.create = AsyncMock(return_value=mock_response)
            result = await classifier.classify("약관 질문")

        assert isinstance(result, IntentResult)
