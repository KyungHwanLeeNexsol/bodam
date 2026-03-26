"""현대해상화재보험 크롤러

Playwright 기반으로 현대해상 약관 공시 페이지를 크롤링하여 PDF를 수집.
JS 렌더링이 필요한 SPA 사이트이므로 Playwright 사용.

# @MX:NOTE: [AUTO] 현대해상은 Playwright 필수 (SPA, JS 렌더링)
# @MX:NOTE: [AUTO] 약관 공시 페이지: /consumer/disclosure/terms/termsList.do
# @MX:NOTE: [AUTO] 판매중/판매중지 구분: saleStatus 파라미터 또는 탭 클릭으로 처리
# @MX:NOTE: [AUTO] PDF URL 패턴: FileActionServlet/preview 또는 /data/{year}/{filename}.pdf
# @MX:NOTE: [AUTO] 저장 경로: hyundai-marine/{product_code}/{filename}
"""

from __future__ import annotations

import asyncio
import gc
import logging
import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urljoin

from app.services.crawler.base import (
    BaseCrawler,
    CrawlRunResult,
    DeltaResult,
    PolicyListing,
    SaleStatus,
)
from app.services.crawler.storage import StorageBackend

logger = logging.getLogger(__name__)

# 현대해상 사이트 기본 URL
_BASE_URL = "https://www.hi.co.kr"
# 약관 공시 목록 페이지
_TERMS_LIST_URL = f"{_BASE_URL}/consumer/disclosure/terms/termsList.do"
# 약관 공시 페이지 (menuId 방식)
_TERMS_MENU_URL = f"{_BASE_URL}/serviceAction.do"


@dataclass
class TermsItem:
    """약관 목록에서 파싱된 개별 약관 항목

    Attributes:
        product_code: 상품 코드 (고유 식별자)
        product_name: 상품명
        sale_status: 판매 상태 (ON_SALE / DISCONTINUED)
        pdf_url: PDF 파일 URL (직접 다운로드 가능)
        category: 보험 분류
        filename: 원본 파일명
    """

    product_code: str
    product_name: str
    sale_status: SaleStatus
    pdf_url: str
    category: str
    filename: str


