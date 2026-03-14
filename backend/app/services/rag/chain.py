"""RAG 체인 서비스

SPEC-LLM-001 TASK-008: 다단계 검색, 결과 병합, 중복 제거 파이프라인.
"""

from __future__ import annotations

import structlog

from app.services.rag.rewriter import QueryRewriter

logger = structlog.get_logger()

# 최소 유사도 임계값 (이 값 이상의 결과만 포함)
_SIMILARITY_THRESHOLD = 0.3

# 1차 검색 결과 최대 개수
_TOP_K_FIRST = 5

# 2차 검색 결과 최대 개수
_TOP_K_SECOND = 3


class RAGChain:
    """다단계 RAG 검색 체인

    쿼리 재작성 → 1차 검색 → 정제 쿼리 생성 → 2차 검색 → 결과 병합의
    순서로 동작하는 RAG 파이프라인입니다.
    """

    def __init__(
        self,
        vector_search: object,
        rewriter: QueryRewriter | None = None,
    ) -> None:
        """RAG 체인 초기화

        Args:
            vector_search: VectorSearchService 인스턴스
            rewriter: QueryRewriter 인스턴스 (기본값: QueryRewriter())
        """
        self._vector_search = vector_search
        self._rewriter = rewriter or QueryRewriter()

    async def search(self, query: str) -> tuple[list[dict], float]:
        """다단계 RAG 검색 실행

        1. QueryRewriter로 쿼리 재작성
        2. 1차 벡터 검색
        3. 결과가 있으면 정제 쿼리로 2차 검색
        4. 결과 병합, 중복 제거, 유사도 정렬

        Args:
            query: 원본 사용자 쿼리

        Returns:
            tuple[list[dict], float]: (검색 결과 목록, 신뢰도 점수)
        """
        # 1단계: 쿼리 재작성
        rewritten_query = self._rewriter.rewrite(query)
        logger.debug("쿼리 재작성", original=query, rewritten=rewritten_query)

        # 2단계: 1차 벡터 검색
        first_results = await self._vector_search.search(
            query=rewritten_query,
            top_k=_TOP_K_FIRST,
            threshold=_SIMILARITY_THRESHOLD,
        )

        all_results = list(first_results)

        # 3단계: 1차 결과 기반 정제 쿼리 생성 후 2차 검색
        if first_results:
            refined_query = self._build_refined_query(rewritten_query, first_results)
            second_results = await self._vector_search.search(
                query=refined_query,
                top_k=_TOP_K_SECOND,
                threshold=_SIMILARITY_THRESHOLD,
            )
            all_results.extend(second_results)

        # 4단계: 중복 제거 및 유사도 정렬
        merged = self._merge_and_deduplicate(all_results)

        # 신뢰도 = 최상위 결과의 유사도 (결과 없으면 0.0)
        confidence = merged[0]["similarity"] if merged else 0.0

        logger.info(
            "RAG 검색 완료",
            query=query,
            result_count=len(merged),
            confidence=confidence,
        )

        return merged, confidence

    def _build_refined_query(self, original_query: str, results: list[dict]) -> str:
        """1차 검색 결과를 기반으로 정제 쿼리 생성

        Args:
            original_query: 원본 (재작성된) 쿼리
            results: 1차 검색 결과 목록

        Returns:
            정제된 쿼리 문자열
        """
        if not results:
            return original_query

        # 최상위 결과의 약관명을 쿼리에 추가하여 정밀도 향상
        top_result = results[0]
        policy_name = top_result.get("policy_name", "")
        company_name = top_result.get("company_name", "")

        if policy_name:
            refined = f"{original_query} {company_name} {policy_name}".strip()
        else:
            refined = original_query

        return refined

    def _merge_and_deduplicate(self, results: list[dict]) -> list[dict]:
        """검색 결과 병합, 중복 제거, 유사도 정렬

        동일한 (company_name, policy_name, chunk_text)를 가진 결과를 중복으로 처리합니다.
        중복 시 더 높은 유사도를 유지합니다.

        Args:
            results: 병합할 검색 결과 목록

        Returns:
            중복 제거 및 유사도 정렬된 결과 목록
        """
        seen: dict[tuple, dict] = {}

        for result in results:
            key = (
                result.get("company_name", ""),
                result.get("policy_name", ""),
                result.get("chunk_text", ""),
            )
            if key not in seen or result.get("similarity", 0) > seen[key].get("similarity", 0):
                seen[key] = result

        # 유사도 내림차순 정렬
        merged = sorted(seen.values(), key=lambda x: x.get("similarity", 0), reverse=True)
        return merged
