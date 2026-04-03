"""JIT RAG 섹션 파인더 (SPEC-JIT-001)

쿼리에 관련된 약관 섹션을 추출하는 서비스.
전략 A: 전체 토큰 < 120000 → 전체 섹션 반환 (full context)
전략 B: 전체 토큰 >= 120000 → BM25로 상위 5개 섹션 반환
"""

from __future__ import annotations

import logging
import re

from app.services.jit_rag.models import Section

logger = logging.getLogger(__name__)

# 전략 분기 토큰 임계값
_FULL_CONTEXT_TOKEN_LIMIT = 120_000
# BM25 상위 k개
_BM25_TOP_K = 5


def _estimate_tokens(text: str) -> int:
    """텍스트 토큰 수 추정 (len // 4 근사)

    Args:
        text: 토큰 수를 추정할 텍스트

    Returns:
        추정 토큰 수
    """
    return len(text) // 4


def _tokenize_korean(text: str) -> list[str]:
    """한국어 텍스트 토크나이즈 (공백 + 구두점 기준 분리)

    BM25 입력용 간단한 토크나이저.

    Args:
        text: 토크나이즈할 텍스트

    Returns:
        토큰 목록
    """
    # 구두점 제거 후 공백 분리
    cleaned = re.sub(r"[^\w\s가-힣]", " ", text)
    tokens = [t for t in cleaned.split() if t]
    return tokens


class SectionFinder:
    """약관 섹션 관련성 검색기

    # @MX:NOTE: [AUTO] 전략 분기: 소규모 → 전체 반환, 대규모 → BM25 top-5
    """

    def find_relevant(self, query: str, sections: list[Section]) -> list[Section]:
        """쿼리에 관련된 섹션 목록 반환

        전체 토큰 수에 따라 전략 A(전체) 또는 전략 B(BM25)를 선택.

        Args:
            query: 사용자 쿼리
            sections: 검색 대상 섹션 목록

        Returns:
            관련 섹션 목록
        """
        if not sections:
            return []

        # 전체 토큰 수 추정
        total_text = " ".join(s.title + " " + s.content for s in sections)
        total_tokens = _estimate_tokens(total_text)

        if total_tokens < _FULL_CONTEXT_TOKEN_LIMIT:
            # 전략 A: 전체 섹션 반환 (full context)
            logger.debug(
                "SectionFinder: 전략 A (전체 반환) - 토큰=%d, 섹션=%d",
                total_tokens,
                len(sections),
            )
            return list(sections)
        else:
            # 전략 B: BM25로 상위 k개 반환
            logger.debug(
                "SectionFinder: 전략 B (BM25) - 토큰=%d, 섹션=%d",
                total_tokens,
                len(sections),
            )
            return self._bm25_search(query, sections)

    def _bm25_search(self, query: str, sections: list[Section]) -> list[Section]:
        """BM25로 관련 섹션 상위 k개 반환

        rank_bm25 라이브러리를 사용하여 TF-IDF 기반 유사도 계산.

        Args:
            query: 검색 쿼리
            sections: 검색 대상 섹션 목록

        Returns:
            상위 k개 섹션 목록
        """
        try:
            from rank_bm25 import BM25Okapi  # type: ignore[import]
        except ImportError:
            logger.warning("rank_bm25 미설치 - 전체 섹션 반환으로 폴백")
            return sections[:_BM25_TOP_K]

        # 섹션 텍스트 토크나이즈
        corpus = [
            _tokenize_korean(s.title + " " + s.content)
            for s in sections
        ]

        # 빈 토큰 코퍼스 처리
        corpus = [tokens if tokens else [""] for tokens in corpus]

        bm25 = BM25Okapi(corpus)
        query_tokens = _tokenize_korean(query)

        if not query_tokens:
            return sections[:_BM25_TOP_K]

        scores = bm25.get_scores(query_tokens)

        # 점수 내림차순 정렬 후 상위 k개 인덱스 선택
        top_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:_BM25_TOP_K]
        return [sections[i] for i in top_indices]
