"""KB손해보험 크롤러 (SPEC-DATA-002 Phase 3)

Playwright 기반으로 KB손보 약관 상세 페이지를 크롤링하여 연도별 PDF를 모두 수집.
JS 렌더링이 필요하여 Playwright 사용.

# @MX:NOTE: [AUTO] KB손보는 Playwright 필요 (JS 렌더링, euc-kr 인코딩)
# @MX:NOTE: [AUTO] 상세 페이지 접근: detail() 함수가 POST /CG802030002.ec로 폼 제출
# @MX:NOTE: [AUTO] PDF URL 패턴: /CG802030003.ec?fileNm={날짜}_{코드}_{1|2|3}.pdf
#   - 1=보험약관, 2=사업방법서, 3=상품요약서
#   - 날짜 형식: YYYYMMDD (대소문자 혼용 가능 - .PDF, .pdf)
# @MX:NOTE: [AUTO] 저장 경로: kb-nonlife/{product_code}/{fileNm} (원본 파일명 보존)
"""

from __future__ import annotations

import asyncio
import gc
import logging
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import unquote

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
_DETAIL_URL = f"{_BASE_URL}/CG802030002.ec"
_DOWNLOAD_URL = f"{_BASE_URL}/CG802030003.ec"


@dataclass
class PdfFileInfo:
    """상세 페이지에서 수집한 개별 PDF 파일 정보

    Attributes:
        file_name: fileNm 파라미터값 (예: 20240101_10101_1.pdf)
        download_url: 전체 다운로드 URL
        page_href: 페이지 내 원본 href 속성값 (클릭 다운로드용, 예: /CG802030003.ec?fileNm=...)
        start_date: 약관 적용 시작일 (YYYYMMDD)
        end_date: 약관 적용 종료일 (YYYYMMDD, None이면 현재 적용 중)
        doc_type: 문서 유형 번호 (1=보험약관, 2=사업방법서, 3=상품요약서)
    """

    file_name: str
    download_url: str
    page_href: str
    start_date: str
    end_date: str | None
    doc_type: int


@dataclass
class ProductDetail:
    """상품 상세 페이지 데이터

    Attributes:
        listing: 상품 기본 정보
        pdf_files: 상세 페이지에서 수집한 PDF 파일 목록 (연도별 전체)
    """

    listing: PolicyListing
    pdf_files: list[PdfFileInfo] = field(default_factory=list)


