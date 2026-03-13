"""벡터 검색 서비스 모듈 (TAG-017)

pgvector 코사인 거리를 사용하여 정책 청크를 의미론적으로 검색.
SQLAlchemy 비동기 세션과 EmbeddingService를 의존성 주입으로 사용.
"""

from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import select

from app.models.insurance import InsuranceCategory, InsuranceCompany, Policy, PolicyChunk

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.services.rag.embeddings import EmbeddingService

logger = logging.getLogger(__name__)


class VectorSearchService:
    """pgvector 기반 의미론적 유사도 검색 서비스

    쿼리 텍스트를 임베딩으로 변환 후 PolicyChunk 테이블에서
    코사인 거리가 가장 가까운 청크를 검색.
    보험사, 카테고리 필터 및 유사도 임계값 지원.
    """

    # # @MX:ANCHOR: [AUTO] VectorSearchService는 RAG 검색 파이프라인의 핵심 서비스
    # # @MX:REASON: 시맨틱 검색 API, 추천 시스템 등 여러 호출자가 이 클래스를 사용

    def __init__(
        self,
        session: AsyncSession,
        embedding_service: EmbeddingService,
    ) -> None:
        """VectorSearchService 초기화

        Args:
            session: SQLAlchemy 비동기 세션
            embedding_service: 텍스트 임베딩 생성 서비스
        """
        self._session = session
        self._embedding_service = embedding_service

    async def search(
        self,
        query: str,
        top_k: int = 5,
        threshold: float = 0.8,
        company_id: uuid.UUID | None = None,
        category: InsuranceCategory | None = None,
    ) -> list[dict]:
        """의미론적 유사도 기반 청크 검색

        쿼리를 임베딩으로 변환 후 PolicyChunk 테이블에서
        코사인 거리가 가장 가까운 top_k개의 청크 반환.

        Args:
            query: 검색 쿼리 텍스트
            top_k: 반환할 최대 결과 수 (기본값: 5)
            threshold: 최대 코사인 거리 임계값 (기본값: 0.8, 낮을수록 유사함)
            company_id: 특정 보험사 UUID로 필터링 (None: 전체)
            category: 보험 분류로 필터링 (None: 전체)

        Returns:
            검색 결과 딕셔너리 리스트. 각 항목:
            - chunk_id: 청크 UUID
            - policy_id: 상품 UUID
            - coverage_id: 보장 항목 UUID (없으면 None)
            - chunk_text: 청크 원문
            - chunk_index: 청크 순서
            - similarity: 코사인 유사도 (1 - 코사인 거리)
            - policy_name: 보험 상품명
            - company_name: 보험사명
        """
        # 1단계: 쿼리 텍스트를 임베딩 벡터로 변환
        query_embedding = await self._embedding_service.embed_text(query)

        if not query_embedding:
            logger.warning("쿼리 임베딩 생성 실패: %r", query)
            return []

        # 2단계: pgvector 코사인 거리 기반 SQL 쿼리 구성
        rows = await self._execute_search_query(
            query_embedding=query_embedding,
            top_k=top_k,
            threshold=threshold,
            company_id=company_id,
            category=category,
        )

        # 3단계: 결과 딕셔너리로 변환
        return self._rows_to_dicts(rows)

    async def _execute_search_query(
        self,
        query_embedding: list[float],
        top_k: int,
        threshold: float,
        company_id: uuid.UUID | None,
        category: InsuranceCategory | None,
    ) -> list:
        """pgvector 코사인 거리 쿼리 실행 (내부 메서드)

        PolicyChunk → Policy → InsuranceCompany 조인으로
        메타데이터 포함 검색 결과 반환.

        Args:
            query_embedding: 쿼리 임베딩 벡터
            top_k: 반환할 최대 결과 수
            threshold: 최대 코사인 거리 임계값
            company_id: 보험사 UUID 필터
            category: 보험 분류 필터

        Returns:
            SQLAlchemy Row 객체 리스트
        """
        # 코사인 거리 계산 컬럼 (pgvector <-> 연산자)
        distance_col = PolicyChunk.embedding.cosine_distance(query_embedding)

        # 기본 쿼리 구성
        stmt = (
            select(
                PolicyChunk.id.label("chunk_id"),
                PolicyChunk.chunk_text,
                PolicyChunk.chunk_index,
                PolicyChunk.coverage_id,
                distance_col.label("distance"),
                Policy.id.label("policy_id"),
                Policy.name.label("policy_name"),
                Policy.category,
                InsuranceCompany.name.label("company_name"),
            )
            .join(Policy, PolicyChunk.policy_id == Policy.id)
            .join(InsuranceCompany, Policy.company_id == InsuranceCompany.id)
            .where(distance_col <= threshold)
            .order_by(distance_col)
            .limit(top_k)
        )

        # 선택적 필터 적용
        if company_id is not None:
            stmt = stmt.where(Policy.company_id == company_id)

        if category is not None:
            stmt = stmt.where(Policy.category == category)

        result = await self._session.execute(stmt)
        return result.all()

    def _rows_to_dicts(self, rows: list) -> list[dict]:
        """SQLAlchemy Row 리스트를 딕셔너리 리스트로 변환 (내부 메서드)

        distance를 similarity (1 - distance)로 변환.

        Args:
            rows: SQLAlchemy Row 객체 리스트

        Returns:
            결과 딕셔너리 리스트
        """
        results = []
        for row in rows:
            # 코사인 거리 → 코사인 유사도 변환
            similarity = 1.0 - float(row.distance)

            results.append(
                {
                    "chunk_id": row.chunk_id,
                    "policy_id": row.policy_id,
                    "coverage_id": row.coverage_id,
                    "chunk_text": row.chunk_text,
                    "chunk_index": row.chunk_index,
                    "similarity": similarity,
                    "policy_name": row.policy_name,
                    "company_name": row.company_name,
                }
            )
        return results
