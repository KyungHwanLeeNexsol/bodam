"""전문 검색(Full-Text Search) 서비스 모듈 (SPEC-PIPELINE-001 REQ-10)

tsvector 기반 PostgreSQL 전문 검색을 수행.
한국어 텍스트에는 simple 설정을 사용(한국어 전용 사전보다 호환성 우수).
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from sqlalchemy import text

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


def build_tsquery(query: str) -> str:
    """검색 쿼리 문자열을 tsquery 형식으로 변환

    공백으로 구분된 단어를 AND(&) 조건으로 연결.
    빈 문자열은 빈 문자열 반환.

    Args:
        query: 원본 검색 쿼리 문자열

    Returns:
        tsquery 형식 문자열 (예: "암 & 보험 & 보장")
        빈 입력의 경우 빈 문자열 반환
    """
    stripped = query.strip()
    if not stripped:
        return ""

    # 공백으로 분리 후 빈 토큰 제거
    tokens = [t for t in stripped.split() if t]
    if not tokens:
        return ""

    # AND 조건으로 결합
    return " & ".join(tokens)


class FulltextSearchService:
    """tsvector 기반 전문 검색 서비스

    PolicyChunk.search_vector 컬럼을 대상으로
    PostgreSQL 전문 검색 쿼리를 실행.
    simple 텍스트 설정을 사용하여 한국어 호환성 보장.
    """

    # @MX:ANCHOR: [AUTO] FulltextSearchService는 하이브리드 검색의 키워드 검색 컴포넌트
    # @MX:REASON: HybridSearchService 등 여러 호출자가 이 클래스에 의존

    def __init__(self, db_session: AsyncSession) -> None:
        """FulltextSearchService 초기화

        Args:
            db_session: SQLAlchemy 비동기 세션
        """
        self._session = db_session

    async def search(
        self,
        query: str,
        limit: int = 10,
        company_code: str | None = None,
        sale_status: str | None = None,
    ) -> list[dict]:
        """전문 검색 실행

        tsvector 기반 키워드 검색으로 PolicyChunk를 검색.
        search_vector 컬럼이 없는 경우 chunk_text를 직접 검색.

        Args:
            query: 검색 쿼리 텍스트
            limit: 반환할 최대 결과 수 (기본값: 10)
            company_code: 보험사 코드 필터 (None: 전체)
            sale_status: 판매 상태 필터 (None: 전체)

        Returns:
            검색 결과 딕셔너리 리스트. 각 항목:
            - chunk_id: 청크 UUID
            - text: 청크 원문
            - score: 키워드 검색 점수
            - policy_id: 상품 UUID
            - policy_name: 상품명
            - company_name: 보험사명
        """
        tsquery_str = build_tsquery(query)
        if not tsquery_str:
            logger.warning("전문 검색 쿼리가 비어 있음: %r", query)
            return []

        # to_tsvector simple 설정으로 chunk_text 검색
        # (search_vector 컬럼이 아직 마이그레이션되지 않은 환경 고려)
        base_sql = """
            SELECT
                pc.id::text AS chunk_id,
                pc.chunk_text AS text,
                ts_rank(
                    to_tsvector('simple', pc.chunk_text),
                    to_tsquery('simple', :tsquery)
                ) AS score,
                p.id::text AS policy_id,
                p.name AS policy_name,
                ic.name AS company_name
            FROM policy_chunks pc
            JOIN policies p ON pc.policy_id = p.id
            JOIN insurance_companies ic ON p.company_id = ic.id
            WHERE to_tsvector('simple', pc.chunk_text) @@ to_tsquery('simple', :tsquery)
        """

        params: dict = {"tsquery": tsquery_str, "limit": limit}

        # 보험사 코드 필터
        if company_code is not None:
            base_sql += " AND ic.code = :company_code"
            params["company_code"] = company_code

        # 판매 상태 필터
        if sale_status is not None:
            base_sql += " AND p.sale_status = :sale_status"
            params["sale_status"] = sale_status

        base_sql += " ORDER BY score DESC LIMIT :limit"

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
            logger.exception("전문 검색 실행 중 오류 발생: query=%r", query)
            return []
