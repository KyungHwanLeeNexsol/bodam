"""YAML 설정 로더 테스트 (SPEC-CRAWLER-002)

CompanyCrawlerConfig Pydantic 모델과 YAML 파일 로딩을 검증.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
import yaml

from app.services.crawler.config_loader import (
    CompanyCrawlerConfig,
    PaginationConfig,
    SelectorConfig,
    list_company_configs,
    load_company_config,
)


# ---------------------------------------------------------------------------
# SelectorConfig Pydantic 모델 테스트
# ---------------------------------------------------------------------------


class TestSelectorConfig:
    """SelectorConfig Pydantic 모델 유효성 검증"""

    def test_required_fields_only(self):
        """필수 필드만으로 SelectorConfig 생성 성공"""
        config = SelectorConfig(
            listing_container="table tbody tr",
            product_name="td:nth-child(2)",
            pdf_link="a[href*='.pdf']",
        )
        assert config.listing_container == "table tbody tr"
        assert config.product_name == "td:nth-child(2)"
        assert config.pdf_link == "a[href*='.pdf']"

    def test_optional_fields_default_none(self):
        """선택적 필드 기본값은 None"""
        config = SelectorConfig(
            listing_container="table tbody tr",
            product_name="td:nth-child(2)",
            pdf_link="a[href*='.pdf']",
        )
        assert config.product_code is None
        assert config.sale_status is None
        assert config.next_page is None
        assert config.discontinued_tab is None

    def test_all_fields_provided(self):
        """모든 필드 제공 시 정상 파싱"""
        config = SelectorConfig(
            listing_container=".list-table tr",
            product_name=".product-name",
            product_code=".product-code",
            pdf_link="a[href$='.pdf']",
            sale_status=".sale-status",
            next_page=".paging .next",
            discontinued_tab=".tab-discontinued",
        )
        assert config.discontinued_tab == ".tab-discontinued"


# ---------------------------------------------------------------------------
# PaginationConfig Pydantic 모델 테스트
# ---------------------------------------------------------------------------


class TestPaginationConfig:
    """PaginationConfig 기본값 및 유효성 검증"""

    def test_default_values(self):
        """기본값 확인"""
        config = PaginationConfig()
        assert config.type == "numbered"
        assert config.max_pages == 50

    def test_custom_values(self):
        """커스텀 값 설정"""
        config = PaginationConfig(type="infinite_scroll", max_pages=10)
        assert config.type == "infinite_scroll"
        assert config.max_pages == 10


# ---------------------------------------------------------------------------
# CompanyCrawlerConfig Pydantic 모델 테스트
# ---------------------------------------------------------------------------


class TestCompanyCrawlerConfig:
    """CompanyCrawlerConfig 전체 모델 테스트"""

    @pytest.fixture
    def sample_selectors(self) -> SelectorConfig:
        return SelectorConfig(
            listing_container="table tbody tr",
            product_name="td:nth-child(2)",
            pdf_link="a[href*='.pdf']",
        )

    def test_required_fields(self, sample_selectors):
        """필수 필드로 CompanyCrawlerConfig 생성"""
        config = CompanyCrawlerConfig(
            company_name="흥국생명",
            company_code="heungkuk-life",
            base_url="https://www.heungkuklife.co.kr",
            listing_url="https://www.heungkuklife.co.kr/consumer/support/terms/termsList.do",
            selectors=sample_selectors,
        )
        assert config.company_name == "흥국생명"
        assert config.company_code == "heungkuk-life"

    def test_default_values(self, sample_selectors):
        """기본값 확인"""
        config = CompanyCrawlerConfig(
            company_name="테스트",
            company_code="test",
            base_url="https://example.com",
            listing_url="https://example.com/list",
            selectors=sample_selectors,
        )
        assert config.category == "LIFE"
        assert config.discontinued_url is None
        assert config.rate_limit_seconds == 3.0
        assert config.wait_for_selector is None
        assert config.timeout_ms == 30000

    def test_pagination_default(self, sample_selectors):
        """pagination 미설정 시 기본값 사용"""
        config = CompanyCrawlerConfig(
            company_name="테스트",
            company_code="test",
            base_url="https://example.com",
            listing_url="https://example.com/list",
            selectors=sample_selectors,
        )
        assert config.pagination.type == "numbered"
        assert config.pagination.max_pages == 50


# ---------------------------------------------------------------------------
# load_company_config() 함수 테스트
# ---------------------------------------------------------------------------


class TestLoadCompanyConfig:
    """load_company_config() YAML 파일 로딩 테스트"""

    @pytest.fixture
    def sample_yaml_data(self) -> dict:
        return {
            "company_name": "테스트보험",
            "company_code": "test-ins",
            "category": "LIFE",
            "base_url": "https://test.example.com",
            "listing_url": "https://test.example.com/list",
            "selectors": {
                "listing_container": "table tbody tr",
                "product_name": "td:nth-child(2)",
                "pdf_link": "a[href*='.pdf']",
            },
            "pagination": {
                "type": "numbered",
                "max_pages": 20,
            },
            "rate_limit_seconds": 2.0,
            "timeout_ms": 25000,
        }

    def test_load_existing_yaml(self, sample_yaml_data, tmp_path, monkeypatch):
        """존재하는 YAML 파일 로딩 성공"""
        # config/companies 디렉토리 생성
        companies_dir = tmp_path / "config" / "companies"
        companies_dir.mkdir(parents=True)

        # YAML 파일 생성
        yaml_file = companies_dir / "test-ins.yaml"
        with open(yaml_file, "w", encoding="utf-8") as f:
            yaml.dump(sample_yaml_data, f, allow_unicode=True)

        # load_company_config가 tmp_path를 바라보도록 패치
        import app.services.crawler.config_loader as loader_module
        original_path = loader_module.Path

        def patched_file(company_code: str) -> Path:
            return companies_dir / f"{company_code}.yaml"

        monkeypatch.setattr(loader_module, "_get_config_file", patched_file)

        # lru_cache 클리어
        load_company_config.cache_clear()

        config = load_company_config("test-ins")
        assert config.company_name == "테스트보험"
        assert config.company_code == "test-ins"
        assert config.rate_limit_seconds == 2.0

    def test_load_nonexistent_raises_file_not_found(self, monkeypatch):
        """존재하지 않는 회사 코드로 FileNotFoundError 발생"""
        import app.services.crawler.config_loader as loader_module

        def patched_file(company_code: str) -> Path:
            return Path("/nonexistent/path") / f"{company_code}.yaml"

        monkeypatch.setattr(loader_module, "_get_config_file", patched_file)
        load_company_config.cache_clear()

        with pytest.raises(FileNotFoundError):
            load_company_config("nonexistent-company")

    def test_heungkuk_life_yaml_exists(self):
        """흥국생명 설정 YAML 파일이 실제로 존재해야 함"""
        config_file = (
            Path(__file__).parent.parent.parent
            / "app" / "services" / "crawler" / "config" / "companies" / "heungkuk_life.yaml"
        )
        assert config_file.exists(), f"흥국생명 설정 파일 없음: {config_file}"

    def test_heungkuk_life_config_loads_correctly(self):
        """흥국생명 설정이 올바르게 로드되어야 함"""
        load_company_config.cache_clear()
        config = load_company_config("heungkuk_life")
        assert config.company_name == "흥국생명"
        assert config.company_code == "heungkuk-life"
        assert "heungkuklife" in config.base_url


# ---------------------------------------------------------------------------
# list_company_configs() 함수 테스트
# ---------------------------------------------------------------------------


class TestListCompanyConfigs:
    """list_company_configs() 전체 목록 반환 테스트"""

    def test_returns_list(self):
        """list_company_configs()는 리스트를 반환"""
        result = list_company_configs()
        assert isinstance(result, list)

    def test_includes_heungkuk_life(self):
        """결과 목록에 흥국생명 포함"""
        result = list_company_configs()
        codes = [c.company_code for c in result]
        assert "heungkuk-life" in codes

    def test_all_items_are_company_config(self):
        """모든 항목이 CompanyCrawlerConfig 인스턴스"""
        result = list_company_configs()
        for item in result:
            assert isinstance(item, CompanyCrawlerConfig)
