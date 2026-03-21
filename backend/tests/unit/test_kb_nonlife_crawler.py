"""KB손해보험 크롤러 단위 테스트 (SPEC-DATA-002 Phase 3)

TDD RED 페이즈: KBNonLifeCrawler 구현 전 테스트 작성.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.crawler.base import CrawlRunResult, PolicyListing


class TestKBNonLifeCrawlerImport:
    """KBNonLifeCrawler 임포트 및 클래스 구조 테스트"""

    def test_import_kb_nonlife_crawler(self):
        """KBNonLifeCrawler 임포트 가능해야 함"""
        from app.services.crawler.companies.nonlife.kb_nonlife_crawler import KBNonLifeCrawler
        assert KBNonLifeCrawler is not None

    def test_kb_crawler_inherits_base(self):
        """KBNonLifeCrawler는 BaseCrawler를 상속해야 함"""
        from app.services.crawler.base import BaseCrawler
        from app.services.crawler.companies.nonlife.kb_nonlife_crawler import KBNonLifeCrawler
        assert issubclass(KBNonLifeCrawler, BaseCrawler)

    def test_kb_crawler_has_target_categories(self):
        """KBNonLifeCrawler는 TARGET_CATEGORIES 상수를 가져야 함"""
        from app.services.crawler.companies.nonlife.kb_nonlife_crawler import KBNonLifeCrawler
        assert hasattr(KBNonLifeCrawler, "TARGET_CATEGORIES")
        # 질병/상해 관련 카테고리 포함 확인
        cats = KBNonLifeCrawler.TARGET_CATEGORIES
        assert "상해보험" in cats
        assert "질병보험" in cats

    def test_kb_crawler_init_with_storage(self):
        """KBNonLifeCrawler는 storage만으로 초기화 가능해야 함"""
        from app.services.crawler.companies.nonlife.kb_nonlife_crawler import KBNonLifeCrawler
        mock_storage = MagicMock()
        crawler = KBNonLifeCrawler(storage=mock_storage)
        assert crawler.storage is mock_storage
        assert crawler.db_session is None

    def test_kb_crawler_has_crawler_name(self):
        """KBNonLifeCrawler는 crawler_name을 'kb-nonlife'로 설정해야 함"""
        from app.services.crawler.companies.nonlife.kb_nonlife_crawler import KBNonLifeCrawler
        mock_storage = MagicMock()
        crawler = KBNonLifeCrawler(storage=mock_storage)
        assert crawler.crawler_name == "kb-nonlife"


class TestKBNonLifeCrawlerCategoryFilter:
    """카테고리 필터링 테스트"""

    def test_filter_target_categories_includes_disease(self):
        """질병보험은 대상 카테고리에 포함돼야 함"""
        from app.services.crawler.companies.nonlife.kb_nonlife_crawler import KBNonLifeCrawler
        assert "질병보험" in KBNonLifeCrawler.TARGET_CATEGORIES

    def test_filter_target_categories_includes_injury(self):
        """상해보험은 대상 카테고리에 포함돼야 함"""
        from app.services.crawler.companies.nonlife.kb_nonlife_crawler import KBNonLifeCrawler
        assert "상해보험" in KBNonLifeCrawler.TARGET_CATEGORIES

    def test_filter_target_categories_includes_integrated(self):
        """통합보험은 대상 카테고리에 포함돼야 함"""
        from app.services.crawler.companies.nonlife.kb_nonlife_crawler import KBNonLifeCrawler
        assert "통합보험" in KBNonLifeCrawler.TARGET_CATEGORIES

    def test_filter_target_categories_includes_driver(self):
        """운전자보험은 대상 카테고리에 포함돼야 함"""
        from app.services.crawler.companies.nonlife.kb_nonlife_crawler import KBNonLifeCrawler
        assert "운전자보험" in KBNonLifeCrawler.TARGET_CATEGORIES

    def test_is_target_category_returns_true_for_disease(self):
        """질병보험은 _is_target_category에서 True 반환"""
        from app.services.crawler.companies.nonlife.kb_nonlife_crawler import KBNonLifeCrawler
        mock_storage = MagicMock()
        crawler = KBNonLifeCrawler(storage=mock_storage)
        assert crawler._is_target_category("질병보험") is True

    def test_is_target_category_returns_false_for_auto(self):
        """자동차보험은 _is_target_category에서 False 반환"""
        from app.services.crawler.companies.nonlife.kb_nonlife_crawler import KBNonLifeCrawler
        mock_storage = MagicMock()
        crawler = KBNonLifeCrawler(storage=mock_storage)
        assert crawler._is_target_category("자동차보험") is False


class TestKBNonLifeCrawlerParseListings:
    """parse_listing 테스트"""

    @pytest.mark.asyncio
    async def test_parse_listing_returns_list(self):
        """parse_listing은 리스트를 반환해야 함"""
        from app.services.crawler.companies.nonlife.kb_nonlife_crawler import KBNonLifeCrawler
        mock_storage = MagicMock()
        crawler = KBNonLifeCrawler(storage=mock_storage)

        # Playwright page mock
        mock_page = AsyncMock()
        # 페이지에서 상품 데이터 반환 (질병보험 카테고리)
        mock_page.evaluate = AsyncMock(return_value=[
            {
                "code": "12345",
                "catCode": "Q",
                "seq": "1",
                "name": "KB 건강보험 테스트",
                "status": "판매중",
                "category": "질병보험",
            }
        ])

        result = await crawler.parse_listing(mock_page)
        assert isinstance(result, list)

    @pytest.mark.asyncio
    async def test_parse_listing_filters_non_target_categories(self):
        """parse_listing은 대상 카테고리가 아닌 상품을 제외해야 함"""
        from app.services.crawler.companies.nonlife.kb_nonlife_crawler import KBNonLifeCrawler
        mock_storage = MagicMock()
        crawler = KBNonLifeCrawler(storage=mock_storage)

        mock_page = AsyncMock()
        # 자동차보험은 제외, 질병보험은 포함
        mock_page.evaluate = AsyncMock(return_value=[
            {
                "code": "11111",
                "catCode": "A",
                "seq": "1",
                "name": "자동차 보험",
                "status": "판매중",
                "category": "자동차보험",
            },
            {
                "code": "22222",
                "catCode": "Q",
                "seq": "1",
                "name": "질병 보험",
                "status": "판매중",
                "category": "질병보험",
            },
        ])

        result = await crawler.parse_listing(mock_page)
        assert len(result) == 1
        assert result[0].product_name == "질병 보험"

    @pytest.mark.asyncio
    async def test_parse_listing_returns_policy_listing_instances(self):
        """parse_listing은 PolicyListing 인스턴스 목록을 반환해야 함"""
        from app.services.crawler.companies.nonlife.kb_nonlife_crawler import KBNonLifeCrawler
        mock_storage = MagicMock()
        crawler = KBNonLifeCrawler(storage=mock_storage)

        mock_page = AsyncMock()
        mock_page.evaluate = AsyncMock(return_value=[
            {
                "code": "12345",
                "catCode": "Q",
                "seq": "1",
                "name": "KB 건강보험",
                "status": "판매중",
                "category": "질병보험",
            }
        ])

        result = await crawler.parse_listing(mock_page)
        assert len(result) == 1
        assert isinstance(result[0], PolicyListing)
        assert result[0].company_code == "kb-nonlife"
        assert result[0].category == "질병보험"


class TestKBNonLifeCrawlerDetectChanges:
    """detect_changes 테스트"""

    @pytest.mark.asyncio
    async def test_detect_changes_skips_existing_pdfs(self):
        """이미 다운로드된 PDF는 스킵해야 함"""
        from app.services.crawler.companies.nonlife.kb_nonlife_crawler import KBNonLifeCrawler
        from app.services.crawler.base import DeltaResult
        mock_storage = MagicMock()
        # 이미 존재하는 파일로 mock
        mock_storage.exists = MagicMock(return_value=True)

        crawler = KBNonLifeCrawler(storage=mock_storage)
        listing = PolicyListing(
            company_name="KB손해보험",
            product_name="KB 건강보험",
            product_code="12345",
            category="질병보험",
            pdf_url="https://www.kbinsure.co.kr/pdf/test.pdf",
            company_code="kb-nonlife",
        )

        result = await crawler.detect_changes([listing])
        assert isinstance(result, DeltaResult)
        # 이미 존재하면 new가 아닌 unchanged로 분류
        assert len(result.unchanged) == 1
        assert len(result.new) == 0

    @pytest.mark.asyncio
    async def test_detect_changes_new_pdfs_added(self):
        """새 PDF는 new 목록에 추가돼야 함"""
        from app.services.crawler.companies.nonlife.kb_nonlife_crawler import KBNonLifeCrawler
        from app.services.crawler.base import DeltaResult
        mock_storage = MagicMock()
        # 존재하지 않는 파일로 mock
        mock_storage.exists = MagicMock(return_value=False)

        crawler = KBNonLifeCrawler(storage=mock_storage)
        listing = PolicyListing(
            company_name="KB손해보험",
            product_name="KB 건강보험",
            product_code="12345",
            category="질병보험",
            pdf_url="https://www.kbinsure.co.kr/pdf/test.pdf",
            company_code="kb-nonlife",
        )

        result = await crawler.detect_changes([listing])
        assert isinstance(result, DeltaResult)
        assert len(result.new) == 1
        assert len(result.unchanged) == 0


def _make_pw_mock(mock_page: AsyncMock) -> AsyncMock:
    """Playwright 컨텍스트 매니저 전체를 반환하는 헬퍼"""
    mock_context = AsyncMock()
    mock_context.new_page = AsyncMock(return_value=mock_page)

    mock_browser = AsyncMock()
    mock_browser.new_context = AsyncMock(return_value=mock_context)
    mock_browser.close = AsyncMock()

    mock_pw_instance = AsyncMock()
    mock_pw_instance.chromium = MagicMock()
    mock_pw_instance.chromium.launch = AsyncMock(return_value=mock_browser)
    mock_pw_instance.__aenter__ = AsyncMock(return_value=mock_pw_instance)
    mock_pw_instance.__aexit__ = AsyncMock(return_value=None)

    return mock_pw_instance


class TestKBNonLifeCrawlerCrawl:
    """crawl() 통합 테스트"""

    @pytest.mark.asyncio
    async def test_crawl_returns_crawl_run_result(self):
        """crawl()은 CrawlRunResult를 반환해야 함"""
        import sys
        import types

        from app.services.crawler.companies.nonlife.kb_nonlife_crawler import KBNonLifeCrawler
        mock_storage = MagicMock()
        mock_storage.exists = MagicMock(return_value=True)
        mock_storage.save = MagicMock()

        crawler = KBNonLifeCrawler(storage=mock_storage)

        # Playwright 페이지 mock
        mock_page = AsyncMock()
        mock_page.goto = AsyncMock()
        mock_page.evaluate = AsyncMock(side_effect=[
            [{"code": "12345", "catCode": "Q", "seq": "1", "name": "KB 건강보험",
              "status": "판매중", "category": "질병보험"}],
            False,
        ])

        mock_pw_instance = _make_pw_mock(mock_page)

        # playwright 모듈을 sys.modules에 mock으로 등록
        mock_playwright_module = types.ModuleType("playwright")
        mock_async_api = types.ModuleType("playwright.async_api")
        mock_async_api.async_playwright = MagicMock(return_value=mock_pw_instance)
        mock_playwright_module.async_api = mock_async_api

        with patch.dict(sys.modules, {
            "playwright": mock_playwright_module,
            "playwright.async_api": mock_async_api,
        }):
            result = await crawler.crawl()

        assert isinstance(result, CrawlRunResult)
        assert result.total_found >= 0

    @pytest.mark.asyncio
    async def test_crawl_skips_already_downloaded(self):
        """이미 다운로드된 파일은 skipped_count에 반영돼야 함"""
        import sys
        import types

        from app.services.crawler.companies.nonlife.kb_nonlife_crawler import KBNonLifeCrawler
        mock_storage = MagicMock()
        mock_storage.exists = MagicMock(return_value=True)

        crawler = KBNonLifeCrawler(storage=mock_storage)

        mock_page = AsyncMock()
        mock_page.goto = AsyncMock()
        mock_page.evaluate = AsyncMock(side_effect=[
            [{"code": "12345", "catCode": "Q", "seq": "1", "name": "KB 건강보험",
              "status": "판매중", "category": "질병보험"}],
            False,
        ])

        mock_pw_instance = _make_pw_mock(mock_page)

        mock_playwright_module = types.ModuleType("playwright")
        mock_async_api = types.ModuleType("playwright.async_api")
        mock_async_api.async_playwright = MagicMock(return_value=mock_pw_instance)
        mock_playwright_module.async_api = mock_async_api

        with patch.dict(sys.modules, {
            "playwright": mock_playwright_module,
            "playwright.async_api": mock_async_api,
        }):
            result = await crawler.crawl()

        assert result.skipped_count >= 1
