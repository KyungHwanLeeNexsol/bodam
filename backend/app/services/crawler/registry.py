"""크롤러 레지스트리 (SPEC-CRAWLER-001)

보험사별 크롤러 클래스를 이름으로 등록하고 조회하는 레지스트리.
Celery 태스크에서 크롤러를 동적으로 찾아 실행할 때 사용.
"""

from __future__ import annotations

from typing import Any


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


# 전역 레지스트리 싱글톤
crawler_registry = CrawlerRegistry()
