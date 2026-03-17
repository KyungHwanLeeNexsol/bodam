"""신한라이프 약관 크롤러 (SPEC-CRAWLER-002 REQ-02.1)

GenericLifeCrawler를 상속하여 신한라이프 사이트 특화 동작을 구현.
신한라이프는 /hp/cdhi0020t01.do 페이지에서 판매중/판매중지 카테고리 분리.
"""

from __future__ import annotations

import logging

from app.services.crawler.companies.life.generic_life import GenericLifeCrawler
from app.services.crawler.config_loader import CompanyCrawlerConfig
from app.services.crawler.storage import StorageBackend

logger = logging.getLogger(__name__)

# 신한라이프 판매 상태 텍스트 매핑
SALE_STATUS_MAP = {
    "판매중": "ON_SALE",
    "현행": "ON_SALE",
    "현재판매": "ON_SALE",
    "판매중지": "DISCONTINUED",
    "중지": "DISCONTINUED",
    "판매종료": "DISCONTINUED",
    "단종": "DISCONTINUED",
}

# 신한라이프 목록 URL - 판매중/판매중지 모두 포함
# /hp/cdhi0020t01.do: 약관 공시 페이지
SHINHAN_BASE_URL = "https://www.shinhanlife.co.kr"


class ShinhanLifeCrawler(GenericLifeCrawler):
    """신한라이프 약관 크롤러

    신한라이프(shinhanlife.co.kr) 약관 목록 페이지 크롤링.
    판매중/판매중지 카테고리가 분리되어 있어 양쪽 모두 크롤링.
    Spring MVC .do URL 패턴 사용.
    """

    def __init__(self, config: CompanyCrawlerConfig, storage: StorageBackend) -> None:
        """신한라이프 크롤러 초기화

        Args:
            config: 보험사별 크롤링 설정 (YAML에서 로드)
            storage: PDF 파일 저장 백엔드
        """
        super().__init__(config=config, storage=storage)

    def _parse_sale_status(self, status_text: str) -> str:
        """신한라이프 판매 상태 텍스트를 SaleStatus 값으로 변환

        판매중/판매중지 탭이 분리된 경우를 처리.

        Args:
            status_text: 크롤링된 판매 상태 텍스트 또는 탭 정보

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
