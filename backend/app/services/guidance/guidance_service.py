"""분쟁 가이던스 오케스트레이터 서비스

SPEC-GUIDANCE-001 Phase G5: 모든 하위 서비스를 조합하여 통합 분쟁 분석 제공.
"""
from __future__ import annotations

import logging
from datetime import date
from typing import TYPE_CHECKING

from app.schemas.guidance import (
    DisputeAnalysisResponse,
    DisputeType,
    PrecedentSummary,
)
from app.services.guidance.disclaimer import DisclaimerGenerator
from app.services.guidance.dispute_detector import DisputeDetector
from app.services.guidance.escalation_advisor import EscalationAdvisor
from app.services.guidance.evidence_advisor import EvidenceAdvisor
from app.services.guidance.probability_scorer import ProbabilityScorer

if TYPE_CHECKING:
    from app.services.guidance.precedent_service import PrecedentService

logger = logging.getLogger(__name__)


class GuidanceService:
    """분쟁 가이던스 통합 오케스트레이터

    하위 서비스들을 순차적으로 호출하여
    종합적인 분쟁 분석 결과를 생성합니다.
    """

    # @MX:ANCHOR: [AUTO] GuidanceService는 분쟁 가이던스 파이프라인의 최상위 오케스트레이터
    # @MX:REASON: API 라우터, 테스트 등 여러 곳에서 이 클래스의 analyze_dispute 를 호출

    def __init__(
        self,
        dispute_detector: DisputeDetector,
        precedent_service: PrecedentService,
        probability_scorer: ProbabilityScorer,
        evidence_advisor: EvidenceAdvisor,
        escalation_advisor: EscalationAdvisor,
    ) -> None:
        self._dispute_detector = dispute_detector
        self._precedent_service = precedent_service
        self._probability_scorer = probability_scorer
        self._evidence_advisor = evidence_advisor
        self._escalation_advisor = escalation_advisor

    async def analyze_dispute(
        self,
        query: str,
        dispute_type: DisputeType | None = None,
        insurance_type: str | None = None,
    ) -> DisputeAnalysisResponse:
        """종합 분쟁 분석 수행

        1. 분쟁 유형 감지 (미제공 시)
        2. 관련 판례 검색
        3. 약관 모호성 분석 (판례에서 약관 텍스트 추출)
        4. 승소 확률 예측
        5. 증거 전략 자문
        6. 에스컬레이션 단계 권장

        Args:
            query: 분쟁 상황 설명
            dispute_type: 분쟁 유형 (None 이면 자동 감지)
            insurance_type: 보험 유형 필터

        Returns:
            DisputeAnalysisResponse
        """
        # 1. 분쟁 유형 감지
        if dispute_type is None:
            detected_type, type_confidence, _ = await self._dispute_detector.detect_dispute_type(query)
            dispute_type = detected_type
        else:
            type_confidence = 1.0

        # 2. 판례 검색
        precedent_results = await self._precedent_service.hybrid_search(
            query=query,
            top_k=5,
            insurance_type=insurance_type,
        )

        precedent_summaries = [
            PrecedentSummary(
                case_number=p["case_number"],
                court_name=p["court_name"],
                decision_date=(
                    p["decision_date"]
                    if isinstance(p["decision_date"], date)
                    else date.fromisoformat(str(p["decision_date"]))
                ),
                summary=p["summary"],
                relevance_score=min(
                    1.0,
                    max(0.0, p.get("relevance_score", p.get("similarity", 0.0)) or 0.0),
                ),
                key_ruling=p["ruling"],
            )
            for p in precedent_results
        ]

        # 3. 약관 모호성 분석 (판례의 ruling 에서 약관 관련 텍스트 추출)
        clause_texts = [p["ruling"] for p in precedent_results if p.get("ruling")]
        ambiguous_clauses = await self._dispute_detector.analyze_ambiguous_clauses(
            query=query,
            clause_texts=clause_texts[:3],  # 상위 3개만
        )

        # 4. 승소 확률 예측
        precedent_text_summaries = [p["summary"] for p in precedent_results]
        clause_analysis_texts = [c.clause_text for c in ambiguous_clauses]

        probability = await self._probability_scorer.predict(
            query=query,
            dispute_type=dispute_type,
            precedent_summaries=precedent_text_summaries,
            clause_analysis=clause_analysis_texts,
        )

        # 5. 증거 전략
        evidence = await self._evidence_advisor.advise(
            query=query,
            dispute_type=dispute_type,
        )

        # 6. 에스컬레이션
        escalation = await self._escalation_advisor.recommend(
            query=query,
            dispute_type=dispute_type,
            probability_score=probability.overall_score,
        )

        return DisputeAnalysisResponse(
            dispute_type=dispute_type,
            ambiguous_clauses=ambiguous_clauses,
            precedents=precedent_summaries,
            probability=probability,
            evidence_strategy=evidence,
            escalation=escalation,
            disclaimer=DisclaimerGenerator.get_general_disclaimer(),
            confidence=type_confidence,
        )
