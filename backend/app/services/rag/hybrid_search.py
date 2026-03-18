"""하이브리드 검색 서비스 모듈 (SPEC-PIPELINE-001 REQ-11, REQ-12, REQ-13)

pgvector 의미론적 검색 + tsvector 키워드 검색을 RRF 알고리즘으로 결합.
REQ-11: RRF 공식 = 1 / (k + rank), k=60
REQ-12: 회사 코드, 판매 상태 기반 메타데이터 필터링 지원
REQ-13: vector_score, keyword_score, combined_score 반환
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# RRF 기본 상수 (k=60은 논문 기반 표준값)
DEFAULT_RRF_K = 60


def compute_rrf_score(rank: int, k: int = DEFAULT_RRF_K) -> float:
    """RRF(Reciprocal Rank Fusion) 점수 계산

    RRF 공식: score = 1 / (k + rank)
    rank는 1부터 시작 (1 = 최상위 결과).

    Args:
        rank: 결과 순위 (1-based, 낮을수록 좋음)
        k: RRF 상수 (기본값: 60, 논문 기반 표준값)

    Returns:
        RRF 점수 (0 < score <= 1/(k+1))
    """
    return 1.0 / (k + rank)


def fuse_ranked_results(
    vector_results: list[dict],
    keyword_results: list[dict],
    k: int = DEFAULT_RRF_K,
) -> list[dict]:
    """벡터 검색 결과와 키워드 검색 결과를 RRF로 결합

    각 리스트의 순위 기반으로 RRF 점수를 계산하여 결합.
    동일한 chunk_id는 두 점수를 합산(중복 제거).
    결과는 combined_score 내림차순으로 정렬.

    Args:
        vector_results: 벡터 검색 결과 리스트.
            각 항목은 최소 {chunk_id, score, text} 포함.
        keyword_results: 키워드 검색 결과 리스트.
            각 항목은 최소 {chunk_id, score, text} 포함.
        k: RRF 상수 (기본값: 60)

    Returns:
        결합된 검색 결과 리스트. 각 항목:
        - chunk_id: 청크 ID
        - text: 청크 원문
        - vector_score: 벡터 검색 RRF 점수 (없으면 0.0)
        - keyword_score: 키워드 검색 RRF 점수 (없으면 0.0)
        - combined_score: 두 점수의 합
        - 원본 메타데이터 필드 (policy_id, policy_name 등)
    """
    # chunk_id 기준으로 점수 누적 딕셔너리
    fused: dict[str, dict] = {}

    # 벡터 검색 결과 처리 (순위 1-based)
    for rank, result in enumerate(vector_results, start=1):
        chunk_id = result["chunk_id"]
        rrf_score = compute_rrf_score(rank=rank, k=k)

        if chunk_id not in fused:
            # 원본 결과의 메타데이터 복사 (chunk_id, text, policy_id 등)
            fused[chunk_id] = {key: val for key, val in result.items()}
            fused[chunk_id]["vector_score"] = rrf_score
            fused[chunk_id]["keyword_score"] = 0.0
        else:
            fused[chunk_id]["vector_score"] += rrf_score

    # 키워드 검색 결과 처리 (순위 1-based)
    for rank, result in enumerate(keyword_results, start=1):
        chunk_id = result["chunk_id"]
        rrf_score = compute_rrf_score(rank=rank, k=k)

        if chunk_id not in fused:
            fused[chunk_id] = {key: val for key, val in result.items()}
            fused[chunk_id]["vector_score"] = 0.0
            fused[chunk_id]["keyword_score"] = rrf_score
        else:
            fused[chunk_id]["keyword_score"] = fused[chunk_id].get("keyword_score", 0.0) + rrf_score

    # combined_score 계산 및 정렬
    result_list = []
    for chunk_id, data in fused.items():
        data["combined_score"] = data["vector_score"] + data["keyword_score"]
        result_list.append(data)

    # combined_score 내림차순 정렬
    result_list.sort(key=lambda x: x["combined_score"], reverse=True)
    return result_list


class HybridSearchService:
    """하이브리드 검색 서비스 (REQ-11, REQ-12)

    pgvector 의미론적 검색 + tsvector 키워드 검색을 RRF로 결합.
    메타데이터 필터링(company_code, sale_status) 지원.
    각 결과에 vector_score, keyword_score, combined_score 포함 (REQ-13).
    """

    # @MX:ANCHOR: [AUTO] HybridSearchService는 검색 파이프라인의 핵심 진입점
    # @MX:REASON: RAG 체인, API 엔드포인트 등 여러 호출자가 이 클래스를 사용

    def __init__(self, db_session: AsyncSession) -> None:
        """HybridSearchService 초기화

        Args:
            db_session: SQLAlchemy 비동기 세션
        """
        self._session = db_session

    async def search(
        self,
        query: str,
        query_embedding: list[float],
        limit: int = 10,
        company_code: str | None = None,
        sale_status: str | None = None,
    ) -> list[dict]:
        """하이브리드 검색 실행

        벡터 검색과 키워드 검색을 각각 실행 후 RRF로 결합.
        메타데이터 필터(company_code, sale_status) 적용.

        Args:
            query: 검색 쿼리 텍스트 (키워드 검색용)
            query_embedding: 쿼리 임베딩 벡터 (벡터 검색용)
            limit: 최종 반환할 최대 결과 수 (기본값: 10)
            company_code: 보험사 코드 필터 (None: 전체)
            sale_status: 판매 상태 필터 (None: 전체)

        Returns:
            결합된 검색 결과 리스트 (REQ-13 점수 필드 포함)
        """
        # 각 검색에서 충분한 후보 확보를 위해 limit * 3 사용
        candidate_limit = limit * 3

        # 벡터 검색 실행
        vector_results = await self._vector_search(
            query_embedding=query_embedding,
            limit=candidate_limit,
            company_code=company_code,
            sale_status=sale_status,
        )

        # 키워드 검색 실행
        from app.services.rag.fulltext_search import FulltextSearchService

        fulltext_service = FulltextSearchService(db_session=self._session)
        keyword_results = await fulltext_service.search(
            query=query,
            limit=candidate_limit,
            company_code=company_code,
            sale_status=sale_status,
        )

        # RRF로 결과 결합
        fused = fuse_ranked_results(
            vector_results=vector_results,
            keyword_results=keyword_results,
            k=DEFAULT_RRF_K,
        )

        # limit 적용하여 반환
        return fused[:limit]

    async def _vector_search(
        self,
        query_embedding: list[float],
        limit: int,
        company_code: str | None = None,
        sale_status: str | None = None,
    ) -> list[dict]:
        """pgvector 코사인 거리 기반 벡터 검색 (내부 메서드)

        Args:
            query_embedding: 쿼리 임베딩 벡터
            limit: 반환할 최대 결과 수
            company_code: 보험사 코드 필터
            sale_status: 판매 상태 필터

        Returns:
            벡터 검색 결과 리스트
        """
        from sqlalchemy import text

        # pgvector 코사인 거리(<->) 기반 검색
        base_sql = """
            SELECT
                pc.id::text AS chunk_id,
                pc.chunk_text AS text,
                1 - (pc.embedding <=> CAST(:embedding AS vector)) AS score,
                p.id::text AS policy_id,
                p.name AS policy_name,
                ic.name AS company_name,
                ic.code AS company_code,
                p.sale_status
            FROM policy_chunks pc
            JOIN policies p ON pc.policy_id = p.id
            JOIN insurance_companies ic ON p.company_id = ic.id
            WHERE pc.embedding IS NOT NULL
        """

        params: dict = {
            "embedding": str(query_embedding),
            "limit": limit,
        }

        if company_code is not None:
            base_sql += " AND ic.code = :company_code"
            params["company_code"] = company_code

        if sale_status is not None:
            base_sql += " AND p.sale_status = :sale_status"
            params["sale_status"] = sale_status

        base_sql += " ORDER BY pc.embedding <=> CAST(:embedding AS vector) LIMIT :limit"

        try:
            result = await self._session.execute(text(base_sql), params)
            rows = result.fetchall()
            return [
                {
                    "chunk_id": row.chunk_id,
                    "text": row.text,
                    "score": float(row.score),
                    "policy_id": row.policy_id,
                    "policy_name": row.policy_name,
                    "company_name": row.company_name,
                }
                for row in rows
            ]
        except Exception:
            logger.exception("벡터 검색 실행 중 오류 발생")
            return []
