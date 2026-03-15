"""GuidanceService 오케스트레이터 단위 테스트

SPEC-GUIDANCE-001 Phase G5: 모든 하위 서비스를 조합하는
GuidanceService analyze_dispute 동작 검증.
"""

from __future__ import annotations

from datetime import date
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.schemas.guidance import (
    DisputeAnalysisResponse,
    DisputeType,
    EscalationLevel,
    EscalationRecommendation,
    EvidenceStrategy,
    PrecedentSummary,
    ProbabilityScore,
)
from app.services.guidance.guidance_service import GuidanceService


def _make_probability() -> ProbabilityScore:
    """테스트용 ProbabilityScore 생성"""
    return ProbabilityScore(
        overall_score=0.6,
        factors=["판례 다수 존재"],
        confidence=0.8,
        disclaimer="법적 조언 아님",
    )


def _make_evidence() -> EvidenceStrategy:
    """테스트용 EvidenceStrategy 생성"""
    return EvidenceStrategy(
        required_documents=["보험증권"],
        recommended_documents=["진단서"],
        preparation_tips=["원본 보관"],
        timeline_advice="30일 이내",
    )


def _make_escalation(score: float = 0.6) -> EscalationRecommendation:
    """테스트용 EscalationRecommendation 생성"""
    return EscalationRecommendation(
        recommended_level=EscalationLevel.COMPANY_COMPLAINT,
        reason="초기 단계",
        next_steps=["민원 접수"],
        estimated_duration="2주",
        cost_estimate="무료",
    )


def _make_precedent_dict(case_number: str = "2023가단1234") -> dict:
    """테스트용 판례 딕셔너리 생성"""
    return {
        "case_number": case_number,
        "court_name": "서울중앙지법",
        "decision_date": date(2023, 6, 1),
        "summary": "보험금 지급 거절 사건",
        "ruling": "원고 승소",
        "relevance_score": 0.85,
        "similarity": 0.85,
    }


def _make_guidance_service(
    *,
    detect_result: tuple = (DisputeType.CLAIM_DENIAL, 0.9, "근거"),
    precedent_results: list | None = None,
    clauses: list | None = None,
    probability: ProbabilityScore | None = None,
    evidence: EvidenceStrategy | None = None,
    escalation: EscalationRecommendation | None = None,
) -> GuidanceService:
    """테스트용 GuidanceService 생성 (mock 하위 서비스 주입)"""
    if precedent_results is None:
        precedent_results = [_make_precedent_dict()]
    if clauses is None:
        clauses = []
    if probability is None:
        probability = _make_probability()
    if evidence is None:
        evidence = _make_evidence()
    if escalation is None:
        escalation = _make_escalation()

    dispute_detector = MagicMock()
    dispute_detector.detect_dispute_type = AsyncMock(return_value=detect_result)
    dispute_detector.analyze_ambiguous_clauses = AsyncMock(return_value=clauses)

    precedent_service = MagicMock()
    precedent_service.hybrid_search = AsyncMock(return_value=precedent_results)

    probability_scorer = MagicMock()
    probability_scorer.predict = AsyncMock(return_value=probability)

    evidence_advisor = MagicMock()
    evidence_advisor.advise = AsyncMock(return_value=evidence)

    escalation_advisor = MagicMock()
    escalation_advisor.recommend = AsyncMock(return_value=escalation)

    return GuidanceService(
        dispute_detector=dispute_detector,
        precedent_service=precedent_service,
        probability_scorer=probability_scorer,
        evidence_advisor=evidence_advisor,
        escalation_advisor=escalation_advisor,
    )


