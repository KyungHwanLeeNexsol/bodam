"""교보생명 약관 크롤러 (SPEC-CRAWLER-002 REQ-02.1)

GenericLifeCrawler를 상속하여 교보생명 사이트 특화 동작을 구현.
교보생명은 PDF 다운로드 URL 패턴이 다름:
- /file/ajax/download?fName=/dtc/pdf/mm/{filename}
"""

from __future__ import annotations

import logging
import re
from typing import Any

from app.services.crawler.base import PolicyListing
from app.services.crawler.companies.life.generic_life import GenericLifeCrawler
from app.services.crawler.config_loader import CompanyCrawlerConfig
from app.services.crawler.storage import StorageBackend

logger = logging.getLogger(__name__)

# 교보생명 PDF 다운로드 URL 패턴
KYOBO_PDF_BASE = "https://www.kyobo.com"
KYOBO_PDF_DOWNLOAD_PATH = "/file/ajax/download"

# 판매 상태 텍스트 매핑
SALE_STATUS_MAP = {
    "판매중": "ON_SALE",
    "현행": "ON_SALE",
    "판매중지": "DISCONTINUED",
    "중지": "DISCONTINUED",
    "단종": "DISCONTINUED",
}


class KyoboLifeCrawler(GenericLifeCrawler):
    """교보생명 약관 크롤러

    교보생명(kyobo.com) 약관 목록 페이지 크롤링.
    특이사항: PDF 다운로드 URL이 /file/ajax/download?fName=... 패턴을 사용.
    GenericLifeCrawler의 download_pdf를 오버라이드하여 교보 특화 처리.
    """

    def __init__(self, config: CompanyCrawlerConfig, storage: StorageBackend) -> None:
        """교보생명 크롤러 초기화

        Args:
            config: 보험사별 크롤링 설정 (YAML에서 로드)
            storage: PDF 파일 저장 백엔드
        """
        super().__init__(config=config, storage=storage)

    def _build_kyobo_pdf_url(self, filename: str) -> str:
        """교보생명 PDF 다운로드 URL 생성

        교보생명의 PDF URL 패턴:
        /file/ajax/download?fName=/dtc/pdf/mm/{filename}

        Args:
            filename: PDF 파일명 (확장자 포함)

        Returns:
            완전한 PDF 다운로드 URL
        """
        return f"{KYOBO_PDF_BASE}{KYOBO_PDF_DOWNLOAD_PATH}?fName=/dtc/pdf/mm/{filename}"

    def _parse_sale_status(self, status_text: str) -> str:
        """교보생명 판매 상태 텍스트를 SaleStatus 값으로 변환

        Args:
            status_text: 크롤링된 판매 상태 텍스트

        Returns:
            SaleStatus 문자열 (ON_SALE, DISCONTINUED, UNKNOWN)
        """
        if not status_text:
            return "UNKNOWN"
        normalized = status_text.strip()
        for key, value in SALE_STATUS_MAP.items():
            if key in normalized:
                return value
        return "UNKNOWN"

    def _normalize_pdf_url(self, raw_url: str) -> str:
        """교보생명 PDF URL 정규화

        원시 URL에서 파일명을 추출하여 교보생명 표준 다운로드 URL로 변환.

        Args:
            raw_url: 페이지에서 파싱된 원시 URL

        Returns:
            정규화된 PDF 다운로드 URL
        """
        if not raw_url:
            return raw_url

        # 이미 교보생명 다운로드 URL 패턴이면 그대로 반환
        if KYOBO_PDF_DOWNLOAD_PATH in raw_url:
            if raw_url.startswith("http"):
                return raw_url
            return f"{KYOBO_PDF_BASE}{raw_url}"

        # fName 파라미터에서 파일명 추출
        if "fName=" in raw_url:
            return raw_url if raw_url.startswith("http") else f"{KYOBO_PDF_BASE}{raw_url}"

        # .pdf로 끝나는 URL에서 파일명 추출
        match = re.search(r"([^/]+\.pdf)", raw_url, re.IGNORECASE)
        if match:
            filename = match.group(1)
            return self._build_kyobo_pdf_url(filename)

        # 기본 처리: URL이 절대 경로가 아니면 base_url 추가
        if raw_url.startswith("/"):
            return f"{KYOBO_PDF_BASE}{raw_url}"
        if not raw_url.startswith("http"):
            return f"{KYOBO_PDF_BASE}/{raw_url}"
        return raw_url
