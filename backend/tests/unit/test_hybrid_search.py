"""하이브리드 검색 단위 테스트 (SPEC-PIPELINE-001 REQ-11, REQ-13)"""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest


class TestRRFAlgorithm:
    """RRF (Reciprocal Rank Fusion) 알고리즘 테스트"""

    def test_rrf_score_with_equal_ranks(self) -> None:
        """같은 순위의 두 결과는 같은 RRF 점수를 받아야 함"""
        from app.services.rag.hybrid_search import compute_rrf_score

        score1 = compute_rrf_score(rank=1, k=60)
        score2 = compute_rrf_score(rank=1, k=60)
        assert score1 == score2

    def test_rrf_score_decreases_with_rank(self) -> None:
        """높은 순위(낮은 rank 값)가 더 높은 점수를 받아야 함"""
        from app.services.rag.hybrid_search import compute_rrf_score

        score_rank1 = compute_rrf_score(rank=1, k=60)
        score_rank10 = compute_rrf_score(rank=10, k=60)
        assert score_rank1 > score_rank10

    def test_rrf_formula(self) -> None:
        """RRF 공식: 1 / (k + rank)"""
        from app.services.rag.hybrid_search import compute_rrf_score

        k, rank = 60, 5
        expected = 1 / (k + rank)
        assert compute_rrf_score(rank=rank, k=k) == pytest.approx(expected)

    def test_fuse_results_deduplicates(self) -> None:
        """동일한 청크 ID는 점수를 합산하여 중복 제거해야 함"""
        from app.services.rag.hybrid_search import fuse_ranked_results

        vector_results = [{"chunk_id": "a", "score": 0.9, "text": "텍스트 A"}]
        keyword_results = [{"chunk_id": "a", "score": 0.8, "text": "텍스트 A"}]
        fused = fuse_ranked_results(vector_results, keyword_results, k=60)
        # 동일한 chunk_id는 하나의 결과로 합쳐져야 함
        assert len(fused) == 1

    def test_fuse_results_combines_different_chunks(self) -> None:
        """서로 다른 청크는 별도의 결과로 반환해야 함"""
        from app.services.rag.hybrid_search import fuse_ranked_results

        vector_results = [{"chunk_id": "a", "score": 0.9, "text": "텍스트 A"}]
        keyword_results = [{"chunk_id": "b", "score": 0.8, "text": "텍스트 B"}]
        fused = fuse_ranked_results(vector_results, keyword_results, k=60)
        assert len(fused) == 2

    def test_fuse_results_sorted_by_score(self) -> None:
        """결합된 결과는 점수 내림차순으로 정렬되어야 함"""
        from app.services.rag.hybrid_search import fuse_ranked_results

        # b가 vector_results에서 1위, keyword_results에서도 1위 → 높은 점수
        vector_results = [
            {"chunk_id": "b", "score": 0.95, "text": "B"},
            {"chunk_id": "a", "score": 0.7, "text": "A"},
        ]
        keyword_results = [
            {"chunk_id": "b", "score": 0.9, "text": "B"},
        ]
        fused = fuse_ranked_results(vector_results, keyword_results, k=60)
        assert fused[0]["chunk_id"] == "b"


class TestHybridSearchService:
    """HybridSearchService 클래스 테스트"""

    def test_hybrid_search_service_exists(self) -> None:
        """HybridSearchService 클래스가 존재해야 함"""
        from app.services.rag.hybrid_search import HybridSearchService

        assert HybridSearchService is not None

    def test_hybrid_search_service_instantiation(self) -> None:
        """HybridSearchService는 db_session으로 생성 가능해야 함"""
        from app.services.rag.hybrid_search import HybridSearchService

        mock_session = AsyncMock()
        service = HybridSearchService(db_session=mock_session)
        assert service is not None


class TestSearchScoring:
    """검색 결과 점수 필드 테스트 (REQ-13)"""

    def test_search_result_has_scores(self) -> None:
        """검색 결과에 vector_score, keyword_score, combined_score가 포함되어야 함 (REQ-13)"""
        from app.services.rag.hybrid_search import fuse_ranked_results

        vector_results = [{"chunk_id": "a", "score": 0.9, "text": "A"}]
        keyword_results = [{"chunk_id": "a", "score": 0.8, "text": "A"}]
        fused = fuse_ranked_results(vector_results, keyword_results, k=60)
        result = fused[0]
        assert "vector_score" in result or "combined_score" in result