class HyundaiMarineCrawler(BaseCrawler):
    """현대해상화재보험 약관 크롤러

    Playwright로 약관 공시 페이지의 판매중/판매중지 목록을 수집하고
    PDF를 다운로드하여 저장.
    """

    def __init__(
        self,
        storage: StorageBackend,
        rate_limit_seconds: float = 2.0,
        max_retries: int = 3,
        fail_threshold: float = 0.05,
        fail_min_samples: int = 5,
        browser_restart_interval: int = 50,
    ) -> None:
        """현대해상 크롤러 초기화

        Args:
            storage: PDF 파일 저장 백엔드
            rate_limit_seconds: 요청 간 대기 시간(초)
            max_retries: 최대 재시도 횟수
            fail_threshold: 실패율 임계값 (초과 시 즉시 중단)
            fail_min_samples: 최소 처리 건수 이후 임계값 적용
            browser_restart_interval: 브라우저 컨텍스트 재시작 주기
        """
        super().__init__(
            crawler_name="hyundai-marine",
            db_session=None,
            storage=storage,
            rate_limit_seconds=rate_limit_seconds,
            max_retries=max_retries,
        )
        self.fail_threshold = fail_threshold
        self.fail_min_samples = fail_min_samples
        self.browser_restart_interval = browser_restart_interval

    def _is_valid_pdf(self, data: bytes) -> bool:
        """PDF 바이너리 유효성 검증

        Args:
            data: 다운로드된 바이너리 데이터

        Returns:
            유효한 PDF이면 True
        """
        return data[:4] == b"%PDF" and len(data) > 1000

    def _get_storage_path(self, product_code: str, filename: str) -> str:
        """PDF 저장 경로 생성

        Args:
            product_code: 상품 코드
            filename: 원본 파일명

        Returns:
            저장 경로 (예: hyundai-marine/10101/abc.pdf)
        """
        # 파일명 소문자 정규화
        normalized = filename.lower()
        return f"hyundai-marine/{product_code}/{normalized}"

    def _extract_product_code(self, pdf_url: str, filename: str) -> str:
        """PDF URL 또는 파일명에서 상품 코드 추출

        현대해상 PDF URL 패턴:
          - /FileActionServlet/preview/{숫자}/data/{연도}/{해시}.pdf
          - /data/{연도}/{파일명}.pdf
          - CM{코드}_{날짜}.pdf 형식

        Args:
            pdf_url: PDF URL
            filename: 파일명

        Returns:
            추출된 상품 코드 (실패 시 파일명 해시 기반)
        """
        # CM 코드 패턴 (예: CM5117, CM8410)
        match = re.search(r"(CM\d+[A-Z]?)", filename, re.IGNORECASE)
        if match:
            return match.group(1).upper()

        # URL에서 해시 기반 코드 추출
        match = re.search(r"/([a-f0-9]{32})\.", pdf_url, re.IGNORECASE)
        if match:
            return match.group(1)[:12]

        # 파일명 자체를 코드로 사용 (확장자 제거)
        stem = re.sub(r"\.(pdf|PDF)$", "", filename)
        # 특수문자 제거 후 최대 40자
        safe = re.sub(r"[^\w가-힣-]", "_", stem)[:40]
        return safe or "unknown"

    async def parse_listing(self, page: Any) -> list[PolicyListing]:
        """현재 페이지에서 약관 목록 파싱

        현대해상 약관 공시 페이지의 테이블에서 상품 정보와 PDF 링크를 추출.

        Args:
            page: Playwright 페이지 객체

        Returns:
            파싱된 PolicyListing 목록
        """
        # @MX:NOTE: [AUTO] 현대해상 약관 페이지는 SPA이므로 JS evaluate로 DOM 파싱
        items: list[dict] = await page.evaluate(r"""() => {
            const results = [];

            // 테이블 행에서 약관 정보 추출 (다양한 테이블 구조 대응)
            const rows = document.querySelectorAll('table tbody tr, .tbl_list tbody tr, .board_list tbody tr');
            rows.forEach(tr => {
                const tds = tr.querySelectorAll('td');
                if (tds.length < 2) return;

                // PDF 링크 찾기
                const links = tr.querySelectorAll('a[href*=".pdf"], a[href*="FileActionServlet"], a[onclick*="pdf"], a[href*="download"]');
                if (links.length === 0) return;

                // 첫 번째 PDF 링크 처리
                links.forEach(link => {
                    const href = link.getAttribute('href') || '';
                    const onclick = link.getAttribute('onclick') || '';

                    // 유효한 PDF 링크인지 확인
                    let pdfUrl = '';
                    if (href && (href.includes('.pdf') || href.includes('FileActionServlet') || href.includes('download'))) {
                        pdfUrl = href;
                    } else if (onclick && onclick.includes('pdf')) {
                        // onclick에서 URL 추출 시도
                        const match = onclick.match(/['"]([^'"]*\.pdf[^'"]*)['"]/i);
                        if (match) pdfUrl = match[1];
                    }

                    if (!pdfUrl) return;

                    // 상품명: 행의 텍스트 컨텐츠 (첫 번째 링크 또는 상품명 컬럼)
                    const nameTd = tds[0] || tds[1];
                    const productName = (link.textContent || nameTd.textContent || '').trim()
                        .replace(/\s+/g, ' ').substring(0, 200);

                    // 파일명 추출
                    const filename = pdfUrl.split('/').pop() || pdfUrl.split('=').pop() || 'unknown.pdf';

                    results.push({
                        productName: productName || filename,
                        pdfUrl: pdfUrl,
                        filename: filename,
                        rowText: Array.from(tds).map(td => td.textContent.trim()).join('|'),
                    });
                });
            });

            // 중복 URL 제거
            const seen = new Set();
            return results.filter(item => {
                if (seen.has(item.pdfUrl)) return false;
                seen.add(item.pdfUrl);
                return true;
            });
        }""")

        listings: list[PolicyListing] = []
        for item in items:
            pdf_url_raw = item.get("pdfUrl", "")
            filename = item.get("filename", "unknown.pdf")
            product_name = item.get("productName", filename)
            row_text = item.get("rowText", "")

            if not pdf_url_raw:
                continue

            # 절대 URL 변환
            if pdf_url_raw.startswith("/"):
                pdf_url = f"{_BASE_URL}{pdf_url_raw}"
            elif not pdf_url_raw.startswith("http"):
                pdf_url = f"{_BASE_URL}/{pdf_url_raw}"
            else:
                pdf_url = pdf_url_raw

            product_code = self._extract_product_code(pdf_url, filename)

            # 판매 상태는 현재 크롤링 모드(판매중/판매중지)에서 결정
            # 실제 상태는 _fetch_listings_by_status에서 설정
            sale_status = SaleStatus.UNKNOWN

            listing = PolicyListing(
                company_name="현대해상",
                product_name=product_name,
                product_code=product_code,
                category="NON_LIFE",
                pdf_url=pdf_url,
                company_code="hyundai-marine",
                sale_status=sale_status,
            )
            listings.append(listing)

        return listings

    async def _fetch_listings_by_status(
        self,
        page: Any,
        sale_status: SaleStatus,
    ) -> list[PolicyListing]:
        """판매 상태별 약관 목록 전체 수집 (페이지네이션 포함)

        약관 공시 페이지에서 판매중 또는 판매중지 약관 목록을 모든 페이지에서 수집.

        Args:
            page: Playwright 페이지 객체
            sale_status: 수집할 판매 상태

        Returns:
            수집된 PolicyListing 목록
        """
        # 판매 상태 파라미터
        status_param = "01" if sale_status == SaleStatus.ON_SALE else "02"
        status_label = "판매중" if sale_status == SaleStatus.ON_SALE else "판매중지"

        logger.info("[현대해상] %s 목록 수집 시작", status_label)

        # 약관 공시 페이지로 이동
        target_url = f"{_TERMS_LIST_URL}?saleStatus={status_param}"
        try:
            await page.goto(target_url, timeout=30000, wait_until="networkidle")
            await asyncio.sleep(2)
        except Exception as e:
            logger.warning("[현대해상] 페이지 로드 실패 (%s): %s, 대안 URL 시도", target_url, e)
            # menuId 방식 시도
            alt_url = f"{_TERMS_MENU_URL}?menuId=200001"
            try:
                await page.goto(alt_url, timeout=30000, wait_until="networkidle")
                await asyncio.sleep(2)
            except Exception as e2:
                logger.error("[현대해상] 대안 URL도 실패: %s", e2)
                return []

        # 판매 상태 탭/필터 클릭 시도
        if sale_status == SaleStatus.DISCONTINUED:
            await self._click_discontinued_tab(page)

        all_listings: list[PolicyListing] = []
        page_num = 1
        max_pages = 200  # 안전 상한선

        while page_num <= max_pages:
            listings = await self.parse_listing(page)

            # 판매 상태 설정
            for listing in listings:
                listing.sale_status = sale_status

            all_listings.extend(listings)
            logger.info(
                "[현대해상] %s 페이지 %d 파싱: %d개 (누적 %d개)",
                status_label,
                page_num,
                len(listings),
                len(all_listings),
            )

            # 다음 페이지 확인
            has_next = await self._go_to_next_page(page, page_num + 1)
            if not has_next:
                break

            page_num += 1
            await asyncio.sleep(1)

        logger.info(
            "[현대해상] %s 목록 수집 완료: %d개 (%d페이지)",
            status_label,
            len(all_listings),
            page_num,
        )
        return all_listings

    async def _click_discontinued_tab(self, page: Any) -> None:
        """판매중지 탭 또는 필터 클릭

        Args:
            page: Playwright 페이지 객체
        """
        try:
            # 판매중지 탭/버튼/라디오 버튼 클릭 시도 (다양한 선택자)
            selectors = [
                "a:has-text('판매중지')",
                "button:has-text('판매중지')",
                "label:has-text('판매중지')",
                "[value='02']",
                "input[value='discontinued']",
                ".tab_item:has-text('판매중지')",
            ]
            for selector in selectors:
                try:
                    element = await page.query_selector(selector)
                    if element:
                        await element.click()
                        await asyncio.sleep(2)
                        logger.info("[현대해상] 판매중지 탭 클릭 성공: %s", selector)
                        return
                except Exception:
                    continue

            # URL 파라미터 방식 시도
            current_url = page.url
            if "saleStatus=" in current_url:
                new_url = re.sub(r"saleStatus=\w+", "saleStatus=02", current_url)
            else:
                new_url = f"{current_url}&saleStatus=02" if "?" in current_url else f"{current_url}?saleStatus=02"

            await page.goto(new_url, timeout=30000, wait_until="networkidle")
            await asyncio.sleep(2)

        except Exception as e:
            logger.warning("[현대해상] 판매중지 탭 클릭 실패: %s", e)

    async def _go_to_next_page(self, page: Any, next_page_num: int) -> bool:
        """다음 페이지로 이동

        Args:
            page: Playwright 페이지 객체
            next_page_num: 이동할 페이지 번호

        Returns:
            이동 성공 여부
        """
        try:
            # 다음 페이지 링크 확인
            has_next: bool = await page.evaluate(f"""() => {{
                // 페이지네이션 링크 탐색
                const pagingLinks = document.querySelectorAll('.paging a, .pagination a, [class*=pag] a, .page_num a');
                for (const a of pagingLinks) {{
                    const text = (a.textContent || '').trim();
                    const onclick = a.getAttribute('onclick') || '';
                    const href = a.getAttribute('href') || '';
                    if (text === '{next_page_num}' || onclick.includes('{next_page_num}') || href.includes('page={next_page_num}')) {{
                        return true;
                    }}
                }}
                // 다음 버튼 확인
                const nextBtn = document.querySelector('.btn_next, [class*=next]:not([class*=prev]), a:has-text("다음")');
                if (nextBtn && !nextBtn.classList.contains('disabled') && !nextBtn.hasAttribute('disabled')) {{
                    return true;
                }}
                return false;
            }}""")

            if not has_next:
                return False

            # 페이지 클릭 또는 이동
            clicked: bool = await page.evaluate(f"""() => {{
                const pagingLinks = document.querySelectorAll('.paging a, .pagination a, [class*=pag] a, .page_num a');
                for (const a of pagingLinks) {{
                    const text = (a.textContent || '').trim();
                    const onclick = a.getAttribute('onclick') || '';
                    if (text === '{next_page_num}' || onclick.includes('{next_page_num}')) {{
                        a.click();
                        return true;
                    }}
                }}
                return false;
            }}""")

            if clicked:
                try:
                    await page.wait_for_load_state("networkidle", timeout=10000)
                except Exception:
                    await asyncio.sleep(2)
                return True

        except Exception as e:
            logger.debug("[현대해상] 페이지 이동 실패 (페이지 %d): %s", next_page_num, e)

        return False

    async def download_pdf(self, listing: PolicyListing) -> bytes:
        """PDF 다운로드 (httpx 직접 다운로드)

        Args:
            listing: 다운로드할 상품 정보

        Returns:
            PDF 바이너리 데이터 (실패 시 빈 bytes)
        """
        import httpx

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": _TERMS_LIST_URL,
            "Accept": "application/pdf,*/*",
        }

        for attempt in range(self.max_retries):
            try:
                async with httpx.AsyncClient(
                    headers=headers,
                    follow_redirects=True,
                    timeout=60.0,
                ) as client:
                    resp = await client.get(listing.pdf_url)
                    resp.raise_for_status()

                    # Content-Type 확인
                    content_type = resp.headers.get("content-type", "")
                    if "html" in content_type.lower() and not self._is_valid_pdf(resp.content):
                        logger.warning(
                            "[현대해상] HTML 응답 수신 (PDF 아님) [%s]: content-type=%s",
                            listing.pdf_url[:80],
                            content_type,
                        )
                        return b""

                    if self._is_valid_pdf(resp.content):
                        return resp.content

                    logger.warning(
                        "[현대해상] PDF 검증 실패 [%s]: %d bytes, 시작=%r",
                        listing.pdf_url[:80],
                        len(resp.content),
                        resp.content[:50],
                    )
                    return b""

            except Exception as e:
                logger.warning(
                    "[현대해상] PDF 다운로드 실패 (시도 %d/%d) [%s]: %s",
                    attempt + 1,
                    self.max_retries,
                    listing.pdf_url[:80],
                    e,
                )
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(2.0 * (attempt + 1))

        return b""

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
            filename = listing.pdf_url.split("/")[-1].split("?")[0] or "unknown.pdf"
            storage_path = self._get_storage_path(listing.product_code, filename)
            if self.storage.exists(storage_path):
                unchanged_listings.append(listing)
            else:
                new_listings.append(listing)

        return DeltaResult(
            new=new_listings,
            updated=[],
            unchanged=unchanged_listings,
        )

    # @MX:ANCHOR: [AUTO] HyundaiMarineCrawler.crawl - 현대해상 크롤링 진입점
    # @MX:REASON: crawl_and_ingest_hyundai_marine.py에서 직접 호출됨
    async def crawl(self) -> CrawlRunResult:
        """현대해상 약관 크롤링 메인 진입점

        1. Playwright로 판매중/판매중지 약관 목록 수집 (페이지네이션 포함)
        2. 신규/기존 분류 (파일 존재 여부 기준)
        3. 신규 파일 PDF 다운로드 및 저장
        4. 실패율 초과 시 즉시 중단

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
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                )
                page = await context.new_page()

                # 판매중/판매중지 목록 수집
                on_sale_listings = await self._fetch_listings_by_status(
                    page, SaleStatus.ON_SALE
                )

                # 브라우저 컨텍스트 재시작 (메모리 해제)
                await context.close()
                gc.collect()
                context = await browser.new_context(
                    accept_downloads=True,
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                )
                page = await context.new_page()

                discontinued_listings = await self._fetch_listings_by_status(
                    page, SaleStatus.DISCONTINUED
                )

                all_listings = on_sale_listings + discontinued_listings
                total_found = len(all_listings)

                logger.info(
                    "[현대해상] 전체 수집: 판매중=%d, 판매중지=%d, 합계=%d",
                    len(on_sale_listings),
                    len(discontinued_listings),
                    total_found,
                )

                # 중복 URL 제거 (동일 PDF URL은 한 번만 처리)
                seen_urls: set[str] = set()
                unique_listings: list[PolicyListing] = []
                for listing in all_listings:
                    if listing.pdf_url not in seen_urls:
                        seen_urls.add(listing.pdf_url)
                        unique_listings.append(listing)

                logger.info(
                    "[현대해상] 중복 제거 후 %d개 (원래 %d개)",
                    len(unique_listings),
                    total_found,
                )

                # 신규/기존 분류
                delta = await self.detect_changes(unique_listings)
                skipped_count = len(delta.unchanged)
                logger.info(
                    "[현대해상] 신규: %d개, 기존(스킵): %d개",
                    len(delta.new),
                    skipped_count,
                )

                # 신규 PDF 다운로드
                # @MX:WARN: [AUTO] browser_restart_interval마다 컨텍스트 재시작 (메모리 누수 방지)
                # @MX:REASON: Chromium 힙 누수 방지를 위해 주기적 재시작 필요
                products_attempted = 0
                aborted = False

                for idx, listing in enumerate(delta.new):
                    # 주기적으로 브라우저 컨텍스트 재시작
                    if idx > 0 and idx % self.browser_restart_interval == 0:
                        logger.info(
                            "[현대해상] 브라우저 컨텍스트 재시작 (%d번째 파일, 메모리 해제)",
                            idx,
                        )
                        await context.close()
                        gc.collect()
                        context = await browser.new_context(
                            accept_downloads=True,
                            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                        )
                        page = await context.new_page()

                    filename = listing.pdf_url.split("/")[-1].split("?")[0] or "unknown.pdf"
                    storage_path = self._get_storage_path(listing.product_code, filename)

                    # 이미 존재하는 파일 스킵
                    if self.storage.exists(storage_path):
                        skipped_count += 1
                        continue

                    try:
                        pdf_data = await self.download_pdf(listing)

                        if self._is_valid_pdf(pdf_data):
                            self.storage.save(pdf_data, storage_path)
                            new_count += 1
                            results.append({
                                "product_code": listing.product_code,
                                "product_name": listing.product_name,
                                "sale_status": listing.sale_status,
                                "pdf_url": listing.pdf_url,
                                "status": "downloaded",
                            })
                            logger.debug(
                                "[현대해상] 저장: %s (%d bytes)",
                                storage_path,
                                len(pdf_data),
                            )
                        else:
                            failed_count += 1
                            logger.warning(
                                "[현대해상] PDF 다운로드 실패: %s",
                                listing.pdf_url[:80],
                            )

                    except Exception as e:
                        failed_count += 1
                        logger.error(
                            "[현대해상] 다운로드 오류 [%s]: %s",
                            listing.pdf_url[:80],
                            e,
                        )

                    products_attempted += 1
                    if products_attempted >= self.fail_min_samples:
                        fail_rate = failed_count / max(products_attempted, 1)
                        if fail_rate > self.fail_threshold:
                            logger.error(
                                "[현대해상] 실패율 %.1f%% > 임계값 %.1f%% (처리 %d건 중 %d건 실패) → 수집 중단",
                                fail_rate * 100,
                                self.fail_threshold * 100,
                                products_attempted,
                                failed_count,
                            )
                            aborted = True
                            break

                    await asyncio.sleep(self.rate_limit_seconds)

                if aborted:
                    logger.error("[현대해상] 실패율 임계값 초과로 수집 중단됨. 디버깅 후 재실행하세요.")

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
