"""크롤러 레지스트리 단위 테스트 (SPEC-CRAWLER-001)

CrawlerRegistry 등록, 조회, 목록 기능 테스트.
"""

from __future__ import annotations

from app.services.crawler.registry import CrawlerRegistry


class TestCrawlerRegistry:
    """CrawlerRegistry 테스트"""

    def test_registry_creation(self):
        """CrawlerRegistry 인스턴스 생성"""
        registry = CrawlerRegistry()
        assert registry is not None

    def test_register_crawler(self):
        """크롤러 클래스를 등록할 수 있어야 함"""
        registry = CrawlerRegistry()

        class FakeCrawler:
            pass

        registry.register("fake", FakeCrawler)
        assert registry.get("fake") is FakeCrawler

    def test_get_unregistered_returns_none(self):
        """미등록 크롤러 조회 시 None을 반환해야 함"""
        registry = CrawlerRegistry()
        assert registry.get("nonexistent") is None

    def test_list_crawlers_empty(self):
        """등록된 크롤러 없으면 빈 목록 반환"""
        registry = CrawlerRegistry()
        assert registry.list_crawlers() == []

    def test_list_crawlers_returns_names(self):
        """등록된 크롤러 이름 목록을 반환해야 함"""
        registry = CrawlerRegistry()

        class FakeA:
            pass

        class FakeB:
            pass

        registry.register("crawler_a", FakeA)
        registry.register("crawler_b", FakeB)

        names = registry.list_crawlers()
        assert "crawler_a" in names
        assert "crawler_b" in names
        assert len(names) == 2

    def test_register_duplicate_overwrites(self):
        """중복 등록 시 덮어쓰기"""
        registry = CrawlerRegistry()

        class OldCrawler:
            pass

        class NewCrawler:
            pass

        registry.register("duplicate", OldCrawler)
        registry.register("duplicate", NewCrawler)

        assert registry.get("duplicate") is NewCrawler
