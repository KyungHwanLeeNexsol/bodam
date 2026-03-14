"""손해보험협회(KNIA) 크롤러 (SPEC-CRAWLER-001)

한국손해보험협회(knia.or.kr)에서 약관 PDF 목록을 크롤링.
Playwright를 사용한 JS 렌더링 지원.
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


class KNIACrawler(BaseCrawler):
    """한국손해보험협회 약관 크롤러

    knia.or.kr에서 손해보험 상품 목록과 약관 PDF를 크롤링.
    JavaScript 렌더링이 필요하여 Playwright 사용.
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
        변경 감지 후 신규/변경 항목만 PDF 다운로드.

        Returns:
            크롤링 실행 결과 요약
        """
        results = []
        try:
            html = await self._fetch_listing_page()
            listings = await self.parse_listing(html)
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

    async def _fetch_listing_page(self) -> str:
        """Playwright로 KNIA 목록 페이지 HTML 가져오기

        Returns:
            렌더링된 HTML 문자열
        """
        try:
            from playwright.async_api import async_playwright

            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True)
                page = await browser.new_page()
                await page.goto(f"{BASE_URL}/consumer/policy", wait_until="networkidle")
                html = await page.content()
                await browser.close()
                return html
        except ImportError:
            logger.warning("playwright 미설치, 빈 HTML 반환")
            return ""

    async def parse_listing(self, page: Any) -> list[PolicyListing]:
        """HTML에서 손해보험 상품 목록 파싱

        div.insurance-list > div.item 구조에서 상품 정보 추출.

        Args:
            page: HTML 문자열

        Returns:
            파싱된 PolicyListing 목록
        """
        listings = []

        try:
            # div.item 블록 추출
            items = re.findall(
                r'<div[^>]*class=["\'][^"\']*item[^"\']*["\'][^>]*>(.*?)</div>',
                page,
                re.DOTALL,
            )

            for item in items:
                # 텍스트에서 HTML 태그 제거
                def strip_tags(text: str) -> str:
                    return re.sub(r'<[^>]+>', '', text).strip()

                # company-name, product-name, code 스팬 추출
                company_match = re.search(
                    r'<span[^>]*class=["\'][^"\']*company-name[^"\']*["\'][^>]*>(.*?)</span>',
                    item, re.DOTALL
                )
                product_match = re.search(
                    r'<span[^>]*class=["\'][^"\']*product-name[^"\']*["\'][^>]*>(.*?)</span>',
                    item, re.DOTALL
                )
                code_match = re.search(
                    r'<span[^>]*class=["\'][^"\']*code[^"\']*["\'][^>]*>(.*?)</span>',
                    item, re.DOTALL
                )
                pdf_match = re.search(
                    r'href=["\']([^"\']*\.pdf[^"\']*)["\']',
                    item, re.IGNORECASE
                )

                if not code_match or not pdf_match:
                    continue

                pdf_url = pdf_match.group(1)
                if not pdf_url.startswith("http"):
                    pdf_url = f"{BASE_URL}{pdf_url}"

                company_name = strip_tags(company_match.group(1)) if company_match else ""
                product_name = strip_tags(product_match.group(1)) if product_match else ""
                product_code = strip_tags(code_match.group(1))

                if not product_code:
                    continue

                company_code = re.sub(r'[^a-z0-9]', '-', company_name.lower()).strip('-')
                if not company_code:
                    company_code = f"company-{len(listings)}"

                listings.append(PolicyListing(
                    company_name=company_name,
                    product_name=product_name,
                    product_code=product_code,
                    category=InsuranceCategory.NON_LIFE,
                    pdf_url=pdf_url,
                    company_code=company_code,
                ))

        except Exception as exc:
            logger.error("KNIA 목록 파싱 실패: %s", str(exc))

        return listings

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

            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True)
                page = await browser.new_page()

                response_data: list[bytes] = []

                async def handle_response(response: Any) -> None:
                    if url in response.url:
                        body = await response.body()
                        response_data.append(body)

                page.on("response", handle_response)
                await page.goto(url)
                await browser.close()

                return response_data[0] if response_data else b""
        except ImportError:
            logger.warning("playwright 미설치, 빈 bytes 반환")
            return b""

    async def detect_changes(self, listings: list[PolicyListing]) -> DeltaResult:
        """기존 Policy 데이터와 비교하여 변경 감지

        DB에서 현재 상품 목록을 조회 후 content_hash 비교.

        Args:
            listings: 크롤링으로 발견된 상품 목록

        Returns:
            변경 감지 결과 (new, updated, unchanged)
        """
        new_listings = []
        updated_listings = []
        unchanged_listings = []

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
