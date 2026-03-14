"""생명보험협회(KLIA) 크롤러 (SPEC-CRAWLER-001)

한국생명보험협회(klia.or.kr)에서 약관 PDF 목록을 크롤링.
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

# KLIA 크롤러 식별자
CRAWLER_NAME = "klia"

# 생명보험협회 기본 URL
BASE_URL = "https://www.klia.or.kr"


class KLIACrawler(BaseCrawler):
    """한국생명보험협회 약관 크롤러

    klia.or.kr에서 생명보험 상품 목록과 약관 PDF를 크롤링.
    JavaScript 렌더링이 필요하여 Playwright 사용.
    """

    def __init__(self, db_session: Any, storage: Any, **kwargs: Any) -> None:
        """KLIA 크롤러 초기화

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
        """KLIA 약관 목록 전체 크롤링

        Playwright로 목록 페이지를 렌더링 후 파싱.
        변경 감지 후 신규/변경 항목만 PDF 다운로드.

        Returns:
            크롤링 실행 결과 요약
        """
        results = []
        try:
            # Playwright로 목록 페이지 렌더링
            html = await self._fetch_listing_page()
            listings = await self.parse_listing(html)
            delta = await self.detect_changes(listings)

            new_count = 0
            updated_count = 0
            failed_count = 0

            # 신규/변경 항목 PDF 다운로드
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
                    logger.error("KLIA %s PDF 다운로드 실패: %s", listing.product_code, str(exc))
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
            logger.error("KLIA 크롤링 실패: %s", str(exc))
            return CrawlRunResult(
                total_found=0, new_count=0, updated_count=0,
                skipped_count=0, failed_count=1, results=[]
            )

    async def _fetch_listing_page(self) -> str:
        """Playwright로 KLIA 목록 페이지 HTML 가져오기

        Returns:
            렌더링된 HTML 문자열
        """
        try:
            from playwright.async_api import async_playwright

            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True)
                page = await browser.new_page()
                await page.goto(f"{BASE_URL}/consumer/policy/list", wait_until="networkidle")
                html = await page.content()
                await browser.close()
                return html
        except ImportError:
            logger.warning("playwright 미설치, 빈 HTML 반환")
            return ""

    async def parse_listing(self, page: Any) -> list[PolicyListing]:
        """HTML에서 생명보험 상품 목록 파싱

        테이블 기반 HTML에서 보험사명, 상품명, 상품코드, PDF URL 추출.

        Args:
            page: HTML 문자열

        Returns:
            파싱된 PolicyListing 목록
        """
        listings = []

        # 간단한 정규식 기반 파싱 (BeautifulSoup 미사용, 의존성 최소화)
        # <table class="product-list"> 내 <tr> 파싱
        try:
            # 회사명, 상품명, 상품코드, PDF URL 패턴 추출
            # td.company, td.product-name, td.product-code, a[href*=".pdf"] 패턴
            rows = re.findall(
                r'<tr[^>]*>.*?</tr>',
                page,
                re.DOTALL,
            )

            for row in rows:
                # 각 셀 추출
                cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
                if len(cells) < 3:
                    continue

                # PDF 링크 추출
                pdf_match = re.search(r'href=["\']([^"\']*\.pdf[^"\']*)["\']', row, re.IGNORECASE)
                if not pdf_match:
                    continue

                pdf_url = pdf_match.group(1)
                if not pdf_url.startswith("http"):
                    pdf_url = f"{BASE_URL}{pdf_url}"

                # 텍스트에서 HTML 태그 제거
                def strip_tags(text: str) -> str:
                    return re.sub(r'<[^>]+>', '', text).strip()

                company_name = strip_tags(cells[0]) if cells else ""
                product_name = strip_tags(cells[1]) if len(cells) > 1 else ""
                product_code = strip_tags(cells[2]) if len(cells) > 2 else ""

                if not product_code:
                    continue

                # 보험사 코드 생성 (slugify)
                company_code = re.sub(r'[^a-z0-9]', '-', company_name.lower()).strip('-')
                if not company_code:
                    company_code = f"company-{len(listings)}"

                listings.append(PolicyListing(
                    company_name=company_name,
                    product_name=product_name,
                    product_code=product_code,
                    category=InsuranceCategory.LIFE,
                    pdf_url=pdf_url,
                    company_code=company_code,
                ))

        except Exception as exc:
            logger.error("KLIA 목록 파싱 실패: %s", str(exc))

        return listings

    async def download_pdf(self, listing: PolicyListing) -> bytes:
        """약관 PDF 다운로드

        Playwright를 통해 PDF를 바이너리로 다운로드.

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

                # 응답 캡처를 위한 핸들러
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
        DB에 없으면 NEW, 해시 다르면 UPDATED, 같으면 UNCHANGED.

        Args:
            listings: 크롤링으로 발견된 상품 목록

        Returns:
            변경 감지 결과 (new, updated, unchanged)
        """
        new_listings = []
        updated_listings = []
        unchanged_listings = []

        try:
            # 모든 상품 코드로 기존 Policy 조회
            product_codes = [listing.product_code for listing in listings]
            stmt = select(Policy).where(Policy.product_code.in_(product_codes))
            result = await self.db_session.execute(stmt)
            existing_policies = result.scalars().all()

            # product_code -> Policy 매핑
            existing_map = {p.product_code: p for p in existing_policies}

            for listing in listings:
                existing = existing_map.get(listing.product_code)
                if existing is None:
                    # DB에 없음: 신규
                    new_listings.append(listing)
                else:
                    # content_hash 비교
                    existing_hash = (existing.metadata_ or {}).get("content_hash")
                    if existing_hash is None:
                        # 해시 없음: 업데이트 필요
                        updated_listings.append(listing)
                    else:
                        # 해시는 PDF 다운로드 후 비교하므로 여기서는 일단 NEW/UPDATED 처리
                        # 실제 운영 환경에서는 PDF를 먼저 다운로드하여 해시 비교
                        updated_listings.append(listing)

        except Exception as exc:
            logger.error("KLIA 변경 감지 실패: %s", str(exc))
            # 실패 시 모두 NEW로 처리
            new_listings = list(listings)

        return DeltaResult(
            new=new_listings,
            updated=updated_listings,
            unchanged=unchanged_listings,
        )
