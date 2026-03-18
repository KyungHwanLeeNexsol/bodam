"""pub.insure.or.kr 생명보험 공시실 크롤러 단위 테스트 (SPEC-CRAWLER-003)

PubInsureLifeCrawler의 핵심 기능을 테스트:
- fn_fileDown 패턴 파싱
- PDF 다운로드 및 magic bytes 검증
- 페이지네이션 처리
- 레이트 리밋 적용
- 변경 감지 (델타 크롤링)
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.crawler.companies.pubinsure_life_crawler import (
    FILE_DOWN_URL,
    LISTING_URL,
    PRODUCT_CATEGORIES,
    PubInsureLifeCrawler,
)
from app.services.crawler.base import CrawlRunResult, DeltaResult, PolicyListing


# ---------------------------------------------------------------------------
# 픽스처
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_db_session() -> MagicMock:
    """테스트용 DB 세션 목"""
    return MagicMock()


@pytest.fixture
def mock_storage() -> MagicMock:
    """테스트용 스토리지 목"""
    return MagicMock()


@pytest.fixture
def crawler(mock_db_session: MagicMock, mock_storage: MagicMock) -> PubInsureLifeCrawler:
    """레이트 리밋 없는 테스트용 크롤러"""
    return PubInsureLifeCrawler(
        db_session=mock_db_session,
        storage=mock_storage,
        rate_limit_seconds=0.0,
    )


SAMPLE_HTML_WITH_FILE_DOWN = """
<html><body>
<table>
<tr>
  <td>삼성생명</td>
  <td>삼성 종신보험 2024</td>
  <td><a onclick="fn_fileDown('41658', '5');">다운로드</a></td>
</tr>
<tr>
  <td>한화생명</td>
  <td>한화 연금보험</td>
  <td><a onclick="fn_fileDown('99999', '1');">다운로드</a></td>
