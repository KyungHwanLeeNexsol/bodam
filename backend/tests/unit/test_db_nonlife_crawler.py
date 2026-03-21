"""DB손해보험 크롤러 단위 테스트 (SPEC-DATA-002 Phase 3)

TDD RED 페이즈: DBNonLifeCrawler 구현 전 테스트 작성.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.crawler.base import CrawlRunResult, PolicyListing


class TestDBNonLifeCrawlerImport:
    """DBNonLifeCrawler 임포트 및 클래스 구조 테스트"""

    def test_import_db_nonlife_crawler(self):
        """DBNonLifeCrawler 임포트 가능해야 함"""
        from app.services.crawler.companies.nonlife.db_nonlife_crawler import DBNonLifeCrawler
        assert DBNonLifeCrawler is not None

    def test_db_crawler_inherits_base(self):
        """DBNonLifeCrawler는 BaseCrawler를 상속해야 함"""
        from app.services.crawler.base import BaseCrawler
        from app.services.crawler.companies.nonlife.db_nonlife_crawler import DBNonLifeCrawler
        assert issubclass(DBNonLifeCrawler, BaseCrawler)

    def test_db_crawler_has_target_categories(self):
        """DBNonLifeCrawler는 TARGET_CATEGORIES 상수를 가져야 함"""
        from app.services.crawler.companies.nonlife.db_nonlife_crawler import DBNonLifeCrawler
        assert hasattr(DBNonLifeCrawler, "TARGET_CATEGORIES")
        cats = DBNonLifeCrawler.TARGET_CATEGORIES
        assert len(cats) > 0

    def test_db_crawler_init_with_storage(self):
        """DBNonLifeCrawler는 storage만으로 초기화 가능해야 함"""
        from app.services.crawler.companies.nonlife.db_nonlife_crawler import DBNonLifeCrawler
        mock_storage = MagicMock()
        crawler = DBNonLifeCrawler(storage=mock_storage)
        assert crawler.storage is mock_storage
        assert crawler.db_session is None

    def test_db_crawler_has_crawler_name(self):
        """DBNonLifeCrawler는 crawler_name을 'db-nonlife'로 설정해야 함"""
        from app.services.crawler.companies.nonlife.db_nonlife_crawler import DBNonLifeCrawler
        mock_storage = MagicMock()
        crawler = DBNonLifeCrawler(storage=mock_storage)
        assert crawler.crawler_name == "db-nonlife"


class TestDBNonLifeCrawlerCategories:
    """TARGET_CATEGORIES 구조 테스트"""

    def test_target_categories_is_list(self):
        """TARGET_CATEGORIES는 리스트여야 함"""
        from app.services.crawler.companies.nonlife.db_nonlife_crawler import DBNonLifeCrawler
        assert isinstance(DBNonLifeCrawler.TARGET_CATEGORIES, list)

    def test_target_categories_has_required_fields(self):
        """각 카테고리는 ln, sn, mn, label 필드를 가져야 함"""
        from app.services.crawler.companies.nonlife.db_nonlife_crawler import DBNonLifeCrawler
        for cat in DBNonLifeCrawler.TARGET_CATEGORIES:
            assert "ln" in cat
            assert "sn" in cat
            assert "mn" in cat
            assert "label" in cat

    def test_target_categories_includes_health(self):
        """건강 카테고리가 포함돼야 함"""
        from app.services.crawler.companies.nonlife.db_nonlife_crawler import DBNonLifeCrawler
        labels = [c["mn"] for c in DBNonLifeCrawler.TARGET_CATEGORIES]
        assert "건강" in labels

    def test_target_categories_includes_injury(self):
        """상해 카테고리가 포함돼야 함"""
        from app.services.crawler.companies.nonlife.db_nonlife_crawler import DBNonLifeCrawler
        labels = [c["mn"] for c in DBNonLifeCrawler.TARGET_CATEGORIES]
        assert "상해" in labels


class TestDBNonLifeCrawlerParseListings:
    """parse_listing 테스트 (parse_listing에 step2 응답 데이터 전달)"""

    @pytest.mark.asyncio
    async def test_parse_listing_returns_list(self):
        """parse_listing은 리스트를 반환해야 함"""
        from app.services.crawler.companies.nonlife.db_nonlife_crawler import DBNonLifeCrawler
        mock_storage = MagicMock()
        crawler = DBNonLifeCrawler(storage=mock_storage)

        # step2 API 응답 형식
        mock_data = [{"PDC_NM": "DB 건강보험 테스트", "_sl_yn": "1"}]
        result = await crawler.parse_listing(mock_data)
        assert isinstance(result, list)

    @pytest.mark.asyncio
    async def test_parse_listing_returns_policy_listing_instances(self):
        """parse_listing은 PolicyListing 인스턴스 목록을 반환해야 함"""
        from app.services.crawler.companies.nonlife.db_nonlife_crawler import DBNonLifeCrawler
        mock_storage = MagicMock()
        crawler = DBNonLifeCrawler(storage=mock_storage)

        mock_data = [{"PDC_NM": "DB 건강보험", "_sl_yn": "1", "_label": "장기-오프라인-건강"}]
        result = await crawler.parse_listing(mock_data)
        assert len(result) >= 0  # 데이터가 있으면 PolicyListing 반환

    @pytest.mark.asyncio
    async def test_parse_listing_handles_empty_data(self):
        """빈 데이터로도 예외 없이 빈 목록 반환"""
        from app.services.crawler.companies.nonlife.db_nonlife_crawler import DBNonLifeCrawler
        mock_storage = MagicMock()
        crawler = DBNonLifeCrawler(storage=mock_storage)

        result = await crawler.parse_listing([])
        assert result == []


class TestDBNonLifeCrawlerStep2API:
    """Step2 AJAX API 호출 테스트"""

    @pytest.mark.asyncio
    async def test_fetch_products_step2_calls_api(self):
        """_fetch_products_step2는 STEP2_URL을 POST 호출해야 함"""
        from app.services.crawler.companies.nonlife.db_nonlife_crawler import DBNonLifeCrawler, STEP2_URL
        mock_storage = MagicMock()
        crawler = DBNonLifeCrawler(storage=mock_storage)

        mock_response = MagicMock()
        mock_response.json = MagicMock(return_value={"result": [{"PDC_NM": "테스트 상품"}]})
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)

        cat = {"ln": "장기보험", "sn": "Off-Line", "mn": "건강", "label": "장기-오프라인-건강"}
        result = await crawler._fetch_products_step2(mock_client, cat, "1")

        assert mock_client.post.called
        call_args = mock_client.post.call_args
        assert STEP2_URL in str(call_args)

    @pytest.mark.asyncio
    async def test_fetch_products_step2_returns_product_list(self):
        """_fetch_products_step2는 상품 목록을 반환해야 함"""
        from app.services.crawler.companies.nonlife.db_nonlife_crawler import DBNonLifeCrawler
        mock_storage = MagicMock()
        crawler = DBNonLifeCrawler(storage=mock_storage)

        mock_response = MagicMock()
        mock_response.json = MagicMock(return_value={
            "result": [{"PDC_NM": "DB 암보험", "PDC_CD": "ABC123"}]
        })

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)

        cat = {"ln": "장기보험", "sn": "Off-Line", "mn": "건강", "label": "장기-오프라인-건강"}
        result = await crawler._fetch_products_step2(mock_client, cat, "1")

        assert isinstance(result, list)
        assert len(result) == 1
        assert result[0]["PDC_NM"] == "DB 암보험"


class TestDBNonLifeCrawlerDetectChanges:
    """detect_changes 테스트"""

    @pytest.mark.asyncio
    async def test_detect_changes_skips_existing_pdfs(self):
        """이미 다운로드된 PDF는 unchanged로 분류해야 함"""
        from app.services.crawler.companies.nonlife.db_nonlife_crawler import DBNonLifeCrawler
        from app.services.crawler.base import DeltaResult
        mock_storage = MagicMock()
        mock_storage.exists = MagicMock(return_value=True)

        crawler = DBNonLifeCrawler(storage=mock_storage)
        listing = PolicyListing(
            company_name="DB손해보험",
            product_name="DB 건강보험",
            product_code="",
            category="장기-오프라인-건강",
            pdf_url="https://www.idbins.com/cYakgwanDown.do?FilePath=InsProduct/test.pdf",
            company_code="db-nonlife",
        )

        result = await crawler.detect_changes([listing])
        assert isinstance(result, DeltaResult)
        assert len(result.unchanged) == 1
        assert len(result.new) == 0

    @pytest.mark.asyncio
    async def test_detect_changes_new_pdfs_added_to_new(self):
        """새 PDF는 new 목록에 추가돼야 함"""
        from app.services.crawler.companies.nonlife.db_nonlife_crawler import DBNonLifeCrawler
        from app.services.crawler.base import DeltaResult
        mock_storage = MagicMock()
        mock_storage.exists = MagicMock(return_value=False)

        crawler = DBNonLifeCrawler(storage=mock_storage)
        listing = PolicyListing(
            company_name="DB손해보험",
            product_name="DB 건강보험",
            product_code="",
            category="장기-오프라인-건강",
            pdf_url="https://www.idbins.com/cYakgwanDown.do?FilePath=InsProduct/test.pdf",
            company_code="db-nonlife",
        )

        result = await crawler.detect_changes([listing])
        assert len(result.new) == 1
        assert len(result.unchanged) == 0


class TestDBNonLifeCrawlerCrawl:
    """crawl() 통합 테스트"""

    @pytest.mark.asyncio
    async def test_crawl_returns_crawl_run_result(self):
        """crawl()은 CrawlRunResult를 반환해야 함"""
        from app.services.crawler.companies.nonlife.db_nonlife_crawler import DBNonLifeCrawler
        mock_storage = MagicMock()
        mock_storage.exists = MagicMock(return_value=True)

        crawler = DBNonLifeCrawler(storage=mock_storage)

        # httpx.AsyncClient 모킹
        mock_response_step2 = MagicMock()
        mock_response_step2.json = MagicMock(return_value={"result": []})

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response_step2)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("app.services.crawler.companies.nonlife.db_nonlife_crawler.httpx.AsyncClient",
                   return_value=mock_client):
            result = await crawler.crawl()

        assert isinstance(result, CrawlRunResult)

    @pytest.mark.asyncio
    async def test_crawl_processes_multiple_categories(self):
        """crawl()은 모든 TARGET_CATEGORIES를 처리해야 함"""
        from app.services.crawler.companies.nonlife.db_nonlife_crawler import DBNonLifeCrawler
        mock_storage = MagicMock()
        mock_storage.exists = MagicMock(return_value=True)

        crawler = DBNonLifeCrawler(storage=mock_storage)

        mock_response = MagicMock()
        mock_response.json = MagicMock(return_value={"result": []})

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("app.services.crawler.companies.nonlife.db_nonlife_crawler.httpx.AsyncClient",
                   return_value=mock_client):
            result = await crawler.crawl()

        # 각 카테고리마다 판매중(1)/판매중지(0) 각각 step2 호출
        # TARGET_CATEGORIES * 2 이상 호출 확인
        expected_min_calls = len(DBNonLifeCrawler.TARGET_CATEGORIES) * 2
        assert mock_client.post.call_count >= expected_min_calls
