"""DisputeDetector 서비스 단위 테스트

SPEC-GUIDANCE-001 Phase G3: LLM 기반 분쟁 유형 탐지 및 약관 모호성 분석.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.schemas.guidance import AmbiguousClause, DisputeType
from app.services.guidance.dispute_detector import (
    _AMBIGUITY_ANALYSIS_PROMPT,
    _DISPUTE_TYPE_PROMPT,
    DisputeDetector,
)


def _make_mock_client(content: str) -> AsyncMock:
    """OpenAI client mock 생성 헬퍼"""
    mock_client = AsyncMock()
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = content
    mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
    return mock_client


# ---------------------------------------------------------------------------
# DisputeDetector.detect_dispute_type 테스트
# ---------------------------------------------------------------------------


class TestDetectDisputeTypeSuccess:
    """detect_dispute_type 정상 케이스"""

    @pytest.mark.asyncio
    async def test_detect_claim_denial(self) -> None:
        """보험금 거절 분쟁 유형 감지"""
        content = json.dumps(
            {"dispute_type": "claim_denial", "confidence": 0.9, "reasoning": "보험금 거절 상황"}
        )
        detector = DisputeDetector(client=_make_mock_client(content))
        dispute_type, confidence, reasoning = await detector.detect_dispute_type(
            "보험금 청구했더니 거절당했어요"
        )
        assert dispute_type == DisputeType.CLAIM_DENIAL
        assert confidence == pytest.approx(0.9)
        assert reasoning == "보험금 거절 상황"

    @pytest.mark.asyncio
    async def test_detect_coverage_dispute(self) -> None:
        """보장 범위 분쟁 유형 감지"""
        content = json.dumps(
            {
                "dispute_type": "coverage_dispute",
                "confidence": 0.85,
                "reasoning": "보장 범위 해석 분쟁",
            }
        )
        detector = DisputeDetector(client=_make_mock_client(content))
        dispute_type, confidence, reasoning = await detector.detect_dispute_type(
            "이 질병이 보장 범위에 포함되는지 모르겠어요"
        )
        assert dispute_type == DisputeType.COVERAGE_DISPUTE
        assert confidence == pytest.approx(0.85)

    @pytest.mark.asyncio
    async def test_detect_incomplete_sale(self) -> None:
        """불완전판매 분쟁 유형 감지"""
        content = json.dumps(
            {
                "dispute_type": "incomplete_sale",
                "confidence": 0.8,
                "reasoning": "설명 의무 위반 의심",
            }
        )
        detector = DisputeDetector(client=_make_mock_client(content))
        dispute_type, confidence, reasoning = await detector.detect_dispute_type(
            "가입할 때 이런 내용은 전혀 설명 안 해줬어요"
        )
        assert dispute_type == DisputeType.INCOMPLETE_SALE
        assert confidence == pytest.approx(0.8)

    @pytest.mark.asyncio
    async def test_detect_premium_dispute(self) -> None:
        """보험료 분쟁 유형 감지"""
        content = json.dumps(
            {
                "dispute_type": "premium_dispute",
                "confidence": 0.75,
                "reasoning": "보험료 환급 분쟁",
            }
        )
        detector = DisputeDetector(client=_make_mock_client(content))
        dispute_type, confidence, reasoning = await detector.detect_dispute_type(
            "해약환급금이 너무 적게 나왔어요"
        )
        assert dispute_type == DisputeType.PREMIUM_DISPUTE
        assert confidence == pytest.approx(0.75)

    @pytest.mark.asyncio
    async def test_detect_contract_cancel(self) -> None:
        """계약 해지 분쟁 유형 감지"""
        content = json.dumps(
            {
                "dispute_type": "contract_cancel",
                "confidence": 0.88,
                "reasoning": "계약 해지 분쟁",
            }
        )
        detector = DisputeDetector(client=_make_mock_client(content))
        dispute_type, confidence, reasoning = await detector.detect_dispute_type(
            "보험사가 일방적으로 계약을 해지했어요"
        )
        assert dispute_type == DisputeType.CONTRACT_CANCEL
        assert confidence == pytest.approx(0.88)

    @pytest.mark.asyncio
    async def test_detect_other(self) -> None:
        """기타 분쟁 유형 감지"""
        content = json.dumps(
            {"dispute_type": "other", "confidence": 0.6, "reasoning": "기타 분쟁"}
        )
        detector = DisputeDetector(client=_make_mock_client(content))
        dispute_type, confidence, reasoning = await detector.detect_dispute_type("기타 문의입니다")
        assert dispute_type == DisputeType.OTHER
        assert confidence == pytest.approx(0.6)


class TestDetectDisputeTypeFallback:
    """detect_dispute_type 폴백 케이스"""

    @pytest.mark.asyncio
    async def test_api_error_fallback_to_other(self) -> None:
        """API 오류 시 OTHER, 0.0 반환"""
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            side_effect=RuntimeError("API 연결 실패")
        )
        detector = DisputeDetector(client=mock_client)
        dispute_type, confidence, reasoning = await detector.detect_dispute_type("보험 분쟁")
        assert dispute_type == DisputeType.OTHER
        assert confidence == pytest.approx(0.0)
        assert "API 연결 실패" in reasoning

    @pytest.mark.asyncio
    async def test_invalid_json_fallback(self) -> None:
        """잘못된 JSON 응답 시 OTHER 반환"""
        detector = DisputeDetector(client=_make_mock_client("not valid json"))
        dispute_type, confidence, _ = await detector.detect_dispute_type("보험 분쟁")
        assert dispute_type == DisputeType.OTHER
        assert confidence == pytest.approx(0.0)

    @pytest.mark.asyncio
    async def test_invalid_dispute_type_value_fallback(self) -> None:
        """존재하지 않는 분쟁 유형 값 시 OTHER 반환"""
        content = json.dumps(
            {"dispute_type": "nonexistent_type", "confidence": 0.9, "reasoning": "분류 근거"}
        )
        detector = DisputeDetector(client=_make_mock_client(content))
        dispute_type, confidence, _ = await detector.detect_dispute_type("보험 분쟁")
        assert dispute_type == DisputeType.OTHER
        assert confidence == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# DisputeDetector.analyze_ambiguous_clauses 테스트
# ---------------------------------------------------------------------------


class TestAnalyzeAmbiguousClausesSuccess:
    """analyze_ambiguous_clauses 정상 케이스"""

    @pytest.mark.asyncio
    async def test_single_clause_success(self) -> None:
        """1개 모호한 조항 분석 결과 반환"""
        clauses_data = [
            {
                "clause_text": "입원 치료를 요하는 경우",
                "ambiguity_reason": "'요하는' 기준이 불명확",
                "consumer_favorable_interpretation": "의사 판단 기준",
                "insurer_favorable_interpretation": "절대적 필요 기준",
                "recommendation": "소비자 유리 해석 적용",
            }
        ]
        content = json.dumps({"clauses": clauses_data})
        detector = DisputeDetector(client=_make_mock_client(content))
        result = await detector.analyze_ambiguous_clauses(
            query="입원비 청구 거절",
            clause_texts=["입원 치료를 요하는 경우 보상합니다"],
        )
        assert len(result) == 1
        assert isinstance(result[0], AmbiguousClause)
        assert result[0].clause_text == "입원 치료를 요하는 경우"
        assert result[0].ambiguity_reason == "'요하는' 기준이 불명확"
        assert result[0].consumer_favorable_interpretation == "의사 판단 기준"
        assert result[0].insurer_favorable_interpretation == "절대적 필요 기준"
        assert result[0].recommendation == "소비자 유리 해석 적용"

    @pytest.mark.asyncio
    async def test_multiple_clauses_success(self) -> None:
        """여러 모호한 조항 반환"""
        clauses_data = [
            {
                "clause_text": "약관 조항 1",
                "ambiguity_reason": "모호성 1",
                "consumer_favorable_interpretation": "소비자 해석 1",
                "insurer_favorable_interpretation": "보험사 해석 1",
                "recommendation": "권장 1",
            },
            {
                "clause_text": "약관 조항 2",
                "ambiguity_reason": "모호성 2",
                "consumer_favorable_interpretation": "소비자 해석 2",
                "insurer_favorable_interpretation": "보험사 해석 2",
                "recommendation": "권장 2",
            },
        ]
        content = json.dumps({"clauses": clauses_data})
        detector = DisputeDetector(client=_make_mock_client(content))
        result = await detector.analyze_ambiguous_clauses(
            query="분쟁 상황",
            clause_texts=["조항 1 텍스트", "조항 2 텍스트"],
        )
        assert len(result) == 2
        assert result[0].clause_text == "약관 조항 1"
        assert result[1].clause_text == "약관 조항 2"


class TestAnalyzeAmbiguousClausesEdgeCases:
    """analyze_ambiguous_clauses 엣지 케이스"""

    @pytest.mark.asyncio
    async def test_empty_clause_texts_returns_empty(self) -> None:
        """빈 clause_texts 입력 시 빈 리스트 반환 (API 호출 없음)"""
        mock_client = AsyncMock()
        detector = DisputeDetector(client=mock_client)
        result = await detector.analyze_ambiguous_clauses(
            query="분쟁 상황",
            clause_texts=[],
        )
        assert result == []
        mock_client.chat.completions.create.assert_not_called()

    @pytest.mark.asyncio
    async def test_api_error_returns_empty_list(self) -> None:
        """API 오류 시 빈 리스트 반환"""
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            side_effect=RuntimeError("API 연결 실패")
        )
        detector = DisputeDetector(client=mock_client)
        result = await detector.analyze_ambiguous_clauses(
            query="분쟁 상황",
            clause_texts=["약관 텍스트"],
        )
        assert result == []

    @pytest.mark.asyncio
    async def test_invalid_json_returns_empty_list(self) -> None:
        """잘못된 JSON 응답 시 빈 리스트 반환"""
        detector = DisputeDetector(client=_make_mock_client("invalid json"))
        result = await detector.analyze_ambiguous_clauses(
            query="분쟁 상황",
            clause_texts=["약관 텍스트"],
        )
        assert result == []

    @pytest.mark.asyncio
    async def test_incomplete_clause_data_skipped(self) -> None:
        """필수 필드 누락된 조항은 건너뜀"""
        # 첫 번째 조항은 완전, 두 번째는 recommendation 누락
        clauses_data = [
            {
                "clause_text": "완전한 조항",
                "ambiguity_reason": "모호성",
                "consumer_favorable_interpretation": "소비자 해석",
                "insurer_favorable_interpretation": "보험사 해석",
                "recommendation": "권장 사항",
            },
            {
                "clause_text": "불완전한 조항",
                "ambiguity_reason": "모호성",
                # recommendation 누락
            },
        ]
        content = json.dumps({"clauses": clauses_data})
        detector = DisputeDetector(client=_make_mock_client(content))
        result = await detector.analyze_ambiguous_clauses(
            query="분쟁 상황",
            clause_texts=["약관 텍스트"],
        )
        # 완전한 조항만 포함
        assert len(result) == 1
        assert result[0].clause_text == "완전한 조항"


# ---------------------------------------------------------------------------
# _parse_dispute_type 직접 단위 테스트
# ---------------------------------------------------------------------------


class TestParseDisputeType:
    """_parse_dispute_type 파싱 메서드 테스트"""

    def test_valid_json_parsing(self) -> None:
        """올바른 JSON 파싱"""
        detector = DisputeDetector(client=AsyncMock())
        content = json.dumps(
            {"dispute_type": "claim_denial", "confidence": 0.9, "reasoning": "근거"}
        )
        dispute_type, confidence, reasoning = detector._parse_dispute_type(content)
        assert dispute_type == DisputeType.CLAIM_DENIAL
        assert confidence == pytest.approx(0.9)
        assert reasoning == "근거"

    def test_empty_string_fallback(self) -> None:
        """빈 문자열 입력 시 OTHER 폴백"""
        detector = DisputeDetector(client=AsyncMock())
        dispute_type, confidence, reasoning = detector._parse_dispute_type("")
        assert dispute_type == DisputeType.OTHER
        assert confidence == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# _parse_ambiguous_clauses 직접 단위 테스트
# ---------------------------------------------------------------------------


class TestParseAmbiguousClauses:
    """_parse_ambiguous_clauses 파싱 메서드 테스트"""

    def test_valid_json_parsing(self) -> None:
        """올바른 JSON 파싱"""
        detector = DisputeDetector(client=AsyncMock())
        clauses_data = [
            {
                "clause_text": "약관 텍스트",
                "ambiguity_reason": "모호성",
                "consumer_favorable_interpretation": "소비자 해석",
                "insurer_favorable_interpretation": "보험사 해석",
                "recommendation": "권장",
            }
        ]
        content = json.dumps({"clauses": clauses_data})
        result = detector._parse_ambiguous_clauses(content)
        assert len(result) == 1
        assert isinstance(result[0], AmbiguousClause)

    def test_empty_clauses_array(self) -> None:
        """빈 clauses 배열 시 빈 리스트"""
        detector = DisputeDetector(client=AsyncMock())
        content = json.dumps({"clauses": []})
        result = detector._parse_ambiguous_clauses(content)
        assert result == []


# ---------------------------------------------------------------------------
# 시스템 프롬프트 및 IntentClassifier 통합 검증
# ---------------------------------------------------------------------------


class TestSystemPromptsContent:
    """시스템 프롬프트 내용 검증"""

    def test_dispute_type_prompt_contains_all_types(self) -> None:
        """분쟁 유형 프롬프트에 모든 DisputeType 포함 확인"""
        for dispute_type in DisputeType:
            assert dispute_type.value in _DISPUTE_TYPE_PROMPT, (
                f"프롬프트에 '{dispute_type.value}' 없음"
            )

    def test_ambiguity_prompt_contains_required_fields(self) -> None:
        """모호성 분석 프롬프트에 필수 필드 설명 포함 확인"""
        required_keywords = [
            "clause_text",
            "ambiguity_reason",
            "consumer_favorable_interpretation",
            "insurer_favorable_interpretation",
            "recommendation",
        ]
        for keyword in required_keywords:
            assert keyword in _AMBIGUITY_ANALYSIS_PROMPT, (
                f"프롬프트에 '{keyword}' 없음"
            )


class TestIntentClassifierDisputeGuidanceIntegration:
    """IntentClassifier와 DISPUTE_GUIDANCE 통합 테스트"""

    @pytest.mark.asyncio
    async def test_intent_classifier_returns_dispute_guidance(self) -> None:
        """classify 메서드가 DISPUTE_GUIDANCE를 반환하는지 mock 테스트"""
        from app.services.llm.classifier import IntentClassifier
        from app.services.llm.models import QueryIntent

        # settings mock
        mock_settings = MagicMock()
        mock_settings.openai_api_key = "test-key"
        mock_settings.llm_classifier_model = "gpt-4o-mini"

        classifier = IntentClassifier(settings=mock_settings)

        # OpenAI 클라이언트를 mock으로 교체
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = json.dumps(
            {
                "intent": "dispute_guidance",
                "confidence": 0.92,
                "reasoning": "보험금 분쟁 상황",
            }
        )
        classifier._client.chat.completions.create = AsyncMock(return_value=mock_response)

        result = await classifier.classify("보험금이 거절되었는데 어떻게 이의제기하나요?")
        assert result.intent == QueryIntent.DISPUTE_GUIDANCE
        assert result.confidence == pytest.approx(0.92)
