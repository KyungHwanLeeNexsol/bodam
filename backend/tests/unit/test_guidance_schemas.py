"""보험 분쟁 가이던스 Pydantic 스키마 단위 테스트

SPEC-GUIDANCE-001 Phase G1: DisputeType, EscalationLevel, 각 스키마 필드 검증.
"""

from __future__ import annotations

from datetime import date
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.guidance import (
    AmbiguousClause,
    CasePrecedentResponse,
    DisputeAnalysisRequest,
    DisputeAnalysisResponse,
    DisputeType,
    EscalationLevel,
    EscalationRecommendation,
    EvidenceStrategy,
    PrecedentSummary,
    ProbabilityScore,
)


class TestDisputeType:
    """DisputeType enum 검증"""

    def test_claim_denial_value(self) -> None:
        """CLAIM_DENIAL 값 확인"""
        assert DisputeType.CLAIM_DENIAL == "claim_denial"

    def test_coverage_dispute_value(self) -> None:
        """COVERAGE_DISPUTE 값 확인"""
        assert DisputeType.COVERAGE_DISPUTE == "coverage_dispute"

    def test_incomplete_sale_value(self) -> None:
        """INCOMPLETE_SALE 값 확인"""
        assert DisputeType.INCOMPLETE_SALE == "incomplete_sale"

    def test_premium_dispute_value(self) -> None:
        """PREMIUM_DISPUTE 값 확인"""
        assert DisputeType.PREMIUM_DISPUTE == "premium_dispute"

    def test_contract_cancel_value(self) -> None:
        """CONTRACT_CANCEL 값 확인"""
        assert DisputeType.CONTRACT_CANCEL == "contract_cancel"

    def test_other_value(self) -> None:
        """OTHER 값 확인"""
        assert DisputeType.OTHER == "other"

    def test_all_six_values_exist(self) -> None:
        """총 6개 값 존재 확인"""
        assert len(DisputeType) == 6


class TestEscalationLevel:
    """EscalationLevel enum 검증"""

    def test_self_resolution_value(self) -> None:
        """SELF_RESOLUTION 값 확인"""
        assert EscalationLevel.SELF_RESOLUTION == "self_resolution"

    def test_company_complaint_value(self) -> None:
        """COMPANY_COMPLAINT 값 확인"""
        assert EscalationLevel.COMPANY_COMPLAINT == "company_complaint"

    def test_fss_complaint_value(self) -> None:
        """FSS_COMPLAINT 값 확인"""
        assert EscalationLevel.FSS_COMPLAINT == "fss_complaint"

    def test_dispute_mediation_value(self) -> None:
        """DISPUTE_MEDIATION 값 확인"""
        assert EscalationLevel.DISPUTE_MEDIATION == "dispute_mediation"

    def test_legal_action_value(self) -> None:
        """LEGAL_ACTION 값 확인"""
        assert EscalationLevel.LEGAL_ACTION == "legal_action"

    def test_all_five_values_exist(self) -> None:
        """총 5개 값 존재 확인"""
        assert len(EscalationLevel) == 5


class TestAmbiguousClause:
    """AmbiguousClause 스키마 검증"""

    def test_valid_ambiguous_clause(self) -> None:
        """유효한 AmbiguousClause 생성 확인"""
        clause = AmbiguousClause(
            clause_text="사고로 인한 후유 장해",
            ambiguity_reason="후유 장해 범위 불명확",
            consumer_favorable_interpretation="넓은 의미의 장해 인정",
            insurer_favorable_interpretation="의학적으로 인정된 장해만 해당",
            recommendation="소비자 유리 해석 적용",
        )
        assert clause.clause_text == "사고로 인한 후유 장해"

    def test_all_fields_required(self) -> None:
        """모든 필드 필수 확인"""
        with pytest.raises(ValidationError):
            AmbiguousClause(
                clause_text="텍스트",
                # ambiguity_reason 누락
                consumer_favorable_interpretation="A",
                insurer_favorable_interpretation="B",
                recommendation="C",
            )


