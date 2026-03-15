"""EscalationAdvisor 단위 테스트

SPEC-GUIDANCE-001 Phase G4: 에스컬레이션 단계 자문 서비스 검증.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.schemas.guidance import (
    DisputeType,
    EscalationLevel,
    EscalationRecommendation,
)
from app.services.guidance.escalation_advisor import EscalationAdvisor


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
# EscalationAdvisor.recommend 기본 레벨 테스트
# ---------------------------------------------------------------------------


class TestEscalationAdvisorDefaultLevel:
    """recommend 메서드 - 기본 에스컬레이션 레벨"""

    @pytest.mark.asyncio
    async def test_recommend_claim_denial_default_level(self) -> None:
        """CLAIM_DENIAL 기본 레벨 - company_complaint"""
        content = json.dumps({"recommended_level": "company_complaint", "reason": "보험사 민원 필요", "estimated_duration": "14일", "cost_estimate": "무료"})
        advisor = EscalationAdvisor(client=_make_mock_client(content))
        result = await advisor.recommend("보험금 거절", DisputeType.CLAIM_DENIAL)
        assert isinstance(result, EscalationRecommendation)
        assert result.recommended_level == EscalationLevel.COMPANY_COMPLAINT

    @pytest.mark.asyncio
    async def test_recommend_coverage_dispute_default_level(self) -> None:
        """COVERAGE_DISPUTE 기본 레벨 - fss_complaint"""
        content = json.dumps({"recommended_level": "fss_complaint", "reason": "금감원 민원 필요", "estimated_duration": "30일", "cost_estimate": "무료"})
        advisor = EscalationAdvisor(client=_make_mock_client(content))
        result = await advisor.recommend("보장 범위 분쟁", DisputeType.COVERAGE_DISPUTE)
        assert result.recommended_level == EscalationLevel.FSS_COMPLAINT

    @pytest.mark.asyncio
    async def test_recommend_incomplete_sale_default_level(self) -> None:
        """INCOMPLETE_SALE 기본 레벨 - fss_complaint"""
        content = json.dumps({"recommended_level": "fss_complaint", "reason": "불완전판매 금감원 민원", "estimated_duration": "30일", "cost_estimate": "무료"})
        advisor = EscalationAdvisor(client=_make_mock_client(content))
        result = await advisor.recommend("불완전판매", DisputeType.INCOMPLETE_SALE)
        assert result.recommended_level == EscalationLevel.FSS_COMPLAINT

    @pytest.mark.asyncio
    async def test_recommend_other_default_level(self) -> None:
        """OTHER 기본 레벨 - self_resolution"""
        content = json.dumps({"recommended_level": "self_resolution", "reason": "자체 해결 시도", "estimated_duration": "7일", "cost_estimate": "무료"})
        advisor = EscalationAdvisor(client=_make_mock_client(content))
        result = await advisor.recommend("기타 문의", DisputeType.OTHER)
        assert result.recommended_level == EscalationLevel.SELF_RESOLUTION


# ---------------------------------------------------------------------------
# EscalationAdvisor.recommend LLM 통합 테스트
# ---------------------------------------------------------------------------


class TestEscalationAdvisorLlmIntegration:
    """recommend 메서드 - LLM 응답 통합"""

    @pytest.mark.asyncio
    async def test_recommend_reflects_llm_level(self) -> None:
        """LLM 응답의 에스컬레이션 레벨 반영"""
        content = json.dumps({
            "recommended_level": "dispute_mediation",
            "reason": "복잡한 분쟁으로 조정 필요",
            "estimated_duration": "60일",
            "cost_estimate": "무료",
        })
        advisor = EscalationAdvisor(client=_make_mock_client(content))
        result = await advisor.recommend("복잡한 분쟁", DisputeType.CLAIM_DENIAL)
        assert result.recommended_level == EscalationLevel.DISPUTE_MEDIATION

    @pytest.mark.asyncio
    async def test_recommend_invalid_llm_level_uses_default(self) -> None:
        """LLM 잘못된 레벨 응답 시 기본값 사용"""
        content = json.dumps({
            "recommended_level": "invalid_level_xyz",
            "reason": "이상한 레벨",
            "estimated_duration": "",
            "cost_estimate": "",
        })
        advisor = EscalationAdvisor(client=_make_mock_client(content))
        result = await advisor.recommend("분쟁 상황", DisputeType.CLAIM_DENIAL)
        # 기본값 company_complaint 사용
        assert result.recommended_level == EscalationLevel.COMPANY_COMPLAINT

    @pytest.mark.asyncio
    async def test_recommend_api_error_fallback(self) -> None:
        """API 오류 시 기본값으로 폴백"""
        advisor = EscalationAdvisor(client=_make_error_client())
        result = await advisor.recommend("분쟁 상황", DisputeType.CLAIM_DENIAL)
        assert isinstance(result, EscalationRecommendation)
        assert result.recommended_level == EscalationLevel.COMPANY_COMPLAINT

    @pytest.mark.asyncio
    async def test_recommend_probability_score_passed_to_llm(self) -> None:
        """probability_score가 LLM 호출에 전달됨"""
        content = json.dumps({"recommended_level": "company_complaint", "reason": "민원 접수", "estimated_duration": "14일", "cost_estimate": "무료"})
        mock_client = _make_mock_client(content)
        advisor = EscalationAdvisor(client=mock_client)
        await advisor.recommend("분쟁 상황", DisputeType.CLAIM_DENIAL, probability_score=0.75)
        call_args = mock_client.chat.completions.create.call_args
        user_content = call_args.kwargs["messages"][1]["content"]
        assert "75.0%" in user_content or "0.75" in user_content or "75" in user_content

    @pytest.mark.asyncio
    async def test_recommend_includes_next_steps(self) -> None:
        """recommend 결과에 next_steps 포함"""
        content = json.dumps({"recommended_level": "company_complaint", "reason": "민원 접수", "estimated_duration": "14일", "cost_estimate": "무료"})
        advisor = EscalationAdvisor(client=_make_mock_client(content))
        result = await advisor.recommend("분쟁 상황", DisputeType.CLAIM_DENIAL)
        assert len(result.next_steps) > 0

    @pytest.mark.asyncio
    async def test_recommend_estimated_duration_included(self) -> None:
        """recommend 결과에 estimated_duration 포함"""
        content = json.dumps({"recommended_level": "company_complaint", "reason": "민원", "estimated_duration": "14영업일", "cost_estimate": ""})
        advisor = EscalationAdvisor(client=_make_mock_client(content))
        result = await advisor.recommend("분쟁 상황", DisputeType.CLAIM_DENIAL)
        assert result.estimated_duration == "14영업일"

    @pytest.mark.asyncio
    async def test_recommend_cost_estimate_included(self) -> None:
        """recommend 결과에 cost_estimate 포함"""
        content = json.dumps({"recommended_level": "legal_action", "reason": "소송 필요", "estimated_duration": "1년", "cost_estimate": "변호사 비용 발생"})
        advisor = EscalationAdvisor(client=_make_mock_client(content))
        result = await advisor.recommend("소송 필요 분쟁", DisputeType.CLAIM_DENIAL)
        assert result.cost_estimate == "변호사 비용 발생"


# ---------------------------------------------------------------------------
# EscalationAdvisor.get_default_escalation 테스트
# ---------------------------------------------------------------------------


class TestEscalationAdvisorGetDefault:
    """get_default_escalation 메서드 테스트"""

    def test_get_default_escalation_claim_denial(self) -> None:
        """CLAIM_DENIAL 기본 레벨 조회"""
        advisor = EscalationAdvisor(client=AsyncMock())
        result = advisor.get_default_escalation(DisputeType.CLAIM_DENIAL)
        assert result == EscalationLevel.COMPANY_COMPLAINT

    def test_get_default_escalation_other(self) -> None:
        """OTHER 기본 레벨 조회"""
        advisor = EscalationAdvisor(client=AsyncMock())
        result = advisor.get_default_escalation(DisputeType.OTHER)
        assert result == EscalationLevel.SELF_RESOLUTION


# ---------------------------------------------------------------------------
# EscalationAdvisor._parse_response 테스트
# ---------------------------------------------------------------------------


class TestEscalationAdvisorParseResponse:
    """_parse_response 메서드 테스트"""

    def test_parse_response_valid_json(self) -> None:
        """유효한 JSON 파싱"""
        advisor = EscalationAdvisor(client=AsyncMock())
        content = json.dumps({"recommended_level": "fss_complaint", "reason": "금감원 민원"})
        result = advisor._parse_response(content)
        assert result["recommended_level"] == "fss_complaint"

    def test_parse_response_invalid_json_returns_empty_dict(self) -> None:
        """잘못된 JSON - 빈 dict 반환"""
        advisor = EscalationAdvisor(client=AsyncMock())
        result = advisor._parse_response("not json {{")
        assert result == {}
