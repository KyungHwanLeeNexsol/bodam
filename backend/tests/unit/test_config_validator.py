"""ConfigValidator 단위 테스트 (SPEC-PIPELINE-001 REQ-01)

ConfigValidator 클래스의 validate_single, validate_all 메서드 테스트.
httpx를 모킹하여 실제 네트워크 접근 없이 테스트.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.crawler.config_validator import ConfigValidator, ValidationResult


class TestValidationResult:
    """ValidationResult 데이터클래스 테스트"""

    def test_validation_result_creation(self):
        """ValidationResult 인스턴스 생성"""
        result = ValidationResult(
            company_code="test-company",
            url_accessible=True,
            page_loaded=True,
            pdf_links_found=True,
            error_message=None,
        )
        assert result.company_code == "test-company"
        assert result.url_accessible is True
        assert result.pdf_links_found is True
        assert result.error_message is None

    def test_validation_result_with_error(self):
        """에러가 있는 ValidationResult 생성"""
        result = ValidationResult(
            company_code="test-company",
            url_accessible=False,
            page_loaded=False,
            pdf_links_found=False,
            error_message="Connection timeout",
        )
        assert result.url_accessible is False
        assert result.error_message == "Connection timeout"

    def test_validation_result_is_dataclass(self):
        """ValidationResult는 dataclass여야 함"""
        import dataclasses

        assert dataclasses.is_dataclass(ValidationResult)

    def test_validation_result_to_dict(self):
        """ValidationResult는 dict로 변환 가능해야 함"""
        import dataclasses

        result = ValidationResult(
            company_code="test-co",
            url_accessible=True,
            page_loaded=False,
            pdf_links_found=False,
            error_message="page load failed",
        )
        d = dataclasses.asdict(result)
        assert d["company_code"] == "test-co"
        assert d["url_accessible"] is True


class TestConfigValidatorCreation:
    """ConfigValidator 생성 테스트"""

    def test_config_validator_can_be_instantiated(self):
        """ConfigValidator 인스턴스 생성"""
        validator = ConfigValidator()
        assert validator is not None

    def test_config_validator_has_validate_single(self):
        """validate_single 메서드가 존재해야 함"""
        validator = ConfigValidator()
        assert hasattr(validator, "validate_single")
        assert callable(validator.validate_single)

    def test_config_validator_has_validate_all(self):
        """validate_all 메서드가 존재해야 함"""
        validator = ConfigValidator()
        assert hasattr(validator, "validate_all")
        assert callable(validator.validate_all)


class TestValidateSingle:
    """validate_single 메서드 테스트"""

    @pytest.fixture
    def mock_config(self):
        """테스트용 CompanyCrawlerConfig 모의 객체"""
        config = MagicMock()
        config.company_code = "test-company"
        config.listing_url = "https://example.com/policies"
        config.selectors = MagicMock()
        config.selectors.pdf_link = "a.pdf-link"
        return config

    async def test_validate_single_url_accessible_returns_true(self, mock_config):
        """URL 접근 가능하면 url_accessible=True 반환"""
        validator = ConfigValidator()

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = "<html><body><a class='pdf-link' href='/doc.pdf'>PDF</a></body></html>"

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("app.services.crawler.config_validator.load_company_config", return_value=mock_config):
            with patch("httpx.AsyncClient", return_value=mock_client):
                result = await validator.validate_single("test-company")

        assert isinstance(result, ValidationResult)
        assert result.company_code == "test-company"
        assert result.url_accessible is True

    async def test_validate_single_url_inaccessible_returns_false(self, mock_config):
        """URL 접근 불가시 url_accessible=False 반환"""
        validator = ConfigValidator()

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(side_effect=Exception("Connection refused"))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("app.services.crawler.config_validator.load_company_config", return_value=mock_config):
            with patch("httpx.AsyncClient", return_value=mock_client):
                result = await validator.validate_single("test-company")

        assert result.url_accessible is False
        assert result.error_message is not None
        assert "Connection refused" in result.error_message

    async def test_validate_single_page_loaded_on_200(self, mock_config):
        """HTTP 200 응답이면 page_loaded=True"""
        validator = ConfigValidator()

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = "<html><body><a class='pdf-link' href='/doc.pdf'>PDF</a></body></html>"

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("app.services.crawler.config_validator.load_company_config", return_value=mock_config):
            with patch("httpx.AsyncClient", return_value=mock_client):
                result = await validator.validate_single("test-company")

        assert result.page_loaded is True

    async def test_validate_single_page_not_loaded_on_404(self, mock_config):
        """HTTP 404 응답이면 page_loaded=False"""
        validator = ConfigValidator()

        mock_response = MagicMock()
        mock_response.status_code = 404
        mock_response.text = "Not Found"

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("app.services.crawler.config_validator.load_company_config", return_value=mock_config):
            with patch("httpx.AsyncClient", return_value=mock_client):
                result = await validator.validate_single("test-company")

        assert result.page_loaded is False

    async def test_validate_single_pdf_links_found_when_present(self, mock_config):
        """페이지에 PDF 링크가 있으면 pdf_links_found=True"""
        validator = ConfigValidator()

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = "<html><body><a class='pdf-link' href='/doc.pdf'>PDF</a></body></html>"

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("app.services.crawler.config_validator.load_company_config", return_value=mock_config):
            with patch("httpx.AsyncClient", return_value=mock_client):
                result = await validator.validate_single("test-company")

        assert result.pdf_links_found is True

    async def test_validate_single_pdf_links_not_found_when_absent(self):
        """페이지에 PDF 링크가 없으면 pdf_links_found=False"""
        validator = ConfigValidator()

        config = MagicMock()
        config.company_code = "test-company"
        config.listing_url = "https://example.com/policies"
        config.selectors = MagicMock()
        config.selectors.pdf_link = "a.nonexistent-selector"

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = "<html><body><p>내용 없음</p></body></html>"

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("app.services.crawler.config_validator.load_company_config", return_value=config):
            with patch("httpx.AsyncClient", return_value=mock_client):
                result = await validator.validate_single("test-company")

        assert result.pdf_links_found is False

    async def test_validate_single_result_has_all_required_fields(self, mock_config):
        """결과에 필수 필드가 모두 포함되어야 함"""
        validator = ConfigValidator()

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = "<html><body><a class='pdf-link' href='/doc.pdf'>PDF</a></body></html>"

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("app.services.crawler.config_validator.load_company_config", return_value=mock_config):
            with patch("httpx.AsyncClient", return_value=mock_client):
                result = await validator.validate_single("test-company")

        assert hasattr(result, "company_code")
        assert hasattr(result, "url_accessible")
        assert hasattr(result, "page_loaded")
        assert hasattr(result, "pdf_links_found")
        assert hasattr(result, "error_message")


class TestValidateAll:
    """validate_all 메서드 테스트"""

    async def test_validate_all_returns_list(self):
        """validate_all은 리스트를 반환해야 함"""
        validator = ConfigValidator()

        mock_configs = []
        with patch("app.services.crawler.config_validator.list_company_configs", return_value=mock_configs):
            results = await validator.validate_all()

        assert isinstance(results, list)

    async def test_validate_all_returns_result_per_config(self):
        """각 설정 파일마다 결과가 하나씩 반환되어야 함"""
        validator = ConfigValidator()

        config1 = MagicMock()
        config1.company_code = "company-a"
        config1.listing_url = "https://a.com/policies"
        config1.selectors = MagicMock()
        config1.selectors.pdf_link = "a.pdf"

        config2 = MagicMock()
        config2.company_code = "company-b"
        config2.listing_url = "https://b.com/policies"
        config2.selectors = MagicMock()
        config2.selectors.pdf_link = "a.pdf"

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = "<html><a class='pdf' href='/doc.pdf'>PDF</a></html>"

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("app.services.crawler.config_validator.list_company_configs", return_value=[config1, config2]):
            with patch("httpx.AsyncClient", return_value=mock_client):
                results = await validator.validate_all()

        assert len(results) == 2
        company_codes = [r.company_code for r in results]
        assert "company-a" in company_codes
        assert "company-b" in company_codes

    async def test_validate_all_each_result_is_validation_result(self):
        """각 결과는 ValidationResult 인스턴스여야 함"""
        validator = ConfigValidator()

        config1 = MagicMock()
        config1.company_code = "company-a"
        config1.listing_url = "https://a.com/policies"
        config1.selectors = MagicMock()
        config1.selectors.pdf_link = "a.pdf"

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = "<html><a class='pdf' href='/doc.pdf'>PDF</a></html>"

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("app.services.crawler.config_validator.list_company_configs", return_value=[config1]):
            with patch("httpx.AsyncClient", return_value=mock_client):
                results = await validator.validate_all()

        assert all(isinstance(r, ValidationResult) for r in results)

    async def test_validate_all_handles_individual_failure_gracefully(self):
        """개별 검증 실패해도 전체 결과가 반환되어야 함"""
        validator = ConfigValidator()

        config1 = MagicMock()
        config1.company_code = "company-a"
        config1.listing_url = "https://a.com/policies"
        config1.selectors = MagicMock()
        config1.selectors.pdf_link = "a.pdf"

        config2 = MagicMock()
        config2.company_code = "company-b"
        config2.listing_url = "https://b.com/policies"
        config2.selectors = MagicMock()
        config2.selectors.pdf_link = "a.pdf"

        call_count = 0

        async def selective_fail(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise Exception("첫 번째 요청 실패")
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.text = "<html><a class='pdf' href='/doc.pdf'>PDF</a></html>"
            return mock_resp

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(side_effect=selective_fail)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("app.services.crawler.config_validator.list_company_configs", return_value=[config1, config2]):
            with patch("httpx.AsyncClient", return_value=mock_client):
                results = await validator.validate_all()

        # 두 설정 모두 결과가 있어야 함
        assert len(results) == 2
        # 첫 번째는 실패
        failed = next(r for r in results if r.company_code == "company-a")
        assert failed.url_accessible is False
        # 두 번째는 성공
        succeeded = next(r for r in results if r.company_code == "company-b")
        assert succeeded.url_accessible is True
