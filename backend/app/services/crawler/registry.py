"""크롤러 레지스트리 (SPEC-CRAWLER-001, SPEC-CRAWLER-002)

보험사별 크롤러 클래스를 이름으로 등록하고 조회하는 레지스트리.
Celery 태스크에서 크롤러를 동적으로 찾아 실행할 때 사용.
SPEC-CRAWLER-002: YAML 설정 기반 자동 등록 및 전체 크롤링 기능 추가.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class CrawlerRegistry:
    """크롤러 클래스 레지스트리

    크롤러 이름 -> 클래스 매핑을 관리.
    동일 이름 재등록 시 덮어쓰기.
    """

    def __init__(self) -> None:
        """빈 레지스트리 초기화"""
        self._registry: dict[str, Any] = {}

    def register(self, name: str, crawler_class: Any) -> None:
        """크롤러 클래스 등록

        Args:
            name: 크롤러 식별자 (예: klia, knia)
            crawler_class: BaseCrawler를 상속한 크롤러 클래스
        """
        self._registry[name] = crawler_class

    def get(self, name: str) -> Any | None:
        """이름으로 크롤러 클래스 조회

        Args:
            name: 크롤러 식별자

        Returns:
            크롤러 클래스 또는 None (미등록 시)
        """
        return self._registry.get(name)

    def list_crawlers(self) -> list[str]:
        """등록된 크롤러 이름 목록 반환

        Returns:
            등록된 크롤러 이름 목록
        """
        return list(self._registry.keys())

    def scan_yaml_configs(self, storage: Any) -> None:
        """YAML 설정 파일을 스캔하여 범용 크롤러 인스턴스 자동 등록

        config/companies/ 디렉토리의 모든 YAML 파일을 읽어
        category에 따라 GenericLifeCrawler 또는 GenericNonLifeCrawler를 등록.
        파싱 실패 파일은 건너뜀.

        Args:
            storage: PDF 저장 백엔드 (StorageBackend 인스턴스)
        """
        # 임포트를 지연하여 순환 참조 방지
        from app.services.crawler.companies.life.generic_life import GenericLifeCrawler
        from app.services.crawler.companies.nonlife.generic_nonlife import GenericNonLifeCrawler
        from app.services.crawler.config_loader import list_company_configs

        configs = list_company_configs()

        for config in configs:
            try:
                if config.category.upper() == "NON_LIFE":
                    crawler = GenericNonLifeCrawler(config=config, storage=storage)
                else:
                    # LIFE 또는 기타 카테고리는 생명보험사 크롤러 사용
                    crawler = GenericLifeCrawler(config=config, storage=storage)

                self._registry[config.company_code] = crawler
                logger.debug(
                    "YAML 크롤러 등록: %s (category=%s)",
                    config.company_code,
                    config.category,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "크롤러 등록 실패 (%s): %s",
                    config.company_code,
                    str(exc),
                )

        logger.info(
            "YAML 설정에서 %d개 크롤러 등록 완료",
            len(configs),
        )

    async def crawl_all(self, storage: Any) -> dict[str, Any]:
        """모든 등록된 크롤러 순차 실행

        실행 순서:
        1. 협회 크롤러 (knia, klia) 먼저 실행 - 중복 감지 기준 데이터 수집
        2. 개별 보험사 크롤러 순차 실행

        Args:
            storage: PDF 저장 백엔드 (StorageBackend 인스턴스)

        Returns:
            크롤러 이름 -> CrawlRunResult 매핑 딕셔너리
        """
        results: dict[str, Any] = {}

        # 협회 크롤러 우선 실행 (knia, klia)
        association_crawlers = ["knia", "klia"]
        company_crawlers = [
            name for name in self._registry
            if name not in association_crawlers
        ]

        # 협회 크롤러 실행
        for crawler_name in association_crawlers:
            crawler = self._registry.get(crawler_name)
            if crawler is None:
                logger.debug("협회 크롤러 미등록, 건너뜀: %s", crawler_name)
                continue

            try:
                logger.info("협회 크롤러 실행 시작: %s", crawler_name)
                result = await crawler.crawl()
                results[crawler_name] = result
                logger.info(
                    "협회 크롤러 완료: %s (발견=%d, 신규=%d)",
                    crawler_name,
                    result.total_found,
                    result.new_count,
                )
            except Exception as exc:  # noqa: BLE001
                logger.error("협회 크롤러 실패 (%s): %s", crawler_name, str(exc))
                results[crawler_name] = {"error": str(exc)}

        # 개별 보험사 크롤러 실행
        for crawler_name in company_crawlers:
            crawler = self._registry.get(crawler_name)
            if crawler is None:
                continue

            try:
                logger.info("보험사 크롤러 실행 시작: %s", crawler_name)
                result = await crawler.crawl()
                results[crawler_name] = result
                logger.info(
                    "보험사 크롤러 완료: %s (발견=%d, 신규=%d)",
                    crawler_name,
                    result.total_found,
                    result.new_count,
                )
            except Exception as exc:  # noqa: BLE001
                logger.error("보험사 크롤러 실패 (%s): %s", crawler_name, str(exc))
                results[crawler_name] = {"error": str(exc)}

        return results


# 전역 레지스트리 싱글톤
crawler_registry = CrawlerRegistry()
