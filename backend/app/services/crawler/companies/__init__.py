"""보험사별 크롤러 패키지 (SPEC-CRAWLER-001, SPEC-CRAWLER-002, SPEC-CRAWLER-003)

KLIACrawler(생명보험협회), KNIACrawler(손해보험협회), PubInsureLifeCrawler(공시실) 제공.
협회 크롤러는 registry.register()를 통해 지연 등록됩니다.
실제 등록은 register_association_crawlers()를 명시적으로 호출하거나,
crawl_all() 실행 시 자동으로 이루어집니다.
"""

from __future__ import annotations


def register_association_crawlers() -> None:
    """협회 크롤러(KNIA, KLIA, PubInsureLife)를 전역 레지스트리에 등록

    순환 임포트 방지를 위해 함수 내에서 지연 임포트 사용.
    Celery 태스크 실행 시점 또는 애플리케이션 시작 시 호출.
    """
    from app.services.crawler.companies.klia_crawler import KliaCrawler
    from app.services.crawler.companies.knia_crawler import KniaCrawler
    from app.services.crawler.companies.pubinsure_life_crawler import PubInsureLifeCrawler
    from app.services.crawler.registry import crawler_registry

    crawler_registry.register("knia", KniaCrawler)
    crawler_registry.register("klia", KliaCrawler)
    # REQ-05: pub_insure_life 크롤러 등록 (pub.insure.or.kr 생명보험 공시실)
    crawler_registry.register("pub_insure_life", PubInsureLifeCrawler)
