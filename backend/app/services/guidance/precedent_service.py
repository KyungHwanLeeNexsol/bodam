"""판례 검색 서비스

SPEC-GUIDANCE-001 Phase G2: 벡터 + 키워드 하이브리드 판례 검색.
"""
from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import or_, select

from app.models.case_precedent import CasePrecedent

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.services.rag.embeddings import EmbeddingService

logger = logging.getLogger(__name__)


class PrecedentService:
    """판례 검색 서비스

    벡터 유사도 검색과 키워드 검색을 결합하여
    분쟁 상황에 맞는 관련 판례를 검색.
    """

    # # @MX:ANCHOR: [AUTO] PrecedentService는 가이던스 파이프라인의 핵심 판례 검색 서비스
    # # @MX:REASON: 분쟁 가이던스, 확률 예측, 증거 전략 등 여러 서비스가 이 클래스를 사용

    def __init__(
        self,
        session: AsyncSession,
        embedding_service: EmbeddingService,
    ) -> None:
        self._session = session
        self._embedding_service = embedding_service

    async def search_by_vector(
        self,
        query: str,
        top_k: int = 5,
        threshold: float = 0.8,
        case_type: str | None = None,
        insurance_type: str | None = None,
    ) -> list[dict]:
        """벡터 유사도 기반 판례 검색

        쿼리를 임베딩으로 변환 후 CasePrecedent 테이블에서
        코사인 거리가 가장 가까운 판례 반환.

        Args:
            query: 검색 쿼리 텍스트
            top_k: 반환할 최대 결과 수
            threshold: 최대 코사인 거리 임계값
            case_type: 사건 유형 필터
            insurance_type: 보험 유형 필터

        Returns:
            검색 결과 딕셔너리 리스트:
            - id: 판례 UUID
            - case_number: 판례 번호
            - court_name: 법원명
            - decision_date: 판결일
            - case_type: 사건 유형
            - insurance_type: 보험 유형
            - summary: 판례 요약
            - ruling: 판결 요지
            - similarity: 코사인 유사도 (1 - distance)
            - source_url: 출처 URL
        """
        query_embedding = await self._embedding_service.embed_text(query)
        if not query_embedding:
            logger.warning("쿼리 임베딩 생성 실패: %r", query)
            return []

        distance_col = CasePrecedent.embedding.cosine_distance(query_embedding)

        stmt = (
            select(
                CasePrecedent.id,
                CasePrecedent.case_number,
                CasePrecedent.court_name,
                CasePrecedent.decision_date,
                CasePrecedent.case_type,
                CasePrecedent.insurance_type,
                CasePrecedent.summary,
                CasePrecedent.ruling,
                CasePrecedent.source_url,
                distance_col.label("distance"),
            )
            .where(distance_col <= threshold)
            .order_by(distance_col)
            .limit(top_k)
        )

        if case_type is not None:
            stmt = stmt.where(CasePrecedent.case_type == case_type)
        if insurance_type is not None:
            stmt = stmt.where(CasePrecedent.insurance_type == insurance_type)

        result = await self._session.execute(stmt)
        rows = result.all()

        return [
            {
                "id": row.id,
                "case_number": row.case_number,
                "court_name": row.court_name,
                "decision_date": row.decision_date,
                "case_type": row.case_type,
                "insurance_type": row.insurance_type,
                "summary": row.summary,
                "ruling": row.ruling,
                "similarity": 1.0 - float(row.distance),
                "source_url": row.source_url,
            }
            for row in rows
        ]

    async def search_by_keyword(
        self,
        keyword: str,
        top_k: int = 10,
        case_type: str | None = None,
        insurance_type: str | None = None,
    ) -> list[dict]:
        """키워드 기반 판례 검색

        summary, ruling 텍스트에서 키워드를 ILIKE로 검색.

        Args:
            keyword: 검색 키워드
            top_k: 반환할 최대 결과 수
            case_type: 사건 유형 필터
            insurance_type: 보험 유형 필터

        Returns:
            검색 결과 딕셔너리 리스트
        """
        like_pattern = f"%{keyword}%"

        stmt = (
            select(
                CasePrecedent.id,
                CasePrecedent.case_number,
                CasePrecedent.court_name,
                CasePrecedent.decision_date,
                CasePrecedent.case_type,
                CasePrecedent.insurance_type,
                CasePrecedent.summary,
                CasePrecedent.ruling,
                CasePrecedent.source_url,
            )
            .where(
                or_(
                    CasePrecedent.summary.ilike(like_pattern),
                    CasePrecedent.ruling.ilike(like_pattern),
                )
            )
            .order_by(CasePrecedent.decision_date.desc())
            .limit(top_k)
        )

        if case_type is not None:
            stmt = stmt.where(CasePrecedent.case_type == case_type)
        if insurance_type is not None:
            stmt = stmt.where(CasePrecedent.insurance_type == insurance_type)

        result = await self._session.execute(stmt)
        rows = result.all()

        return [
            {
                "id": row.id,
                "case_number": row.case_number,
                "court_name": row.court_name,
                "decision_date": row.decision_date,
                "case_type": row.case_type,
                "insurance_type": row.insurance_type,
                "summary": row.summary,
                "ruling": row.ruling,
                "similarity": None,  # 키워드 검색은 유사도 없음
                "source_url": row.source_url,
            }
            for row in rows
        ]

    async def hybrid_search(
        self,
        query: str,
        top_k: int = 5,
        vector_weight: float = 0.7,
        keyword_weight: float = 0.3,
        threshold: float = 0.8,
        case_type: str | None = None,
        insurance_type: str | None = None,
    ) -> list[dict]:
        """하이브리드 검색 (벡터 + 키워드 결합)

        벡터 유사도 검색과 키워드 검색을 결합하여
        가중 합산으로 최종 관련도 점수 계산.

        Args:
            query: 검색 쿼리 텍스트
            top_k: 반환할 최대 결과 수
            vector_weight: 벡터 검색 가중치 (기본: 0.7)
            keyword_weight: 키워드 검색 가중치 (기본: 0.3)
            threshold: 벡터 검색 코사인 거리 임계값
            case_type: 사건 유형 필터
            insurance_type: 보험 유형 필터

        Returns:
            결합된 검색 결과 (relevance_score 포함)
        """
        # 벡터 검색 (더 많은 후보 확보)
        vector_results = await self.search_by_vector(
            query=query,
            top_k=top_k * 2,
            threshold=threshold,
            case_type=case_type,
            insurance_type=insurance_type,
        )

        # 키워드 검색 (주요 키워드 추출하여 검색)
        keywords = self._extract_keywords(query)
        keyword_results = []
        for kw in keywords[:3]:  # 상위 3개 키워드
            kw_results = await self.search_by_keyword(
                keyword=kw,
                top_k=top_k * 2,
                case_type=case_type,
                insurance_type=insurance_type,
            )
            keyword_results.extend(kw_results)

        # 결과 병합 및 점수 계산
        merged = self._merge_results(
            vector_results=vector_results,
            keyword_results=keyword_results,
            vector_weight=vector_weight,
            keyword_weight=keyword_weight,
        )

        # 점수순 정렬 후 top_k 반환
        merged.sort(key=lambda x: x["relevance_score"], reverse=True)
        return merged[:top_k]

    async def get_by_id(self, precedent_id: uuid.UUID) -> dict | None:
        """ID로 판례 단건 조회

        Args:
            precedent_id: 판례 UUID

        Returns:
            판례 딕셔너리 또는 None
        """
        stmt = select(CasePrecedent).where(CasePrecedent.id == precedent_id)
        result = await self._session.execute(stmt)
        row = result.scalar_one_or_none()

        if row is None:
            return None

        return {
            "id": row.id,
            "case_number": row.case_number,
            "court_name": row.court_name,
            "decision_date": row.decision_date,
            "case_type": row.case_type,
            "insurance_type": row.insurance_type,
            "summary": row.summary,
            "ruling": row.ruling,
            "key_clauses": row.key_clauses,
            "source_url": row.source_url,
        }

    async def get_by_case_number(self, case_number: str) -> dict | None:
        """판례 번호로 조회

        Args:
            case_number: 판례 번호

        Returns:
            판례 딕셔너리 또는 None
        """
        stmt = select(CasePrecedent).where(CasePrecedent.case_number == case_number)
        result = await self._session.execute(stmt)
        row = result.scalar_one_or_none()

        if row is None:
            return None

        return {
            "id": row.id,
            "case_number": row.case_number,
            "court_name": row.court_name,
            "decision_date": row.decision_date,
            "case_type": row.case_type,
            "insurance_type": row.insurance_type,
            "summary": row.summary,
            "ruling": row.ruling,
            "key_clauses": row.key_clauses,
            "source_url": row.source_url,
        }

    def _extract_keywords(self, query: str) -> list[str]:
        """쿼리에서 주요 키워드 추출

        한국어 불용어 제거 후 2자 이상 단어 반환.

        Args:
            query: 원본 쿼리

        Returns:
            키워드 리스트 (길이순 내림차순)
        """
        # 한국어 불용어 목록
        stop_words = {
            "그", "이", "저", "것", "수", "등", "때", "중",
            "의", "를", "에", "가", "은", "는", "로", "와", "과",
            "한", "할", "하는", "된", "되는", "하여", "위해",
            "있는", "없는", "합니다", "됩니다", "입니다",
            "보험", "보험금", "청구", "분쟁",  # 도메인 공통어 (너무 일반적)
        }

        # 공백으로 분리 후 2자 이상, 불용어 제외
        words = query.split()
        keywords = [w for w in words if len(w) >= 2 and w not in stop_words]

        # 길이순 내림차순 (긴 단어가 더 구체적)
        keywords.sort(key=len, reverse=True)
        return keywords

    def _merge_results(
        self,
        vector_results: list[dict],
        keyword_results: list[dict],
        vector_weight: float,
        keyword_weight: float,
    ) -> list[dict]:
        """벡터 + 키워드 검색 결과 병합

        동일 판례를 ID로 병합하고 가중 합산 점수 계산.

        Args:
            vector_results: 벡터 검색 결과
            keyword_results: 키워드 검색 결과
            vector_weight: 벡터 검색 가중치
            keyword_weight: 키워드 검색 가중치

        Returns:
            병합된 결과 리스트 (relevance_score 포함)
        """
        merged: dict[uuid.UUID, dict] = {}

        # 벡터 결과 추가
        for item in vector_results:
            item_id = item["id"]
            if item_id not in merged:
                merged[item_id] = {**item, "relevance_score": 0.0, "keyword_match": False}
            similarity = item.get("similarity") or 0.0
            merged[item_id]["relevance_score"] += similarity * vector_weight

        # 키워드 결과 추가
        for item in keyword_results:
            item_id = item["id"]
            if item_id not in merged:
                merged[item_id] = {**item, "relevance_score": 0.0, "keyword_match": True}
            else:
                merged[item_id]["keyword_match"] = True
            merged[item_id]["relevance_score"] += keyword_weight

        return list(merged.values())
