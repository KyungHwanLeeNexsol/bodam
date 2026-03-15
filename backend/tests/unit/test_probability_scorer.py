"""ProbabilityScorer 단위 테스트

SPEC-GUIDANCE-001 Phase G4: LLM 기반 승소 확률 예측 서비스 검증.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.schemas.guidance import DisputeType, ProbabilityScore
from app.services.guidance.probability_scorer import ProbabilityScorer


def _make_mock_client(content: str) -> AsyncMock:
    """OpenAI client mock 생성 헬퍼"""
    mock_client = AsyncMock()
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = content
    mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
    return mock_client


def _make_error_client() -> AsyncMock:
    """오류를 발생시키는 OpenAI client mock 생성 헬퍼"""
    mock_client = AsyncMock()
    mock_client.chat.completions.create = AsyncMock(side_effect=Exception("API 오류"))
    return mock_client


# ---------------------------------------------------------------------------
# ProbabilityScorer.predict 테스트
# ---------------------------------------------------------------------------


class TestProbabilityScorePredict:
    """predict 메서드 테스트"""

    @pytest.mark.asyncio
    async def test_predict_success_basic(self) -> None:
        """정상적인 LLM 응답 파싱"""
        content = json.dumps({"overall_score": 0.7, "factors": ["강한 증거", "유사 판례 존재"], "confidence": 0.85})
        scorer = ProbabilityScorer(client=_make_mock_client(content))
        result = await scorer.predict("보험금 청구 거절 상황", DisputeType.CLAIM_DENIAL)
        assert isinstance(result, ProbabilityScore)
        assert result.overall_score == pytest.approx(0.7)
        assert result.confidence == pytest.approx(0.85)
        assert "강한 증거" in result.factors

    @pytest.mark.asyncio
    async def test_predict_dispute_type_passed(self) -> None:
        """분쟁 유형이 LLM 호출에 전달됨"""
        content = json.dumps({"overall_score": 0.6, "factors": [], "confidence": 0.7})
        mock_client = _make_mock_client(content)
        scorer = ProbabilityScorer(client=mock_client)
        await scorer.predict("보험금 분쟁", DisputeType.COVERAGE_DISPUTE)
        call_args = mock_client.chat.completions.create.call_args
        user_content = call_args.kwargs["messages"][1]["content"]
        assert "coverage_dispute" in user_content

    @pytest.mark.asyncio
    async def test_predict_with_precedent_summaries(self) -> None:
        """판례 요약 포함 시 컨텍스트에 전달"""
        content = json.dumps({"overall_score": 0.75, "factors": ["판례 참조"], "confidence": 0.9})
        mock_client = _make_mock_client(content)
        scorer = ProbabilityScorer(client=mock_client)
        precedents = ["대법원 2020. 1. 1. 판결 - 보험금 지급 인정"]
        await scorer.predict("분쟁 상황", DisputeType.CLAIM_DENIAL, precedent_summaries=precedents)
        call_args = mock_client.chat.completions.create.call_args
        user_content = call_args.kwargs["messages"][1]["content"]
        assert "판례" in user_content

    @pytest.mark.asyncio
    async def test_predict_with_clause_analysis(self) -> None:
        """약관 분석 포함 시 컨텍스트에 전달"""
        content = json.dumps({"overall_score": 0.65, "factors": ["약관 분석"], "confidence": 0.8})
        mock_client = _make_mock_client(content)
        scorer = ProbabilityScorer(client=mock_client)
        clauses = ["약관 제3조 모호 - 소비자 유리 해석 가능"]
        await scorer.predict("분쟁 상황", DisputeType.CLAIM_DENIAL, clause_analysis=clauses)
        call_args = mock_client.chat.completions.create.call_args
        user_content = call_args.kwargs["messages"][1]["content"]
        assert "약관" in user_content

    @pytest.mark.asyncio
    async def test_predict_api_error_fallback_score(self) -> None:
        """API 오류 시 폴백 - overall_score 0.5"""
        scorer = ProbabilityScorer(client=_make_error_client())
        result = await scorer.predict("분쟁 상황", DisputeType.CLAIM_DENIAL)
        assert result.overall_score == pytest.approx(0.5)

    @pytest.mark.asyncio
    async def test_predict_api_error_fallback_confidence(self) -> None:
        """API 오류 시 폴백 - confidence 0.0"""
        scorer = ProbabilityScorer(client=_make_error_client())
        result = await scorer.predict("분쟁 상황", DisputeType.CLAIM_DENIAL)
        assert result.confidence == pytest.approx(0.0)

    @pytest.mark.asyncio
    async def test_predict_disclaimer_included(self) -> None:
        """결과에 disclaimer 포함"""
        content = json.dumps({"overall_score": 0.6, "factors": [], "confidence": 0.7})
        scorer = ProbabilityScorer(client=_make_mock_client(content))
        result = await scorer.predict("분쟁 상황", DisputeType.CLAIM_DENIAL)
        assert result.disclaimer
        assert len(result.disclaimer) >= 20


# ---------------------------------------------------------------------------
# ProbabilityScorer._parse_response 테스트
# ---------------------------------------------------------------------------


class TestProbabilityScoreParseResponse:
    """_parse_response 메서드 테스트"""

    def test_parse_response_valid_json(self) -> None:
        """유효한 JSON 파싱"""
        scorer = ProbabilityScorer(client=AsyncMock())
        content = json.dumps({"overall_score": 0.8, "factors": ["요인1"], "confidence": 0.9})
        result = scorer._parse_response(content)
        assert result.overall_score == pytest.approx(0.8)
        assert result.factors == ["요인1"]
        assert result.confidence == pytest.approx(0.9)

    def test_parse_response_score_clamping_above_one(self) -> None:
        """score 1.5 → 1.0 클램핑"""
        scorer = ProbabilityScorer(client=AsyncMock())
        content = json.dumps({"overall_score": 1.5, "factors": [], "confidence": 0.5})
        result = scorer._parse_response(content)
        assert result.overall_score == pytest.approx(1.0)

    def test_parse_response_invalid_json_fallback(self) -> None:
        """잘못된 JSON 폴백 - overall_score 0.5, confidence 0.0"""
        scorer = ProbabilityScorer(client=AsyncMock())
        result = scorer._parse_response("invalid json {{{")
        assert result.overall_score == pytest.approx(0.5)
        assert result.confidence == pytest.approx(0.0)
