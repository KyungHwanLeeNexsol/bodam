"""Phase 3 통합 테스트 (SPEC-CRAWLER-002)

20개 YAML 설정(8개 생명보험사 + 12개 손해보험사) 로드 검증.
scan_yaml_configs() 전체 보험사 크롤러 등록 확인.
list_crawlers() 전체 보험사 코드 포함 확인.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest


# 생명보험사 8개 코드 (Phase 2에서 추가)
LIFE_COMPANY_CODES = [
    "heungkuk-life",
    "samsung-life",
    "hanwha-life",
    "kyobo-life",
    "shinhan-life",
    "nh-life",
    "dongyang-life",
    "mirae-life",
]

# 손해보험사 12개 코드 (Phase 3에서 추가)
NON_LIFE_COMPANY_CODES = [
    "samsung-fire",
    "hyundai-marine",
    "db-insurance",
    "kb-insurance",
    "meritz-fire",
    "hanwha-general",
    "heungkuk-fire",
    "axa-general",
    "hana-insurance",
    "mg-insurance",
    "nh-insurance",
    "lotte-insurance",
]

ALL_COMPANY_CODES = LIFE_COMPANY_CODES + NON_LIFE_COMPANY_CODES


class TestAllYamlConfigsLoad:
    """20개 YAML 설정 파일 로드 검증"""

    def test_list_company_configs_returns_all_20(self) -> None:
        """list_company_configs()가 생명보험 8개 + 손해보험 12개 = 20개 반환"""
        from app.services.crawler.config_loader import list_company_configs

        configs = list_company_configs()
        assert len(configs) >= 20, f"20개 이상 설정 필요, 실제: {len(configs)}"

    def test_all_life_company_configs_loadable(self) -> None:
        """생명보험사 8개 YAML 설정 파일 로드 가능"""
        from app.services.crawler.config_loader import list_company_configs

        configs = list_company_configs()
        loaded_codes = {c.company_code for c in configs}

        for code in LIFE_COMPANY_CODES:
            assert code in loaded_codes, f"생명보험사 설정 누락: {code}"

    def test_all_nonlife_company_configs_loadable(self) -> None:
        """손해보험사 12개 YAML 설정 파일 로드 가능"""
        from app.services.crawler.config_loader import list_company_configs

        configs = list_company_configs()
        loaded_codes = {c.company_code for c in configs}

        for code in NON_LIFE_COMPANY_CODES:
            assert code in loaded_codes, f"손해보험사 설정 누락: {code}"

    def test_nonlife_configs_have_correct_category(self) -> None:
        """손해보험사 YAML 설정의 category가 NON_LIFE인지 확인"""
        from app.services.crawler.config_loader import list_company_configs

        configs = list_company_configs()
        nonlife_map = {
            c.company_code: c.category
            for c in configs
            if c.company_code in NON_LIFE_COMPANY_CODES
        }

        for code in NON_LIFE_COMPANY_CODES:
            assert code in nonlife_map, f"손해보험사 설정 누락: {code}"
            assert nonlife_map[code].upper() == "NON_LIFE", (
                f"{code}의 category가 NON_LIFE가 아님: {nonlife_map[code]}"
            )

    def test_life_configs_have_correct_category(self) -> None:
        """생명보험사 YAML 설정의 category가 LIFE인지 확인"""
        from app.services.crawler.config_loader import list_company_configs

        configs = list_company_configs()
        life_map = {
            c.company_code: c.category
            for c in configs
            if c.company_code in LIFE_COMPANY_CODES
        }

        for code in LIFE_COMPANY_CODES:
            assert code in life_map, f"생명보험사 설정 누락: {code}"
            assert life_map[code].upper() == "LIFE", (
                f"{code}의 category가 LIFE가 아님: {life_map[code]}"
            )


class TestScanYamlConfigsRegistersAll:
    """scan_yaml_configs()가 20개 보험사 크롤러 모두 등록하는지 검증"""

    def test_scan_yaml_configs_registers_all_20_crawlers(self) -> None:
        """scan_yaml_configs() 후 20개 이상 크롤러가 레지스트리에 등록"""
        from app.services.crawler.registry import CrawlerRegistry

        mock_storage = MagicMock()
        registry = CrawlerRegistry()
        registry.scan_yaml_configs(mock_storage)

        registered = registry.list_crawlers()
        assert len(registered) >= 20, (
            f"20개 이상 크롤러 등록 필요, 실제: {len(registered)}\n"
            f"등록된 크롤러: {registered}"
        )

    def test_scan_yaml_configs_registers_all_life_companies(self) -> None:
        """scan_yaml_configs() 후 생명보험사 8개 모두 등록 확인"""
        from app.services.crawler.registry import CrawlerRegistry

        mock_storage = MagicMock()
        registry = CrawlerRegistry()
        registry.scan_yaml_configs(mock_storage)

        registered = registry.list_crawlers()
        for code in LIFE_COMPANY_CODES:
            assert code in registered, f"생명보험사 크롤러 등록 누락: {code}"

    def test_scan_yaml_configs_registers_all_nonlife_companies(self) -> None:
        """scan_yaml_configs() 후 손해보험사 12개 모두 등록 확인"""
        from app.services.crawler.registry import CrawlerRegistry

        mock_storage = MagicMock()
        registry = CrawlerRegistry()
        registry.scan_yaml_configs(mock_storage)

        registered = registry.list_crawlers()
        for code in NON_LIFE_COMPANY_CODES:
            assert code in registered, f"손해보험사 크롤러 등록 누락: {code}"

    def test_nonlife_crawlers_are_generic_nonlife_instances(self) -> None:
        """손해보험사 크롤러가 GenericNonLifeCrawler 인스턴스인지 확인"""
        from app.services.crawler.companies.nonlife.generic_nonlife import GenericNonLifeCrawler
        from app.services.crawler.registry import CrawlerRegistry

        mock_storage = MagicMock()
        registry = CrawlerRegistry()
        registry.scan_yaml_configs(mock_storage)

        # 손해보험사 샘플 검증 (삼성화재, 현대해상)
        for code in ["samsung-fire", "hyundai-marine"]:
            crawler = registry.get(code)
            assert crawler is not None, f"크롤러 없음: {code}"
            assert isinstance(crawler, GenericNonLifeCrawler), (
                f"{code} 크롤러가 GenericNonLifeCrawler가 아님: {type(crawler)}"
            )

    def test_life_crawlers_are_generic_life_instances(self) -> None:
        """생명보험사 크롤러가 GenericLifeCrawler 인스턴스인지 확인"""
        from app.services.crawler.companies.life.generic_life import GenericLifeCrawler
        from app.services.crawler.registry import CrawlerRegistry

        mock_storage = MagicMock()
        registry = CrawlerRegistry()
        registry.scan_yaml_configs(mock_storage)

        # 생명보험사 샘플 검증 (삼성생명, 흥국생명)
        for code in ["samsung-life", "heungkuk-life"]:
            crawler = registry.get(code)
            assert crawler is not None, f"크롤러 없음: {code}"
            assert isinstance(crawler, GenericLifeCrawler), (
                f"{code} 크롤러가 GenericLifeCrawler가 아님: {type(crawler)}"
            )


class TestListCrawlersIncludesAllCodes:
    """list_crawlers()가 모든 보험사 코드를 포함하는지 검증"""

    def test_list_crawlers_includes_all_company_codes_after_scan(self) -> None:
        """scan_yaml_configs() 후 list_crawlers()가 20개 보험사 코드 모두 포함"""
        from app.services.crawler.registry import CrawlerRegistry

        mock_storage = MagicMock()
        registry = CrawlerRegistry()
        registry.scan_yaml_configs(mock_storage)

        registered = registry.list_crawlers()
        missing = [code for code in ALL_COMPANY_CODES if code not in registered]

        assert not missing, (
            f"누락된 크롤러 코드: {missing}\n"
            f"등록된 크롤러: {registered}"
        )

    def test_knia_klia_registration_via_register_function(self) -> None:
        """register_association_crawlers() 함수가 companies 패키지에 존재하는지 확인

        klia_crawler.py, knia_crawler.py는 pgvector 등 DB 의존성이 있어
        실제 임포트는 통합 환경에서만 가능. 여기서는 함수 존재 여부만 검증.
        """
        from app.services.crawler.companies import register_association_crawlers

        # register_association_crawlers 함수가 호출 가능한지 확인
        assert callable(register_association_crawlers), (
            "register_association_crawlers가 callable이 아님"
        )

    def test_registry_accepts_class_registration(self) -> None:
        """레지스트리가 클래스 등록을 처리할 수 있는지 확인 (KNIA/KLIA 패턴)"""
        from unittest.mock import MagicMock

        from app.services.crawler.registry import CrawlerRegistry

        test_registry = CrawlerRegistry()

        # 클래스처럼 동작하는 Mock (callable, crawl 메서드 없음)
        MockKniaCrawler = MagicMock()
        MockKniaCrawler.crawl = None  # 인스턴스가 아닌 클래스처럼 설정
        del MockKniaCrawler.crawl  # crawl 속성 제거

        test_registry.register("knia", MockKniaCrawler)
        test_registry.register("klia", MagicMock())

        registered = test_registry.list_crawlers()
        assert "knia" in registered, "KNIA 크롤러가 레지스트리에 없음"
        assert "klia" in registered, "KLIA 크롤러가 레지스트리에 없음"

    @pytest.mark.parametrize("company_code", ALL_COMPANY_CODES)
    def test_each_company_config_loads_without_error(self, company_code: str) -> None:
        """각 보험사 YAML 설정이 오류 없이 로드되는지 개별 검증"""
        from app.services.crawler.config_loader import list_company_configs

        configs = list_company_configs()
        codes = {c.company_code for c in configs}
        assert company_code in codes, f"보험사 설정 로드 실패: {company_code}"
