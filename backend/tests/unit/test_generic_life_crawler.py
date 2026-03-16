"""GenericLifeCrawler 테스트 (SPEC-CRAWLER-002)

YAML 설정 기반 생명보험사 범용 크롤러 단위 테스트.
Playwright는 Mock으로 대체.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.crawler.base import CrawlRunResult, PolicyListing, SaleStatus
from app.services.crawler.companies.life.generic_life import GenericLifeCrawler
from app.services.crawler.config_loader import (
    CompanyCrawlerConfig,
    PaginationConfig,
    SelectorConfig,
)
from app.services.crawler.storage import LocalFileStorage


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def sample_config() -> CompanyCrawlerConfig:
    """테스트용 CompanyCrawlerConfig"""
    return CompanyCrawlerConfig(
        company_name="테스트보험",
        company_code="test-ins",
        category="LIFE",
        base_url="https://test.example.com",
        listing_url="https://test.example.com/terms/list",
        selectors=SelectorConfig(
            listing_container="table tbody tr",
            product_name="td:nth-child(2)",
            product_code="td:nth-child(1)",
            pdf_link="a[href*='.pdf']",
            next_page=".paging .next",
        ),
        pagination=PaginationConfig(type="numbered", max_pages=5),
        rate_limit_seconds=0.0,  # 테스트에서 대기 없음
        timeout_ms=5000,
    )


@pytest.fixture
def mock_storage(tmp_path) -> LocalFileStorage:
    """테스트용 로컬 스토리지"""
    return LocalFileStorage(base_dir=str(tmp_path / "pdfs"))


@pytest.fixture
def crawler(sample_config, mock_storage) -> GenericLifeCrawler:
    """테스트용 GenericLifeCrawler 인스턴스"""
    return GenericLifeCrawler(config=sample_config, storage=mock_storage)


# ---------------------------------------------------------------------------
# 생성자 테스트
# ---------------------------------------------------------------------------


class TestGenericLifeCrawlerConstructor:
    """GenericLifeCrawler 생성자 테스트"""

    def test_constructor_sets_config(self, sample_config, mock_storage):
        """config 속성이 올바르게 설정되어야 함"""
        crawler = GenericLifeCrawler(config=sample_config, storage=mock_storage)
        assert crawler.config == sample_config

    def test_constructor_sets_storage(self, sample_config, mock_storage):
        """storage 속성이 올바르게 설정되어야 함"""
        crawler = GenericLifeCrawler(config=sample_config, storage=mock_storage)
        assert crawler.storage == mock_storage

    def test_constructor_uses_config_rate_limit(self, sample_config, mock_storage):
        """rate_limit_seconds가 config에서 설정되어야 함"""
        crawler = GenericLifeCrawler(config=sample_config, storage=mock_storage)
        assert crawler.rate_limit_seconds == sample_config.rate_limit_seconds

    def test_constructor_inherits_base_crawler(self, sample_config, mock_storage):
        """BaseCrawler를 상속해야 함"""
        from app.services.crawler.base import BaseCrawler
        crawler = GenericLifeCrawler(config=sample_config, storage=mock_storage)
        assert isinstance(crawler, BaseCrawler)


# ---------------------------------------------------------------------------
# parse_listing() 테스트
# ---------------------------------------------------------------------------


class TestParseListingMethod:
    """parse_listing() 메서드 테스트 (Playwright Mock 사용)"""

    @pytest.mark.asyncio
    async def test_parse_listing_returns_list(self, crawler):
        """parse_listing()은 항상 리스트를 반환"""
        mock_page = MagicMock()
        mock_page.query_selector_all = AsyncMock(return_value=[])

        result = await crawler.parse_listing(mock_page)
        assert isinstance(result, list)

    @pytest.mark.asyncio
    async def test_parse_listing_with_empty_page(self, crawler):
        """빈 페이지에서 빈 리스트 반환"""
        mock_page = MagicMock()
        mock_page.query_selector_all = AsyncMock(return_value=[])

        result = await crawler.parse_listing(mock_page)
        assert result == []

    @pytest.mark.asyncio
    async def test_parse_listing_default_sale_status(self, crawler):
        """기본 parse_listing은 ON_SALE 상태로 파싱"""
        mock_page = MagicMock()
        mock_page.query_selector_all = AsyncMock(return_value=[])

        result = await crawler.parse_listing(mock_page, sale_status=SaleStatus.ON_SALE)
        assert isinstance(result, list)


# ---------------------------------------------------------------------------
# crawl() 테스트
# ---------------------------------------------------------------------------


class TestCrawlMethod:
    """crawl() 메서드 테스트"""

    def _make_mock_playwright(self):
        """Playwright Mock 헬퍼"""
        mock_pw_instance = MagicMock()
        mock_browser = AsyncMock()
        mock_page = AsyncMock()
        mock_page.query_selector_all = AsyncMock(return_value=[])
        mock_page.goto = AsyncMock()
        mock_page.wait_for_load_state = AsyncMock()
        mock_page.query_selector = AsyncMock(return_value=None)
        mock_page.close = AsyncMock()

        mock_browser.new_page = AsyncMock(return_value=mock_page)
        mock_browser.close = AsyncMock()
        mock_pw_instance.chromium.launch = AsyncMock(return_value=mock_browser)
        mock_pw_instance.__aenter__ = AsyncMock(return_value=mock_pw_instance)
        mock_pw_instance.__aexit__ = AsyncMock(return_value=None)

        return mock_pw_instance

    @pytest.mark.asyncio
    async def test_crawl_returns_crawl_run_result(self, crawler):
        """crawl()은 CrawlRunResult를 반환"""
        mock_pw_instance = self._make_mock_playwright()

        with patch("playwright.async_api.async_playwright", return_value=mock_pw_instance):
            # import 자체를 성공시키되 playwright를 mock으로
            import sys
            # playwright가 설치된 경우 ImportError를 강제해서 빈 결과 반환 경로 테스트
            with patch.object(
                __import__("app.services.crawler.companies.life.generic_life",
                           fromlist=["GenericLifeCrawler"]),
                "__name__",
                "app.services.crawler.companies.life.generic_life",
            ):
                pass

        # playwright ImportError를 테스트하여 빈 결과 반환 확인
        with patch("builtins.__import__", side_effect=self._import_side_effect):
            result = await crawler.crawl()
        assert isinstance(result, CrawlRunResult)

    def _import_side_effect(self, name, *args, **kwargs):
        """playwright import를 실패시키는 side effect"""
        if name == "playwright.async_api" or name == "playwright":
            raise ImportError("mock playwright not installed")
        import builtins
        return builtins.__import__(name, *args, **kwargs)

    @pytest.mark.asyncio
    async def test_crawl_handles_playwright_import_error(self, crawler):
        """playwright 미설치 시 빈 결과 반환 (크래시 없음)"""
        original_import = __builtins__.__import__ if hasattr(__builtins__, "__import__") else __import__

        import builtins
        original = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if name in ("playwright", "playwright.async_api"):
                raise ImportError("playwright not installed")
            return original(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=mock_import):
            result = await crawler.crawl()

        assert isinstance(result, CrawlRunResult)
        assert result.total_found == 0

    @pytest.mark.asyncio
    async def test_crawl_result_has_all_fields(self, crawler):
        """CrawlRunResult에 모든 필드가 있어야 함"""
        import builtins
        original = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if name in ("playwright", "playwright.async_api"):
                raise ImportError("playwright not installed")
            return original(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=mock_import):
            result = await crawler.crawl()

        assert hasattr(result, "total_found")
        assert hasattr(result, "new_count")
        assert hasattr(result, "updated_count")
        assert hasattr(result, "skipped_count")
        assert hasattr(result, "failed_count")
        assert hasattr(result, "results")


# ---------------------------------------------------------------------------
# detect_changes() 테스트
# ---------------------------------------------------------------------------


class TestDetectChangesMethod:
    """detect_changes() 변경 감지 테스트"""

    @pytest.mark.asyncio
    async def test_detect_changes_empty_list(self, crawler):
        """빈 목록으로 detect_changes() 호출 시 모든 카운트 0"""
        from app.services.crawler.base import DeltaResult
        result = await crawler.detect_changes([])
        assert isinstance(result, DeltaResult)
        assert result.new == []
        assert result.updated == []
        assert result.unchanged == []

    @pytest.mark.asyncio
    async def test_detect_changes_all_new(self, crawler):
        """storage에 없는 항목은 모두 신규로 분류"""
        listings = [
            PolicyListing(
                company_name="테스트보험",
                product_name=f"상품{i}",
                product_code=f"T-{i:03d}",
                category="LIFE",
                pdf_url=f"https://test.example.com/p{i}.pdf",
                company_code="test-ins",
            )
            for i in range(3)
        ]
        from app.services.crawler.base import DeltaResult
        result = await crawler.detect_changes(listings)
        assert isinstance(result, DeltaResult)
        # storage에 아무것도 없으므로 모두 신규
        assert len(result.new) + len(result.updated) == 3