class KBNonLifeCrawler(BaseCrawler):
    """KB손해보험 약관 크롤러

    Playwright로 상품 목록을 수집한 후, 각 상품의 상세 페이지에서
    연도별 PDF를 모두 수집하고 다운로드.
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
        fail_threshold: float = 0.05,
        fail_min_samples: int = 5,
        browser_restart_interval: int = 30,
    ) -> None:
        """KB손보 크롤러 초기화

        Args:
            storage: PDF 파일 저장 백엔드
            rate_limit_seconds: 요청 간 대기 시간(초)
            max_retries: 최대 재시도 횟수
            fail_threshold: 실패율 임계값 (초과 시 즉시 중단)
            fail_min_samples: 최소 처리 건수 이후 임계값 적용
            browser_restart_interval: 브라우저 컨텍스트 재시작 주기 (상품 수 기준, 메모리 해제용)
        """
        super().__init__(
            crawler_name="kb-nonlife",
            db_session=None,
            storage=storage,
            rate_limit_seconds=rate_limit_seconds,
            max_retries=max_retries,
        )
        self.fail_threshold = fail_threshold
        self.fail_min_samples = fail_min_samples
        self.browser_restart_interval = browser_restart_interval

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
        products: list[dict[str, str]] = await page.evaluate(r"""() => {
            const results = [];
            document.querySelectorAll('table tr').forEach(tr => {
                const tds = tr.querySelectorAll('td');
                if (tds.length >= 4) {
                    const anchor = tds[3]?.querySelector('a');
                    if (anchor) {
                        const href = anchor.getAttribute('href') || '';
                        const match = href.match(/detail\('(\d+)','([^']+)','([^']+)'\)/);
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
            cat_code = prod.get("catCode", "")
            name = prod.get("name", "")
            status_str = prod.get("status", "")

            sale_status = SaleStatus.ON_SALE if "판매" in status_str and "중지" not in status_str else SaleStatus.DISCONTINUED

            # @MX:NOTE: [AUTO] pdf_url에 catCode와 seq를 포함하여 상세 페이지 접근에 사용
            #           실제 다운로드 URL은 상세 페이지 파싱 후 결정됨
            pdf_url = f"{_DETAIL_URL}?bojongNo={code}&gubun={cat_code}&seq={seq}"

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

    def _is_valid_pdf(self, data: bytes) -> bool:
        """PDF 바이너리 유효성 검증

        Args:
            data: 다운로드된 바이너리 데이터

        Returns:
            유효한 PDF이면 True
        """
        return data[:4] == b"%PDF" and len(data) > 1000

    def _get_storage_path(self, product_code: str, file_name: str) -> str:
        """PDF 저장 경로 생성

        Args:
            product_code: 상품 코드
            file_name: 원본 파일명 (예: 20240101_10101_1.pdf)

        Returns:
            저장 경로 (예: kb-nonlife/10101/20240101_10101_1.pdf)
        """
        # 파일명 소문자 정규화 (.PDF -> .pdf)
        normalized = file_name.lower()
        return f"kb-nonlife/{product_code}/{normalized}"

    async def fetch_detail_pdfs(
        self, page: Any, listing: PolicyListing
    ) -> list[PdfFileInfo]:
        """상세 페이지에서 연도별 PDF 파일 목록 수집

        detail() 함수 역할을 직접 수행하여 상세 페이지로 이동 후
        테이블에서 모든 PDF 링크를 추출.

        Args:
            page: Playwright 페이지 객체 (목록 페이지 또는 다른 페이지)
            listing: 상품 기본 정보 (pdf_url에 bojongNo, gubun, seq 포함)

        Returns:
            PDF 파일 정보 목록 (날짜별 정렬)
        """
        from urllib.parse import parse_qs, urlparse

        # pdf_url에서 파라미터 추출
        parsed = urlparse(listing.pdf_url)
        params = parse_qs(parsed.query)

        code = params.get("bojongNo", [listing.product_code])[0]
        cat_code = params.get("gubun", [""])[0]
        seq = params.get("seq", ["1"])[0]

        # 상세 페이지로 POST 네비게이션
        # @MX:NOTE: [AUTO] detail() 함수는 폼 POST로 동작하므로 직접 폼 제출 재현
        try:
            async with page.expect_navigation(wait_until="networkidle", timeout=20000):
                await page.evaluate(f"""
                    (() => {{
                        document.getElementById('bojongNo').value = '{code}';
                        document.getElementById('gubun').value = '{cat_code}';
                        document.getElementById('bojongSeq').value = '{seq}';
                        var form = document.prdtList;
                        form.target = '_self';
                        form.action = '/CG802030002.ec';
                        form.submit();
                    }})();
                """)
        except Exception as e:
            logger.warning(
                "[KB손보] 상세 페이지 네비게이션 실패 [%s]: %s",
                listing.product_name[:40],
                e,
            )
            return []

        await asyncio.sleep(1)

        # 상세 페이지에서 PDF 링크 추출
        # @MX:NOTE: [AUTO] 상세 페이지 테이블 구조:
        #   행2: 헤더 (판매시작일|판매종료일|보험약관|사업방법서|상품요약서|비고)
        #   행3~: 각 연도별 (시작일|종료일|약관PDF링크|사업방법서링크|요약서링크|비고)
        # @MX:NOTE: [AUTO] 숨겨진 앵커 제외: HTML에는 있으나 display:none인 링크는 서버에 파일 없음
        raw_pdfs: list[dict] = await page.evaluate(r"""() => {
            const pdfs = [];
            document.querySelectorAll('a').forEach(el => {
                const href = el.getAttribute('href') || '';
                if (!href.includes('CG802030003') || !href.includes('fileNm=')) return;
                // 조상 요소 중 display:none 또는 visibility:hidden이면 제외
                let node = el;
                while (node && node.tagName !== 'BODY') {
                    const s = window.getComputedStyle(node);
                    if (s.display === 'none' || s.visibility === 'hidden') return;
                    node = node.parentElement;
                }
                pdfs.push({href});
            });
            return pdfs;
        }""")

        pdf_files: list[PdfFileInfo] = []
        for item in raw_pdfs:
            href = item.get("href", "")
            if not href:
                continue

            # fileNm 파라미터 추출
            # 형식: /CG802030003.ec?fileNm=20240101_10101_1.pdf
            if "fileNm=" not in href:
                continue

            file_name_raw = href.split("fileNm=", 1)[1]
            # URL 디코딩 (공백 등)
            file_name = unquote(file_name_raw).strip()

            if not file_name:
                continue

            # 파일명에서 날짜, 코드, 문서번호 파싱
            # 패턴: {날짜}_{코드}_{번호}.{확장자}
            # 예: 20240101_10101_1.pdf, 20181001_10101_1[0].pdf
            import re
            match = re.match(r"(\d{8})_(\d+)_(\d+)", file_name)
            if not match:
                # 파싱 불가한 파일명도 수집 (알 수 없는 형식)
                pdf_files.append(PdfFileInfo(
                    file_name=file_name,
                    download_url=f"{_BASE_URL}{href}" if href.startswith("/") else href,
                    page_href=href,
                    start_date="",
                    end_date=None,
                    doc_type=0,
                ))
                continue

            start_date = match.group(1)
            doc_type = int(match.group(3))

            download_url = f"{_BASE_URL}{href}" if href.startswith("/") else href

            pdf_files.append(PdfFileInfo(
                file_name=file_name,
                download_url=download_url,
                page_href=href,
                start_date=start_date,
                end_date=None,  # 상세 페이지에서 종료일 추출 가능하지만 파일명으로 충분
                doc_type=doc_type,
            ))

        logger.info(
            "[KB손보] 상세 페이지 PDF 수집: %s → %d개 (raw_pdfs=%d개)",
            listing.product_name[:40],
            len(pdf_files),
            len(raw_pdfs),
        )
        for pf in pdf_files:
            logger.debug("[KB손보] 수집된 PDF: %s → %s", pf.file_name, pf.download_url)
        return pdf_files

    async def download_pdf(self, listing: PolicyListing) -> bytes:
        """PDF 다운로드 (하위 호환성 유지용 - 단일 URL 다운로드)

        Args:
            listing: 다운로드할 상품 정보 (pdf_url에 직접 다운로드 URL 필요)

        Returns:
            PDF 바이너리 데이터 (실패시 빈 bytes)
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
            try:
                resp = await client.get(listing.pdf_url)
                resp.raise_for_status()
                if self._is_valid_pdf(resp.content):
                    return resp.content
            except Exception as e:
                logger.debug("[KB손보] PDF 다운로드 실패 [%s]: %s", listing.pdf_url[:80], e)

        return b""

    async def download_pdf_by_url(self, page: Any, url: str, file_name: str, page_href: str = "") -> bytes:
        """상세 페이지 링크 클릭으로 PDF 다운로드 (Playwright 다운로드 인터셉트)

        # @MX:NOTE: KB손보 서버는 Sec-Fetch-Dest=document(링크 클릭 네비게이션)만 허용.
        # fetch()/XHR/page.request는 Sec-Fetch-Dest=empty로 전송되어 HTML 오류 페이지 반환.
        # Sec-Fetch-* 헤더는 브라우저가 자동 설정하므로 JS에서 수동 지정 불가.
        # page.expect_download()로 실제 클릭 → 브라우저 다운로드를 인터셉트하여 바이트 반환.

        Args:
            page: Playwright 페이지 객체 (상세 페이지가 열려 있어야 함)
            url: 다운로드 전체 URL (미사용, 하위 호환성 유지)
            file_name: 파일명 (로깅용)
            page_href: 페이지 내 원본 href 속성값 (링크 탐색용)

        Returns:
            PDF 바이너리 데이터 (실패시 빈 bytes)
        """
        from pathlib import Path as _Path

        href = page_href
        if not href:
            logger.warning("[KB손보] page_href 없음 - 다운로드 불가 [%s]", file_name)
            return b""
        try:
            async with page.expect_download(timeout=30000) as download_info:
                await page.evaluate(
                    """(href) => {
                        const links = Array.from(document.querySelectorAll('a'));
                        const link = links.find(a => a.getAttribute('href') === href);
                        if (!link) throw new Error('링크 없음: ' + href);
                        link.click();
                    }""",
                    href,
                )
            download = await download_info.value
            path = await download.path()
            if path:
                data = _Path(path).read_bytes()
                await download.delete()  # 임시 파일 즉시 삭제 (Chromium 다운로드 디렉터리 누적 방지)
                if self._is_valid_pdf(data):
                    return data
                first_bytes = data[:100].decode("utf-8", errors="replace").strip()
                logger.warning(
                    "[KB손보] 다운로드 파일 PDF 아님 [%s] %d bytes, 시작: %r",
                    file_name, len(data), first_bytes,
                )
        except Exception as e:
            logger.warning("[KB손보] 클릭 다운로드 실패 [%s]: %s", file_name, e)

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
            # 상품 디렉터리 존재 여부로 판단
            # 상세 페이지 접근이 필요하므로 디렉터리 수준 체크
            dir_path = f"kb-nonlife/{listing.product_code}/"
            if self.storage.exists(dir_path):
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
        3. 신규/기존 분류 (상품 디렉터리 단위)
        4. 신규 상품의 상세 페이지에서 연도별 PDF 목록 수집
        5. PDF 다운로드 및 저장

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
                    logger.info(
                        "[KB손보] 페이지 %d 파싱 완료: %d개 상품 (누적 %d개)",
                        page_num,
                        len(listings),
                        len(all_listings),
                    )

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

                    if page_num > 2000:
                        logger.warning("[KB손보] 페이지 수 제한 초과 (2000페이지), 중단")
                        break

                logger.info(
                    "[KB손보] 전체 %d개 상품 수집 (%d페이지)",
                    len(all_listings),
                    page_num - 1,
                )
                total_found = len(all_listings)

                # 중복 제거 (동일 product_code는 상세 페이지가 동일)
                seen_codes: set[str] = set()
                unique_listings: list[PolicyListing] = []
                for listing in all_listings:
                    if listing.product_code not in seen_codes:
                        seen_codes.add(listing.product_code)
                        unique_listings.append(listing)

                logger.info(
                    "[KB손보] 중복 제거 후 %d개 (원래 %d개)",
                    len(unique_listings),
                    total_found,
                )

                # 신규/기존 분류 (상품 디렉터리 단위)
                delta = await self.detect_changes(unique_listings)
                skipped_count = len(delta.unchanged)
                logger.info(
                    "[KB손보] 신규: %d개, 기존(스킵): %d개",
                    len(delta.new),
                    skipped_count,
                )

                # 신규 상품 처리: 상세 페이지 방문 → PDF 목록 수집 → 다운로드
                # @MX:NOTE: fail-stop: 최소 fail_min_samples 이후 실패율 > fail_threshold 시 즉시 중단
                # @MX:NOTE: browser_restart_interval마다 컨텍스트 재시작 → Chromium 힙 해제
                products_attempted = 0  # 실제 처리 시도 건수 (스킵 제외)
                aborted = False
                for idx, listing in enumerate(delta.new):
                    # browser_restart_interval마다 컨텍스트 재시작 (메모리 누수 방지)
                    if idx > 0 and idx % self.browser_restart_interval == 0:
                        logger.info(
                            "[KB손보] 브라우저 컨텍스트 재시작 (%d번째 상품, 메모리 해제)",
                            idx,
                        )
                        await context.close()
                        gc.collect()
                        context = await browser.new_context(
                            accept_downloads=True,
                            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                        )
                        page = await context.new_page()

                    # 목록 페이지로 복귀 (상세 페이지 폼 제출을 위해 필요)
                    await page.goto(_LIST_URL, timeout=30000, wait_until="networkidle")
                    await asyncio.sleep(1)

                    # 상세 페이지에서 연도별 PDF 목록 수집
                    pdf_files = await self.fetch_detail_pdfs(page, listing)

                    if not pdf_files:
                        logger.warning(
                            "[KB손보] 상세 페이지 PDF 없음: %s (code=%s)",
                            listing.product_name[:50],
                            listing.product_code,
                        )
                        failed_count += 1
                        products_attempted += 1
                        if products_attempted >= self.fail_min_samples:
                            fail_rate = failed_count / products_attempted
                            if fail_rate > self.fail_threshold:
                                logger.error(
                                    "[KB손보] 실패율 %.1f%% > 임계값 %.1f%% (처리 %d건 중 %d건 실패) → 수집 중단",
                                    fail_rate * 100, self.fail_threshold * 100,
                                    products_attempted, failed_count,
                                )
                                aborted = True
                                break
                        continue

                    # 각 PDF 파일 다운로드
                    product_downloaded = 0
                    product_failed = 0

                    for pdf_info in pdf_files:
                        storage_path = self._get_storage_path(
                            listing.product_code, pdf_info.file_name
                        )

                        # 이미 존재하는 파일 스킵
                        if self.storage.exists(storage_path):
                            continue

                        try:
                            pdf_data = await self.download_pdf_by_url(
                                page, pdf_info.download_url, pdf_info.file_name,
                                pdf_info.page_href,
                            )

                            if self._is_valid_pdf(pdf_data):
                                self.storage.save(pdf_data, storage_path)
                                product_downloaded += 1
                                logger.debug(
                                    "[KB손보] 저장: %s (%d bytes)",
                                    storage_path,
                                    len(pdf_data),
                                )
                            else:
                                product_failed += 1
                                logger.debug(
                                    "[KB손보] PDF 검증 실패 (서버 미제공): %s",
                                    pdf_info.file_name,
                                )

                        except Exception as e:
                            product_failed += 1
                            logger.error(
                                "[KB손보] 다운로드 오류 [%s]: %s",
                                pdf_info.file_name,
                                e,
                            )

                        await asyncio.sleep(self.rate_limit_seconds)

                    if product_downloaded > 0:
                        new_count += product_downloaded
                        results.append({
                            "product_name": listing.product_name,
                            "category": listing.category,
                            "status": "downloaded",
                            "pdf_count": product_downloaded,
                            "failed_count": product_failed,
                        })
                        logger.info(
                            "[KB손보] 완료: %s → %d개 저장, %d개 실패",
                            listing.product_name[:50],
                            product_downloaded,
                            product_failed,
                        )
                    elif product_failed > 0 and product_downloaded == 0:
                        failed_count += 1
                        logger.warning(
                            "[KB손보] 파일 없음 (서버 미제공): %s (code=%s)",
                            listing.product_name[:50],
                            listing.product_code,
                        )

                    products_attempted += 1
                    if products_attempted >= self.fail_min_samples:
                        fail_rate = failed_count / products_attempted
                        if fail_rate > self.fail_threshold:
                            logger.error(
                                "[KB손보] 실패율 %.1f%% > 임계값 %.1f%% (처리 %d건 중 %d건 실패) → 수집 중단",
                                fail_rate * 100, self.fail_threshold * 100,
                                products_attempted, failed_count,
                            )
                            aborted = True
                            break

                if aborted:
                    logger.error("[KB손보] 실패율 임계값 초과로 수집 중단됨. 디버깅 후 재실행하세요.")

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