class TestPrecedentSummary:
    """PrecedentSummary 스키마 검증"""

    def test_valid_precedent_summary(self) -> None:
        """유효한 PrecedentSummary 생성 확인"""
        summary = PrecedentSummary(
            case_number="2023다56789",
            court_name="대법원",
            decision_date=date(2023, 6, 15),
            summary="보험금 지급 거절 사건",
            relevance_score=0.85,
            key_ruling="약관 불명확 시 소비자 유리 해석",
        )
        assert summary.case_number == "2023다56789"

    def test_relevance_score_must_be_between_0_and_1(self) -> None:
        """relevance_score 0.0~1.0 범위 검증"""
        with pytest.raises(ValidationError):
            PrecedentSummary(
                case_number="2023다56789",
                court_name="대법원",
                decision_date=date(2023, 6, 15),
                summary="요약",
                relevance_score=1.5,  # 범위 초과
                key_ruling="판결 요지",
            )

    def test_relevance_score_cannot_be_negative(self) -> None:
        """relevance_score 음수 불허 검증"""
        with pytest.raises(ValidationError):
            PrecedentSummary(
                case_number="2023다56789",
                court_name="대법원",
                decision_date=date(2023, 6, 15),
                summary="요약",
                relevance_score=-0.1,  # 음수
                key_ruling="판결 요지",
            )

    def test_relevance_score_boundary_values(self) -> None:
        """relevance_score 경계값(0.0, 1.0) 허용 확인"""
        s1 = PrecedentSummary(
            case_number="A",
            court_name="B",
            decision_date=date(2023, 1, 1),
            summary="C",
            relevance_score=0.0,
            key_ruling="D",
        )
        s2 = PrecedentSummary(
            case_number="A",
            court_name="B",
            decision_date=date(2023, 1, 1),
            summary="C",
            relevance_score=1.0,
            key_ruling="D",
        )
        assert s1.relevance_score == 0.0
        assert s2.relevance_score == 1.0


class TestProbabilityScore:
    """ProbabilityScore 스키마 검증"""

    def test_valid_probability_score(self) -> None:
        """유효한 ProbabilityScore 생성 확인"""
        score = ProbabilityScore(
            overall_score=0.65,
            factors=["판례 유사도 높음", "증거 충분"],
            confidence=0.80,
            disclaimer="본 예측은 법적 효력이 없습니다.",
        )
        assert score.overall_score == 0.65

    def test_overall_score_range_validation(self) -> None:
        """overall_score 0.0~1.0 범위 검증"""
        with pytest.raises(ValidationError):
            ProbabilityScore(
                overall_score=1.1,
                confidence=0.5,
                disclaimer="면책 고지",
            )

    def test_confidence_range_validation(self) -> None:
        """confidence 0.0~1.0 범위 검증"""
        with pytest.raises(ValidationError):
            ProbabilityScore(
                overall_score=0.5,
                confidence=-0.1,
                disclaimer="면책 고지",
            )

    def test_factors_defaults_to_empty_list(self) -> None:
        """factors 기본값이 빈 리스트인지 확인"""
        score = ProbabilityScore(
            overall_score=0.5,
            confidence=0.5,
            disclaimer="면책",
        )
        assert score.factors == []


class TestEvidenceStrategy:
    """EvidenceStrategy 스키마 검증"""

    def test_all_list_fields_default_to_empty(self) -> None:
        """리스트 필드 기본값이 빈 리스트인지 확인"""
        strategy = EvidenceStrategy()
        assert strategy.required_documents == []
        assert strategy.recommended_documents == []
        assert strategy.preparation_tips == []

    def test_timeline_advice_defaults_to_empty_string(self) -> None:
        """timeline_advice 기본값이 빈 문자열인지 확인"""
        strategy = EvidenceStrategy()
        assert strategy.timeline_advice == ""

    def test_valid_evidence_strategy_with_data(self) -> None:
        """유효한 EvidenceStrategy 생성 확인"""
        strategy = EvidenceStrategy(
            required_documents=["진단서", "보험증권"],
            recommended_documents=["진료기록부"],
            preparation_tips=["원본 보관"],
            timeline_advice="청구 시효 2년",
        )
        assert len(strategy.required_documents) == 2


class TestEscalationRecommendation:
    """EscalationRecommendation 스키마 검증"""

    def test_valid_escalation_recommendation(self) -> None:
        """유효한 EscalationRecommendation 생성 확인"""
        rec = EscalationRecommendation(
            recommended_level=EscalationLevel.FSS_COMPLAINT,
            reason="보험사 민원 처리 거부",
            next_steps=["금감원 민원 접수"],
            estimated_duration="2~3개월",
            cost_estimate="무료",
        )
        assert rec.recommended_level == EscalationLevel.FSS_COMPLAINT

    def test_next_steps_defaults_to_empty_list(self) -> None:
        """next_steps 기본값이 빈 리스트인지 확인"""
        rec = EscalationRecommendation(
            recommended_level=EscalationLevel.SELF_RESOLUTION,
            reason="단순 문의",
        )
        assert rec.next_steps == []

    def test_optional_string_fields_default_to_empty(self) -> None:
        """optional 문자열 필드 기본값 빈 문자열 확인"""
        rec = EscalationRecommendation(
            recommended_level=EscalationLevel.SELF_RESOLUTION,
            reason="단순 문의",
        )
        assert rec.estimated_duration == ""
        assert rec.cost_estimate == ""


