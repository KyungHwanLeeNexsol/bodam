"""JIT RAG 문서 파인더 테스트 (SPEC-JIT-001 P2)

DocumentFinder의 3단계 전략 테스트:
  1. 직접 보험사 URL 매핑
  2. 보험협회/금감원 공시 도메인 검색 (FSS)
  3. DuckDuckGo 검색 폴백
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import httpx

from app.services.jit_rag.document_finder import (
    DocumentFinder,
    DocumentNotFoundError,
    INSURER_MAPPING,
    _LIFE_KEYWORDS,
    _NON_LIFE_KEYWORDS,
)


# ──────────────────────────────────────────────
# 전략 1: 직접 매핑 테스트
# ──────────────────────────────────────────────


class TestDirectMapping:
    """보험사 직접 URL 매핑 테스트"""

    def test_known_insurer_returns_url(self):
        """주요 보험사 이름이 포함된 상품명은 직접 URL을 반환해야 한다"""
        finder = DocumentFinder()
        url = finder._try_direct_mapping("삼성화재 운전자보험")
        assert url == "https://www.samsungfire.com/SFPF100024M.action"

    def test_unknown_insurer_returns_none(self):
        """매핑에 없는 보험사는 None을 반환해야 한다"""
        finder = DocumentFinder()
        url = finder._try_direct_mapping("미지보험 알 수 없는 상품")
        assert url is None

    def test_life_insurer_mapped(self):
        """생명보험사 매핑이 동작해야 한다"""
        finder = DocumentFinder()
        url = finder._try_direct_mapping("교보생명 종신보험")
        assert url == "https://www.kyobo.co.kr/"

    def test_insurer_mapping_has_25_entries(self):
        """INSURER_MAPPING은 최소 25개 보험사를 포함해야 한다"""
        assert len(INSURER_MAPPING) >= 25

    @pytest.mark.parametrize("insurer", [
        "삼성화재", "현대해상", "KB손보", "메리츠화재",
        "삼성생명", "교보생명", "한화생명", "미래에셋생명",
    ])
    def test_all_major_insurers_are_mapped(self, insurer: str):
        """주요 보험사가 모두 매핑되어 있어야 한다"""
        assert insurer in INSURER_MAPPING


# ──────────────────────────────────────────────
# 전략 2: FSS/보험협회 타겟 검색 테스트
# ──────────────────────────────────────────────


class TestFSSSearch:
    """보험협회/금감원 공시 도메인 타겟 검색 테스트"""

    def test_life_keywords_classification(self):
        """생명보험 키워드가 올바르게 분류되어야 한다"""
        assert "생명" in _LIFE_KEYWORDS
        assert "종신" in _LIFE_KEYWORDS
        assert "연금" in _LIFE_KEYWORDS

    def test_non_life_keywords_classification(self):
        """손해보험 키워드가 올바르게 분류되어야 한다"""
        assert "화재" in _NON_LIFE_KEYWORDS
        assert "운전자보험" in _NON_LIFE_KEYWORDS or "손보" in _NON_LIFE_KEYWORDS

    @pytest.mark.asyncio
    async def test_fss_search_returns_none_on_network_error(self):
        """네트워크 오류 시 None을 반환해야 한다 (예외 전파 없음)"""
        finder = DocumentFinder()
        with patch.object(finder, "_search_portal_domain", new_callable=AsyncMock) as mock_search:
            mock_search.side_effect = Exception("네트워크 오류")
            result = await finder._try_fss_search("알 수 없는 상품명")
        assert result is None

    @pytest.mark.asyncio
    async def test_fss_search_tries_life_domains_for_life_product(self):
        """생명보험 상품은 생보협회 도메인(klia.or.kr)을 먼저 검색해야 한다"""
        finder = DocumentFinder()
        called_domains: list[str] = []

        async def mock_search(product_name: str, domain: str) -> str | None:
            called_domains.append(domain)
            return None

        with patch.object(finder, "_search_portal_domain", side_effect=mock_search):
            await finder._try_fss_search("교보생명 종신보험")

        assert "klia.or.kr" in called_domains
        # 생명보험은 손보협회 도메인을 먼저 시도하면 안 됨
        if called_domains:
            assert called_domains[0] == "klia.or.kr"

    @pytest.mark.asyncio
    async def test_fss_search_tries_non_life_domains_for_non_life_product(self):
        """손해보험 상품은 손보협회 도메인(knia.or.kr)을 먼저 검색해야 한다"""
        finder = DocumentFinder()
        called_domains: list[str] = []

        async def mock_search(product_name: str, domain: str) -> str | None:
            called_domains.append(domain)
            return None

        with patch.object(finder, "_search_portal_domain", side_effect=mock_search):
            await finder._try_fss_search("삼성화재 운전자보험")

        assert "knia.or.kr" in called_domains
        if called_domains:
            assert called_domains[0] == "knia.or.kr"

    @pytest.mark.asyncio
    async def test_fss_search_returns_found_url(self):
        """FSS 검색에서 URL을 찾으면 반환해야 한다"""
        finder = DocumentFinder()
        expected_url = "https://www.klia.or.kr/terms/sample.pdf"

        async def mock_search(product_name: str, domain: str) -> str | None:
            if domain == "klia.or.kr":
                return expected_url
            return None

        with patch.object(finder, "_search_portal_domain", side_effect=mock_search):
            result = await finder._try_fss_search("NH농협생명 연금보험")

        assert result == expected_url

    @pytest.mark.asyncio
    async def test_search_portal_domain_parses_pdf_url(self):
        """포털 도메인 검색에서 PDF URL을 올바르게 파싱해야 한다"""
        finder = DocumentFinder()
        fake_html = '''
        <html><body>
        <a href="https://www.klia.or.kr/data/terms/sample.pdf">약관 다운로드</a>
        <a href="https://other.com/file.pdf">다른 파일</a>
        </body></html>
        '''

        mock_response = MagicMock()
        mock_response.text = fake_html
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.get = AsyncMock(return_value=mock_response)

        with patch("app.services.jit_rag.document_finder.httpx.AsyncClient", return_value=mock_client):
            result = await finder._search_portal_domain("생명보험 약관", "klia.or.kr")

        assert result == "https://www.klia.or.kr/data/terms/sample.pdf"

    @pytest.mark.asyncio
    async def test_search_portal_domain_returns_none_when_no_pdf(self):
        """해당 도메인에 PDF가 없으면 None을 반환해야 한다"""
        finder = DocumentFinder()
        fake_html = '<html><body><a href="https://other.com/file.pdf">다른 파일</a></body></html>'

        mock_response = MagicMock()
        mock_response.text = fake_html
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.get = AsyncMock(return_value=mock_response)

        with patch("app.services.jit_rag.document_finder.httpx.AsyncClient", return_value=mock_client):
            result = await finder._search_portal_domain("생명보험 약관", "klia.or.kr")

        assert result is None


# ──────────────────────────────────────────────
# 전략 3: DuckDuckGo 폴백 테스트
# ──────────────────────────────────────────────


class TestDuckDuckGoSearch:
    """DuckDuckGo 전역 검색 폴백 테스트"""

    @pytest.mark.asyncio
    async def test_duckduckgo_returns_pdf_url(self):
        """DuckDuckGo 검색 결과에서 PDF URL을 반환해야 한다"""
        finder = DocumentFinder()
        fake_html = '''
        <html><body>
        <a href="https://www.samsungfire.com/terms/driver.pdf">운전자보험 약관</a>
        </body></html>
        '''

        mock_response = MagicMock()
        mock_response.text = fake_html
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.get = AsyncMock(return_value=mock_response)

        with patch("app.services.jit_rag.document_finder.httpx.AsyncClient", return_value=mock_client):
            result = await finder._try_duckduckgo_search("삼성화재 운전자보험")

        assert result is not None
        assert result.endswith(".pdf")

    @pytest.mark.asyncio
    async def test_duckduckgo_returns_none_on_timeout(self):
        """타임아웃 시 None을 반환해야 한다 (예외 전파 없음)"""
        finder = DocumentFinder()

        with patch("app.services.jit_rag.document_finder.httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.get = AsyncMock(side_effect=httpx.TimeoutException("타임아웃"))
            mock_cls.return_value = mock_client

            result = await finder._try_duckduckgo_search("알 수 없는 보험 상품")

        assert result is None


# ──────────────────────────────────────────────
# 전체 find_url 플로우 테스트
# ──────────────────────────────────────────────


class TestFindUrl:
    """find_url 전체 흐름 테스트"""

    @pytest.mark.asyncio
    async def test_direct_mapping_takes_priority(self):
        """전략1(직접 매핑)이 성공하면 전략2,3을 시도하지 않아야 한다"""
        finder = DocumentFinder()
        with (
            patch.object(finder, "_try_fss_search", new_callable=AsyncMock) as mock_fss,
            patch.object(finder, "_try_duckduckgo_search", new_callable=AsyncMock) as mock_ddg,
        ):
            result = await finder.find_url("삼성화재 운전자보험")

        assert result == "https://www.samsungfire.com/SFPF100024M.action"
        mock_fss.assert_not_called()
        mock_ddg.assert_not_called()

    @pytest.mark.asyncio
    async def test_falls_through_to_fss_when_mapping_fails(self):
        """전략1 실패 시 전략2(FSS)를 시도해야 한다"""
        finder = DocumentFinder()
        fss_url = "https://klia.or.kr/terms/sample.pdf"

        with patch.object(finder, "_try_fss_search", new_callable=AsyncMock, return_value=fss_url):
            result = await finder.find_url("미지보험사 생명보험")

        assert result == fss_url

    @pytest.mark.asyncio
    async def test_falls_through_to_duckduckgo_when_fss_fails(self):
        """전략1,2 모두 실패 시 전략3(DuckDuckGo)을 시도해야 한다"""
        finder = DocumentFinder()
        ddg_url = "https://example.com/terms.pdf"

        with (
            patch.object(finder, "_try_fss_search", new_callable=AsyncMock, return_value=None),
            patch.object(finder, "_try_duckduckgo_search", new_callable=AsyncMock, return_value=ddg_url),
        ):
            result = await finder.find_url("미지보험사 알 수 없는 상품")

        assert result == ddg_url

    @pytest.mark.asyncio
    async def test_raises_document_not_found_when_all_fail(self):
        """모든 전략 실패 시 DocumentNotFoundError를 발생시켜야 한다"""
        finder = DocumentFinder()

        with (
            patch.object(finder, "_try_fss_search", new_callable=AsyncMock, return_value=None),
            patch.object(finder, "_try_duckduckgo_search", new_callable=AsyncMock, return_value=None),
        ):
            with pytest.raises(DocumentNotFoundError):
                await finder.find_url("존재하지 않는 보험 상품")
