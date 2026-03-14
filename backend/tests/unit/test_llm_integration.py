"""LLM 파이프라인 통합 테스트

SPEC-LLM-001 TASK-011: 전체 파이프라인 통합 및 폴백 시나리오 검증.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.llm.classifier import IntentClassifier
from app.services.llm.metrics import LLMMetrics
from app.services.llm.models import IntentResult, LLMResponse, QueryIntent
from app.services.llm.prompts import PromptManager
from app.services.llm.quality import QualityGuard
from app.services.llm.router import FallbackChain, LLMRouter
from app.services.rag.chain import RAGChain
from app.services.rag.rewriter import QueryRewriter


@pytest.fixture
def mock_settings():
    """통합 테스트용 Settings"""
    settings = MagicMock()
    settings.gemini_api_key = "test-gemini-key"
    settings.openai_api_key = "test-openai-key"
    settings.llm_primary_model = "gemini-2.0-flash"
    settings.llm_fallback_model = "gpt-4o"
    settings.llm_classifier_model = "gpt-4o-mini"
    settings.llm_confidence_threshold = 0.7
    settings.llm_fallback_on_low_confidence = True
    settings.llm_cost_tracking_enabled = True
    return settings


class TestFullPipelineMocked:
    """전체 파이프라인 모킹 테스트"""

    async def test_policy_lookup_pipeline(self, mock_settings):
        """약관 조회 전체 파이프라인"""
        # 컴포넌트 초기화
        classifier = IntentClassifier(settings=mock_settings)
        prompt_manager = PromptManager()
        rag_chain = RAGChain(vector_search=MagicMock())
        router = LLMRouter(settings=mock_settings)
        quality_guard = QualityGuard()
        metrics = LLMMetrics()

        # 1. 의도 분류 모킹
        classifier.classify = AsyncMock(
            return_value=IntentResult(
                intent=QueryIntent.POLICY_LOOKUP,
                confidence=0.92,
                reasoning="약관 조회",
            )
        )

        # 2. RAG 검색 모킹
        rag_chain._vector_search.search = AsyncMock(
            return_value=[
                {
                    "policy_name": "실손의료보험",
                    "company_name": "삼성화재",
                    "chunk_text": "입원 치료비 보장 내용",
                    "similarity": 0.9,
                }
            ]
        )

        # 3. LLM 응답 모킹
        router._gemini_provider.generate = AsyncMock(
            return_value=LLMResponse(
                content="실손의료보험은 입원 치료비를 보장합니다.",
                model_used="gemini-2.0-flash",
                input_tokens=200,
                output_tokens=80,
                estimated_cost_usd=0.001,
            )
        )

        query = "실손보험 입원 보장 내용이 뭔가요?"

        # 파이프라인 실행
        intent_result = await classifier.classify(query)
        assert intent_result.intent == QueryIntent.POLICY_LOOKUP

        search_results, confidence = await rag_chain.search(query)
        assert len(search_results) > 0

        messages = prompt_manager.build_messages(
            history=[],
            context=search_results,
            query=query,
            intent=intent_result.intent,
        )
        assert len(messages) >= 2

        llm_response = await router.route(messages=messages, intent_result=intent_result)
        assert llm_response.model_used == "gemini-2.0-flash"

        final_response = await quality_guard.post_process(
            response=llm_response,
            context=search_results,
            intent=intent_result.intent,
        )
        assert isinstance(final_response, str)

        # 메트릭 기록
        from app.services.llm.models import QueryMetrics

        query_metrics = QueryMetrics(
            latency_ms=150.0,
            input_tokens=llm_response.input_tokens,
            output_tokens=llm_response.output_tokens,
            model_used=llm_response.model_used,
            estimated_cost_usd=llm_response.estimated_cost_usd,
        )
        metrics.record(query_metrics)

        session = metrics.get_session_metrics()
        assert session.query_count == 1
        assert "gemini-2.0-flash" in session.models_used

    async def test_claim_guidance_fallback_scenario(self, mock_settings):
        """낮은 신뢰도 청구 안내 폴백 시나리오"""
        router = LLMRouter(settings=mock_settings)

        # 낮은 신뢰도 청구 안내
        intent_result = IntentResult(
            intent=QueryIntent.CLAIM_GUIDANCE,
            confidence=0.45,  # 임계값(0.7) 미만
        )

        gpt4o_response = LLMResponse(
            content="GPT-4o 청구 안내",
            model_used="gpt-4o",
        )
        router._openai_provider.generate = AsyncMock(return_value=gpt4o_response)

        result = await router.route(
            messages=[{"role": "user", "content": "청구 방법"}],
            intent_result=intent_result,
        )
        assert result.model_used == "gpt-4o"

    async def test_fallback_chain_scenario(self, mock_settings):
        """폴백 체인 시나리오: Gemini 실패 → GPT-4o"""
        chain = FallbackChain(settings=mock_settings)

        # Gemini 실패, GPT-4o 성공
        chain._providers[0].generate = AsyncMock(side_effect=Exception("Gemini API 오류"))
        chain._providers[1].generate = AsyncMock(
            return_value=LLMResponse(
                content="GPT-4o 응답",
                model_used="gpt-4o",
            )
        )

        result = await chain.generate(messages=[{"role": "user", "content": "질문"}])
        assert result.model_used == "gpt-4o"


class TestQueryRewriterIntegration:
    """QueryRewriter 통합 테스트"""

    def test_rewriter_with_rag_chain(self):
        """RewriterQueryRewriter가 RAGChain에 통합됨"""
        rewriter = QueryRewriter()
        mock_vs = MagicMock()
        mock_vs.search = AsyncMock(return_value=[])

        chain = RAGChain(vector_search=mock_vs, rewriter=rewriter)
        assert chain._rewriter is rewriter

    def test_insurance_term_expansion_flow(self):
        """보험 용어 확장 흐름 검증"""
        rewriter = QueryRewriter()
        query = "실손 통원 한도 알고 싶어요"
        result = rewriter.rewrite(query)

        assert "실손의료보험" in result
        assert "통원치료비" in result


class TestMetricsIntegration:
    """메트릭 통합 테스트"""

    def test_metrics_accumulation(self):
        """여러 쿼리 메트릭 누적"""
        from app.services.llm.models import QueryMetrics

        metrics = LLMMetrics()

        for i in range(5):
            metrics.record(
                QueryMetrics(
                    latency_ms=100.0 * (i + 1),
                    input_tokens=100,
                    output_tokens=50,
                    model_used="gemini-2.0-flash",
                    estimated_cost_usd=0.001,
                )
            )

        session = metrics.get_session_metrics()
        assert session.query_count == 5
        assert session.total_tokens == 750  # (100+50) * 5
        assert session.avg_latency_ms == pytest.approx(300.0, abs=1e-6)  # (100+200+300+400+500)/5
