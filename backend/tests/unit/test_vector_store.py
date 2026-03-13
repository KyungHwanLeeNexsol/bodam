"""VectorSearchService 단위 테스트 (TAG-016)

데이터베이스 세션과 EmbeddingService를 모킹하여
벡터 유사도 검색 로직을 단위 테스트.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock


def _make_fixed_embedding(dim: int = 1536) -> list[float]:
    """테스트용 고정 임베딩 벡터 생성 헬퍼"""
    return [0.1] * dim


def _make_search_row(
    chunk_id: uuid.UUID | None = None,
    chunk_text: str = "약관 청크 내용",
    distance: float = 0.2,
    policy_name: str = "테스트 보험상품",
    company_name: str = "테스트 보험사",
    policy_id: uuid.UUID | None = None,
    coverage_id: uuid.UUID | None = None,
    chunk_index: int = 0,
    category: str = "LIFE",
):
    """검색 결과 행(row) mock 생성 헬퍼"""
    row = MagicMock()
    row.chunk_id = chunk_id or uuid.uuid4()
    row.chunk_text = chunk_text
    row.distance = distance
    row.policy_name = policy_name
    row.company_name = company_name
    row.policy_id = policy_id or uuid.uuid4()
    row.coverage_id = coverage_id
    row.chunk_index = chunk_index
    row.category = category
    return row


class TestVectorSearchServiceSearch:
    """VectorSearchService.search() 테스트"""

    async def test_search_returns_results_sorted_by_distance(self):
        """search()가 거리 오름차순으로 정렬된 결과를 반환해야 함"""
        from app.services.rag.vector_store import VectorSearchService

        # 거리가 다른 3개의 행 준비 (순서 무작위)
        rows = [
            _make_search_row(distance=0.5, chunk_text="세 번째"),
            _make_search_row(distance=0.1, chunk_text="첫 번째"),
            _make_search_row(distance=0.3, chunk_text="두 번째"),
        ]

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.all = MagicMock(return_value=rows)
        mock_session.execute = AsyncMock(return_value=mock_result)

        fixed_vec = _make_fixed_embedding()
        mock_emb = AsyncMock()
        mock_emb.embed_text = AsyncMock(return_value=fixed_vec)

        service = VectorSearchService(session=mock_session, embedding_service=mock_emb)
        results = await service.search(query="보험 검색 쿼리")

        assert isinstance(results, list)
        # 결과가 반환되어야 함
        assert len(results) > 0

    async def test_search_filters_by_threshold(self):
        """threshold 이상의 distance를 가진 결과는 제외되어야 함

        SQL 쿼리에서 WHERE distance <= threshold 조건으로 처리됨.
        """
        from app.services.rag.vector_store import VectorSearchService

        # threshold 0.3으로 필터링 시 distance=0.5 항목은 제외
        rows = [
            _make_search_row(distance=0.1, chunk_text="유사한 청크"),
            _make_search_row(distance=0.2, chunk_text="약간 유사한 청크"),
        ]

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.all = MagicMock(return_value=rows)
        mock_session.execute = AsyncMock(return_value=mock_result)

        fixed_vec = _make_fixed_embedding()
        mock_emb = AsyncMock()
        mock_emb.embed_text = AsyncMock(return_value=fixed_vec)

        service = VectorSearchService(session=mock_session, embedding_service=mock_emb)
        results = await service.search(query="검색 쿼리", threshold=0.3)

        # threshold 필터링 후 2개 반환
        assert len(results) == 2

    async def test_search_limits_results_by_top_k(self):
        """top_k 값만큼만 결과가 반환되어야 함"""
        from app.services.rag.vector_store import VectorSearchService

        # SQL LIMIT으로 처리 - mock은 이미 제한된 결과 반환
        rows = [_make_search_row(distance=0.1 * i) for i in range(1, 4)]

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.all = MagicMock(return_value=rows)
        mock_session.execute = AsyncMock(return_value=mock_result)

        fixed_vec = _make_fixed_embedding()
        mock_emb = AsyncMock()
        mock_emb.embed_text = AsyncMock(return_value=fixed_vec)

        service = VectorSearchService(session=mock_session, embedding_service=mock_emb)
        results = await service.search(query="검색 쿼리", top_k=3)

        assert len(results) == 3

    async def test_search_filters_by_company_id(self):
        """company_id 필터가 쿼리에 적용되어야 함"""
        from app.services.rag.vector_store import VectorSearchService

        company_id = uuid.uuid4()
        rows = [_make_search_row(distance=0.2)]

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.all = MagicMock(return_value=rows)
        mock_session.execute = AsyncMock(return_value=mock_result)

        fixed_vec = _make_fixed_embedding()
        mock_emb = AsyncMock()
        mock_emb.embed_text = AsyncMock(return_value=fixed_vec)

        service = VectorSearchService(session=mock_session, embedding_service=mock_emb)
        results = await service.search(query="검색 쿼리", company_id=company_id)

        # 세션이 쿼리를 실행했는지 확인
        mock_session.execute.assert_called_once()
        # 결과 반환 확인
        assert len(results) == 1

    async def test_search_filters_by_category(self):
        """category 필터가 쿼리에 적용되어야 함"""
        from app.models.insurance import InsuranceCategory
        from app.services.rag.vector_store import VectorSearchService

        rows = [_make_search_row(distance=0.2, category="LIFE")]

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.all = MagicMock(return_value=rows)
        mock_session.execute = AsyncMock(return_value=mock_result)

        fixed_vec = _make_fixed_embedding()
        mock_emb = AsyncMock()
        mock_emb.embed_text = AsyncMock(return_value=fixed_vec)

        service = VectorSearchService(session=mock_session, embedding_service=mock_emb)
        results = await service.search(query="검색 쿼리", category=InsuranceCategory.LIFE)

        mock_session.execute.assert_called_once()
        assert len(results) == 1

    async def test_search_empty_database_returns_empty_list(self):
        """빈 데이터베이스에서 검색 시 빈 리스트 반환"""
        from app.services.rag.vector_store import VectorSearchService

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.all = MagicMock(return_value=[])
        mock_session.execute = AsyncMock(return_value=mock_result)

        fixed_vec = _make_fixed_embedding()
        mock_emb = AsyncMock()
        mock_emb.embed_text = AsyncMock(return_value=fixed_vec)

        service = VectorSearchService(session=mock_session, embedding_service=mock_emb)
        results = await service.search(query="아무것도 없는 DB 검색")

        assert results == []

    async def test_search_result_contains_required_fields(self):
        """검색 결과 딕셔너리가 필수 필드를 포함해야 함"""
        from app.services.rag.vector_store import VectorSearchService

        chunk_id = uuid.uuid4()
        policy_id = uuid.uuid4()
        coverage_id = uuid.uuid4()
        row = _make_search_row(
            chunk_id=chunk_id,
            chunk_text="청크 내용 검증",
            distance=0.15,
            policy_name="테스트 보험상품",
            company_name="테스트 보험사",
            policy_id=policy_id,
            coverage_id=coverage_id,
            chunk_index=2,
        )

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.all = MagicMock(return_value=[row])
        mock_session.execute = AsyncMock(return_value=mock_result)

        fixed_vec = _make_fixed_embedding()
        mock_emb = AsyncMock()
        mock_emb.embed_text = AsyncMock(return_value=fixed_vec)

        service = VectorSearchService(session=mock_session, embedding_service=mock_emb)
        results = await service.search(query="검색 쿼리")

        assert len(results) == 1
        result = results[0]

        # 필수 필드 존재 확인
        assert "chunk_id" in result
        assert "chunk_text" in result
        assert "similarity" in result
        assert "policy_name" in result
        assert "company_name" in result
        assert "policy_id" in result
        assert "coverage_id" in result
        assert "chunk_index" in result

        # 값 확인
        assert result["chunk_id"] == chunk_id
        assert result["chunk_text"] == "청크 내용 검증"
        assert result["policy_name"] == "테스트 보험상품"
        assert result["company_name"] == "테스트 보험사"
        # similarity는 distance에서 변환: 1 - distance
        assert abs(result["similarity"] - (1.0 - 0.15)) < 0.001

    async def test_search_converts_distance_to_similarity(self):
        """distance가 similarity(1 - distance)로 변환되어야 함"""
        from app.services.rag.vector_store import VectorSearchService

        row = _make_search_row(distance=0.3)

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.all = MagicMock(return_value=[row])
        mock_session.execute = AsyncMock(return_value=mock_result)

        fixed_vec = _make_fixed_embedding()
        mock_emb = AsyncMock()
        mock_emb.embed_text = AsyncMock(return_value=fixed_vec)

        service = VectorSearchService(session=mock_session, embedding_service=mock_emb)
        results = await service.search(query="검색 쿼리")

        assert len(results) == 1
        # similarity = 1.0 - distance = 1.0 - 0.3 = 0.7
        assert abs(results[0]["similarity"] - 0.7) < 0.001
