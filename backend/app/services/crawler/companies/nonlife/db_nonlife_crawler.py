"""DB손해보험 크롤러 (SPEC-DATA-002 Phase 3)

5단계 AJAX API를 httpx로 직접 호출하여 약관 PDF를 수집.
Playwright 불필요 - httpx만 사용.

# @MX:NOTE: [AUTO] DB손보는 5단계 AJAX API (Step2~Step5)
# @MX:NOTE: [AUTO] Step2(상품목록) → Step3(판매기간) → Step4(약관 파일명) → PDF 다운로드
# @MX:NOTE: [AUTO] PDF URL: /cYakgwanDown.do?FilePath=InsProduct/{INPL_FINM}
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any
from urllib.parse import quote

import httpx

from app.services.crawler.base import (
    BaseCrawler,
    CrawlRunResult,
    DeltaResult,
    PolicyListing,
    SaleStatus,
)
from app.services.crawler.storage import StorageBackend

logger = logging.getLogger(__name__)

_BASE_URL = "https://www.idbins.com"

# @MX:ANCHOR: [AUTO] DB손보 STEP API URL 상수
# @MX:REASON: _fetch_products_step2, _fetch_period_step3, _fetch_filename_step4 메서드에서 참조
STEP2_URL = f"{_BASE_URL}/insuPcPbanFindProductStep2_AX.do"
STEP3_URL = f"{_BASE_URL}/insuPcPbanFindProductStep3_AX.do"
STEP4_URL = f"{_BASE_URL}/insuPcPbanFindProductStep4_AX.do"
DOWNLOAD_URL = f"{_BASE_URL}/cYakgwanDown.do"

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": f"{_BASE_URL}/FWMAIV1534.do",
}


class DBNonLifeCrawler(BaseCrawler):
    """DB손해보험 약관 크롤러

    AJAX Step API를 순차 호출하여 질병/상해 관련 PDF를 수집.
    판매중(sl_yn=1)과 판매중지(sl_yn=0) 상품 모두 수집.
    """

    # @MX:ANCHOR: [AUTO] DBNonLifeCrawler.TARGET_CATEGORIES - 수집 대상 카테고리
    # @MX:REASON: crawl() 및 parse_listing()에서 직접 참조됨
    TARGET_CATEGORIES: list[dict[str, str]] = [
        {"ln": "장기보험", "sn": "Off-Line", "mn": "간병", "label": "장기-오프라인-간병"},
        {"ln": "장기보험", "sn": "Off-Line", "mn": "건강", "label": "장기-오프라인-건강"},
        {"ln": "장기보험", "sn": "Off-Line", "mn": "상해", "label": "장기-오프라인-상해"},
        {"ln": "장기보험", "sn": "Off-Line", "mn": "질병", "label": "장기-오프라인-질병"},
        {"ln": "장기보험", "sn": "TM/CM", "mn": "간병", "label": "장기-TM/CM-간병"},
        {"ln": "장기보험", "sn": "TM/CM", "mn": "건강", "label": "장기-TM/CM-건강"},
        {"ln": "장기보험", "sn": "TM/CM", "mn": "상해", "label": "장기-TM/CM-상해"},
        {"ln": "장기보험", "sn": "TM/CM", "mn": "질병", "label": "장기-TM/CM-질병"},
        {"ln": "장기보험", "sn": "방카슈랑스", "mn": "간병", "label": "장기-방카-간병"},
        {"ln": "장기보험", "sn": "방카슈랑스", "mn": "건강", "label": "장기-방카-건강"},
        {"ln": "장기보험", "sn": "방카슈랑스", "mn": "상해", "label": "장기-방카-상해"},
        {"ln": "장기보험", "sn": "방카슈랑스", "mn": "질병", "label": "장기-방카-질병"},
        {"ln": "일반", "sn": "99", "mn": "상해", "label": "일반-상해"},
    ]

    def __init__(
        self,
        storage: StorageBackend,
        rate_limit_seconds: float = 2.0,
        max_retries: int = 3,
    ) -> None:
        """DB손보 크롤러 초기화

        Args:
            storage: PDF 파일 저장 백엔드
            rate_limit_seconds: 요청 간 대기 시간(초)
            max_retries: 최대 재시도 횟수
        """
        super().__init__(
            crawler_name="db-nonlife",
            db_session=None,
            storage=storage,
            rate_limit_seconds=rate_limit_seconds,
            max_retries=max_retries,
        )

    async def parse_listing(self, data: Any) -> list[PolicyListing]:
        """Step2 응답 데이터에서 PolicyListing 목록 생성

        Args:
            data: Step2 API에서 반환된 상품 정보 목록 (list[dict])

        Returns:
            PolicyListing 목록
        """
        if not data:
            return []

        listings: list[PolicyListing] = []
        for item in data:
            pdc_nm = item.get("PDC_NM", "")
            if not pdc_nm:
                continue

            sl_yn = item.get("_sl_yn", "1")
            label = item.get("_label", "")
            sale_status = SaleStatus.ON_SALE if sl_yn == "1" else SaleStatus.DISCONTINUED

            listing = PolicyListing(
                company_name="DB손해보험",
                product_name=pdc_nm,
                product_code=item.get("PDC_CD", ""),
                category=label,
                pdf_url="",  # Step4에서 채워짐
                company_code="db-nonlife",
                sale_status=sale_status,
            )
            listings.append(listing)

        return listings

    async def download_pdf(self, listing: PolicyListing) -> bytes:
        """PDF 다운로드

        Args:
            listing: 다운로드할 상품 정보 (pdf_url 포함)

        Returns:
            PDF 바이너리 데이터
        """
        async with httpx.AsyncClient(
            headers=_HEADERS,
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
            safe_name = listing.product_name.strip()
            for ch in ['/', '\\', ':', '?', '"', '<', '>', '*', '|']:
                safe_name = safe_name.replace(ch, '_')
            path = f"db-nonlife/{listing.category}/{safe_name}.pdf"

            if self.storage.exists(path):
                unchanged_listings.append(listing)
            else:
                new_listings.append(listing)

        return DeltaResult(
            new=new_listings,
            updated=[],
            unchanged=unchanged_listings,
        )

    async def _fetch_products_step2(
        self,
        client: httpx.AsyncClient,
        cat: dict[str, str],
        sl_yn: str,
    ) -> list[dict[str, Any]]:
        """Step2: 상품 목록 조회

        Args:
            client: httpx AsyncClient
            cat: 카테고리 정보 (ln, sn, mn, label)
            sl_yn: 판매 여부 ('1'=판매중, '0'=판매중지)

        Returns:
            상품 정보 목록
        """
        try:
            resp = await client.post(
                STEP2_URL,
                json={
                    "arc_knd_lgcg_nm": cat["ln"],
                    "sl_chn_nm": cat["sn"],
                    "arc_knd_mdcg_nm": cat["mn"],
                    "arc_pdc_sl_yn": sl_yn,
                },
                headers={"Content-Type": "application/json"},
                timeout=60.0,
            )
            data = resp.json()
            items = data.get("result", [])
            for item in items:
                item["_sl_yn"] = sl_yn
                item["_label"] = cat["label"]
            return items
        except Exception as e:
            logger.error("[DB손보] Step2 실패 (카테고리=%s, sl_yn=%s): %s",
                         cat["label"], sl_yn, e)
            return []

    async def _fetch_period_step3(
        self,
        client: httpx.AsyncClient,
        pdc_nm: str,
        sl_yn: str,
    ) -> list[dict[str, Any]]:
        """Step3: 판매기간 조회

        Args:
            client: httpx AsyncClient
            pdc_nm: 상품명
            sl_yn: 판매 여부

        Returns:
            판매기간 목록 (최신 우선)
        """
        try:
            resp = await client.post(
                STEP3_URL,
                json={"pdc_nm": pdc_nm, "arc_pdc_sl_yn": sl_yn},
                headers={"Content-Type": "application/json"},
                timeout=60.0,
            )
            data = resp.json()
            return data.get("result", [])
        except Exception as e:
            logger.debug("[DB손보] Step3 실패 [%s]: %s", pdc_nm[:30], e)
            return []

    async def _fetch_filename_step4(
        self,
        client: httpx.AsyncClient,
        sqno: str,
        sl_yn: str,
    ) -> list[dict[str, Any]]:
        """Step4: 약관 파일명 조회

        Args:
            client: httpx AsyncClient
            sqno: 판매기간 순번
            sl_yn: 판매 여부

        Returns:
            파일 정보 목록
        """
        try:
            resp = await client.post(
                STEP4_URL,
                json={"sqno": str(sqno), "arc_pdc_sl_yn": sl_yn},
                headers={"Content-Type": "application/json"},
                timeout=60.0,
            )
            data = resp.json()
            return data.get("result", [])
        except Exception as e:
            logger.debug("[DB손보] Step4 실패 (sqno=%s): %s", sqno, e)
            return []

    # @MX:ANCHOR: [AUTO] DBNonLifeCrawler.crawl - DB손보 크롤링 진입점
    # @MX:REASON: run_pipeline.py의 _create_crawler() 및 run_crawl()에서 직접 호출됨
    async def crawl(self) -> CrawlRunResult:
        """DB손보 약관 크롤링 메인 진입점

        1. 각 카테고리별 Step2-3-4 API 순차 호출
        2. PDF URL 구성
        3. 신규/기존 분류
        4. 신규 항목 PDF 다운로드 및 저장

        Returns:
            크롤링 실행 결과 요약
        """
        total_found = 0
        new_count = 0
        skipped_count = 0
        failed_count = 0
        results: list[dict] = []

        async with httpx.AsyncClient(headers=_HEADERS, follow_redirects=True) as client:
            for cat in self.TARGET_CATEGORIES:
                label = cat["label"]
                products: list[dict[str, Any]] = []

                # Step2: 판매중 + 판매중지 모두 수집
                for sl_yn in ["1", "0"]:
                    items = await self._fetch_products_step2(client, cat, sl_yn)
                    products.extend(items)

                if not products:
                    continue

                total_found += len(products)
                logger.info("[DB손보] %s: %d개 상품", label, len(products))

                for prod in products:
                    pdc_nm = prod.get("PDC_NM", "")
                    if not pdc_nm:
                        continue

                    sl_yn = prod.get("_sl_yn", "1")

                    # Step3: 판매기간 조회
                    periods = await self._fetch_period_step3(client, pdc_nm, sl_yn)
                    if not periods:
                        failed_count += 1
                        continue

                    latest = periods[0]
                    sqno = latest.get("SQNO", "")

                    # Step4: 약관 파일명 조회
                    files = await self._fetch_filename_step4(client, sqno, sl_yn)
                    if not files:
                        failed_count += 1
                        continue

                    inpl_finm = files[0].get("INPL_FINM", "")
                    if not inpl_finm:
                        failed_count += 1
                        continue

                    pdf_url = f"{DOWNLOAD_URL}?FilePath=InsProduct/{quote(inpl_finm)}"

                    # 스토리지 존재 여부 확인 (스킵 체크)
                    safe_name = pdc_nm.strip()
                    for ch in ['/', '\\', ':', '?', '"', '<', '>', '*', '|']:
                        safe_name = safe_name.replace(ch, '_')
                    path = f"db-nonlife/{label}/{safe_name}.pdf"

                    if self.storage.exists(path):
                        skipped_count += 1
                        continue

                    # PDF 다운로드
                    try:
                        resp = await client.get(pdf_url, timeout=30.0)
                        if (resp.status_code == 200
                                and resp.content[:4] == b"%PDF"
                                and len(resp.content) > 1000):
                            self.storage.save(resp.content, path)
                            new_count += 1
                            results.append({
                                "product_name": pdc_nm,
                                "category": label,
                                "status": "downloaded",
                            })
                            logger.info("[DB손보] 다운로드: %s (%d bytes)",
                                       pdc_nm[:50], len(resp.content))
                        else:
                            failed_count += 1
                    except Exception as e:
                        failed_count += 1
                        logger.error("[DB손보] 다운로드 실패 [%s]: %s", pdc_nm[:50], e)

                    await asyncio.sleep(self.rate_limit_seconds)

        return CrawlRunResult(
            total_found=total_found,
            new_count=new_count,
            updated_count=0,
            skipped_count=skipped_count,
            failed_count=failed_count,
            results=results,
        )
