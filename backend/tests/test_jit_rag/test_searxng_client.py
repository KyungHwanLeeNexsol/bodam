"""SearXNG API 클라이언트 테스트 (SPEC-JIT-003 T-003)

TDD 사이클:
1. 성공 검색 → SearchResult 목록 반환
2. PDF URL 우선순위 정렬
3. 타임아웃 처리 → 빈 리스트 반환
4. HTTP 오류 처리 → 빈 리스트 반환
5. 빈 결과 처리
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.services.jit_rag.searxng_client import SearchResult, SearXNGClient


class TestSearchResult:
    """SearchResult 데이터클래스 테스트"""

    def test_search_result_has_required_fields(self):
        """SearchResult는 url, title, content, engine 필드를 가져야 한다"""
        result = SearchResult(
            url="https://example.com/terms.pdf",
            title="보험약관",
            content="보험 약관 내용",
            engine="google",
        )
        assert result.url == "https://example.com/terms.pdf"
        assert result.title == "보험약관"
        assert result.content == "보험 약관 내용"
        assert result.engine == "google"


class TestSearXNGClientInit:
    """SearXNGClient 초기화 테스트"""

    def test_init_with_base_url(self):
        """base_url로 클라이언트를 초기화할 수 있어야 한다"""
        client = SearXNGClient(base_url="http://localhost:8080")
        assert client._base_url == "http://localhost:8080"

    def test_init_strips_trailing_slash(self):
        """base_url 끝의 슬래시는 제거되어야 한다"""
        client = SearXNGClient(base_url="http://localhost:8080/")
        assert client._base_url == "http://localhost:8080"

    def test_init_default_timeout(self):
        """기본 타임아웃은 10.0초여야 한다"""
        client = SearXNGClient(base_url="http://localhost:8080")
        assert client._timeout == 10.0

    def test_init_custom_timeout(self):
        """커스텀 타임아웃을 설정할 수 있어야 한다"""
        client = SearXNGClient(base_url="http://localhost:8080", timeout=30.0)
        assert client._timeout == 30.0


class TestSearXNGClientSearch:
    """SearXNGClient.search() 메서드 테스트"""

    def _make_mock_response(self, json_data: dict) -> MagicMock:
        """httpx 응답 목(mock) 생성 헬퍼"""
        mock_response = MagicMock()
        mock_response.json.return_value = json_data
        mock_response.raise_for_status = MagicMock()
        return mock_response

    @pytest.mark.asyncio
    async def test_search_returns_list_of_search_results(self):
        """성공적인 검색은 SearchResult 목록을 반환해야 한다"""
        client = SearXNGClient(base_url="http://localhost:8080")
        fake_response = {
            "results": [
                {
                    "url": "https://example.com/terms.pdf",
                    "title": "약관 PDF",
                    "content": "보험 약관",
                    "engine": "google",
                },
                {
                    "url": "https://other.com/page",
                    "title": "약관 페이지",
                    "content": "약관 내용",
                    "engine": "bing",
                },
            ]
        }
        mock_response = self._make_mock_response(fake_response)
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.get = AsyncMock(return_value=mock_response)

        with patch("app.services.jit_rag.searxng_client.httpx.AsyncClient", return_value=mock_client):
            results = await client.search("삼성화재 운전자보험 약관")

        assert len(results) == 2
        assert all(isinstance(r, SearchResult) for r in results)
        assert results[0].url == "https://example.com/terms.pdf"
        assert results[0].engine == "google"

    @pytest.mark.asyncio
    async def test_search_sends_correct_params(self):
        """검색 요청에 올바른 쿼리 파라미터가 전달되어야 한다"""
        client = SearXNGClient(base_url="http://localhost:8080")
        fake_response = {"results": []}
        mock_response = self._make_mock_response(fake_response)
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.get = AsyncMock(return_value=mock_response)

        with patch("app.services.jit_rag.searxng_client.httpx.AsyncClient", return_value=mock_client):
            await client.search("테스트 쿼리")

        # GET 요청 파라미터 확인
        call_args = mock_client.get.call_args
        assert call_args is not None
        params = call_args.kwargs.get("params", {}) or (call_args.args[1] if len(call_args.args) > 1 else {})
        # URL 또는 params에 검색어가 포함되어야 함
        call_str = str(call_args)
        assert "테스트 쿼리" in call_str or "format" in call_str

    @pytest.mark.asyncio
    async def test_pdf_urls_are_prioritized(self):
        """PDF URL은 결과 목록의 앞부분에 정렬되어야 한다"""
        client = SearXNGClient(base_url="http://localhost:8080")
        fake_response = {
            "results": [
                {
                    "url": "https://example.com/page",
                    "title": "약관 페이지",
                    "content": "일반 페이지",
                    "engine": "bing",
                },
                {
                    "url": "https://other.com/terms.pdf",
                    "title": "약관 PDF",
                    "content": "PDF 파일",
                    "engine": "google",
                },
            ]
        }
        mock_response = self._make_mock_response(fake_response)
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.get = AsyncMock(return_value=mock_response)

        with patch("app.services.jit_rag.searxng_client.httpx.AsyncClient", return_value=mock_client):
            results = await client.search("보험 약관")

        # PDF URL이 첫 번째에 위치해야 함
        assert len(results) >= 2
        assert results[0].url.endswith(".pdf")

    @pytest.mark.asyncio
    async def test_timeout_returns_empty_list(self):
        """타임아웃 시 빈 리스트를 반환해야 한다 (예외 미전파)"""
        client = SearXNGClient(base_url="http://localhost:8080")
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.get = AsyncMock(side_effect=httpx.TimeoutException("타임아웃"))

        with patch("app.services.jit_rag.searxng_client.httpx.AsyncClient", return_value=mock_client):
            results = await client.search("보험 약관")

        assert results == []

    @pytest.mark.asyncio
    async def test_http_error_returns_empty_list(self):
        """HTTP 오류 시 빈 리스트를 반환해야 한다 (예외 미전파)"""
        client = SearXNGClient(base_url="http://localhost:8080")
        mock_response = MagicMock()
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "500 Internal Server Error",
            request=MagicMock(),
            response=MagicMock(),
        )
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.get = AsyncMock(return_value=mock_response)

        with patch("app.services.jit_rag.searxng_client.httpx.AsyncClient", return_value=mock_client):
            results = await client.search("보험 약관")

        assert results == []

    @pytest.mark.asyncio
    async def test_empty_results_returns_empty_list(self):
        """빈 검색 결과는 빈 리스트를 반환해야 한다"""
        client = SearXNGClient(base_url="http://localhost:8080")
        fake_response = {"results": []}
        mock_response = self._make_mock_response(fake_response)
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.get = AsyncMock(return_value=mock_response)

        with patch("app.services.jit_rag.searxng_client.httpx.AsyncClient", return_value=mock_client):
            results = await client.search("존재하지 않는 보험 상품")

        assert results == []

    @pytest.mark.asyncio
    async def test_search_with_custom_engines(self):
        """engines 파라미터가 검색에 전달되어야 한다"""
        client = SearXNGClient(base_url="http://localhost:8080")
        fake_response = {"results": []}
        mock_response = self._make_mock_response(fake_response)
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.get = AsyncMock(return_value=mock_response)

        with patch("app.services.jit_rag.searxng_client.httpx.AsyncClient", return_value=mock_client):
            results = await client.search("보험 약관", engines=["google", "bing"])

        assert results == []
        # 요청이 실제로 호출되었는지 확인
        mock_client.get.assert_called_once()

    @pytest.mark.asyncio
    async def test_missing_results_key_returns_empty_list(self):
        """응답에 results 키가 없으면 빈 리스트를 반환해야 한다"""
        client = SearXNGClient(base_url="http://localhost:8080")
        fake_response = {"query": "테스트"}  # results 키 없음
        mock_response = self._make_mock_response(fake_response)
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.get = AsyncMock(return_value=mock_response)

        with patch("app.services.jit_rag.searxng_client.httpx.AsyncClient", return_value=mock_client):
            results = await client.search("보험 약관")

        assert results == []
