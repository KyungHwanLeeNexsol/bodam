"""보험사별 크롤러 단위 테스트 (SPEC-CRAWLER-001)

KLIACrawler, KNIACrawler HTML 픽스처 기반 테스트.
실제 웹사이트 접근 없이 모킹으로 테스트.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from app.services.crawler.base import PolicyListing
from app.services.crawler.companies.klia_crawler import KLIACrawler
from app.services.crawler.companies.knia_crawler import KNIACrawler

# HTML 픽스처 - KLIA(생명보험협회) 스타일 목록 페이지
KLIA_SAMPLE_HTML = """
<html>
<body>
<table class="product-list">
  <tr>
    <td class="company">삼성생명</td>
    <td class="product-name">삼성 종신보험 2024</td>
    <td class="product-code">SL-2024-001</td>
    <td><a href="/pdf/SL-2024-001.pdf">약관 PDF</a></td>
  </tr>
  <tr>
    <td class="company">한화생명</td>
    <td class="product-name">한화 정기보험</td>
    <td class="product-code">HW-2024-001</td>
    <td><a href="/pdf/HW-2024-001.pdf">약관 PDF</a></td>
  </tr>
</table>
</body>
</html>
"""

# HTML 픽스처 - KNIA(손해보험협회) 스타일 목록 페이지
KNIA_SAMPLE_HTML = """
<html>
<body>
<div class="insurance-list">
  <div class="item">
    <span class="company-name">삼성화재</span>
    <span class="product-name">삼성 자동차보험</span>
    <span class="code">SF-AUTO-001</span>
    <a href="/docs/SF-AUTO-001.pdf">약관</a>
  </div>
  <div class="item">
    <span class="company-name">현대해상</span>
    <span class="product-name">현대 화재보험</span>
    <span class="code">HD-FIRE-001</span>
    <a href="/docs/HD-FIRE-001.pdf">약관</a>
  </div>
</div>
</body>
</html>
"""


class TestKLIACrawler:
    """KLIACrawler 테스트"""

    def test_klia_crawler_creation(self):
        """KLIACrawler 인스턴스 생성"""
        crawler = KLIACrawler(
            db_session=MagicMock(),
            storage=MagicMock(),
        )
        assert crawler is not None
        assert crawler.crawler_name == "klia"

    def test_klia_crawler_inherits_base(self):
        """KLIACrawler는 BaseCrawler를 상속해야 함"""
        from app.services.crawler.base import BaseCrawler

        assert issubclass(KLIACrawler, BaseCrawler)

    async def test_klia_parse_listing_extracts_products(self):
        """parse_listing()은 HTML에서 상품 목록을 추출해야 함"""
        crawler = KLIACrawler(
            db_session=MagicMock(),
            storage=MagicMock(),
        )
        listings = await crawler.parse_listing(KLIA_SAMPLE_HTML)
        assert len(listings) >= 1

        # 첫 번째 상품 검증
        first = listings[0]
        assert isinstance(first, PolicyListing)
        assert first.product_code is not None
        assert first.pdf_url is not None

    async def test_klia_download_pdf_returns_bytes(self):
        """download_pdf()는 bytes를 반환해야 함"""
        crawler = KLIACrawler(
            db_session=MagicMock(),
            storage=MagicMock(),
        )
        listing = PolicyListing(
            company_name="삼성생명",
            product_name="종신보험",
            product_code="SL-001",
            category="LIFE",
            pdf_url="https://example.com/policy.pdf",
            company_code="samsung-life",
        )

        mock_page = AsyncMock()
        mock_page.goto = AsyncMock()
        mock_page.content = AsyncMock(return_value=b"pdf binary content")

        with patch.object(crawler, "_download_with_playwright", return_value=b"pdf content"):
            result = await crawler.download_pdf(listing)

        assert isinstance(result, bytes)

    async def test_klia_detect_changes_classifies_new(self):
        """detect_changes()는 새 상품을 NEW로 분류해야 함"""
        mock_session = AsyncMock()
        # 기존 Policy 없음 (빈 결과 반환)
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        mock_session.execute = AsyncMock(return_value=mock_result)

        crawler = KLIACrawler(
            db_session=mock_session,
            storage=MagicMock(),
        )

        listings = [
            PolicyListing(
                company_name="삼성생명",
                product_name="신규 상품",
                product_code="NEW-001",
                category="LIFE",
                pdf_url="https://example.com/new.pdf",
                company_code="samsung-life",
            )
        ]

        result = await crawler.detect_changes(listings)
        assert len(result.new) == 1
        assert result.new[0].product_code == "NEW-001"


class TestKNIACrawler:
    """KNIACrawler 테스트"""

    def test_knia_crawler_creation(self):
        """KNIACrawler 인스턴스 생성"""
        crawler = KNIACrawler(
            db_session=MagicMock(),
            storage=MagicMock(),
        )
        assert crawler is not None
        assert crawler.crawler_name == "knia"

    def test_knia_crawler_inherits_base(self):
        """KNIACrawler는 BaseCrawler를 상속해야 함"""
        from app.services.crawler.base import BaseCrawler

        assert issubclass(KNIACrawler, BaseCrawler)

    async def test_knia_parse_listing_extracts_products(self):
        """parse_listing()은 HTML에서 상품 목록을 추출해야 함"""
        crawler = KNIACrawler(
            db_session=MagicMock(),
            storage=MagicMock(),
        )
        listings = await crawler.parse_listing(KNIA_SAMPLE_HTML)
        assert len(listings) >= 1

        first = listings[0]
        assert isinstance(first, PolicyListing)
        assert first.product_code is not None

    async def test_knia_detect_changes_classifies_new(self):
        """detect_changes()는 새 상품을 NEW로 분류해야 함"""
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        mock_session.execute = AsyncMock(return_value=mock_result)

        crawler = KNIACrawler(
            db_session=mock_session,
            storage=MagicMock(),
        )

        listings = [
            PolicyListing(
                company_name="삼성화재",
                product_name="신규 손보 상품",
                product_code="NL-NEW-001",
                category="NON_LIFE",
                pdf_url="https://example.com/nl.pdf",
                company_code="samsung-fire",
            )
        ]

        result = await crawler.detect_changes(listings)
        assert len(result.new) == 1
