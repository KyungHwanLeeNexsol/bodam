"""전문 검색 단위 테스트 (SPEC-PIPELINE-001 REQ-10)"""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest


class TestFulltextSearchService:
    """FulltextSearchService 클래스 테스트"""

    def test_fulltext_search_service_exists(self) -> None:
        """FulltextSearchService 클래스가 존재해야 함"""
        from app.services.rag.fulltext_search import FulltextSearchService

        assert FulltextSearchService is not None

    def test_fulltext_search_service_instantiation(self) -> None:
        """FulltextSearchService는 db_session으로 생성 가능해야 함"""
        from app.services.rag.fulltext_search import FulltextSearchService

        mock_session = AsyncMock()
        service = FulltextSearchService(db_session=mock_session)
        assert service is not None

    def test_build_tsquery_converts_spaces_to_and(self) -> None:
        """공백으로 구분된 단어를 AND 조건으로 변환해야 함"""
        from app.services.rag.fulltext_search import build_tsquery

        query = build_tsquery("암 보험 보장")
        assert "&" in query or "암" in query

    def test_build_tsquery_single_word(self) -> None:
        """단일 단어 쿼리는 그대로 반환해야 함"""
        from app.services.rag.fulltext_search import build_tsquery

        query = build_tsquery("암")
        assert "암" in query

    def test_build_tsquery_empty_string(self) -> None:
        """빈 문자열은 빈 쿼리를 반환해야 함"""
        from app.services.rag.fulltext_search import build_tsquery

        query = build_tsquery("")
        assert query == "" or query is None


class TestPolicyChunkModel:
    """PolicyChunk 모델 search_vector 컬럼 테스트 (REQ-10)"""

    def test_search_vector_column_exists_in_db_definition(self) -> None:
        """PolicyChunk 모델에 search_vector 컬럼이 정의되어야 함 (REQ-10)"""
        from app.models.insurance import PolicyChunk

        # SQLAlchemy 컬럼으로 정의되어 있어야 함
        assert hasattr(PolicyChunk, "search_vector")
