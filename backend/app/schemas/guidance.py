"""보험 분쟁 가이던스 Pydantic 스키마

SPEC-GUIDANCE-001 Phase G1: 분쟁 유형, 에스컬레이션 레벨,
분쟁 분석 요청/응답, 판례 응답 스키마 정의.
"""

from __future__ import annotations

from datetime import date
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field


class DisputeType(StrEnum):
    """보험 분쟁 유형"""

    # 보험금 지급 거절
    CLAIM_DENIAL = "claim_denial"
    # 보장 범위 분쟁
    COVERAGE_DISPUTE = "coverage_dispute"
    # 불완전판매
    INCOMPLETE_SALE = "incomplete_sale"
    # 보험료 분쟁
    PREMIUM_DISPUTE = "premium_dispute"
    # 계약 해지 분쟁
    CONTRACT_CANCEL = "contract_cancel"
    # 기타
    OTHER = "other"


class EscalationLevel(StrEnum):
    """분쟁 에스컬레이션 단계"""

    # 자체 해결
    SELF_RESOLUTION = "self_resolution"
    # 보험사 민원
    COMPANY_COMPLAINT = "company_complaint"
    # 금감원 민원
    FSS_COMPLAINT = "fss_complaint"
    # 분쟁조정
    DISPUTE_MEDIATION = "dispute_mediation"
    # 법적 소송
    LEGAL_ACTION = "legal_action"


class AmbiguousClause(BaseModel):
    """모호한 약관 조항 분석 결과"""

    # 모호한 약관 조항 텍스트
    clause_text: str = Field(..., description="모호한 약관 조항 텍스트")
    # 모호성 근거
    ambiguity_reason: str = Field(..., description="모호성 근거")
    # 소비자 유리 해석
    consumer_favorable_interpretation: str = Field(..., description="소비자 유리 해석")
    # 보험사 유리 해석
    insurer_favorable_interpretation: str = Field(..., description="보험사 유리 해석")
    # 권장 해석 방향
    recommendation: str = Field(..., description="권장 해석 방향")


class PrecedentSummary(BaseModel):
    """관련 판례 요약"""

    # 판례 번호
    case_number: str = Field(..., description="판례 번호")
    # 법원명
    court_name: str = Field(..., description="법원명")
    # 판결일
    decision_date: date = Field(..., description="판결일")
    # 판례 요약
    summary: str = Field(..., description="판례 요약")
    # 관련도 점수 (0.0~1.0)
    relevance_score: float = Field(..., ge=0.0, le=1.0, description="관련도 점수")
    # 핵심 판결 요지
    key_ruling: str = Field(..., description="핵심 판결 요지")


class ProbabilityScore(BaseModel):
    """승소 확률 예측 결과"""

    # 전체 승소 확률 (0.0~1.0)
    overall_score: float = Field(..., ge=0.0, le=1.0, description="전체 승소 확률")
    # 확률 산정 근거 요인
    factors: list[str] = Field(default_factory=list, description="확률 산정 근거 요인")
    # 예측 신뢰도 (0.0~1.0)
    confidence: float = Field(..., ge=0.0, le=1.0, description="예측 신뢰도")
    # 법적 면책 고지
    disclaimer: str = Field(..., description="법적 면책 고지")


class EvidenceStrategy(BaseModel):
    """증거 전략 가이드"""

    # 필수 증빙 서류
    required_documents: list[str] = Field(default_factory=list, description="필수 증빙 서류")
    # 권장 증빙 서류
    recommended_documents: list[str] = Field(default_factory=list, description="권장 증빙 서류")
    # 준비 요령
    preparation_tips: list[str] = Field(default_factory=list, description="준비 요령")
    # 시한 관련 조언
    timeline_advice: str = Field("", description="시한 관련 조언")


class EscalationRecommendation(BaseModel):
    """에스컬레이션 단계 권장"""

    # 권장 에스컬레이션 단계
    recommended_level: EscalationLevel = Field(..., description="권장 에스컬레이션 단계")
    # 권장 근거
    reason: str = Field(..., description="권장 근거")
    # 다음 단계
    next_steps: list[str] = Field(default_factory=list, description="다음 단계")
    # 예상 소요 기간
    estimated_duration: str = Field("", description="예상 소요 기간")
    # 예상 비용
    cost_estimate: str = Field("", description="예상 비용")


class DisputeAnalysisRequest(BaseModel):
    """분쟁 분석 요청"""

    # 분쟁 상황 설명 (10~2000자)
    query: str = Field(..., min_length=10, max_length=2000, description="분쟁 상황 설명")
    # 분쟁 유형 (자동 감지 가능)
    dispute_type: DisputeType | None = Field(None, description="분쟁 유형 (자동 감지 가능)")
    # 보험 유형
    insurance_type: str | None = Field(None, description="보험 유형")
    # 관련 보험 상품 ID
    policy_id: UUID | None = Field(None, description="관련 보험 상품 ID")


class DisputeAnalysisResponse(BaseModel):
    """분쟁 분석 응답"""

    # 감지된 분쟁 유형
    dispute_type: DisputeType = Field(..., description="감지된 분쟁 유형")
    # 모호한 약관 조항 분석
    ambiguous_clauses: list[AmbiguousClause] = Field(
        default_factory=list, description="모호한 약관 조항 분석"
    )
    # 관련 판례
    precedents: list[PrecedentSummary] = Field(default_factory=list, description="관련 판례")
    # 승소 확률 예측
    probability: ProbabilityScore | None = Field(None, description="승소 확률 예측")
    # 증거 전략
    evidence_strategy: EvidenceStrategy | None = Field(None, description="증거 전략")
    # 에스컬레이션 권장
    escalation: EscalationRecommendation | None = Field(None, description="에스컬레이션 권장")
    # 법적 면책 고지
    disclaimer: str = Field(..., description="법적 면책 고지")
    # 분석 신뢰도 (0.0~1.0)
    confidence: float = Field(..., ge=0.0, le=1.0, description="분석 신뢰도")


class CasePrecedentResponse(BaseModel):
    """판례 응답 스키마"""

    id: UUID
    case_number: str
    court_name: str
    decision_date: date
    case_type: str
    insurance_type: str | None
    summary: str
    ruling: str
    source_url: str | None
