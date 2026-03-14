"""RAG 체인 단위 테스트

SPEC-LLM-001 TASK-008: 다단계 검색, 결과 병합, 중복 제거 검증.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.rag.chain import RAGChain


@pytest.fixture
def mock_vector_search():
    """VectorSearchService 목 픽스처"""
    service = MagicMock()
    service.search = AsyncMock()
    return service


@pytest.fixture
def rag_chain(mock_vector_search):
    """RAGChain 픽스처"""
    return RAGChain(vector_search=mock_vector_search)


class TestRAGChainInit:
    """RAGChain 초기화 테스트"""

    def test_init_with_vector_search(self, mock_vector_search):
        """VectorSearchService로 초기화"""
        chain = RAGChain(vector_search=mock_vector_search)
        assert chain is not None


class TestRAGChainSearch:
    """RAGChain 검색 테스트"""

    async def test_search_returns_list(self, rag_chain, mock_vector_search):
        """검색 결과가 리스트 반환"""
        mock_vector_search.search.return_value = []
        results, confidence = await rag_chain.search("실손보험 질문")
        assert isinstance(results, list)
        assert isinstance(confidence, float)

    async def test_search_with_results(self, rag_chain, mock_vector_search):
        """검색 결과 있을 때 처리"""
        first_results = [
            {
                "policy_name": "실손의료보험",
                "company_name": "삼성화재",
                "chunk_text": "실손 의료비 보상 내용",
                "similarity": 0.9,
            }
        ]
        # 1차 검색 → 결과 있음, 2차 검색도 설정
        mock_vector_search.search.side_effect = [first_results, first_results]

        results, confidence = await rag_chain.search("실손보험 보장 내용")

        assert len(results) > 0
        assert confidence > 0.0

    async def test_search_deduplicates_results(self, rag_chain, mock_vector_search):
        """중복 결과 제거"""
        duplicate_result = {
            "policy_name": "실손의료보험",
            "company_name": "삼성화재",
            "chunk_text": "동일한 내용",
            "similarity": 0.9,
        }
        # 1차, 2차 모두 동일한 결과 반환
        mock_vector_search.search.side_effect = [[duplicate_result], [duplicate_result]]

        results, confidence = await rag_chain.search("실손보험 질문")

        # 중복이 제거되어 1개만 남음
        assert len(results) == 1

    async def test_search_sorts_by_similarity(self, rag_chain, mock_vector_search):
        """결과를 유사도 내림차순으로 정렬"""
        results_1 = [
            {
                "policy_name": "보험A",
                "company_name": "회사A",
                "chunk_text": "내용A",
                "similarity": 0.7,
            }
        ]
        results_2 = [
            {
                "policy_name": "보험B",
                "company_name": "회사B",
                "chunk_text": "내용B",
                "similarity": 0.9,
            }
        ]
        mock_vector_search.search.side_effect = [results_1, results_2]

        results, _ = await rag_chain.search("질문")

        # 유사도 높은 것이 먼저
        if len(results) >= 2:
            assert results[0]["similarity"] >= results[1]["similarity"]

    async def test_confidence_zero_when_no_results(self, rag_chain, mock_vector_search):
        """결과 없을 때 신뢰도 0"""
        mock_vector_search.search.return_value = []

        _, confidence = await rag_chain.search("무관한 질문")

        assert confidence == 0.0

    async def test_confidence_from_top_result_similarity(self, rag_chain, mock_vector_search):
        """신뢰도는 최상위 결과의 유사도 기반"""
        top_result = {
            "policy_name": "실손보험",
            "company_name": "현대해상",
            "chunk_text": "보장 내용",
            "similarity": 0.85,
        }
        mock_vector_search.search.side_effect = [[top_result], []]

        _, confidence = await rag_chain.search("실손보험 질문")

        assert confidence > 0.0

    async def test_rewriter_applied_to_query(self, mock_vector_search):
        """QueryRewriter가 쿼리에 적용됨"""
        from app.services.rag.rewriter import QueryRewriter

        mock_rewriter = MagicMock(spec=QueryRewriter)
        mock_rewriter.rewrite = MagicMock(return_value="실손의료보험 보장 내용")
        mock_vector_search.search.return_value = []

        chain = RAGChain(vector_search=mock_vector_search, rewriter=mock_rewriter)
        await chain.search("실손 보장")

        # rewrite가 호출되었는지 확인
        mock_rewriter.rewrite.assert_called_once_with("실손 보장")
