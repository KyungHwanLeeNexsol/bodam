"""ConfigValidator - 보험사 크롤러 설정 유효성 검사 (SPEC-PIPELINE-001 REQ-01)

각 보험사 YAML 설정 파일을 실제 웹사이트 접근으로 검증.
httpx를 사용하여 URL 접근성, 페이지 로드 성공, PDF 링크 존재 여부를 확인.
"""

from __future__ import annotations

import dataclasses
import logging
from typing import TYPE_CHECKING

import httpx
from bs4 import BeautifulSoup

from app.services.crawler.config_loader import list_company_configs, load_company_config

if TYPE_CHECKING:
    from app.services.crawler.config_loader import CompanyCrawlerConfig

logger = logging.getLogger(__name__)

# httpx 요청 타임아웃 (초)
_REQUEST_TIMEOUT = 10.0


@dataclasses.dataclass
class ValidationResult:
    """단일 보험사 설정 검증 결과

    SPEC-PIPELINE-001 AC-01: 각 검증 항목별 성공/실패 여부와 오류 메시지 포함.
    """

    # 보험사 코드 (예: heungkuk-life)
    company_code: str
    # 목록 페이지 URL에 HTTP 접근 가능 여부
    url_accessible: bool
    # 페이지가 성공적으로 로드되었는지 (HTTP 2xx)
    page_loaded: bool
    # 페이지에 PDF 링크가 하나 이상 존재하는지
    pdf_links_found: bool
    # 검증 실패 시 오류 메시지 (성공 시 None)
    error_message: str | None


# @MX:ANCHOR: [AUTO] ConfigValidator - 보험사 설정 일괄 검증 클래스
# @MX:REASON: validate_single, validate_all 메서드가 외부에서 직접 호출됨
class ConfigValidator:
    """보험사 크롤러 설정 유효성 검사기 (SPEC-PIPELINE-001 REQ-01)

    각 보험사의 YAML 설정 파일을 실제 웹사이트에 접근하여 검증.
    단위 테스트에서는 httpx를 모킹하여 실제 네트워크 접근 없이 테스트 가능.
    """

    async def validate_single(self, company_code: str) -> ValidationResult:
        """단일 보험사 설정 검증

        목록 페이지 URL에 httpx로 접근하여 접근성, 페이지 로드, PDF 링크 존재 여부를 확인.

        Args:
            company_code: 검증할 보험사 코드

        Returns:
            ValidationResult 인스턴스
        """
        config = load_company_config(company_code)
        return await self._validate_config(config)

    async def validate_all(self) -> list[ValidationResult]:
        """등록된 모든 보험사 설정 일괄 검증

        config/companies/ 디렉토리의 모든 YAML 파일을 순차적으로 검증.
        개별 실패가 전체 실행을 중단시키지 않음.

        Returns:
            각 보험사의 ValidationResult 목록
        """
        configs = list_company_configs()
        results: list[ValidationResult] = []

        for config in configs:
            result = await self._validate_config(config)
            results.append(result)

        return results

    async def _validate_config(self, config: CompanyCrawlerConfig) -> ValidationResult:
        """단일 설정 객체 검증 (내부 메서드)

        Args:
            config: 검증할 CompanyCrawlerConfig 인스턴스

        Returns:
            ValidationResult 인스턴스
        """
        company_code = config.company_code
        listing_url = config.listing_url

        try:
            async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT, follow_redirects=True) as client:
                response = await client.get(listing_url)
        except Exception as exc:
            logger.warning("보험사 %s URL 접근 실패: %s", company_code, str(exc))
            return ValidationResult(
                company_code=company_code,
                url_accessible=False,
                page_loaded=False,
                pdf_links_found=False,
                error_message=str(exc),
            )

        # URL 접근 가능 여부 (HTTP 요청 자체가 성공하면 True)
        url_accessible = True

        # 페이지 로드 성공 여부 (2xx 응답 코드)
        page_loaded = 200 <= response.status_code < 300

        # PDF 링크 존재 여부 (CSS 선택자로 찾기)
        pdf_links_found = False
        if page_loaded:
            pdf_links_found = self._check_pdf_links(response.text, config.selectors.pdf_link)

        error_message: str | None = None
        if not page_loaded:
            error_message = f"HTTP {response.status_code} 응답"
        elif not pdf_links_found:
            error_message = f"PDF 링크 없음 (선택자: {config.selectors.pdf_link})"

        logger.debug(
            "보험사 %s 검증 완료: url=%s, loaded=%s, pdf=%s",
            company_code,
            url_accessible,
            page_loaded,
            pdf_links_found,
        )

        return ValidationResult(
            company_code=company_code,
            url_accessible=url_accessible,
            page_loaded=page_loaded,
            pdf_links_found=pdf_links_found,
            error_message=error_message,
        )

    def _check_pdf_links(self, html: str, selector: str) -> bool:
        """HTML에서 CSS 선택자로 PDF 링크 존재 여부 확인

        Args:
            html: 페이지 HTML 문자열
            selector: CSS 선택자 (예: 'a.pdf-link')

        Returns:
            PDF 링크가 하나 이상 존재하면 True
        """
        try:
            soup = BeautifulSoup(html, "html.parser")
            elements = soup.select(selector)
            return len(elements) > 0
        except Exception as exc:  # noqa: BLE001
            logger.warning("CSS 선택자 파싱 실패 (%s): %s", selector, str(exc))
            return False
