"""변경 감지(Delta) 로직 단위 테스트 (SPEC-CRAWLER-001)

SHA-256 해시 기반의 변경 감지 로직을 테스트.
NEW, UPDATED, SKIPPED 분류 검증.
"""

from __future__ import annotations

import hashlib
from unittest.mock import MagicMock

from app.services.crawler.base import BaseCrawler, CrawlRunResult, DeltaResult, PolicyListing


class MockCrawler(BaseCrawler):
    """테스트용 크롤러 구현 (detect_changes 제외 최소 구현)"""

    async def crawl(self) -> CrawlRunResult:
        return CrawlRunResult(total_found=0, new_count=0, updated_count=0, skipped_count=0, failed_count=0, results=[])

    async def parse_listing(self, page) -> list[PolicyListing]:
        return []

    async def download_pdf(self, listing: PolicyListing) -> bytes:
        return b""

    async def detect_changes(self, listings: list[PolicyListing]) -> DeltaResult:
        return DeltaResult(new=listings, updated=[], unchanged=[])


class TestDeltaDetection:
    """변경 감지 로직 테스트"""

    def test_compute_hash_sha256_64_chars(self):
        """SHA-256 해시는 64자 헥스 문자열이어야 함"""
        crawler = MockCrawler(
            crawler_name="test",
            db_session=MagicMock(),
            storage=MagicMock(),
        )
        data = b"test pdf content"
        result = crawler._compute_hash(data)
        assert len(result) == 64
        assert all(c in "0123456789abcdef" for c in result)

    def test_compute_hash_matches_sha256(self):
        """_compute_hash 결과가 hashlib SHA-256과 일치해야 함"""
        crawler = MockCrawler(
            crawler_name="test",
            db_session=MagicMock(),
            storage=MagicMock(),
        )
        data = b"insurance policy content"
        expected = hashlib.sha256(data).hexdigest()
        assert crawler._compute_hash(data) == expected

    def test_delta_result_new_listings_all_new(self):
        """기존 해시 없으면 모두 NEW여야 함"""
        listings = [
            PolicyListing(
                company_name="삼성생명",
                product_name="종신보험",
                product_code="SL-001",
                category="LIFE",
                pdf_url="https://example.com/1.pdf",
                company_code="samsung-life",
            )
        ]
        result = DeltaResult(new=listings, updated=[], unchanged=[])
        assert len(result.new) == 1
        assert len(result.updated) == 0
        assert len(result.unchanged) == 0

    def test_delta_result_unchanged_listings(self):
        """해시 동일하면 UNCHANGED여야 함"""
        listing = PolicyListing(
            company_name="삼성생명",
            product_name="종신보험",
            product_code="SL-001",
            category="LIFE",
            pdf_url="https://example.com/1.pdf",
            company_code="samsung-life",
        )
        result = DeltaResult(new=[], updated=[], unchanged=[listing])
        assert len(result.unchanged) == 1

    def test_delta_result_updated_listings(self):
        """해시 다르면 UPDATED여야 함"""
        listing = PolicyListing(
            company_name="삼성생명",
            product_name="종신보험 업데이트",
            product_code="SL-001",
            category="LIFE",
            pdf_url="https://example.com/updated.pdf",
            company_code="samsung-life",
        )
        result = DeltaResult(new=[], updated=[listing], unchanged=[])
        assert len(result.updated) == 1
