"""손해보험사 범용 크롤러 - YAML 설정 기반 (SPEC-CRAWLER-002)

YAML 설정 파일을 읽어 보험사별 커스터마이징 없이 크롤링.
GenericLifeCrawler와 동일 패턴이지만 KNIA 중복 감지 기능 포함.
category는 NON_LIFE로 고정.
"""

from __future__ import annotations

import hashlib
import logging
import re
from pathlib import Path
from typing import Any

from app.services.crawler.base import (
    BaseCrawler,
    CrawlRunResult,
    DeltaResult,
    PolicyListing,
    SaleStatus,
)
from app.services.crawler.config_loader import CompanyCrawlerConfig
from app.services.crawler.storage import StorageBackend

logger = logging.getLogger(__name__)


class GenericNonLifeCrawler(BaseCrawler):
    """YAML 설정으로 구동되는 손해보험사 범용 크롤러

    CompanyCrawlerConfig에 정의된 선택자와 URL로 크롤링 수행.
    KNIA 크롤러가 수집한 데이터와 content_hash를 비교해 중복 감지.
    """

    def __init__(
        self,
        config: CompanyCrawlerConfig,
        storage: StorageBackend,
        knia_hashes: set[str] | None = None,
    ) -> None:
        """손해보험사 범용 크롤러 초기화

        Args:
            config: 보험사별 크롤링 설정 (YAML에서 로드)
            storage: PDF 파일 저장 백엔드
            knia_hashes: KNIA 크롤러가 수집한 content_hash 집합.
                         None이면 중복 감지를 수행하지 않음.
        """
        super().__init__(
            crawler_name=config.company_code,
            db_session=None,
            storage=storage,
            rate_limit_seconds=config.rate_limit_seconds,
        )
        self.config = config
        # KNIA에서 이미 수집된 항목의 해시 집합 (중복 감지용)
        self.knia_hashes: set[str] = knia_hashes or set()

    def _compute_content_hash(self, listing: PolicyListing) -> str:
        """PolicyListing의 식별 정보로 content_hash 계산

        KNIA 데이터와의 중복 여부를 판별하기 위해 사용.
        company_code + product_code + pdf_url 조합으로 해시 생성.

        Args:
            listing: 해시를 계산할 보험 상품 정보

        Returns:
            16자리 MD5 hex 문자열
        """
        key = f"{listing.company_code}:{listing.product_code}:{listing.pdf_url}"
        return hashlib.md5(key.encode()).hexdigest()[:16]  # noqa: S324

    def _is_knia_duplicate(self, listing: PolicyListing) -> bool:
        """KNIA 수집 데이터와 중복 여부 확인

        Args:
            listing: 확인할 보험 상품 정보

        Returns:
            True이면 KNIA에서 이미 수집된 항목
        """
        if not self.knia_hashes:
            return False
        content_hash = self._compute_content_hash(listing)
        return content_hash in self.knia_hashes

    async def crawl(self) -> CrawlRunResult:
        """전체 크롤링 실행 (판매중 + 판매중지)

        Playwright 없이 실행 시 빈 결과 반환 (크래시 없음).
        KNIA 중복 항목은 skipped_count에 집계.

        Returns:
            크롤링 실행 결과 요약
        """
        try:
            from playwright.async_api import async_playwright
        except ImportError:
            logger.warning("playwright 미설치, 빈 결과 반환: %s", self.config.company_code)
            return CrawlRunResult(
                total_found=0, new_count=0, updated_count=0,
                skipped_count=0, failed_count=0, results=[]
            )

        all_listings: list[PolicyListing] = []

        try:
            async with async_playwright() as pw:
                browser = await pw.chromium.launch(headless=True)
                try:
                    # 판매중 상품 크롤링
                    page = await browser.new_page()
                    on_sale_listings = await self._fetch_listings(
                        page=page,
                        url=self.config.listing_url,
                        sale_status=SaleStatus.ON_SALE,
                    )
                    all_listings.extend(on_sale_listings)
                    await page.close()

                    # 판매중지 상품 크롤링 (별도 URL이 있는 경우)
                    if self.config.discontinued_url:
                        page2 = await browser.new_page()
                        disc_listings = await self._fetch_listings(
                            page=page2,
                            url=self.config.discontinued_url,
                            sale_status=SaleStatus.DISCONTINUED,
                        )
                        all_listings.extend(disc_listings)
                        await page2.close()

                finally:
                    await browser.close()

        except Exception as exc:
            logger.error("크롤링 중 오류 (%s): %s", self.config.company_code, str(exc))
            return CrawlRunResult(
                total_found=0, new_count=0, updated_count=0,
                skipped_count=0, failed_count=1, results=[]
            )

        # KNIA 중복 항목 필터링
        unique_listings: list[PolicyListing] = []
        knia_duplicate_count = 0
        for listing in all_listings:
            if self._is_knia_duplicate(listing):
                logger.debug(
                    "%s KNIA 중복 항목 건너뜀: %s",
                    self.config.company_code,
                    listing.product_code,
                )
                knia_duplicate_count += 1
            else:
                unique_listings.append(listing)

        # 변경 감지
        delta = await self.detect_changes(unique_listings)

        new_count = 0
        updated_count = 0
        failed_count = 0
        results = []

        for listing in delta.new + delta.updated:
            try:
                await self._rate_limit()
                pdf_path = await self.download_pdf(listing)

                if pdf_path:
                    is_new = listing in delta.new
                    if is_new:
                        new_count += 1
                    else:
                        updated_count += 1

                    results.append({
                        "product_code": listing.product_code,
                        "company_code": listing.company_code,
                        "status": "NEW" if is_new else "UPDATED",
                        "pdf_path": str(pdf_path),
                        "sale_status": listing.sale_status.value,
                    })
                else:
                    failed_count += 1
                    results.append({
                        "product_code": listing.product_code,
                        "company_code": listing.company_code,
                        "status": "FAILED",
                        "error": "PDF 다운로드 실패",
                    })
            except Exception as exc:
                failed_count += 1
                logger.error(
                    "%s %s PDF 처리 실패: %s",
                    self.config.company_code,
                    listing.product_code,
                    str(exc),
                )
                results.append({
                    "product_code": listing.product_code,
                    "company_code": listing.company_code,
                    "status": "FAILED",
                    "error": str(exc),
                })

        # KNIA 중복 + 변경 없는 항목 합산
        total_skipped = knia_duplicate_count + len(delta.unchanged)

        return CrawlRunResult(
            total_found=len(all_listings),
            new_count=new_count,
            updated_count=updated_count,
            skipped_count=total_skipped,
            failed_count=failed_count,
            results=results,
        )

    async def _fetch_listings(
        self,
        page: Any,
        url: str,
        sale_status: SaleStatus,
    ) -> list[PolicyListing]:
        """지정 URL에서 약관 목록 전체 크롤링 (페이지네이션 포함)

        Args:
            page: Playwright 페이지 객체
            url: 크롤링 시작 URL
            sale_status: 수집 상품의 판매 상태

        Returns:
            크롤링된 PolicyListing 목록
        """
        all_listings: list[PolicyListing] = []
        max_pages = self.config.pagination.max_pages

        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=self.config.timeout_ms)

            # SPA 로딩 대기 (설정된 경우)
            if self.config.wait_for_selector:
                try:
                    await page.wait_for_selector(
                        self.config.wait_for_selector,
                        timeout=self.config.timeout_ms,
                    )
                except Exception:
                    logger.warning(
                        "%s SPA 선택자 대기 실패 (계속 진행): %s",
                        self.config.company_code,
                        self.config.wait_for_selector,
                    )

        except Exception as exc:
            logger.error(
                "%s 페이지 로드 실패 (%s): %s",
                self.config.company_code,
                url,
                str(exc),
            )
            return all_listings

        for page_num in range(1, max_pages + 1):
            logger.info("%s 페이지 %d 파싱 중...", self.config.company_code, page_num)

            page_listings = await self.parse_listing(page, sale_status=sale_status)
            all_listings.extend(page_listings)

            if not page_listings and page_num > 1:
                logger.info("%s 빈 페이지 도달 (%d페이지)", self.config.company_code, page_num)
                break

            # 다음 페이지 이동
            moved = await self._click_next_page(page)
            if not moved:
                logger.info("%s 마지막 페이지 (%d페이지)", self.config.company_code, page_num)
                break

            # Issue 3 수정: networkidle 실패 후 listing_container 선택자로 폴백 대기
            # SPA(React/Vue) 페이지는 networkidle 이후에도 렌더링이 완료되지 않을 수 있음
            try:
                await page.wait_for_load_state("networkidle", timeout=15000)
            except Exception:
                logger.debug("%s networkidle 타임아웃, listing_container 선택자로 폴백 대기", self.config.company_code)
                listing_sel = self.config.selectors.listing_container.split(",")[0].strip()
                try:
                    await page.wait_for_selector(listing_sel, timeout=30000)
                except Exception as exc:
                    logger.warning(
                        "%s listing_container 대기 실패 (URL: %s, 선택자: '%s'): %s",
                        self.config.company_code,
                        page.url,
                        listing_sel,
                        str(exc),
                    )
                    return all_listings

        return all_listings

    async def parse_listing(
        self,
        page: Any,
        sale_status: SaleStatus = SaleStatus.ON_SALE,
    ) -> list[PolicyListing]:
        """페이지에서 약관 목록 파싱

        config의 selectors를 사용하여 현재 페이지의 상품 목록 추출.
        NON_LIFE 카테고리로 강제 설정.

        Args:
            page: Playwright 페이지 객체
            sale_status: 수집 상품의 판매 상태 (기본: ON_SALE)

        Returns:
            파싱된 PolicyListing 목록
        """
        listings: list[PolicyListing] = []

        # Issue 1 수정: listing_container도 복합 선택자일 수 있으므로 순차 시도
        container_selector = self.config.selectors.listing_container
        sub_selectors = [s.strip() for s in container_selector.split(",")]
        rows: list[Any] = []
        last_exc: Exception | None = None
        for sel in sub_selectors:
            try:
                found = await page.query_selector_all(sel)
                if found:
                    rows = found
                    break
            except Exception as exc:
                last_exc = exc
                logger.warning(
                    "%s 목록 선택자 실패 ('%s'): %s",
                    self.config.company_code,
                    sel,
                    str(exc),
                )

        # Issue 2 수정: 0개 발견 시 WARNING 로그로 실패를 명시
        if not rows:
            logger.warning(
                "%s 목록 항목 0개 발견 (선택자: '%s')%s",
                self.config.company_code,
                container_selector,
                f" - 마지막 오류: {last_exc}" if last_exc else "",
            )
            return listings

        logger.debug("%s 목록 항목 %d개 발견", self.config.company_code, len(rows))

        for row in rows:
            try:
                listing = await self._parse_row(row, sale_status=sale_status)
                if listing:
                    listings.append(listing)
            except Exception as exc:
                logger.debug("%s 행 파싱 실패: %s", self.config.company_code, str(exc))

        return listings

    async def _parse_row(
        self,
        row: Any,
        sale_status: SaleStatus = SaleStatus.ON_SALE,
    ) -> PolicyListing | None:
        """개별 행에서 PolicyListing 추출

        NON_LIFE 카테고리로 강제 설정.

        Args:
            row: Playwright 엘리먼트 (테이블 행 또는 목록 항목)
            sale_status: 판매 상태

        Returns:
            파싱된 PolicyListing 또는 None
        """
        # 상품명 추출
        product_name_el = await row.query_selector(self.config.selectors.product_name)
        if not product_name_el:
            return None
        product_name = (await product_name_el.inner_text()).strip()
        if not product_name:
            return None

        # 상품코드 추출 (선택자 없으면 상품명 해시로 자동 생성)
        product_code = ""
        if self.config.selectors.product_code:
            code_el = await row.query_selector(self.config.selectors.product_code)
            if code_el:
                product_code = (await code_el.inner_text()).strip()

        if not product_code:
            # 상품명으로 자동 생성
            short_hash = hashlib.md5(product_name.encode()).hexdigest()[:8]  # noqa: S324
            product_code = f"{self.config.company_code}-{short_hash}"

        # PDF 링크 추출
        pdf_url = await self._find_pdf_link(row)
        if not pdf_url:
            return None

        # 손해보험사는 category를 NON_LIFE로 강제 설정
        return PolicyListing(
            company_name=self.config.company_name,
            product_name=product_name,
            product_code=product_code,
            category="NON_LIFE",
            pdf_url=pdf_url,
            company_code=self.config.company_code,
            sale_status=sale_status,
        )

    async def _find_pdf_link(self, element: Any) -> str | None:
        """엘리먼트에서 PDF URL 추출

        href, onclick 속성에서 PDF 링크를 탐색.
        콤마로 구분된 복합 선택자는 각각 순차적으로 시도.

        Args:
            element: Playwright 엘리먼트

        Returns:
            PDF URL 또는 None
        """
        pdf_selector = self.config.selectors.pdf_link

        # Issue 1 수정: Playwright는 콤마 구분 복합 선택자 미지원
        # 선택자를 콤마로 분리해 각각 순차 시도
        sub_selectors = [s.strip() for s in pdf_selector.split(",")]
        links: list[Any] = []
        for sel in sub_selectors:
            try:
                found = await element.query_selector_all(sel)
                if found:
                    links = found
                    break
            except Exception as exc:
                logger.warning(
                    "%s PDF 선택자 실패 ('%s'): %s",
                    self.config.company_code,
                    sel,
                    str(exc),
                )

        for link in links:
            href = await link.get_attribute("href")
            if href and href not in ("#", "javascript:void(0)"):
                return href if href.startswith("http") else f"{self.config.base_url}{href}"

            onclick = await link.get_attribute("onclick")
            if onclick:
                match = re.search(r"['\"]([^'\"]+\.pdf[^'\"]*)['\"]", onclick)
                if match:
                    path = match.group(1)
                    return path if path.startswith("http") else f"{self.config.base_url}{path}"

        return None

    async def _click_next_page(self, page: Any) -> bool:
        """다음 페이지 버튼 클릭

        config의 next_page 선택자로 버튼을 찾아 클릭.

        Args:
            page: Playwright 페이지 객체

        Returns:
            클릭 성공 여부
        """
        if not self.config.selectors.next_page:
            return False

        try:
            next_btn = await page.query_selector(self.config.selectors.next_page)
            if not next_btn:
                return False

            disabled = await next_btn.get_attribute("disabled")
            class_attr = await next_btn.get_attribute("class") or ""

            if disabled or "disabled" in class_attr:
                return False

            await next_btn.click()
            return True

        except Exception as exc:
            logger.debug("%s 다음 페이지 클릭 실패: %s", self.config.company_code, str(exc))
            return False

    async def download_pdf(self, listing: PolicyListing) -> Path | None:
        """PDF 다운로드 및 스토리지 저장

        Playwright로 PDF를 다운로드하고 설정된 스토리지에 저장.

        Args:
            listing: 다운로드할 상품 정보

        Returns:
            저장된 파일 경로 또는 None (실패 시)
        """
        try:
            from playwright.async_api import async_playwright
        except ImportError:
            logger.warning("playwright 미설치, PDF 다운로드 불가")
            return None

        try:
            async with async_playwright() as pw:
                browser = await pw.chromium.launch(headless=True)
                try:
                    page = await browser.new_page()
                    pdf_bytes: list[bytes] = []

                    async def handle_response(response: Any) -> None:
                        if listing.pdf_url in response.url and response.status < 400:
                            try:
                                body = await response.body()
                                pdf_bytes.append(body)
                            except Exception:
                                pass

                    page.on("response", handle_response)
                    await page.goto(listing.pdf_url, wait_until="networkidle", timeout=30000)

                    if not pdf_bytes:
                        await page.wait_for_timeout(2000)

                finally:
                    await browser.close()

            if not pdf_bytes:
                logger.warning("PDF 데이터 없음: %s", listing.pdf_url)
                return None

            # 스토리지에 저장
            filename = listing.pdf_url.split("/")[-1] or "latest.pdf"
            if not filename.endswith(".pdf"):
                filename = f"{listing.product_code}.pdf"

            path = self.storage.get_path(
                company_code=listing.company_code,
                product_code=listing.product_code,
                filename=filename,
            )
            saved_key = self.storage.save(pdf_bytes[0], path)
            return Path(saved_key)

        except Exception as exc:
            logger.error(
                "%s PDF 다운로드 실패 (%s): %s",
                self.config.company_code,
                listing.pdf_url,
                str(exc),
            )
            return None

    async def detect_changes(self, listings: list[PolicyListing]) -> DeltaResult:
        """스토리지 기반 변경 감지

        스토리지에 파일이 없으면 NEW, 있으면 UNCHANGED로 분류.

        Args:
            listings: 크롤링으로 발견된 상품 목록

        Returns:
            변경 감지 결과
        """
        new_listings: list[PolicyListing] = []
        updated_listings: list[PolicyListing] = []
        unchanged_listings: list[PolicyListing] = []

        for listing in listings:
            try:
                path = self.storage.get_path(
                    company_code=listing.company_code,
                    product_code=listing.product_code,
                    filename="latest.pdf",
                )
                if self.storage.exists(path):
                    unchanged_listings.append(listing)
                else:
                    new_listings.append(listing)
            except Exception as exc:
                logger.warning(
                    "%s 변경 감지 실패 (%s): %s",
                    self.config.company_code,
                    listing.product_code,
                    str(exc),
                )
                new_listings.append(listing)

        return DeltaResult(
            new=new_listings,
            updated=updated_listings,
            unchanged=unchanged_listings,
        )
