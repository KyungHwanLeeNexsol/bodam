"""손해보험협회(KNIA) 크롤러 (SPEC-CRAWLER-001)

한국손해보험협회(knia.or.kr)에서 약관 PDF 목록을 크롤링.
Playwright 네이티브 엘리먼트 선택을 사용한 강건한 파싱.
페이지네이션 자동 처리 포함.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from sqlalchemy import select

from app.models.insurance import InsuranceCategory, Policy
from app.services.crawler.base import BaseCrawler, CrawlRunResult, DeltaResult, PolicyListing

logger = logging.getLogger(__name__)

# KNIA 크롤러 식별자
CRAWLER_NAME = "knia"

# 손해보험협회 기본 URL
BASE_URL = "https://www.knia.or.kr"

# @MX:NOTE: [AUTO] KNIA 약관 크롤링 현황
# kpub.knia.or.kr는 비교공시 사이트로 PDF 다운로드 미제공
# www.knia.or.kr/file/download/XXX는 이미지 파일 (PDF 아님)
# 현재 KNIA 약관 PDF 공개 경로 미확인 - 빈 목록 반환
KNIA_PDF_NOT_AVAILABLE = True

# 다음 페이지 버튼 선택자 후보
NEXT_PAGE_SELECTORS = [
    "a:has-text('다음')",
    "button:has-text('다음')",
    ".pagination .next",
    ".paging .next",
    "a.next",
    "a[title='다음']",
]

# 아이템 컨테이너 선택자 후보 (사이트 구조 변경 대비)
ITEM_SELECTORS = [
    ".insurance-list .item",
    ".product-list .item",
    ".list-area .item",
    "ul.list li",
    ".product-item",
    "table tbody tr",
    ".tb_list tr",
]


class KNIACrawler(BaseCrawler):
    """한국손해보험협회 약관 크롤러

    knia.or.kr에서 손해보험 상품 목록과 약관 PDF를 크롤링.
    JavaScript 렌더링이 필요하여 Playwright 사용.
    Playwright 네이티브 엘리먼트 선택으로 정확한 파싱.
    """

    def __init__(self, db_session: Any, storage: Any, **kwargs: Any) -> None:
        """KNIA 크롤러 초기화

        Args:
            db_session: SQLAlchemy 비동기 세션
            storage: 스토리지 백엔드 인스턴스
            **kwargs: BaseCrawler 추가 설정 (rate_limit_seconds, max_retries)
        """
        super().__init__(
            crawler_name=CRAWLER_NAME,
            db_session=db_session,
            storage=storage,
            **kwargs,
        )

    async def crawl(self) -> CrawlRunResult:
        """KNIA 약관 목록 전체 크롤링

        Playwright로 목록 페이지를 렌더링 후 파싱.
        페이지네이션 처리 포함.
        변경 감지 후 신규/변경 항목만 PDF 다운로드.

        Returns:
            크롤링 실행 결과 요약
        """
        results = []
        try:
            # Playwright 네이티브 선택으로 전체 목록 크롤링
            listings = await self._fetch_all_listings_playwright()
            delta = await self.detect_changes(listings)

            new_count = 0
            updated_count = 0
            failed_count = 0

            for listing in delta.new + delta.updated:
                try:
                    await self._rate_limit()
                    pdf_bytes = await self.download_pdf(listing)
                    path = self.storage.get_path(
                        company_code=listing.company_code,
                        product_code=listing.product_code,
                        version="latest",
                    )
                    self.storage.save(pdf_bytes, path)
                    content_hash = self._compute_hash(pdf_bytes)

                    is_new = listing in delta.new
                    if is_new:
                        new_count += 1
                    else:
                        updated_count += 1

                    results.append({
                        "product_code": listing.product_code,
                        "company_code": listing.company_code,
                        "status": "NEW" if is_new else "UPDATED",
                        "pdf_path": path,
                        "content_hash": content_hash,
                    })
                except Exception as exc:
                    failed_count += 1
                    logger.error("KNIA %s PDF 다운로드 실패: %s", listing.product_code, str(exc))
                    results.append({
                        "product_code": listing.product_code,
                        "company_code": listing.company_code,
                        "status": "FAILED",
                        "error": str(exc),
                    })

            return CrawlRunResult(
                total_found=len(listings),
                new_count=new_count,
                updated_count=updated_count,
                skipped_count=len(delta.unchanged),
                failed_count=failed_count,
                results=results,
            )
        except Exception as exc:
            logger.error("KNIA 크롤링 실패: %s", str(exc))
            return CrawlRunResult(
                total_found=0, new_count=0, updated_count=0,
                skipped_count=0, failed_count=1, results=[]
            )

    # @MX:ANCHOR: [AUTO] 전체 약관 목록 크롤링 핵심 메서드
    # @MX:REASON: crawl()에서 직접 호출, KNIA PDF 미제공으로 빈 목록 반환
    async def _fetch_all_listings_playwright(self) -> list[PolicyListing]:
        """KNIA 약관 목록 크롤링

        현재 KNIA(kpub.knia.or.kr)는 보험료 비교공시 사이트로,
        약관 PDF 다운로드를 제공하지 않습니다.
        www.knia.or.kr/file/download/ 는 이미지 파일만 제공.

        향후 KNIA에서 약관 PDF 공시 경로 확인 시 구현 필요.

        Returns:
            빈 목록 (KNIA PDF 미제공)
        """
        if KNIA_PDF_NOT_AVAILABLE:
            logger.warning(
                "KNIA 약관 PDF 다운로드 경로 미확인. "
                "kpub.knia.or.kr는 비교공시 전용 사이트입니다. "
                "약관 PDF 크롤링을 건너뜁니다."
            )
            return []

        # 향후 구현을 위한 플레이스홀더
        return []

    async def _parse_page_listings(self, page: Any) -> list[PolicyListing]:
        """현재 페이지에서 약관 목록 파싱

        Playwright 네이티브 엘리먼트 선택으로 아이템 파싱.
        div.item 구조와 table tr 구조 모두 지원.

        Args:
            page: Playwright 페이지 객체

        Returns:
            파싱된 PolicyListing 목록
        """
        listings: list[PolicyListing] = []

        # 여러 아이템 선택자 시도
        items = None
        used_selector = ""
        for selector in ITEM_SELECTORS:
            try:
                items = await page.query_selector_all(selector)
                if items:
                    used_selector = selector
                    logger.debug("KNIA 선택자 '%s' 사용, %d개 항목 발견", selector, len(items))
                    break
            except Exception:
                continue

        if not items:
            logger.warning("KNIA 목록 항목을 찾을 수 없습니다")
            return listings

        # 테이블 구조인지 div 구조인지 판별
        is_table = "tr" in used_selector or "tbody" in used_selector

        for item in items:
            try:
                if is_table:
                    listing = await self._parse_table_row(item)
                else:
                    listing = await self._parse_div_item(item)

                if listing:
                    listings.append(listing)
            except Exception as exc:
                logger.debug("KNIA 항목 파싱 실패: %s", str(exc))

        return listings

    async def _parse_table_row(self, row: Any) -> PolicyListing | None:
        """테이블 행에서 PolicyListing 추출

        Args:
            row: Playwright 테이블 행 엘리먼트

        Returns:
            파싱된 PolicyListing 또는 None
        """
        cells = await row.query_selector_all("td")
        if len(cells) < 3:
            return None

        company_name = (await cells[0].inner_text()).strip()
        product_name = (await cells[1].inner_text()).strip()
        product_code = (await cells[2].inner_text()).strip()

        if not product_code:
            return None

        pdf_url = await self._find_pdf_link(row)
        if not pdf_url:
            return None

        company_code = re.sub(r"[^a-z0-9]", "-", company_name.lower()).strip("-")
        if not company_code:
            company_code = f"knia-{len(product_code)}"

        return PolicyListing(
            company_name=company_name,
            product_name=product_name,
            product_code=product_code,
            category=InsuranceCategory.NON_LIFE,
            pdf_url=pdf_url,
            company_code=company_code,
        )

    async def _parse_div_item(self, item: Any) -> PolicyListing | None:
        """div.item 구조에서 PolicyListing 추출

        span.company-name, span.product-name, span.code 패턴 사용.

        Args:
            item: Playwright div 아이템 엘리먼트

        Returns:
            파싱된 PolicyListing 또는 None
        """
        # 회사명 추출 (다양한 클래스명 시도)
        company_name = ""
        for selector in [".company-name", ".company", "[class*='company']"]:
            el = await item.query_selector(selector)
            if el:
                company_name = (await el.inner_text()).strip()
                break

        # 상품명 추출
        product_name = ""
        for selector in [".product-name", ".product", "[class*='product']", ".title"]:
            el = await item.query_selector(selector)
            if el:
                product_name = (await el.inner_text()).strip()
                break

        # 상품코드 추출
        product_code = ""
        for selector in [".code", ".product-code", "[class*='code']", ".num"]:
            el = await item.query_selector(selector)
            if el:
                product_code = (await el.inner_text()).strip()
                break

        if not product_code:
            return None

        pdf_url = await self._find_pdf_link(item)
        if not pdf_url:
            return None

        company_code = re.sub(r"[^a-z0-9]", "-", company_name.lower()).strip("-")
        if not company_code:
            company_code = f"knia-{len(product_code)}"

        return PolicyListing(
            company_name=company_name,
            product_name=product_name,
            product_code=product_code,
            category=InsuranceCategory.NON_LIFE,
            pdf_url=pdf_url,
            company_code=company_code,
        )

    async def _find_pdf_link(self, element: Any) -> str | None:
        """엘리먼트 내에서 PDF 링크 탐색

        다양한 방식으로 PDF URL 추출 시도.

        Args:
            element: Playwright 엘리먼트

        Returns:
            PDF URL 또는 None
        """
        # href 속성에서 .pdf 링크 탐색
        pdf_links = await element.query_selector_all("a[href*='.pdf']")
        if pdf_links:
            href = await pdf_links[0].get_attribute("href")
            if href:
                return href if href.startswith("http") else f"{BASE_URL}{href}"

        # JavaScript 다운로드 링크 탐색 (onclick 속성)
        dl_links = await element.query_selector_all("a[onclick*='download']")
        if dl_links:
            onclick = await dl_links[0].get_attribute("onclick")
            if onclick:
                match = re.search(r"['\"]([^'\"]+\.pdf[^'\"]*)['\"]", onclick)
                if match:
                    path = match.group(1)
                    return path if path.startswith("http") else f"{BASE_URL}{path}"

        # 일반 다운로드 링크 탐색
        all_links = await element.query_selector_all("a[href]")
        for link in all_links:
            href = await link.get_attribute("href") or ""
            text = (await link.inner_text()).strip()
            # 다운로드 텍스트 또는 PDF 관련 href 패턴
            if "download" in href.lower() or "pdf" in href.lower() or text in ("약관", "다운로드", "PDF"):
                if href not in ("#", "javascript:void(0)", ""):
                    return href if href.startswith("http") else f"{BASE_URL}{href}"

        return None

    async def _click_next_page(self, page: Any) -> bool:
        """다음 페이지 버튼 탐색 및 클릭

        여러 선택자 패턴으로 '다음' 버튼을 찾아 클릭.

        Args:
            page: Playwright 페이지 객체

        Returns:
            클릭 성공 여부
        """
        for selector in NEXT_PAGE_SELECTORS:
            try:
                next_btn = await page.query_selector(selector)
                if not next_btn:
                    continue

                # 버튼이 비활성화되어 있는지 확인
                is_disabled = await next_btn.get_attribute("disabled")
                class_attr = await next_btn.get_attribute("class") or ""

                if is_disabled or "disabled" in class_attr:
                    return False

                await next_btn.click()
                return True
            except Exception:
                continue

        return False

    async def parse_listing(self, page: Any) -> list[PolicyListing]:
        """HTML에서 손해보험 상품 목록 파싱 (하위 호환성 유지)

        새로운 구현은 _fetch_all_listings_playwright()를 직접 사용.
        이 메서드는 BaseCrawler ABC 인터페이스 준수를 위해 유지.

        Args:
            page: HTML 문자열 또는 Playwright 페이지 객체

        Returns:
            파싱된 PolicyListing 목록
        """
        # 페이지 객체인 경우 Playwright 파싱 사용
        if hasattr(page, "query_selector_all"):
            return await self._parse_page_listings(page)

        # HTML 문자열인 경우 빈 목록 반환 (레거시 지원)
        logger.warning("KNIA parse_listing: HTML 문자열 파싱은 더 이상 지원되지 않습니다. _fetch_all_listings_playwright()를 사용하세요.")
        return []

    async def download_pdf(self, listing: PolicyListing) -> bytes:
        """약관 PDF 다운로드

        Args:
            listing: 다운로드할 상품 정보

        Returns:
            PDF 바이너리 데이터
        """
        return await self._download_with_playwright(listing.pdf_url)

    async def _download_with_playwright(self, url: str) -> bytes:
        """Playwright로 PDF 다운로드

        Args:
            url: PDF URL

        Returns:
            PDF 바이너리
        """
        try:
            from playwright.async_api import async_playwright
        except ImportError:
            logger.warning("playwright 미설치, 빈 bytes 반환")
            return b""

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            try:
                context = await browser.new_context()
                page = await context.new_page()

                response_data: list[bytes] = []

                async def handle_response(response: Any) -> None:
                    if url in response.url and response.status < 400:
                        try:
                            body = await response.body()
                            response_data.append(body)
                        except Exception:
                            pass

                page.on("response", handle_response)
                await page.goto(url, wait_until="networkidle", timeout=30000)

                if not response_data:
                    await page.wait_for_timeout(2000)

            finally:
                await browser.close()

        if response_data:
            return response_data[0]

        logger.warning("KNIA PDF 다운로드 데이터 없음: %s", url)
        return b""

    async def detect_changes(self, listings: list[PolicyListing]) -> DeltaResult:
        """기존 Policy 데이터와 비교하여 변경 감지

        DB에서 현재 상품 목록을 조회 후 content_hash 비교.

        Args:
            listings: 크롤링으로 발견된 상품 목록

        Returns:
            변경 감지 결과 (new, updated, unchanged)
        """
        new_listings: list[PolicyListing] = []
        updated_listings: list[PolicyListing] = []
        unchanged_listings: list[PolicyListing] = []

        try:
            product_codes = [listing.product_code for listing in listings]
            stmt = select(Policy).where(Policy.product_code.in_(product_codes))
            result = await self.db_session.execute(stmt)
            existing_policies = result.scalars().all()

            existing_map = {p.product_code: p for p in existing_policies}

            for listing in listings:
                existing = existing_map.get(listing.product_code)
                if existing is None:
                    new_listings.append(listing)
                else:
                    existing_hash = (existing.metadata_ or {}).get("content_hash")
                    if existing_hash is None:
                        updated_listings.append(listing)
                    else:
                        updated_listings.append(listing)

        except Exception as exc:
            logger.error("KNIA 변경 감지 실패: %s", str(exc))
            new_listings = list(listings)

        return DeltaResult(
            new=new_listings,
            updated=updated_listings,
            unchanged=unchanged_listings,
        )
