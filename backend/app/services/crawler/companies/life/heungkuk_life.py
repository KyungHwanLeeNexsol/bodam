"""흥국생명 약관 크롤러 (SPEC-CRAWLER-002 REQ-02.1)

GenericLifeCrawler를 상속하여 흥국생명 사이트 특화 동작을 구현.
"""

from __future__ import annotations

import logging

from app.services.crawler.companies.life.generic_life import GenericLifeCrawler
from app.services.crawler.config_loader import CompanyCrawlerConfig
from app.services.crawler.storage import StorageBackend

logger = logging.getLogger(__name__)

# 흥국생명 판매 상태 텍스트 매핑
SALE_STATUS_MAP = {
    "판매중": "ON_SALE",
    "현행": "ON_SALE",
    "판매중지": "DISCONTINUED",
    "중지": "DISCONTINUED",
    "단종": "DISCONTINUED",
}


class HeungkukLifeCrawler(GenericLifeCrawler):
    """흥국생명 약관 크롤러

    흥국생명(heungkuklife.co.kr) 약관 목록 페이지 크롤링.
    GenericLifeCrawler 기반으로 흥국생명 특화 판매 상태 파싱 오버라이드.
    """

    def __init__(self, config: CompanyCrawlerConfig, storage: StorageBackend) -> None:
        """흥국생명 크롤러 초기화

        Args:
            config: 보험사별 크롤링 설정 (YAML에서 로드)
            storage: PDF 파일 저장 백엔드
        """
        super().__init__(config=config, storage=storage)

    def _parse_sale_status(self, status_text: str) -> str:
        """흥국생명 판매 상태 텍스트를 SaleStatus 값으로 변환

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