class TestDisputeAnalysisRequest:
    """DisputeAnalysisRequest 스키마 검증"""

    def test_valid_request_with_minimum_fields(self) -> None:
        """최소 필드로 유효한 요청 생성 확인"""
        req = DisputeAnalysisRequest(query="보험금 지급이 거절되었는데 어떻게 해야 하나요?")
        assert req.dispute_type is None
        assert req.insurance_type is None
        assert req.policy_id is None

    def test_query_min_length_validation(self) -> None:
        """query 최소 길이(10) 검증"""
        with pytest.raises(ValidationError):
            DisputeAnalysisRequest(query="짧은쿼리")  # 9자 미만

    def test_query_max_length_validation(self) -> None:
        """query 최대 길이(2000) 검증"""
        with pytest.raises(ValidationError):
            DisputeAnalysisRequest(query="a" * 2001)

    def test_query_boundary_length_10_is_valid(self) -> None:
        """query 길이 정확히 10자는 유효 확인"""
        req = DisputeAnalysisRequest(query="가나다라마바사아자차")  # 10자
        assert len(req.query) == 10

    def test_optional_fields_accepted(self) -> None:
        """선택 필드 설정 확인"""
        req = DisputeAnalysisRequest(
            query="보험금 청구 거절에 대한 이의제기 방법이 궁금합니다.",
            dispute_type=DisputeType.CLAIM_DENIAL,
            insurance_type="실손의료보험",
            policy_id=uuid4(),
        )
        assert req.dispute_type == DisputeType.CLAIM_DENIAL


class TestDisputeAnalysisResponse:
    """DisputeAnalysisResponse 스키마 검증"""

    def _make_response(self, **kwargs) -> DisputeAnalysisResponse:
        """기본 유효 응답 생성 헬퍼"""
        defaults = {
            "dispute_type": DisputeType.CLAIM_DENIAL,
            "disclaimer": "본 내용은 법적 조언이 아닙니다.",
            "confidence": 0.75,
        }
        defaults.update(kwargs)
        return DisputeAnalysisResponse(**defaults)

    def test_valid_minimal_response(self) -> None:
        """최소 필드로 유효한 응답 생성 확인"""
        resp = self._make_response()
        assert resp.dispute_type == DisputeType.CLAIM_DENIAL

    def test_list_fields_default_to_empty(self) -> None:
        """리스트 필드 기본값이 빈 리스트인지 확인"""
        resp = self._make_response()
        assert resp.ambiguous_clauses == []
        assert resp.precedents == []

    def test_optional_complex_fields_default_to_none(self) -> None:
        """optional 복합 필드 기본값 None 확인"""
        resp = self._make_response()
        assert resp.probability is None
        assert resp.evidence_strategy is None
        assert resp.escalation is None

    def test_confidence_range_validation(self) -> None:
        """confidence 0.0~1.0 범위 검증"""
        with pytest.raises(ValidationError):
            self._make_response(confidence=1.5)

    def test_full_response_construction(self) -> None:
        """전체 필드를 갖춘 응답 생성 확인"""
        resp = DisputeAnalysisResponse(
            dispute_type=DisputeType.COVERAGE_DISPUTE,
            ambiguous_clauses=[
                AmbiguousClause(
                    clause_text="통원 치료",
                    ambiguity_reason="통원 범위 불명확",
                    consumer_favorable_interpretation="모든 통원 포함",
                    insurer_favorable_interpretation="입원 후 통원만 포함",
                    recommendation="소비자 유리 해석",
                )
            ],
            precedents=[],
            probability=ProbabilityScore(
                overall_score=0.7,
                confidence=0.8,
                disclaimer="법적 효력 없음",
            ),
            evidence_strategy=EvidenceStrategy(required_documents=["진단서"]),
            escalation=EscalationRecommendation(
                recommended_level=EscalationLevel.FSS_COMPLAINT,
                reason="보험사 민원 거부",
            ),
            disclaimer="법적 조언 아님",
            confidence=0.75,
        )
        assert resp.dispute_type == DisputeType.COVERAGE_DISPUTE
        assert len(resp.ambiguous_clauses) == 1


class TestCasePrecedentResponse:
    """CasePrecedentResponse 스키마 검증"""

    def test_valid_case_precedent_response(self) -> None:
        """유효한 CasePrecedentResponse 생성 확인"""
        resp = CasePrecedentResponse(
            id=uuid4(),
            case_number="2023다56789",
            court_name="대법원",
            decision_date=date(2023, 6, 15),
            case_type="보험금청구",
            insurance_type="실손의료보험",
            summary="보험금 지급 거절 판례",
            ruling="약관 불명확 시 소비자 유리 해석",
            source_url="https://example.com/case/2023",
        )
        assert resp.case_number == "2023다56789"

    def test_optional_fields_can_be_none(self) -> None:
        """insurance_type, source_url이 None 가능한지 확인"""
        resp = CasePrecedentResponse(
            id=uuid4(),
            case_number="2023다56789",
            court_name="대법원",
            decision_date=date(2023, 6, 15),
            case_type="보험금청구",
            insurance_type=None,
            summary="요약",
            ruling="판결",
            source_url=None,
        )
        assert resp.insurance_type is None
        assert resp.source_url is None
