"""분쟁 가이던스 API 라우터

SPEC-GUIDANCE-001 Phase G5: 분쟁 분석 및 판례 검색 API 엔드포인트.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.schemas.guidance import (
    CasePrecedentResponse,
    DisputeAnalysisRequest,
    DisputeAnalysisResponse,
    PrecedentSummary,
)
from app.services.guidance.disclaimer import DisclaimerGenerator
from app.services.guidance.dispute_detector import DisputeDetector
from app.services.guidance.escalation_advisor import EscalationAdvisor
from app.services.guidance.evidence_advisor import EvidenceAdvisor
from app.services.guidance.guidance_service import GuidanceService
from app.services.guidance.precedent_service import PrecedentService
from app.services.guidance.probability_scorer import ProbabilityScorer
from app.services.rag.embeddings import EmbeddingService

router = APIRouter(prefix="/guidance", tags=["guidance"])


def _get_guidance_service(
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> GuidanceService:
    """GuidanceService 의존성 주입 팩토리"""
    openai_client = AsyncOpenAI(api_key=settings.openai_api_key or "dummy")

    # EmbeddingService 초기화
    embedding_service = None
    if settings.openai_api_key:
        embedding_service = EmbeddingService(
            api_key=settings.openai_api_key,
            model=settings.embedding_model,
            dimensions=settings.embedding_dimensions,
        )

    precedent_service = PrecedentService(
        session=db,
        embedding_service=embedding_service,
    )

    model = getattr(settings, "llm_classifier_model", "gpt-4o-mini")

    return GuidanceService(
        dispute_detector=DisputeDetector(client=openai_client, model=model),
        precedent_service=precedent_service,
        probability_scorer=ProbabilityScorer(client=openai_client, model=model),
        evidence_advisor=EvidenceAdvisor(client=openai_client, model=model),
        escalation_advisor=EscalationAdvisor(client=openai_client, model=model),
    )


def _get_precedent_service(
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> PrecedentService:
    """PrecedentService 의존성 주입 팩토리"""
    embedding_service = None
    if settings.openai_api_key:
        embedding_service = EmbeddingService(
            api_key=settings.openai_api_key,
            model=settings.embedding_model,
            dimensions=settings.embedding_dimensions,
        )
    return PrecedentService(session=db, embedding_service=embedding_service)


@router.post(
    "/analyze",
    response_model=DisputeAnalysisResponse,
    status_code=200,
    summary="분쟁 종합 분석",
)
async def analyze_dispute(
    body: DisputeAnalysisRequest,
    guidance_service: GuidanceService = Depends(_get_guidance_service),
) -> DisputeAnalysisResponse:
    """보험 분쟁 상황을 종합 분석합니다.

    분쟁 유형 감지, 관련 판례 검색, 약관 모호성 분석,
    승소 확률 예측, 증거 전략, 에스컬레이션 권장을 포함한
    종합 분석 결과를 반환합니다.
    """
    return await guidance_service.analyze_dispute(
        query=body.query,
        dispute_type=body.dispute_type,
        insurance_type=body.insurance_type,
    )


@router.get(
    "/precedents/search",
    response_model=list[PrecedentSummary],
    status_code=200,
    summary="판례 검색",
)
async def search_precedents(
    query: str,
    top_k: int = 5,
    case_type: str | None = None,
    insurance_type: str | None = None,
    precedent_service: PrecedentService = Depends(_get_precedent_service),
) -> list[PrecedentSummary]:
    """키워드 또는 벡터 유사도 기반으로 판례를 검색합니다."""
    from datetime import date as date_type

    results = await precedent_service.hybrid_search(
        query=query,
        top_k=top_k,
        case_type=case_type,
        insurance_type=insurance_type,
    )

    return [
        PrecedentSummary(
            case_number=r["case_number"],
            court_name=r["court_name"],
            decision_date=(
                r["decision_date"]
                if isinstance(r["decision_date"], date_type)
                else date_type.fromisoformat(str(r["decision_date"]))
            ),
            summary=r["summary"],
            relevance_score=min(
                1.0,
                max(0.0, r.get("relevance_score", r.get("similarity", 0.0)) or 0.0),
            ),
            key_ruling=r["ruling"],
        )
        for r in results
    ]


@router.get(
    "/precedents/{precedent_id}",
    response_model=CasePrecedentResponse,
    status_code=200,
    summary="판례 상세 조회",
)
async def get_precedent(
    precedent_id: uuid.UUID,
    precedent_service: PrecedentService = Depends(_get_precedent_service),
) -> CasePrecedentResponse:
    """판례 상세 정보를 조회합니다."""
    result = await precedent_service.get_by_id(precedent_id)
    if result is None:
        raise HTTPException(status_code=404, detail="판례를 찾을 수 없습니다.")

    return CasePrecedentResponse(
        id=result["id"],
        case_number=result["case_number"],
        court_name=result["court_name"],
        decision_date=result["decision_date"],
        case_type=result["case_type"],
        insurance_type=result.get("insurance_type"),
        summary=result["summary"],
        ruling=result["ruling"],
        source_url=result.get("source_url"),
    )


@router.get(
    "/disclaimer",
    status_code=200,
    summary="면책 고지 조회",
)
async def get_disclaimers() -> dict:
    """모든 면책 고지문을 조회합니다."""
    return {
        "general": DisclaimerGenerator.get_general_disclaimer(),
        "probability": DisclaimerGenerator.get_probability_disclaimer(),
        "precedent": DisclaimerGenerator.get_precedent_disclaimer(),
        "escalation": DisclaimerGenerator.get_escalation_disclaimer(),
    }
