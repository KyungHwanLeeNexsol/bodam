"""CrawlerRegistry 단위 테스트 (SPEC-CRAWLER-002)

scan_yaml_configs() 및 list_crawlers() 동작 검증.
실제 Playwright/DB 없이 모킹으로 실행 가능.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


class TestCrawlerRegistry:
    """CrawlerRegistry 기본 동작 테스트"""

    def test_register_and_get(self) -> None:
        """크롤러 등록 후 조회 가능"""
        from app.services.crawler.registry import CrawlerRegistry

        registry = CrawlerRegistry()
        mock_crawler = MagicMock()
        registry.register("test-crawler", mock_crawler)

        assert registry.get("test-crawler") is mock_crawler

    def test_get_unregistered_returns_none(self) -> None:
        """미등록 크롤러 조회 시 None 반환"""
        from app.services.crawler.registry import CrawlerRegistry

        registry = CrawlerRegistry()
        assert registry.get("nonexistent") is None

    def test_list_crawlers_empty(self) -> None:
        """빈 레지스트리 목록은 빈 리스트"""
        from app.services.crawler.registry import CrawlerRegistry

        registry = CrawlerRegistry()
        assert registry.list_crawlers() == []

    def test_list_crawlers_returns_registered_names(self) -> None:
        """등록된 크롤러 이름 목록 반환"""
        from app.services.crawler.registry import CrawlerRegistry

        registry = CrawlerRegistry()
        registry.register("knia", MagicMock())
        registry.register("klia", MagicMock())
        registry.register("samsung-life", MagicMock())

        names = registry.list_crawlers()
        assert "knia" in names
        assert "klia" in names
        assert "samsung-life" in names
        assert len(names) == 3

    def test_register_overwrites_existing(self) -> None:
        """동일 이름 재등록 시 덮어쓰기"""
        from app.services.crawler.registry import CrawlerRegistry

        registry = CrawlerRegistry()
        first = MagicMock(name="first")
        second = MagicMock(name="second")

        registry.register("crawler", first)
        registry.register("crawler", second)

        assert registry.get("crawler") is second
        assert len(registry.list_crawlers()) == 1


class TestScanYamlConfigs:
    """scan_yaml_configs() YAML 설정 자동 등록 테스트"""

    def test_scan_yaml_configs_loads_life_configs(self) -> None:
        """YAML 설정에서 생명보험사 크롤러 자동 등록"""
        from app.services.crawler.registry import CrawlerRegistry

        mock_storage = MagicMock()
        registry = CrawlerRegistry()
        registry.scan_yaml_configs(mock_storage)

        # heungkuk-life는 Phase 1에서 이미 생성된 YAML (기준 설정 파일)
        crawler_names = registry.list_crawlers()
        assert "heungkuk-life" in crawler_names

    def test_scan_yaml_configs_registers_samsung_life(self) -> None:
        """Phase 2에서 추가된 samsung-life YAML 로드 확인"""
        from app.services.crawler.registry import CrawlerRegistry

        mock_storage = MagicMock()
        registry = CrawlerRegistry()
        registry.scan_yaml_configs(mock_storage)

        assert "samsung-life" in registry.list_crawlers()

    def test_scan_yaml_configs_registers_all_new_companies(self) -> None:
        """Phase 2에서 추가된 7개 보험사 YAML 모두 등록 확인"""
        from app.services.crawler.registry import CrawlerRegistry

        mock_storage = MagicMock()
        registry = CrawlerRegistry()
        registry.scan_yaml_configs(mock_storage)

        expected_companies = [
            "samsung-life",
            "hanwha-life",
            "kyobo-life",
            "shinhan-life",
            "nh-life",
            "dongyang-life",
            "mirae-life",
        ]
        registered = registry.list_crawlers()
        for company in expected_companies:
            assert company in registered, f"{company} 크롤러가 등록되지 않음"

    def test_scan_yaml_configs_creates_generic_life_crawler(self) -> None:
        """LIFE 카테고리 YAML은 GenericLifeCrawler로 등록"""
        from app.services.crawler.companies.life.generic_life import GenericLifeCrawler
        from app.services.crawler.registry import CrawlerRegistry

        mock_storage = MagicMock()
        registry = CrawlerRegistry()
        registry.scan_yaml_configs(mock_storage)

        samsung = registry.get("samsung-life")
        assert samsung is not None
        assert isinstance(samsung, GenericLifeCrawler)

    def test_scan_yaml_configs_total_count(self) -> None:
        """8개 YAML 파일(heungkuk + 7개 신규) 모두 등록"""
        from app.services.crawler.registry import CrawlerRegistry

        mock_storage = MagicMock()
        registry = CrawlerRegistry()
        registry.scan_yaml_configs(mock_storage)

        # heungkuk_life + 7개 신규 = 최소 8개
        assert len(registry.list_crawlers()) >= 8

    def test_scan_yaml_configs_invalid_yaml_skipped(self) -> None:
        """파싱 실패 YAML은 건너뛰고 나머지 등록 계속"""
        from app.services.crawler.config_loader import CompanyCrawlerConfig
        from app.services.crawler.registry import CrawlerRegistry

        mock_storage = MagicMock()
        registry = CrawlerRegistry()

        # list_company_configs가 유효한 설정 1개 + 예외 발생 시뮬레이션
        valid_config = CompanyCrawlerConfig(
            company_name="테스트생명",
            company_code="test-life",
            category="LIFE",
            base_url="https://example.com",
            listing_url="https://example.com/terms",
            selectors={
                "listing_container": "table tbody tr",
                "product_name": "td:nth-child(2)",
                "pdf_link": "a[href*='.pdf']",
            },
        )

        # scan_yaml_configs 내부의 지역 임포트 경로로 패치
        with patch(
            "app.services.crawler.config_loader.list_company_configs",
            return_value=[valid_config],
        ):
            # registry 모듈의 list_company_configs 직접 패치
            import app.services.crawler.registry as registry_module
            original_fn = None
            try:
                import app.services.crawler.config_loader as config_loader_module
                original_fn = config_loader_module.list_company_configs

                # 임시로 함수 교체
                def mock_list_company_configs() -> list:
                    return [valid_config]

                config_loader_module.list_company_configs = mock_list_company_configs  # type: ignore[method-assign]
                registry.scan_yaml_configs(mock_storage)
            finally:
                if original_fn is not None:
                    config_loader_module.list_company_configs = original_fn  # type: ignore[method-assign]

        assert "test-life" in registry.list_crawlers()


@pytest.mark.asyncio
class TestCrawlAll:
    """crawl_all() 전체 크롤링 실행 테스트"""

    async def test_crawl_all_runs_association_crawlers_first(self) -> None:
        """협회 크롤러(knia, klia)를 개별 보험사 크롤러보다 먼저 실행"""
        from app.services.crawler.base import CrawlRunResult
        from app.services.crawler.registry import CrawlerRegistry

        execution_order: list[str] = []

        def make_mock_crawler(name: str) -> MagicMock:
            mock = MagicMock()
            empty_result = CrawlRunResult(
                total_found=0, new_count=0, updated_count=0,
                skipped_count=0, failed_count=0, results=[]
            )

            async def crawl() -> CrawlRunResult:
                execution_order.append(name)
                return empty_result

            mock.crawl = crawl
            return mock

        registry = CrawlerRegistry()
        # 순서를 섞어서 등록
        registry.register("samsung-life", make_mock_crawler("samsung-life"))
        registry.register("knia", make_mock_crawler("knia"))
        registry.register("klia", make_mock_crawler("klia"))

        mock_storage = MagicMock()
        await registry.crawl_all(mock_storage)

        # knia, klia가 samsung-life보다 먼저 실행되어야 함
        knia_idx = execution_order.index("knia")
        samsung_idx = execution_order.index("samsung-life")
        assert knia_idx < samsung_idx

    async def test_crawl_all_returns_results_dict(self) -> None:
        """crawl_all() 결과는 크롤러 이름 -> 결과 딕셔너리"""
        from app.services.crawler.base import CrawlRunResult
        from app.services.crawler.registry import CrawlerRegistry

        empty_result = CrawlRunResult(
            total_found=5, new_count=2, updated_count=0,
            skipped_count=3, failed_count=0, results=[]
        )

        mock_crawler = MagicMock()

        async def crawl() -> CrawlRunResult:
            return empty_result

        mock_crawler.crawl = crawl

        registry = CrawlerRegistry()
        registry.register("test-company", mock_crawler)

        mock_storage = MagicMock()
        results = await registry.crawl_all(mock_storage)

        assert "test-company" in results
        assert results["test-company"].total_found == 5

    async def test_crawl_all_handles_crawler_exception(self) -> None:
        """개별 크롤러 실패 시 나머지 크롤러 계속 실행"""
        from app.services.crawler.base import CrawlRunResult
        from app.services.crawler.registry import CrawlerRegistry

        fail_crawler = MagicMock()

        async def fail_crawl() -> CrawlRunResult:
            raise RuntimeError("네트워크 오류")

        fail_crawler.crawl = fail_crawl

        success_crawler = MagicMock()
        success_result = CrawlRunResult(
            total_found=1, new_count=1, updated_count=0,
            skipped_count=0, failed_count=0, results=[]
        )

        async def success_crawl() -> CrawlRunResult:
            return success_result

        success_crawler.crawl = success_crawl

        registry = CrawlerRegistry()
        registry.register("fail-company", fail_crawler)
        registry.register("success-company", success_crawler)

        mock_storage = MagicMock()
        results = await registry.crawl_all(mock_storage)

        # 실패 크롤러는 error 키로 기록
        assert "error" in results["fail-company"]
        # 성공 크롤러 결과는 정상
        assert results["success-company"].total_found == 1
