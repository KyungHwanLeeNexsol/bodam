"""시맨틱 검색 API 라우터 (TAG-017)

POST /api/v1/search/semantic 엔드포인트 제공.
VectorSearchService와 EmbeddingService를 의존성 주입으로 사용.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.schemas.insurance import SearchResult, SemanticSearchRequest, SemanticSearchResponse
from app.services.rag.embeddings import EmbeddingService
from app.services.rag.vector_store import VectorSearchService

router = APIRouter(prefix="/search", tags=["search"])


# # @MX:ANCHOR: [AUTO] get_embedding_service는 검색 엔드포인트의 임베딩 서비스 DI 공급자
# # @MX:REASON: 검색 API와 향후 추가될 엔드포인트 모두 이 의존성을 재사용


async def get_embedding_service(
    settings: Annotated[Settings, Depends(get_settings)],
) -> EmbeddingService:
    """EmbeddingService 의존성 공급자

    FastAPI DI 컨테이너에서 설정 기반으로 EmbeddingService를 생성.

    Args:
        settings: 애플리케이션 설정

    Returns:
        EmbeddingService 인스턴스
    """
    return EmbeddingService(
        api_key=settings.openai_api_key,
        model=settings.embedding_model,
        dimensions=settings.embedding_dimensions,
    )


@router.post("/semantic", response_model=SemanticSearchResponse)
async def semantic_search(
    request: SemanticSearchRequest,
    session: Annotated[AsyncSession, Depends(get_db)],
    embedding_service: Annotated[EmbeddingService, Depends(get_embedding_service)],
) -> SemanticSearchResponse:
    """보험 약관 시맨틱 검색

    쿼리 텍스트를 임베딩으로 변환 후 pgvector 코사인 유사도 기반으로
    가장 관련성 높은 약관 청크를 반환.

    Args:
        request: 검색 요청 (query, top_k, threshold, 선택적 필터)
        session: 비동기 DB 세션 (FastAPI DI)
        embedding_service: 임베딩 서비스 (FastAPI DI)

    Returns:
        SemanticSearchResponse: 검색 결과 목록과 총 개수
    """
    # VectorSearchService 생성 (세션과 임베딩 서비스 주입)
    search_service = VectorSearchService(
        session=session,
        embedding_service=embedding_service,
    )

    # 검색 실행
    raw_results = await search_service.search(
        query=request.query,
        top_k=request.top_k,
        threshold=request.threshold,
        company_id=request.company_id,
        category=request.category,
    )

    # SearchResult 스키마로 변환
    results = [
        SearchResult(
            chunk_id=item["chunk_id"],
            policy_id=item["policy_id"],
            coverage_id=item.get("coverage_id"),
            chunk_text=item["chunk_text"],
            chunk_index=item.get("chunk_index", 0),
            similarity=item["similarity"],
            policy_name=item.get("policy_name"),
            company_name=item.get("company_name"),
        )
        for item in raw_results
    ]

    return SemanticSearchResponse(
        results=results,
        total=len(results),
        query=request.query,
    )
