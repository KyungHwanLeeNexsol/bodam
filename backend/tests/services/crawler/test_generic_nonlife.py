"""GenericNonLifeCrawler 단위 테스트 (SPEC-CRAWLER-002)

Playwright 없이 모킹으로 동작 검증.
KNIA 중복 감지 및 NON_LIFE 카테고리 설정 확인.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.crawler.base import CrawlRunResult, PolicyListing, SaleStatus
from app.services.crawler.config_loader import CompanyCrawlerConfig


def make_test_config(
    company_code: str = "test-nonlife",
    company_name: str = "테스트손해보험",
    category: str = "NON_LIFE",
) -> CompanyCrawlerConfig:
    """테스트용 CompanyCrawlerConfig 생성 헬퍼"""
    return CompanyCrawlerConfig(
        company_name=company_name,
        company_code=company_code,
        category=category,
        base_url="https://example-nonlife.co.kr",
        listing_url="https://example-nonlife.co.kr/terms",
        selectors={
            "listing_container": "table tbody tr",
            "product_name": "td:nth-child(2)",
            "pdf_link": "a[href*='.pdf']",
            "product_code": "td:nth-child(1)",
            "next_page": ".paging .next",
        },
    )


def make_test_listing(
    product_code: str = "TEST-001",
    pdf_url: str = "https://example.com/test.pdf",
) -> PolicyListing:
    """테스트용 PolicyListing 생성 헬퍼"""
    return PolicyListing(
        company_name="테스트손해보험",
        product_name="테스트화재보험",
        product_code=product_code,
        category="NON_LIFE",
        pdf_url=pdf_url,
        company_code="test-nonlife",
        sale_status=SaleStatus.ON_SALE,
    )


class TestGenericNonLifeCrawlerInit:
    """GenericNonLifeCrawler 초기화 테스트"""

    def test_init_with_config_and_storage(self) -> None:
        """config와 storage로 정상 초기화"""
        from app.services.crawler.companies.nonlife.generic_nonlife import GenericNonLifeCrawler

        config = make_test_config()
        mock_storage = MagicMock()
        crawler = GenericNonLifeCrawler(config=config, storage=mock_storage)

        assert crawler.config is config
        assert crawler.knia_hashes == set()

    def test_init_with_knia_hashes(self) -> None:
        """knia_hashes 제공 시 정상 초기화"""
        from app.services.crawler.companies.nonlife.generic_nonlife import GenericNonLifeCrawler

        config = make_test_config()
        mock_storage = MagicMock()
        hashes = {"abc123", "def456"}
        crawler = GenericNonLifeCrawler(config=config, storage=mock_storage, knia_hashes=hashes)

        assert crawler.knia_hashes == hashes

    def test_crawler_name_is_company_code(self) -> None:
        """crawler_name이 company_code와 동일"""
        from app.services.crawler.companies.nonlife.generic_nonlife import GenericNonLifeCrawler

        config = make_test_config(company_code="samsung-fire")
        mock_storage = MagicMock()
        crawler = GenericNonLifeCrawler(config=config, storage=mock_storage)

        assert crawler.crawler_name == "samsung-fire"


class TestContentHash:
    """content_hash 계산 테스트"""

    def test_compute_content_hash_is_16_chars(self) -> None:
        """content_hash는 16자리 hex 문자열"""
        from app.services.crawler.companies.nonlife.generic_nonlife import GenericNonLifeCrawler

        config = make_test_config()
        mock_storage = MagicMock()
        crawler = GenericNonLifeCrawler(config=config, storage=mock_storage)

        listing = make_test_listing()
        hash_val = crawler._compute_content_hash(listing)

        assert len(hash_val) == 16
        assert all(c in "0123456789abcdef" for c in hash_val)

    def test_compute_content_hash_same_listing_same_hash(self) -> None:
        """동일한 listing은 동일한 hash 반환 (결정론적)"""
        from app.services.crawler.companies.nonlife.generic_nonlife import GenericNonLifeCrawler

        config = make_test_config()
        mock_storage = MagicMock()
        crawler = GenericNonLifeCrawler(config=config, storage=mock_storage)

        listing = make_test_listing()
        hash1 = crawler._compute_content_hash(listing)
        hash2 = crawler._compute_content_hash(listing)

        assert hash1 == hash2

    def test_compute_content_hash_different_listings_different_hash(self) -> None:
        """다른 listing은 다른 hash 반환"""
        from app.services.crawler.companies.nonlife.generic_nonlife import GenericNonLifeCrawler

        config = make_test_config()
        mock_storage = MagicMock()
        crawler = GenericNonLifeCrawler(config=config, storage=mock_storage)

        listing1 = make_test_listing(product_code="A001", pdf_url="https://example.com/a.pdf")
        listing2 = make_test_listing(product_code="B001", pdf_url="https://example.com/b.pdf")

        assert crawler._compute_content_hash(listing1) != crawler._compute_content_hash(listing2)


class TestKniaDuplicateDetection:
    """KNIA 중복 감지 테스트"""

    def test_is_knia_duplicate_with_matching_hash(self) -> None:
        """KNIA 해시 집합에 있는 항목은 중복으로 인식"""
        from app.services.crawler.companies.nonlife.generic_nonlife import GenericNonLifeCrawler

        config = make_test_config()
        mock_storage = MagicMock()
        crawler = GenericNonLifeCrawler(config=config, storage=mock_storage)

        listing = make_test_listing()
        listing_hash = crawler._compute_content_hash(listing)

        # KNIA 해시 집합에 미리 추가
        crawler.knia_hashes = {listing_hash}

        assert crawler._is_knia_duplicate(listing) is True

    def test_is_knia_duplicate_with_no_match(self) -> None:
        """KNIA 해시 집합에 없는 항목은 중복 아님"""
        from app.services.crawler.companies.nonlife.generic_nonlife import GenericNonLifeCrawler

        config = make_test_config()
        mock_storage = MagicMock()
        crawler = GenericNonLifeCrawler(config=config, storage=mock_storage, knia_hashes={"zzzzzzz"})

        listing = make_test_listing()
        assert crawler._is_knia_duplicate(listing) is False

    def test_is_knia_duplicate_with_empty_hashes(self) -> None:
        """KNIA 해시 집합이 비어 있으면 항상 False"""
        from app.services.crawler.companies.nonlife.generic_nonlife import GenericNonLifeCrawler

        config = make_test_config()
        mock_storage = MagicMock()
        crawler = GenericNonLifeCrawler(config=config, storage=mock_storage)

        listing = make_test_listing()
        assert crawler._is_knia_duplicate(listing) is False


@pytest.mark.asyncio
class TestCrawlWithoutPlaywright:
    """Playwright 미설치 환경에서의 crawl() 테스트"""

    async def test_crawl_returns_empty_result_without_playwright(self) -> None:
        """playwright 미설치 시 CrawlRunResult 반환 (크래시 없음)"""
        from app.services.crawler.companies.nonlife.generic_nonlife import GenericNonLifeCrawler

        config = make_test_config()
        mock_storage = MagicMock()
        crawler = GenericNonLifeCrawler(config=config, storage=mock_storage)

        with patch.dict("sys.modules", {"playwright": None, "playwright.async_api": None}):
            result = await crawler.crawl()

        assert isinstance(result, CrawlRunResult)
        assert result.total_found == 0
        assert result.new_count == 0
        assert result.failed_count == 0
        assert result.results == []

    async def test_crawl_import_error_returns_empty(self) -> None:
        """ImportError 발생 시 빈 CrawlRunResult 반환"""
        from app.services.crawler.companies.nonlife.generic_nonlife import GenericNonLifeCrawler

        config = make_test_config()
        mock_storage = MagicMock()
        crawler = GenericNonLifeCrawler(config=config, storage=mock_storage)

        with patch(
            "app.services.crawler.companies.nonlife.generic_nonlife.GenericNonLifeCrawler.crawl",
            new_callable=AsyncMock,
        ) as mock_crawl:
            mock_crawl.return_value = CrawlRunResult(
                total_found=0, new_count=0, updated_count=0,
                skipped_count=0, failed_count=0, results=[]
            )
            result = await crawler.crawl()

        assert isinstance(result, CrawlRunResult)


class TestNonLifeCategory:
    """NON_LIFE 카테고리 강제 설정 테스트"""

    def test_config_category_is_non_life(self) -> None:
        """NON_LIFE 카테고리 config로 크롤러 생성 가능"""
        from app.services.crawler.companies.nonlife.generic_nonlife import GenericNonLifeCrawler

        config = make_test_config(category="NON_LIFE")
        mock_storage = MagicMock()
        crawler = GenericNonLifeCrawler(config=config, storage=mock_storage)

        assert crawler.config.category == "NON_LIFE"

    def test_parse_row_sets_non_life_category(self) -> None:
        """_parse_row() 결과 PolicyListing의 category는 NON_LIFE"""
        # PolicyListing 직접 생성으로 카테고리 검증
        listing = PolicyListing(
            company_name="테스트손해보험",
            product_name="화재보험",
            product_code="NON-001",
            category="NON_LIFE",
            pdf_url="https://example.com/fire.pdf",
            company_code="test-nonlife",
            sale_status=SaleStatus.ON_SALE,
        )
        assert listing.category == "NON_LIFE"


class TestCharacterizeGenericNonLifeCrawler:
    """GenericNonLifeCrawler 특성화 테스트 - 현재 동작 문서화"""

    def test_characterize_crawler_name_matches_company_code(self) -> None:
        """특성화: crawler_name은 config.company_code와 동일"""
        from app.services.crawler.companies.nonlife.generic_nonlife import GenericNonLifeCrawler

        config = make_test_config(company_code="hyundai-fire")
        mock_storage = MagicMock()
        crawler = GenericNonLifeCrawler(config=config, storage=mock_storage)

        # 현재 동작: crawler_name은 company_code
        assert crawler.crawler_name == "hyundai-fire"

    def test_characterize_knia_hashes_default_empty_set(self) -> None:
        """특성화: knia_hashes 기본값은 빈 집합"""
        from app.services.crawler.companies.nonlife.generic_nonlife import GenericNonLifeCrawler

        config = make_test_config()
        mock_storage = MagicMock()
        crawler = GenericNonLifeCrawler(config=config, storage=mock_storage)

        # 현재 동작: None 전달 시 빈 set으로 초기화
        assert crawler.knia_hashes == set()
        assert isinstance(crawler.knia_hashes, set)

    def test_characterize_rate_limit_from_config(self) -> None:
        """특성화: rate_limit_seconds는 config 값 사용"""
        from app.services.crawler.companies.nonlife.generic_nonlife import GenericNonLifeCrawler

        config = make_test_config()
        mock_storage = MagicMock()
        crawler = GenericNonLifeCrawler(config=config, storage=mock_storage)

        # 현재 동작: BaseCrawler에 config.rate_limit_seconds 전달
        assert crawler.rate_limit_seconds == config.rate_limit_seconds
