"""KB손해보험 크롤러 (SPEC-DATA-002 Phase 3)

Playwright 기반으로 KB손보 약관 페이지를 크롤링하여 질병/상해 관련 PDF를 수집.
JS 렌더링이 필요하여 Playwright 사용.

# @MX:NOTE: [AUTO] KB손보는 Playwright 필요 (JS 렌더링, euc-kr 인코딩)
# @MX:NOTE: [AUTO] 페이지네이션: goPage(startRow) 호출, 10개/페이지
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.services.crawler.base import (
    BaseCrawler,
    CrawlRunResult,
    DeltaResult,
    PolicyListing,
    SaleStatus,
)
from app.services.crawler.storage import StorageBackend

logger = logging.getLogger(__name__)

# KB손보 사이트 진입점
_BASE_URL = "https://www.kbinsure.co.kr"
_LIST_URL = f"{_BASE_URL}/CG802030001.ec"

# 다운로드 URL 패턴: CG802030003.ec?fileNm=<코드>_<회차>_1.pdf
_PDF_URL_TEMPLATE = f"{_BASE_URL}/CG802030003.ec?fileNm={{code}}_{{seq}}_1.pdf"


class KBNonLifeCrawler(BaseCrawler):
    """KB손해보험 약관 크롤러

    Playwright로 JS 렌더링된 상품 목록을 수집하고, httpx로 PDF를 다운로드.
    질병/상해 관련 카테고리(TARGET_CATEGORIES)만 수집 대상으로 한정.
    """

    # @MX:ANCHOR: [AUTO] KBNonLifeCrawler.TARGET_CATEGORIES - 수집 대상 카테고리
    # @MX:REASON: crawl(), parse_listing(), _is_target_category() 등 다수 메서드에서 참조
    TARGET_CATEGORIES: frozenset[str] = frozenset({
        "상해보험",
        "질병보험",
        "통합보험",
        "운전자보험",
    })

    def __init__(
        self,
        storage: StorageBackend,
        rate_limit_seconds: float = 2.0,
        max_retries: int = 3,
    ) -> None:
        """KB손보 크롤러 초기화

        Args:
            storage: PDF 파일 저장 백엔드
            rate_limit_seconds: 요청 간 대기 시간(초)
            max_retries: 최대 재시도 횟수
        """
        super().__init__(
            crawler_name="kb-nonlife",
            db_session=None,
            storage=storage,
            rate_limit_seconds=rate_limit_seconds,
            max_retries=max_retries,
        )

    def _is_target_category(self, category: str) -> bool:
        """카테고리가 수집 대상인지 확인

        Args:
            category: 상품 카테고리 문자열

        Returns:
            수집 대상이면 True
        """
        return category in self.TARGET_CATEGORIES

    async def parse_listing(self, page: Any) -> list[PolicyListing]:
        """Playwright 페이지 객체에서 상품 목록 파싱

        페이지 JavaScript를 실행하여 테이블에서 상품 정보를 추출.
        TARGET_CATEGORIES에 해당하는 상품만 반환.

        Args:
            page: Playwright 페이지 객체

        Returns:
            파싱된 PolicyListing 목록 (대상 카테고리만)
        """
        products: list[dict[str, str]] = await page.evaluate("""() => {
            const results = [];
            document.querySelectorAll('table tr').forEach(tr => {
                const tds = tr.querySelectorAll('td');
                if (tds.length >= 4) {
                    const anchor = tds[3]?.querySelector('a');
                    if (anchor) {
                        const href = anchor.getAttribute('href') || '';
                        const match = href.match(/detail\\('(\\d+)','([^']+)','([^']+)'\\)/);
                        if (match) {
                            results.push({
                                code: match[1], catCode: match[2], seq: match[3],
                                name: anchor.textContent.trim(),
                                status: tds[0]?.textContent?.trim() || '',
                                category: tds[1]?.textContent?.trim() || '',
                            });
                        }
                    }
                }
            });
            return results;
        }""")

        listings: list[PolicyListing] = []
        for prod in products:
            category = prod.get("category", "")
            if not self._is_target_category(category):
                continue

            code = prod.get("code", "")
            seq = prod.get("seq", "1")
            name = prod.get("name", "")
            status_str = prod.get("status", "")

            sale_status = SaleStatus.ON_SALE if "판매중" in status_str else SaleStatus.DISCONTINUED

            # PDF URL 구성 (직접 다운로드 패턴)
            pdf_url = _PDF_URL_TEMPLATE.format(code=code, seq=seq)

            listing = PolicyListing(
                company_name="KB손해보험",
                product_name=name,
                product_code=code,
                category=category,
                pdf_url=pdf_url,
                company_code="kb-nonlife",
                sale_status=sale_status,
            )
            listings.append(listing)

        return listings

    async def download_pdf(self, listing: PolicyListing) -> bytes:
        """PDF 다운로드

        Args:
            listing: 다운로드할 상품 정보

        Returns:
            PDF 바이너리 데이터
        """
        import httpx

        async with httpx.AsyncClient(
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": _LIST_URL,
            },
            follow_redirects=True,
            timeout=30.0,
        ) as client:
            resp = await client.get(listing.pdf_url)
            resp.raise_for_status()
            return resp.content

    async def detect_changes(self, listings: list[PolicyListing]) -> DeltaResult:
        """스토리지 존재 여부로 신규/기존 분류

        Args:
            listings: 감지할 상품 목록

        Returns:
            DeltaResult (new: 신규, unchanged: 기존)
        """
        new_listings: list[PolicyListing] = []
        unchanged_listings: list[PolicyListing] = []

        for listing in listings:
            # 저장 경로: kb-nonlife/<product_code>/<product_name>.pdf
            safe_name = listing.product_name.strip()
            for ch in ['/', '\\', ':', '?', '"', '<', '>', '*', '|']:
                safe_name = safe_name.replace(ch, '_')
            path = f"kb-nonlife/{listing.product_code}/{safe_name}.pdf"

            if self.storage.exists(path):
                unchanged_listings.append(listing)
            else:
                new_listings.append(listing)

        return DeltaResult(
            new=new_listings,
            updated=[],
            unchanged=unchanged_listings,
        )

    # @MX:ANCHOR: [AUTO] KBNonLifeCrawler.crawl - KB손보 크롤링 진입점
    # @MX:REASON: run_pipeline.py의 _create_crawler() 및 run_crawl()에서 직접 호출됨
    async def crawl(self) -> CrawlRunResult:
        """KB손보 약관 크롤링 메인 진입점

        1. Playwright로 전체 상품 목록 수집 (페이지네이션)
        2. 대상 카테고리 필터링
        3. 신규/기존 분류
        4. 신규 항목 PDF 다운로드 및 저장

        Returns:
            크롤링 실행 결과 요약
        """
        from playwright.async_api import async_playwright

        total_found = 0
        new_count = 0
        skipped_count = 0
        failed_count = 0
        results: list[dict] = []

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            try:
                context = await browser.new_context(
                    accept_downloads=True,
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                )
                page = await context.new_page()

                # 상품 목록 페이지 진입
                await page.goto(_LIST_URL, timeout=30000, wait_until="networkidle")
                await asyncio.sleep(2)

                all_listings: list[PolicyListing] = []
                page_num = 1

                while True:
                    listings = await self.parse_listing(page)
                    all_listings.extend(listings)

                    # 다음 페이지 확인
                    page_num += 1
                    start_row = (page_num - 1) * 10 + 1
                    has_next: bool = await page.evaluate(f"""() => {{
                        const links = document.querySelectorAll('.paging a, [class*=pag] a');
                        for (const a of links) {{
                            const onclick = a.getAttribute('onclick') || '';
                            if (onclick.includes("goPage('{start_row}')")) return true;
                        }}
                        return false;
                    }}""")

                    if not has_next:
                        break

                    try:
                        async with page.expect_navigation(wait_until="networkidle", timeout=15000):
                            await page.evaluate(f"goPage('{start_row}')")
                    except Exception:
                        await asyncio.sleep(3)
                    await asyncio.sleep(1)

                    if page_num > 100:
                        logger.warning("[KB손보] 페이지 수 제한 초과 (100페이지), 중단")
                        break

                logger.info("[KB손보] 전체 %d개 상품 수집 (%d페이지)", len(all_listings), page_num - 1)
                total_found = len(all_listings)

                # 신규/기존 분류
                delta = await self.detect_changes(all_listings)
                skipped_count = len(delta.unchanged)

                # 신규 항목 PDF 다운로드
                for listing in delta.new:
                    safe_name = listing.product_name.strip()
                    for ch in ['/', '\\', ':', '?', '"', '<', '>', '*', '|']:
                        safe_name = safe_name.replace(ch, '_')
                    path = f"kb-nonlife/{listing.product_code}/{safe_name}.pdf"

                    try:
                        pdf_data = await self.download_pdf(listing)
                        if pdf_data[:4] == b"%PDF" and len(pdf_data) > 1000:
                            self.storage.save(pdf_data, path)
                            new_count += 1
                            results.append({
                                "product_name": listing.product_name,
                                "category": listing.category,
                                "status": "downloaded",
                            })
                            logger.info("[KB손보] 다운로드: %s (%d bytes)",
                                       listing.product_name[:50], len(pdf_data))
                        else:
                            failed_count += 1
                            logger.warning("[KB손보] PDF 검증 실패: %s", listing.product_name[:50])
                    except Exception as e:
                        failed_count += 1
                        logger.error("[KB손보] 다운로드 실패 [%s]: %s",
                                     listing.product_name[:50], e)

                    await asyncio.sleep(self.rate_limit_seconds)

            finally:
                await browser.close()

        return CrawlRunResult(
            total_found=total_found,
            new_count=new_count,
            updated_count=0,
            skipped_count=skipped_count,
            failed_count=failed_count,
            results=results,
        )
