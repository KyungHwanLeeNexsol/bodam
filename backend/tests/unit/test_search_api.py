"""시맨틱 검색 API 단위 테스트 (TAG-016)

POST /api/v1/search/semantic 엔드포인트 테스트.
VectorSearchService를 모킹하여 API 레이어만 격리 테스트.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

from httpx import ASGITransport, AsyncClient


def _make_search_results(count: int = 2) -> list[dict]:
    """테스트용 검색 결과 딕셔너리 리스트 생성 헬퍼"""
    results = []
    for i in range(count):
        results.append(
            {
                "chunk_id": uuid.uuid4(),
                "policy_id": uuid.uuid4(),
                "coverage_id": None,
                "chunk_text": f"보험 약관 청크 내용 {i + 1}",
                "chunk_index": i,
                "similarity": 0.9 - i * 0.1,
                "policy_name": f"테스트 보험상품 {i + 1}",
                "company_name": "테스트 보험사",
            }
        )
    return results


def _build_app_with_mock_search(mock_results: list[dict]):
    """VectorSearchService와 DB 세션을 모킹한 FastAPI 앱 반환 헬퍼"""
    from app.api.v1.search import get_embedding_service
    from app.core.database import get_db
    from app.main import app

    # DB 세션 의존성 오버라이드
    async def override_get_db():
        yield AsyncMock()

    # EmbeddingService 의존성 오버라이드
    async def override_get_embedding_service():
        return AsyncMock()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_embedding_service] = override_get_embedding_service

    return app


class TestSemanticSearchEndpoint:
    """POST /api/v1/search/semantic 엔드포인트 테스트"""

    async def test_semantic_search_returns_200_with_results(self):
        """유효한 쿼리로 검색 시 200 응답과 결과 반환"""
        mock_results = _make_search_results(2)

        from app.api.v1.search import get_embedding_service
        from app.core.database import get_db
        from app.main import app
        from app.services.rag.vector_store import VectorSearchService

        async def override_get_db():
            yield AsyncMock()

        async def override_get_embedding_service():
            return AsyncMock()

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_embedding_service] = override_get_embedding_service

        try:
            with patch.object(VectorSearchService, "search", new=AsyncMock(return_value=mock_results)):
                transport = ASGITransport(app=app)
                async with AsyncClient(transport=transport, base_url="http://test") as client:
                    response = await client.post(
                        "/api/v1/search/semantic",
                        json={"query": "암 진단비 보장 조건은?"},
                    )
        finally:
            app.dependency_overrides.pop(get_db, None)
            app.dependency_overrides.pop(get_embedding_service, None)

        assert response.status_code == 200
        data = response.json()
        assert "results" in data
        assert "total" in data
        assert "query" in data
        assert data["query"] == "암 진단비 보장 조건은?"

    async def test_semantic_search_with_company_filter(self):
        """company_id 필터로 검색 시 올바른 파라미터 전달"""
        mock_results = _make_search_results(1)
        company_id = str(uuid.uuid4())

        from app.api.v1.search import get_embedding_service
        from app.core.database import get_db
        from app.main import app
        from app.services.rag.vector_store import VectorSearchService

        async def override_get_db():
            yield AsyncMock()

        async def override_get_embedding_service():
            return AsyncMock()

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_embedding_service] = override_get_embedding_service

        try:
            with patch.object(VectorSearchService, "search", new=AsyncMock(return_value=mock_results)):
                transport = ASGITransport(app=app)
                async with AsyncClient(transport=transport, base_url="http://test") as client:
                    response = await client.post(
                        "/api/v1/search/semantic",
                        json={
                            "query": "보장 내용 검색",
                            "company_id": company_id,
                        },
                    )
        finally:
            app.dependency_overrides.pop(get_db, None)
            app.dependency_overrides.pop(get_embedding_service, None)

        assert response.status_code == 200

    async def test_semantic_search_with_category_filter(self):
        """category 필터로 검색 시 올바른 파라미터 전달"""
        mock_results = _make_search_results(1)

        from app.api.v1.search import get_embedding_service
        from app.core.database import get_db
        from app.main import app
        from app.services.rag.vector_store import VectorSearchService

        async def override_get_db():
            yield AsyncMock()

        async def override_get_embedding_service():
            return AsyncMock()

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_embedding_service] = override_get_embedding_service

        try:
            with patch.object(VectorSearchService, "search", new=AsyncMock(return_value=mock_results)):
                transport = ASGITransport(app=app)
                async with AsyncClient(transport=transport, base_url="http://test") as client:
                    response = await client.post(
                        "/api/v1/search/semantic",
                        json={
                            "query": "생명보험 검색",
                            "category": "LIFE",
                        },
                    )
        finally:
            app.dependency_overrides.pop(get_db, None)
            app.dependency_overrides.pop(get_embedding_service, None)

        assert response.status_code == 200

    async def test_semantic_search_with_custom_top_k_and_threshold(self):
        """사용자 정의 top_k와 threshold로 검색"""
        mock_results = _make_search_results(3)

        from app.api.v1.search import get_embedding_service
        from app.core.database import get_db
        from app.main import app
        from app.services.rag.vector_store import VectorSearchService

        async def override_get_db():
            yield AsyncMock()

        async def override_get_embedding_service():
            return AsyncMock()

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_embedding_service] = override_get_embedding_service

        try:
            with patch.object(VectorSearchService, "search", new=AsyncMock(return_value=mock_results)):
                transport = ASGITransport(app=app)
                async with AsyncClient(transport=transport, base_url="http://test") as client:
                    response = await client.post(
                        "/api/v1/search/semantic",
                        json={
                            "query": "검색 쿼리",
                            "top_k": 10,
                            "threshold": 0.5,
                        },
                    )
        finally:
            app.dependency_overrides.pop(get_db, None)
            app.dependency_overrides.pop(get_embedding_service, None)

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 3

    async def test_semantic_search_empty_query_returns_422(self):
        """빈 쿼리 문자열 입력 시 422 Unprocessable Entity 반환"""
        from app.api.v1.search import get_embedding_service
        from app.core.database import get_db
        from app.main import app

        async def override_get_db():
            yield AsyncMock()

        async def override_get_embedding_service():
            return AsyncMock()

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_embedding_service] = override_get_embedding_service

        try:
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/search/semantic",
                    json={"query": ""},
                )
        finally:
            app.dependency_overrides.pop(get_db, None)
            app.dependency_overrides.pop(get_embedding_service, None)

        assert response.status_code == 422

    async def test_semantic_search_missing_query_returns_422(self):
        """query 필드 누락 시 422 Unprocessable Entity 반환"""
        from app.api.v1.search import get_embedding_service
        from app.core.database import get_db
        from app.main import app

        async def override_get_db():
            yield AsyncMock()

        async def override_get_embedding_service():
            return AsyncMock()

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_embedding_service] = override_get_embedding_service

        try:
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/search/semantic",
                    json={"top_k": 5},
                )
        finally:
            app.dependency_overrides.pop(get_db, None)
            app.dependency_overrides.pop(get_embedding_service, None)

        assert response.status_code == 422

    async def test_semantic_search_response_structure(self):
        """응답이 SemanticSearchResponse 구조를 따르는지 검증"""
        chunk_id = uuid.uuid4()
        policy_id = uuid.uuid4()
        mock_results = [
            {
                "chunk_id": chunk_id,
                "policy_id": policy_id,
                "coverage_id": None,
                "chunk_text": "약관 본문 검증",
                "chunk_index": 0,
                "similarity": 0.85,
                "policy_name": "테스트 보험",
                "company_name": "테스트 보험사",
            }
        ]

        from app.api.v1.search import get_embedding_service
        from app.core.database import get_db
        from app.main import app
        from app.services.rag.vector_store import VectorSearchService

        async def override_get_db():
            yield AsyncMock()

        async def override_get_embedding_service():
            return AsyncMock()

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_embedding_service] = override_get_embedding_service

        try:
            with patch.object(VectorSearchService, "search", new=AsyncMock(return_value=mock_results)):
                transport = ASGITransport(app=app)
                async with AsyncClient(transport=transport, base_url="http://test") as client:
                    response = await client.post(
                        "/api/v1/search/semantic",
                        json={"query": "응답 구조 검증"},
                    )
        finally:
            app.dependency_overrides.pop(get_db, None)
            app.dependency_overrides.pop(get_embedding_service, None)

        assert response.status_code == 200
        data = response.json()

        # 최상위 필드 확인
        assert "results" in data
        assert "total" in data
        assert "query" in data
        assert data["total"] == 1
        assert len(data["results"]) == 1

        # 개별 결과 필드 확인
        result = data["results"][0]
        assert "chunk_id" in result
        assert "policy_id" in result
        assert "chunk_text" in result
        assert "chunk_index" in result
        assert "similarity" in result
        assert "policy_name" in result
        assert "company_name" in result