@pytest.mark.asyncio
class TestGuidanceServiceAnalyze:
    """GuidanceService.analyze_dispute 테스트"""

    async def test_analyze_dispute_calls_all_sub_services(self) -> None:
        """모든 하위 서비스가 호출되는지 확인"""
        service = _make_guidance_service()

        await service.analyze_dispute("보험금 청구가 거절되었습니다 도움이 필요합니다")

        service._dispute_detector.detect_dispute_type.assert_called_once()
        service._precedent_service.hybrid_search.assert_called_once()
        service._dispute_detector.analyze_ambiguous_clauses.assert_called_once()
        service._probability_scorer.predict.assert_called_once()
        service._evidence_advisor.advise.assert_called_once()
        service._escalation_advisor.recommend.assert_called_once()

    async def test_analyze_dispute_auto_detects_dispute_type_when_none(self) -> None:
        """dispute_type=None 이면 detect_dispute_type 이 호출된다"""
        service = _make_guidance_service()

        await service.analyze_dispute("보험금 청구 거절 상황입니다", dispute_type=None)

        service._dispute_detector.detect_dispute_type.assert_called_once()

    async def test_analyze_dispute_skips_detection_when_type_given(self) -> None:
        """dispute_type 이 지정되면 detect_dispute_type 이 호출되지 않는다"""
        service = _make_guidance_service()

        result = await service.analyze_dispute(
            "보험금 청구 거절 상황입니다",
            dispute_type=DisputeType.CLAIM_DENIAL,
        )

        service._dispute_detector.detect_dispute_type.assert_not_called()
        # 수동 지정 시 confidence = 1.0
        assert result.confidence == 1.0

    async def test_analyze_dispute_passes_insurance_type_to_precedent_service(self) -> None:
        """insurance_type 이 precedent_service.hybrid_search 에 전달된다"""
        service = _make_guidance_service()

        await service.analyze_dispute(
            "화재보험 관련 분쟁입니다",
            insurance_type="화재보험",
        )

        call_kwargs = service._precedent_service.hybrid_search.call_args.kwargs
        assert call_kwargs.get("insurance_type") == "화재보험"

    async def test_analyze_dispute_returns_empty_precedents_when_no_results(self) -> None:
        """판례 없을 때 빈 precedents 반환"""
        service = _make_guidance_service(precedent_results=[])

        result = await service.analyze_dispute("보험금 청구 거절 상황입니다")

        assert result.precedents == []

    async def test_analyze_dispute_converts_precedent_dicts_to_summary(self) -> None:
        """판례 딕셔너리가 PrecedentSummary 로 변환된다"""
        p = _make_precedent_dict("2022나5678")
        service = _make_guidance_service(precedent_results=[p])

        result = await service.analyze_dispute("보험금 청구 거절 상황입니다")

        assert len(result.precedents) == 1
        summary = result.precedents[0]
        assert isinstance(summary, PrecedentSummary)
        assert summary.case_number == "2022나5678"
        assert summary.court_name == "서울중앙지법"

    async def test_analyze_dispute_limits_clause_texts_to_top_3(self) -> None:
        """약관 분석에 상위 3개 판례의 ruling 만 전달된다"""
        precedents = [_make_precedent_dict(f"2023가단{i:04d}") for i in range(5)]
        service = _make_guidance_service(precedent_results=precedents)

        await service.analyze_dispute("보험금 청구 거절 상황입니다")

        call_kwargs = service._dispute_detector.analyze_ambiguous_clauses.call_args.kwargs
        assert len(call_kwargs.get("clause_texts", [])) <= 3

    async def test_analyze_dispute_includes_probability(self) -> None:
        """응답에 probability 가 포함된다"""
        probability = _make_probability()
        service = _make_guidance_service(probability=probability)

        result = await service.analyze_dispute("보험금 청구 거절 상황입니다")

        assert result.probability is not None
        service._probability_scorer.predict.assert_called_once()

    async def test_analyze_dispute_includes_evidence_strategy(self) -> None:
        """응답에 evidence_strategy 가 포함된다"""
        service = _make_guidance_service()

        result = await service.analyze_dispute("보험금 청구 거절 상황입니다")

        assert result.evidence_strategy is not None
        service._evidence_advisor.advise.assert_called_once()

    async def test_analyze_dispute_includes_escalation(self) -> None:
        """응답에 escalation 이 포함된다"""
        service = _make_guidance_service()

        result = await service.analyze_dispute("보험금 청구 거절 상황입니다")

        assert result.escalation is not None
        service._escalation_advisor.recommend.assert_called_once()

    async def test_analyze_dispute_includes_disclaimer(self) -> None:
        """응답에 면책 고지가 포함된다"""
        service = _make_guidance_service()

        result = await service.analyze_dispute("보험금 청구 거절 상황입니다")

        assert result.disclaimer != ""
        assert "법적" in result.disclaimer or "참고" in result.disclaimer

    async def test_analyze_dispute_returns_analysis_response_type(self) -> None:
        """반환 타입이 DisputeAnalysisResponse 이다"""
        service = _make_guidance_service()

        result = await service.analyze_dispute("보험금 청구 거절 상황입니다")

        assert isinstance(result, DisputeAnalysisResponse)

    async def test_analyze_dispute_passes_probability_score_to_escalation(self) -> None:
        """escalation_advisor.recommend 에 probability.overall_score 가 전달된다"""
        probability = _make_probability()
        service = _make_guidance_service(probability=probability)

        await service.analyze_dispute("보험금 청구 거절 상황입니다")

        call_kwargs = service._escalation_advisor.recommend.call_args.kwargs
        assert call_kwargs.get("probability_score") == probability.overall_score

    async def test_analyze_dispute_uses_auto_detected_confidence(self) -> None:
        """자동 감지 시 type_confidence 가 result.confidence 가 된다"""
        service = _make_guidance_service(detect_result=(DisputeType.CLAIM_DENIAL, 0.75, "근거"))

        result = await service.analyze_dispute("보험금 청구 거절 상황입니다", dispute_type=None)

        assert result.confidence == pytest.approx(0.75)

    async def test_analyze_dispute_manual_type_has_confidence_1(self) -> None:
        """수동 지정 시 confidence = 1.0"""
        service = _make_guidance_service()

        result = await service.analyze_dispute(
            "보험금 청구 거절 상황입니다",
            dispute_type=DisputeType.COVERAGE_DISPUTE,
        )

        assert result.confidence == 1.0
