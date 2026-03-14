"""LLM 모델 Pydantic 스키마 단위 테스트

SPEC-LLM-001 TASK-002: LLM 관련 Pydantic 모델 검증.
"""

from __future__ import annotations

from app.services.llm.models import (
    IntentResult,
    LLMProviderType,
    LLMResponse,
    QueryIntent,
    QueryMetrics,
    SessionMetrics,
    SourceCitation,
)


class TestQueryIntent:
    """QueryIntent 열거형 테스트"""

    def test_policy_lookup_value(self):
        """policy_lookup 값 확인"""
        assert QueryIntent.POLICY_LOOKUP == "policy_lookup"

    def test_claim_guidance_value(self):
        """claim_guidance 값 확인"""
        assert QueryIntent.CLAIM_GUIDANCE == "claim_guidance"

    def test_general_qa_value(self):
        """general_qa 값 확인"""
        assert QueryIntent.GENERAL_QA == "general_qa"

    def test_is_string_enum(self):
        """문자열 기반 열거형인지 확인"""
        assert isinstance(QueryIntent.POLICY_LOOKUP, str)


class TestLLMProviderType:
    """LLMProviderType 열거형 테스트"""

    def test_gemini_flash_value(self):
        """gemini-2.0-flash 값 확인"""
        assert LLMProviderType.GEMINI_FLASH == "gemini-2.0-flash"

    def test_gpt4o_value(self):
        """gpt-4o 값 확인"""
        assert LLMProviderType.GPT_4O == "gpt-4o"

    def test_gpt4o_mini_value(self):
        """gpt-4o-mini 값 확인"""
        assert LLMProviderType.GPT_4O_MINI == "gpt-4o-mini"


class TestIntentResult:
    """IntentResult 모델 테스트"""

    def test_create_with_required_fields(self):
        """필수 필드만으로 생성"""
        result = IntentResult(intent=QueryIntent.POLICY_LOOKUP, confidence=0.9)
        assert result.intent == QueryIntent.POLICY_LOOKUP
        assert result.confidence == 0.9
        assert result.reasoning == ""

    def test_create_with_all_fields(self):
        """모든 필드로 생성"""
        result = IntentResult(
            intent=QueryIntent.CLAIM_GUIDANCE,
            confidence=0.8,
            reasoning="보험금 청구 관련 질문",
        )
        assert result.reasoning == "보험금 청구 관련 질문"

    def test_confidence_range_valid(self):
        """신뢰도 0~1 범위 유효값"""
        result = IntentResult(intent=QueryIntent.GENERAL_QA, confidence=0.0)
        assert result.confidence == 0.0

        result = IntentResult(intent=QueryIntent.GENERAL_QA, confidence=1.0)
        assert result.confidence == 1.0


class TestSourceCitation:
    """SourceCitation 모델 테스트"""

    def test_create_citation(self):
        """출처 인용 모델 생성"""
        citation = SourceCitation(
            company_name="삼성화재",
            policy_name="실손의료보험",
            chunk_text="실손의료보험은 실제 발생한 의료비를 보상합니다.",
            similarity=0.85,
        )
        assert citation.company_name == "삼성화재"
        assert citation.policy_name == "실손의료보험"
        assert citation.similarity == 0.85

    def test_chunk_text_field(self):
        """chunk_text 필드 최대 200자"""
        long_text = "가" * 300
        citation = SourceCitation(
            company_name="테스트",
            policy_name="테스트약관",
            chunk_text=long_text,
            similarity=0.7,
        )
        # 저장은 가능하지만 200자 제한은 비즈니스 로직에서 처리
        assert len(citation.chunk_text) == 300


class TestLLMResponse:
    """LLMResponse 모델 테스트"""

    def test_create_with_required_fields(self):
        """필수 필드만으로 생성"""
        response = LLMResponse(
            content="보험 약관에 따르면...",
            model_used="gemini-2.0-flash",
        )
        assert response.content == "보험 약관에 따르면..."
        assert response.model_used == "gemini-2.0-flash"
        assert response.input_tokens == 0
        assert response.output_tokens == 0
        assert response.estimated_cost_usd == 0.0
        assert response.confidence_score == 0.0
        assert response.sources == []
        assert response.latency_ms == 0.0

    def test_create_with_sources(self):
        """출처 정보 포함 응답"""
        source = SourceCitation(
            company_name="현대해상",
            policy_name="운전자보험",
            chunk_text="운전 중 사고 시 보상",
            similarity=0.9,
        )
        response = LLMResponse(
            content="운전자보험 내용...",
            model_used="gpt-4o",
            sources=[source],
        )
        assert len(response.sources) == 1
        assert response.sources[0].company_name == "현대해상"

    def test_cost_and_token_fields(self):
        """비용 및 토큰 필드"""
        response = LLMResponse(
            content="응답",
            model_used="gpt-4o",
            input_tokens=100,
            output_tokens=50,
            estimated_cost_usd=0.001,
        )
        assert response.input_tokens == 100
        assert response.output_tokens == 50
        assert response.estimated_cost_usd == 0.001


class TestQueryMetrics:
    """QueryMetrics 모델 테스트"""

    def test_create_metrics(self):
        """쿼리 메트릭 생성"""
        metrics = QueryMetrics(
            latency_ms=150.5,
            input_tokens=200,
            output_tokens=80,
            model_used="gemini-2.0-flash",
            estimated_cost_usd=0.002,
        )
        assert metrics.latency_ms == 150.5
        assert metrics.input_tokens == 200
        assert metrics.output_tokens == 80
        assert metrics.model_used == "gemini-2.0-flash"
        assert metrics.estimated_cost_usd == 0.002
        assert metrics.retrieval_relevance == 0.0

    def test_retrieval_relevance_default(self):
        """검색 관련성 기본값"""
        metrics = QueryMetrics(
            latency_ms=100.0,
            input_tokens=100,
            output_tokens=50,
            model_used="gpt-4o",
            estimated_cost_usd=0.001,
        )
        assert metrics.retrieval_relevance == 0.0


class TestSessionMetrics:
    """SessionMetrics 모델 테스트"""

    def test_create_empty_session_metrics(self):
        """빈 세션 메트릭 생성"""
        metrics = SessionMetrics()
        assert metrics.total_cost_usd == 0.0
        assert metrics.total_tokens == 0
        assert metrics.query_count == 0
        assert metrics.avg_latency_ms == 0.0
        assert metrics.models_used == []

    def test_create_with_values(self):
        """값이 있는 세션 메트릭"""
        metrics = SessionMetrics(
            total_cost_usd=0.05,
            total_tokens=1000,
            query_count=5,
            avg_latency_ms=200.0,
            models_used=["gemini-2.0-flash", "gpt-4o"],
        )
        assert metrics.total_cost_usd == 0.05
        assert metrics.query_count == 5
        assert len(metrics.models_used) == 2
