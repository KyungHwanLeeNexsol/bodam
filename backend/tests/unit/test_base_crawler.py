"""BaseCrawler 단위 테스트 (SPEC-CRAWLER-001)

BaseCrawler ABC, 재시도 로직, 레이트 리밋, 해시 계산 테스트.
"""

from __future__ import annotations

import hashlib
from abc import ABC
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.crawler.base import BaseCrawler, CrawlRunResult, DeltaResult, PolicyListing


class TestPolicyListing:
    """PolicyListing 데이터클래스 테스트"""

    def test_policy_listing_creation(self):
        """PolicyListing 인스턴스 생성"""
        listing = PolicyListing(
            company_name="삼성생명",
            product_name="삼성 종신보험",
            product_code="SL-001",
            category="LIFE",
            pdf_url="https://example.com/policy.pdf",
            company_code="samsung-life",
        )
        assert listing.company_name == "삼성생명"
        assert listing.product_code == "SL-001"
        assert listing.company_code == "samsung-life"

    def test_policy_listing_is_dataclass(self):
        """PolicyListing은 dataclass여야 함"""
        import dataclasses

        assert dataclasses.is_dataclass(PolicyListing)


class TestDeltaResult:
    """DeltaResult 데이터클래스 테스트"""

    def test_delta_result_creation(self):
        """DeltaResult 인스턴스 생성"""
        result = DeltaResult(new=[], updated=[], unchanged=[])
        assert result.new == []
        assert result.updated == []
        assert result.unchanged == []

    def test_delta_result_is_dataclass(self):
        """DeltaResult는 dataclass여야 함"""
        import dataclasses

        assert dataclasses.is_dataclass(DeltaResult)


class TestCrawlRunResult:
    """CrawlRunResult 데이터클래스 테스트"""

    def test_crawl_run_result_creation(self):
        """CrawlRunResult 인스턴스 생성"""
        result = CrawlRunResult(
            total_found=10,
            new_count=5,
            updated_count=2,
            skipped_count=3,
            failed_count=0,
            results=[],
        )
        assert result.total_found == 10
        assert result.new_count == 5

    def test_crawl_run_result_is_dataclass(self):
        """CrawlRunResult는 dataclass여야 함"""
        import dataclasses

        assert dataclasses.is_dataclass(CrawlRunResult)


class ConcreteCrawler(BaseCrawler):
    """테스트용 구체 크롤러 구현"""

    async def crawl(self) -> CrawlRunResult:
        return CrawlRunResult(
            total_found=0, new_count=0, updated_count=0, skipped_count=0, failed_count=0, results=[]
        )

    async def parse_listing(self, page) -> list[PolicyListing]:
        return []

    async def download_pdf(self, listing: PolicyListing) -> bytes:
        return b"pdf content"

    async def detect_changes(self, listings: list[PolicyListing]) -> DeltaResult:
        return DeltaResult(new=listings, updated=[], unchanged=[])


class TestBaseCrawler:
    """BaseCrawler ABC 테스트"""

    def test_base_crawler_is_abstract(self):
        """BaseCrawler는 추상 클래스여야 함"""
        assert issubclass(BaseCrawler, ABC)

    def test_base_crawler_cannot_be_instantiated_directly(self):
        """BaseCrawler는 직접 인스턴스화할 수 없어야 함"""
        with pytest.raises(TypeError):
            BaseCrawler(  # type: ignore
                crawler_name="test",
                db_session=MagicMock(),
                storage=MagicMock(),
            )

    def test_concrete_crawler_can_be_instantiated(self):
        """구체 크롤러는 인스턴스화 가능해야 함"""
        crawler = ConcreteCrawler(
            crawler_name="test",
            db_session=MagicMock(),
            storage=MagicMock(),
        )
        assert crawler.crawler_name == "test"

    def test_crawler_default_rate_limit(self):
        """기본 레이트 리밋은 2.0초여야 함"""
        crawler = ConcreteCrawler(
            crawler_name="test",
            db_session=MagicMock(),
            storage=MagicMock(),
        )
        assert crawler.rate_limit_seconds == 2.0

    def test_crawler_default_max_retries(self):
        """기본 최대 재시도 횟수는 3이어야 함"""
        crawler = ConcreteCrawler(
            crawler_name="test",
            db_session=MagicMock(),
            storage=MagicMock(),
        )
        assert crawler.max_retries == 3

    def test_crawler_custom_rate_limit(self):
        """커스텀 레이트 리밋 설정"""
        crawler = ConcreteCrawler(
            crawler_name="test",
            db_session=MagicMock(),
            storage=MagicMock(),
            rate_limit_seconds=5.0,
        )
        assert crawler.rate_limit_seconds == 5.0

    def test_crawler_custom_max_retries(self):
        """커스텀 최대 재시도 횟수 설정"""
        crawler = ConcreteCrawler(
            crawler_name="test",
            db_session=MagicMock(),
            storage=MagicMock(),
            max_retries=5,
        )
        assert crawler.max_retries == 5


