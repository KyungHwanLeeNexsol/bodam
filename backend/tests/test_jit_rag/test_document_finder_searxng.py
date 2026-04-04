"""DocumentFinder SearXNG 통합 테스트 (SPEC-JIT-003 T-004~T-007)

TDD 사이클:
1. DI: searxng_client=None이면 기존 DuckDuckGo 동작 유지
2. 4단계 SearXNG 전략 (보험사 사이트 → 공시 도메인 → PDF 일반 → 일반)
3. SearXNG 실패 시 DuckDuckGo 폴백
4. 각 전략의 쿼리 패턴 검증
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.jit_rag.document_finder import DocumentFinder, DocumentNotFoundError
from app.services.jit_rag.searxng_client import SearchResult, SearXNGClient


# ──────────────────────────────────────────────
# DI: searxng_client 파라미터 없이 생성
# ──────────────────────────────────────────────


class TestDocumentFinderDI:
    """DocumentFinder 의존성 주입 테스트"""

    def test_can_create_without_searxng_client(self):
        """searxng_client 인자 없이 DocumentFinder를 생성할 수 있어야 한다"""
        finder = DocumentFinder()
        assert finder is not None

    def test_can_create_with_searxng_client(self):
        """searxng_client 인자와 함께 DocumentFinder를 생성할 수 있어야 한다"""
        mock_client = MagicMock(spec=SearXNGClient)
        finder = DocumentFinder(searxng_client=mock_client)
        assert finder._searxng_client is mock_client

    def test_default_searxng_client_is_none(self):
        """searxng_client 기본값은 None이어야 한다"""
        finder = DocumentFinder()
        assert finder._searxng_client is None


# ──────────────────────────────────────────────
# SearXNG 4단계 전략 테스트
# ──────────────────────────────────────────────


class TestSearXNGStrategies:
    """SearXNG 기반 4단계 검색 전략 테스트"""

    def _make_client_returning(self, url: str | None) -> AsyncMock:
        """특정 URL을 반환하는 SearXNG 클라이언트 목(mock) 생성"""
        mock_client = AsyncMock(spec=SearXNGClient)
        if url:
            mock_client.search.return_value = [
                SearchResult(url=url, title="약관", content="보험 약관", engine="google")
            ]
        else:
            mock_client.search.return_value = []
        return mock_client

    def _make_client_empty(self) -> AsyncMock:
        """항상 빈 결과를 반환하는 클라이언트"""
        mock_client = AsyncMock(spec=SearXNGClient)
        mock_client.search.return_value = []
        return mock_client

    @pytest.mark.asyncio
    async def test_strategy1_uses_insurer_domain(self):
        """전략1: site:{insurer_domain} 쿼리로 검색해야 한다"""
        expected_url = "https://samsungfire.com/terms/driver.pdf"
        mock_client = self._make_client_returning(expected_url)
        finder = DocumentFinder(searxng_client=mock_client)

        result = await finder.find_url("삼성화재 운전자보험")

        assert result == expected_url
        # 첫 번째 호출 쿼리에 보험사 도메인이 포함되어야 함
        first_call_query = mock_client.search.call_args_list[0].args[0]
        assert "samsungfire.com" in first_call_query
        assert "약관" in first_call_query

    @pytest.mark.asyncio
    async def test_strategy1_query_includes_filetype_pdf(self):
        """전략1 쿼리는 filetype:pdf를 포함해야 한다"""
        mock_client = self._make_client_empty()
        finder = DocumentFinder(searxng_client=mock_client)

        # 전략1~4 모두 실패하면 DuckDuckGo 폴백 → 모두 실패 → DocumentNotFoundError
        with patch.object(finder, "_try_insurer_site_search", new_callable=AsyncMock, return_value=None):
            with patch.object(finder, "_try_fss_search", new_callable=AsyncMock, return_value=None):
                with patch.object(finder, "_try_duckduckgo_search", new_callable=AsyncMock, return_value=None):
                    with pytest.raises(DocumentNotFoundError):
                        await finder.find_url("삼성화재 운전자보험")

    @pytest.mark.asyncio
    async def test_strategy1_searxng_uses_pdf_filetype_query(self):
        """전략1 SearXNG 쿼리 형식 검증: site:{domain} {product} 약관 filetype:pdf"""
        mock_client = self._make_client_empty()
        finder = DocumentFinder(searxng_client=mock_client)

        await finder._try_searxng_insurer_site(product_name="삼성화재 운전자보험")

        # 도메인과 filetype:pdf가 쿼리에 포함되어야 함
        first_call_query = mock_client.search.call_args_list[0].args[0]
        assert "samsungfire.com" in first_call_query
        assert "filetype:pdf" in first_call_query

    @pytest.mark.asyncio
    async def test_strategy2_uses_public_disclosure_domains(self):
        """전략2: 보험협회/공시 도메인(kpub.knia.or.kr, pub.insure.or.kr)으로 검색해야 한다"""
        mock_client = self._make_client_empty()
        finder = DocumentFinder(searxng_client=mock_client)

        await finder._try_searxng_public_disclosure(product_name="삼성화재 운전자보험")

        # 호출된 쿼리에 공시 도메인이 포함되어야 함
        all_queries = [call.args[0] for call in mock_client.search.call_args_list]
        assert any(
            "kpub.knia.or.kr" in q or "pub.insure.or.kr" in q
            for q in all_queries
        )

    @pytest.mark.asyncio
    async def test_strategy3_uses_pdf_filetype_without_domain(self):
        """전략3: 도메인 없이 filetype:pdf 쿼리로 검색해야 한다"""
        mock_client = self._make_client_empty()
        finder = DocumentFinder(searxng_client=mock_client)

        await finder._try_searxng_pdf_general(product_name="삼성화재 운전자보험")

        first_call_query = mock_client.search.call_args_list[0].args[0]
        assert "filetype:pdf" in first_call_query
        assert "site:" not in first_call_query  # 도메인 없이 검색

    @pytest.mark.asyncio
    async def test_strategy4_uses_general_query_without_pdf(self):
        """전략4: PDF 필터 없이 일반 약관 쿼리로 검색해야 한다"""
        mock_client = self._make_client_empty()
        finder = DocumentFinder(searxng_client=mock_client)

        await finder._try_searxng_general(product_name="삼성화재 운전자보험")

        first_call_query = mock_client.search.call_args_list[0].args[0]
        assert "약관" in first_call_query
        assert "filetype:pdf" not in first_call_query

    @pytest.mark.asyncio
    async def test_searxng_strategy2_returns_first_result_url(self):
        """전략2: 결과가 있으면 첫 번째 URL을 반환해야 한다"""
        expected_url = "https://pub.insure.or.kr/terms/sample.pdf"
        mock_client = AsyncMock(spec=SearXNGClient)
        mock_client.search.return_value = [
            SearchResult(url=expected_url, title="약관", content="약관 내용", engine="google")
        ]
        finder = DocumentFinder(searxng_client=mock_client)

        result = await finder._try_searxng_public_disclosure(product_name="삼성화재 운전자보험")

        assert result == expected_url

    @pytest.mark.asyncio
    async def test_searxng_none_falls_back_to_duckduckgo(self):
        """searxng_client=None이면 DuckDuckGo 폴백 전략을 사용해야 한다"""
        finder = DocumentFinder(searxng_client=None)
        ddg_url = "https://example.com/terms.pdf"

        with (
            patch.object(finder, "_try_insurer_site_search", new_callable=AsyncMock, return_value=None),
            patch.object(finder, "_try_fss_search", new_callable=AsyncMock, return_value=None),
            patch.object(finder, "_try_duckduckgo_search", new_callable=AsyncMock, return_value=ddg_url),
        ):
            result = await finder.find_url("알 수 없는 보험 상품")

        assert result == ddg_url


# ──────────────────────────────────────────────
# SearXNG 전략 실패 시 DuckDuckGo 폴백
# ──────────────────────────────────────────────


class TestSearXNGFallback:
    """SearXNG 전략 실패 시 DuckDuckGo 폴백 테스트"""

    @pytest.mark.asyncio
    async def test_all_searxng_strategies_fail_then_use_duckduckgo(self):
        """SearXNG 4단계 전략 모두 실패하면 DuckDuckGo 폴백을 사용해야 한다"""
        # 모든 SearXNG 검색이 빈 결과 반환
        mock_client = AsyncMock(spec=SearXNGClient)
        mock_client.search.return_value = []
        finder = DocumentFinder(searxng_client=mock_client)
        ddg_url = "https://example.com/ddg_terms.pdf"

        with patch.object(finder, "_try_duckduckgo_search", new_callable=AsyncMock, return_value=ddg_url):
            result = await finder.find_url("알 수 없는 보험 상품")

        assert result == ddg_url

    @pytest.mark.asyncio
    async def test_searxng_exception_falls_back_to_duckduckgo(self):
        """SearXNG 클라이언트가 예외를 발생시키면 DuckDuckGo로 폴백해야 한다"""
        mock_client = AsyncMock(spec=SearXNGClient)
        mock_client.search.side_effect = Exception("SearXNG 연결 실패")
        finder = DocumentFinder(searxng_client=mock_client)
        ddg_url = "https://example.com/ddg_terms.pdf"

        with patch.object(finder, "_try_duckduckgo_search", new_callable=AsyncMock, return_value=ddg_url):
            result = await finder.find_url("알 수 없는 보험 상품")

        assert result == ddg_url

    @pytest.mark.asyncio
    async def test_searxng_and_duckduckgo_both_fail_raises_error(self):
        """SearXNG와 DuckDuckGo 모두 실패하면 DocumentNotFoundError를 발생시켜야 한다"""
        mock_client = AsyncMock(spec=SearXNGClient)
        mock_client.search.return_value = []
        finder = DocumentFinder(searxng_client=mock_client)

        with (
            patch.object(finder, "_try_duckduckgo_search", new_callable=AsyncMock, return_value=None),
        ):
            with pytest.raises(DocumentNotFoundError):
                await finder.find_url("존재하지 않는 보험 상품")


# ──────────────────────────────────────────────
# 기존 DuckDuckGo 메서드 유지 확인
# ──────────────────────────────────────────────


class TestLegacyMethodsPreserved:
    """기존 DuckDuckGo 메서드가 삭제되지 않았는지 확인"""

    def test_search_duckduckgo_method_exists(self):
        """_search_duckduckgo 메서드가 존재해야 한다"""
        finder = DocumentFinder()
        assert hasattr(finder, "_search_duckduckgo")

    def test_try_insurer_site_search_method_exists(self):
        """_try_insurer_site_search 메서드가 존재해야 한다"""
        finder = DocumentFinder()
        assert hasattr(finder, "_try_insurer_site_search")

    def test_try_fss_search_method_exists(self):
        """_try_fss_search 메서드가 존재해야 한다"""
        finder = DocumentFinder()
        assert hasattr(finder, "_try_fss_search")

    def test_try_duckduckgo_search_method_exists(self):
        """_try_duckduckgo_search 메서드가 존재해야 한다"""
        finder = DocumentFinder()
        assert hasattr(finder, "_try_duckduckgo_search")