</tr>
</table>
</body></html>
"""

SAMPLE_HTML_NO_FILE_DOWN = """
<html><body>
<table>
<tr><td>데이터 없음</td></tr>
</table>
</body></html>
"""


# ---------------------------------------------------------------------------
# REQ-01: fn_fileDown 패턴 파싱
# ---------------------------------------------------------------------------

class TestParseListingExtractsFileDownPatterns:
    """REQ-01: fn_fileDown 패턴 파싱 테스트"""

    @pytest.mark.asyncio
    async def test_parse_listing_extracts_file_down_patterns(
        self, crawler: PubInsureLifeCrawler
    ) -> None:
        """fn_fileDown('fileNo', 'seq') 패턴에서 PolicyListing 목록 추출"""
        listings = await crawler.parse_listing(SAMPLE_HTML_WITH_FILE_DOWN)

        assert len(listings) == 2
        # 첫 번째 항목: fileNo=41658, seq=5
        urls = {listing.pdf_url for listing in listings}
        assert f"{FILE_DOWN_URL}?fileNo=41658&seq=5" in urls
        assert f"{FILE_DOWN_URL}?fileNo=99999&seq=1" in urls

    @pytest.mark.asyncio
    async def test_parse_listing_sets_product_code_from_file_no_and_seq(
        self, crawler: PubInsureLifeCrawler
    ) -> None:
        """product_code는 fileNo-seq 형식이어야 함"""
        listings = await crawler.parse_listing(SAMPLE_HTML_WITH_FILE_DOWN)

        product_codes = {listing.product_code for listing in listings}
        assert "41658-5" in product_codes
        assert "99999-1" in product_codes

    @pytest.mark.asyncio
    async def test_parse_listing_sets_category_as_life(
        self, crawler: PubInsureLifeCrawler
    ) -> None:
        """category는 LIFE여야 함"""
        listings = await crawler.parse_listing(SAMPLE_HTML_WITH_FILE_DOWN)

        for listing in listings:
            assert listing.category == "LIFE"

    @pytest.mark.asyncio
    async def test_parse_listing_empty_html(
        self, crawler: PubInsureLifeCrawler
    ) -> None:
        """fn_fileDown 패턴이 없는 HTML은 빈 목록 반환"""
        listings = await crawler.parse_listing(SAMPLE_HTML_NO_FILE_DOWN)

        assert listings == []

    @pytest.mark.asyncio
    async def test_parse_listing_empty_string(
        self, crawler: PubInsureLifeCrawler
    ) -> None:
        """빈 문자열 입력 시 빈 목록 반환"""
        listings = await crawler.parse_listing("")

        assert listings == []


# ---------------------------------------------------------------------------
# REQ-02: PDF 다운로드 및 magic bytes 검증
# ---------------------------------------------------------------------------

class TestDownloadPdf:
    """REQ-02: PDF 다운로드 및 유효성 검증 테스트"""

    @pytest.mark.asyncio
    async def test_download_pdf_success(
        self, crawler: PubInsureLifeCrawler
    ) -> None:
        """유효한 PDF 응답 시 바이너리 데이터 반환"""
        listing = PolicyListing(
            company_name="삼성생명",
            product_name="종신보험",
            product_code="41658-5",
            category="LIFE",
            pdf_url=f"{FILE_DOWN_URL}?fileNo=41658&seq=5",
            company_code="L03",
        )

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.content = b"%PDF-1.4 valid pdf content"

        mock_client = AsyncMock()
        mock_client.get.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await crawler.download_pdf(listing)

        assert result == b"%PDF-1.4 valid pdf content"

    @pytest.mark.asyncio
    async def test_download_pdf_invalid_magic_bytes_returns_empty(
        self, crawler: PubInsureLifeCrawler
    ) -> None:
        """PDF magic bytes(%PDF)가 없는 응답은 빈 바이트 반환"""
        listing = PolicyListing(
            company_name="삼성생명",
            product_name="종신보험",
            product_code="41658-5",
            category="LIFE",
            pdf_url=f"{FILE_DOWN_URL}?fileNo=41658&seq=5",
            company_code="L03",
        )

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.content = b"<html>not a pdf</html>"

        mock_client = AsyncMock()
        mock_client.get.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await crawler.download_pdf(listing)

        assert result == b""

    @pytest.mark.asyncio
    async def test_download_pdf_http_error_returns_empty(
        self, crawler: PubInsureLifeCrawler
    ) -> None:
        """HTTP 4xx/5xx 오류 시 빈 바이트 반환"""
        listing = PolicyListing(
            company_name="삼성생명",
            product_name="종신보험",
            product_code="41658-5",
            category="LIFE",
            pdf_url=f"{FILE_DOWN_URL}?fileNo=41658&seq=5",
            company_code="L03",
        )

        mock_response = MagicMock()
        mock_response.status_code = 404
        mock_response.content = b"not found"

        mock_client = AsyncMock()
        mock_client.get.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await crawler.download_pdf(listing)

        assert result == b""


# ---------------------------------------------------------------------------
# REQ-06: 페이지네이션 처리
# ---------------------------------------------------------------------------

class TestFetchListingPagination:
    """REQ-06: 페이지네이션 처리 테스트"""

    @pytest.mark.asyncio
    async def test_fetch_listing_pagination_stops_when_empty(
        self, crawler: PubInsureLifeCrawler
    ) -> None:
        """빈 응답이 오면 페이지네이션 중단"""
        call_count = 0

        async def mock_fetch_page(category_code: str, page_index: int) -> str:
            nonlocal call_count
            call_count += 1
            if page_index == 1:
                return SAMPLE_HTML_WITH_FILE_DOWN
            return SAMPLE_HTML_NO_FILE_DOWN

        with patch.object(crawler, "_fetch_page", side_effect=mock_fetch_page):
            listings = await crawler._fetch_category_listings("024400010001")

        assert len(listings) == 2
        assert call_count == 2  # 1페이지(데이터), 2페이지(빈 페이지)

    @pytest.mark.asyncio
    async def test_fetch_listing_accumulates_across_pages(
        self, crawler: PubInsureLifeCrawler
    ) -> None:
        """여러 페이지의 데이터를 누적하여 반환"""
        call_count = 0

        async def mock_fetch_page(category_code: str, page_index: int) -> str:
            nonlocal call_count
            call_count += 1
            if page_index <= 2:
                return SAMPLE_HTML_WITH_FILE_DOWN
            return SAMPLE_HTML_NO_FILE_DOWN

        with patch.object(crawler, "_fetch_page", side_effect=mock_fetch_page):
            listings = await crawler._fetch_category_listings("024400010001")

        # 각 페이지에서 2개씩, 2페이지 = 4개 (product_code가 같으면 중복될 수 있음)
        assert len(listings) == 4
        assert call_count == 3


# ---------------------------------------------------------------------------
# REQ-04: 변경 감지 (델타 크롤링)
# ---------------------------------------------------------------------------

class TestDetectChanges:
    """REQ-04: 델타 크롤링 테스트"""

    @pytest.mark.asyncio
    async def test_detect_changes_all_new_when_no_hashes(
        self, crawler: PubInsureLifeCrawler
    ) -> None:
        """저장된 해시가 없으면 모든 항목을 신규로 처리"""
        listings = [
            PolicyListing(
                company_name="삼성생명",
                product_name="종신보험",
                product_code="41658-5",
                category="LIFE",
                pdf_url=f"{FILE_DOWN_URL}?fileNo=41658&seq=5",
                company_code="L03",
            )
        ]

        result = await crawler.detect_changes(listings)

        assert isinstance(result, DeltaResult)
        assert len(result.new) == 1
        assert len(result.updated) == 0
        assert len(result.unchanged) == 0

    @pytest.mark.asyncio
    async def test_detect_changes_unchanged_items_when_hash_matches(
        self, crawler: PubInsureLifeCrawler
    ) -> None:
        """해시가 동일한 항목은 unchanged로 분류"""
        listing = PolicyListing(
            company_name="삼성생명",
            product_name="종신보험",
            product_code="41658-5",
            category="LIFE",
            pdf_url=f"{FILE_DOWN_URL}?fileNo=41658&seq=5",
            company_code="L03",
        )
        pdf_bytes = b"%PDF valid content"
        existing_hash = crawler._compute_hash(pdf_bytes)

        # 기존 해시를 크롤러 내부 캐시에 주입
        crawler._known_hashes["41658-5"] = existing_hash

        result = await crawler.detect_changes([listing])

        assert len(result.new) == 0
        assert len(result.updated) == 0
        assert len(result.unchanged) == 1

    @pytest.mark.asyncio
    async def test_detect_changes_new_items_when_not_in_cache(
        self, crawler: PubInsureLifeCrawler
    ) -> None:
        """캐시에 없는 항목은 new로 분류"""
        listing = PolicyListing(
            company_name="한화생명",
            product_name="연금보험",
            product_code="99999-1",
            category="LIFE",
            pdf_url=f"{FILE_DOWN_URL}?fileNo=99999&seq=1",
            company_code="L01",
        )
        # 다른 product_code 캐시에는 있지만, 이 항목은 없음
        crawler._known_hashes["other-code"] = "some_hash"

        result = await crawler.detect_changes([listing])

        assert len(result.new) == 1
        assert len(result.updated) == 0
        assert len(result.unchanged) == 0


# ---------------------------------------------------------------------------
# REQ-07: Rate Limiting
# ---------------------------------------------------------------------------

class TestRateLimiting:
    """REQ-07: 레이트 리밋 테스트"""

    @pytest.mark.asyncio
    async def test_rate_limiting_applied_during_crawl(
        self, mock_db_session: MagicMock, mock_storage: MagicMock
    ) -> None:
        """crawl() 실행 중 _rate_limit 호출 확인"""
        # 레이트 리밋이 실제로 적용되는 크롤러 (1초)
        crawler = PubInsureLifeCrawler(
            db_session=mock_db_session,
            storage=mock_storage,
            rate_limit_seconds=1.0,
        )

        # 모든 외부 의존성을 목으로 대체
        async def mock_fetch_category(category_code: str) -> list[PolicyListing]:
            return []

        with patch.object(crawler, "_fetch_category_listings", side_effect=mock_fetch_category):
            with patch.object(crawler, "_rate_limit", new_callable=AsyncMock) as mock_rate_limit:
                await crawler.crawl()

        # 카테고리 수만큼 레이트 리밋 호출 확인
        assert mock_rate_limit.call_count >= 1


# ---------------------------------------------------------------------------
# 전체 크롤링 플로우
# ---------------------------------------------------------------------------

class TestCrawlReturnsResult:
    """전체 크롤링 플로우 테스트"""

    @pytest.mark.asyncio
    async def test_crawl_returns_crawl_run_result(
        self, crawler: PubInsureLifeCrawler
    ) -> None:
        """crawl() 메서드가 CrawlRunResult를 반환해야 함"""
        async def mock_fetch_category(category_code: str) -> list[PolicyListing]:
            return []

        with patch.object(crawler, "_fetch_category_listings", side_effect=mock_fetch_category):
            with patch.object(crawler, "_rate_limit", new_callable=AsyncMock):
                result = await crawler.crawl()

        assert isinstance(result, CrawlRunResult)
        assert result.total_found == 0
        assert result.new_count == 0
        assert result.failed_count == 0

    @pytest.mark.asyncio
    async def test_crawl_processes_new_listings(
        self, crawler: PubInsureLifeCrawler
    ) -> None:
        """신규 상품이 있을 때 PDF 다운로드 및 처리"""
        sample_listing = PolicyListing(
            company_name="삼성생명",
            product_name="종신보험",
            product_code="41658-5",
            category="LIFE",
            pdf_url=f"{FILE_DOWN_URL}?fileNo=41658&seq=5",
            company_code="L03",
        )

        async def mock_fetch_category(category_code: str) -> list[PolicyListing]:
            return [sample_listing]

        crawler.storage.get_path.return_value = "/path/to/pdf"
        crawler.storage.save = MagicMock()

        with patch.object(crawler, "_fetch_category_listings", side_effect=mock_fetch_category):
            with patch.object(crawler, "_rate_limit", new_callable=AsyncMock):
                with patch.object(crawler, "download_pdf", new_callable=AsyncMock) as mock_dl:
                    mock_dl.return_value = b"%PDF valid"
                    result = await crawler.crawl()

        assert isinstance(result, CrawlRunResult)
        assert result.total_found >= 1


# ---------------------------------------------------------------------------
# REQ-05: CrawlerRegistry 등록
# ---------------------------------------------------------------------------

class TestCrawlerRegistryRegistration:
    """REQ-05: CrawlerRegistry 등록 테스트"""

    def test_pub_insure_life_can_be_registered_in_registry(self) -> None:
        """PubInsureLifeCrawler를 CrawlerRegistry에 pub_insure_life 키로 등록 가능"""
        from app.services.crawler.registry import CrawlerRegistry
        from app.services.crawler.companies.pubinsure_life_crawler import PubInsureLifeCrawler

        registry = CrawlerRegistry()
        registry.register("pub_insure_life", PubInsureLifeCrawler)

        assert registry.get("pub_insure_life") is PubInsureLifeCrawler
        assert "pub_insure_life" in registry.list_crawlers()


# ---------------------------------------------------------------------------
# _fetch_page 메서드 테스트
# ---------------------------------------------------------------------------

class TestFetchPage:
    """_fetch_page HTTP POST 요청 테스트"""

    @pytest.mark.asyncio
    async def test_fetch_page_returns_html_on_success(
        self, crawler: PubInsureLifeCrawler
    ) -> None:
        """HTTP 200 응답 시 HTML 문자열 반환"""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = "<html>content</html>"

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await crawler._fetch_page("024400010001", 1)

        assert result == "<html>content</html>"

    @pytest.mark.asyncio
    async def test_fetch_page_returns_empty_on_http_error(
        self, crawler: PubInsureLifeCrawler
    ) -> None:
        """HTTP 4xx 오류 시 빈 문자열 반환"""
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.text = ""

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await crawler._fetch_page("024400010001", 1)

        assert result == ""

    @pytest.mark.asyncio
    async def test_fetch_page_returns_empty_on_exception(
        self, crawler: PubInsureLifeCrawler
    ) -> None:
        """네트워크 예외 발생 시 빈 문자열 반환"""
        mock_client = AsyncMock()
        mock_client.post.side_effect = Exception("Connection error")
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await crawler._fetch_page("024400010001", 1)

        assert result == ""

    @pytest.mark.asyncio
    async def test_download_pdf_exception_returns_empty(
        self, crawler: PubInsureLifeCrawler
    ) -> None:
        """httpx 예외 발생 시 빈 바이트 반환"""
        listing = PolicyListing(
            company_name="삼성생명",
            product_name="종신보험",
            product_code="41658-5",
            category="LIFE",
            pdf_url=f"{FILE_DOWN_URL}?fileNo=41658&seq=5",
            company_code="L03",
        )

        mock_client = AsyncMock()
        mock_client.get.side_effect = Exception("Network error")
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await crawler.download_pdf(listing)

        assert result == b""


# ---------------------------------------------------------------------------
# crawl() 에러 처리 테스트
# ---------------------------------------------------------------------------

class TestCrawlErrorHandling:
    """crawl() 에러 처리 테스트"""

    @pytest.mark.asyncio
    async def test_crawl_handles_category_fetch_error(
        self, crawler: PubInsureLifeCrawler
    ) -> None:
        """카테고리 수집 실패 시 해당 카테고리만 건너뜀"""
        async def mock_fetch_category(category_code: str) -> list[PolicyListing]:
            if category_code == "024400010001":
                raise Exception("수집 실패")
            return []

        with patch.object(crawler, "_fetch_category_listings", side_effect=mock_fetch_category):
            with patch.object(crawler, "_rate_limit", new_callable=AsyncMock):
                result = await crawler.crawl()

        # 나머지 카테고리는 정상 처리
        assert isinstance(result, CrawlRunResult)
        assert result.failed_count == 0  # PDF 다운로드 실패가 아님

    @pytest.mark.asyncio
    async def test_crawl_handles_empty_pdf_as_failed(
        self, crawler: PubInsureLifeCrawler
    ) -> None:
        """빈 PDF 응답은 failed_count에 포함"""
        sample_listing = PolicyListing(
            company_name="삼성생명",
            product_name="종신보험",
            product_code="41658-5",
            category="LIFE",
            pdf_url=f"{FILE_DOWN_URL}?fileNo=41658&seq=5",
            company_code="L03",
        )

        async def mock_fetch_category(category_code: str) -> list[PolicyListing]:
            if category_code == list(PRODUCT_CATEGORIES.keys())[0]:
                return [sample_listing]
            return []

        with patch.object(crawler, "_fetch_category_listings", side_effect=mock_fetch_category):
            with patch.object(crawler, "_rate_limit", new_callable=AsyncMock):
                with patch.object(crawler, "download_pdf", new_callable=AsyncMock) as mock_dl:
                    mock_dl.return_value = b""  # 빈 PDF
                    result = await crawler.crawl()

        assert result.failed_count >= 1

    @pytest.mark.asyncio
    async def test_crawl_handles_updated_listings(
        self, crawler: PubInsureLifeCrawler
    ) -> None:
        """updated 항목도 PDF 다운로드 처리"""
        sample_listing = PolicyListing(
            company_name="삼성생명",
            product_name="종신보험",
            product_code="41658-5",
            category="LIFE",
            pdf_url=f"{FILE_DOWN_URL}?fileNo=41658&seq=5",
            company_code="L03",
        )
        # 기존 해시 주입 -> unchanged로 처리됨
        crawler._known_hashes["41658-5"] = "some_existing_hash"

        # detect_changes가 updated를 반환하도록 목 설정
        async def mock_detect_changes(listings: list[PolicyListing]) -> DeltaResult:
            return DeltaResult(new=[], updated=listings, unchanged=[])

        async def mock_fetch_category(category_code: str) -> list[PolicyListing]:
            if category_code == list(PRODUCT_CATEGORIES.keys())[0]:
                return [sample_listing]
            return []

        crawler.storage.get_path.return_value = "/path/to/pdf"
        crawler.storage.save = MagicMock()

        with patch.object(crawler, "_fetch_category_listings", side_effect=mock_fetch_category):
            with patch.object(crawler, "detect_changes", side_effect=mock_detect_changes):
                with patch.object(crawler, "_rate_limit", new_callable=AsyncMock):
                    with patch.object(crawler, "download_pdf", new_callable=AsyncMock) as mock_dl:
                        mock_dl.return_value = b"%PDF valid"
                        result = await crawler.crawl()

        assert result.updated_count >= 1


# ---------------------------------------------------------------------------
# 상수 및 설정 확인
# ---------------------------------------------------------------------------

class TestConstants:
    """크롤러 상수 및 설정 테스트"""

    def test_listing_url_is_correct(self) -> None:
        """목록 조회 URL이 올바른지 확인"""
        assert "pub.insure.or.kr" in LISTING_URL

    def test_file_down_url_is_correct(self) -> None:
        """파일 다운로드 URL이 올바른지 확인"""
        assert "pub.insure.or.kr" in FILE_DOWN_URL
        assert "FileDown.do" in FILE_DOWN_URL

    def test_product_categories_contains_expected_keys(self) -> None:
        """상품 카테고리 코드가 포함되어 있는지 확인"""
        assert "024400010001" in PRODUCT_CATEGORIES  # 종신보험
        assert "024400010003" in PRODUCT_CATEGORIES  # 연금보험
        assert len(PRODUCT_CATEGORIES) >= 5

    def test_crawler_name_is_pub_insure_life(
        self, crawler: PubInsureLifeCrawler
    ) -> None:
        """크롤러 이름이 pub_insure_life여야 함"""
        assert crawler.crawler_name == "pub_insure_life"