class TestComputeHash:
    """_compute_hash 메서드 테스트"""

    def test_compute_hash_returns_sha256(self):
        """SHA-256 해시를 반환해야 함"""
        crawler = ConcreteCrawler(
            crawler_name="test",
            db_session=MagicMock(),
            storage=MagicMock(),
        )
        data = b"test data"
        result = crawler._compute_hash(data)
        expected = hashlib.sha256(data).hexdigest()
        assert result == expected

    def test_compute_hash_returns_string(self):
        """문자열을 반환해야 함"""
        crawler = ConcreteCrawler(
            crawler_name="test",
            db_session=MagicMock(),
            storage=MagicMock(),
        )
        result = crawler._compute_hash(b"data")
        assert isinstance(result, str)

    def test_compute_hash_consistent(self):
        """같은 입력에 항상 같은 결과를 반환해야 함"""
        crawler = ConcreteCrawler(
            crawler_name="test",
            db_session=MagicMock(),
            storage=MagicMock(),
        )
        data = b"consistent data"
        assert crawler._compute_hash(data) == crawler._compute_hash(data)

    def test_compute_hash_different_inputs(self):
        """다른 입력에 다른 결과를 반환해야 함"""
        crawler = ConcreteCrawler(
            crawler_name="test",
            db_session=MagicMock(),
            storage=MagicMock(),
        )
        assert crawler._compute_hash(b"data1") != crawler._compute_hash(b"data2")


class TestRateLimit:
    """_rate_limit 메서드 테스트"""

    async def test_rate_limit_sleeps(self):
        """레이트 리밋은 asyncio.sleep을 호출해야 함"""
        crawler = ConcreteCrawler(
            crawler_name="test",
            db_session=MagicMock(),
            storage=MagicMock(),
            rate_limit_seconds=0.1,
        )
        with patch("asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
            await crawler._rate_limit()
            mock_sleep.assert_called_once_with(0.1)


class TestRetryRequest:
    """_retry_request 메서드 테스트"""

    async def test_retry_on_success(self):
        """성공 시 결과를 반환해야 함"""
        crawler = ConcreteCrawler(
            crawler_name="test",
            db_session=MagicMock(),
            storage=MagicMock(),
        )

        async def success_coro():
            return "success"

        result = await crawler._retry_request(success_coro())
        assert result == "success"

    async def test_retry_on_failure_then_success(self):
        """실패 후 성공하면 성공 결과를 반환해야 함 (callable 기반 재시도)"""
        crawler = ConcreteCrawler(
            crawler_name="test",
            db_session=MagicMock(),
            storage=MagicMock(),
            max_retries=3,
        )
        call_count = 0

        async def flaky():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise Exception("일시적 오류")
            return "success"

        with patch("asyncio.sleep", new_callable=AsyncMock):
            result = await crawler._retry_request_fn(flaky)
        assert result == "success"

    async def test_retry_exhausted_raises(self):
        """모든 재시도 실패 시 예외를 발생시켜야 함"""
        crawler = ConcreteCrawler(
            crawler_name="test",
            db_session=MagicMock(),
            storage=MagicMock(),
            max_retries=2,
        )

        async def always_fail():
            raise Exception("항상 실패")

        with patch("asyncio.sleep", new_callable=AsyncMock):
            with pytest.raises(Exception, match="항상 실패"):
                await crawler._retry_request_fn(always_fail)
