"""현대해상화재보험 크롤러

# @MX:NOTE: [AUTO] 현대해상은 Playwright 필수 (SPA, AJAX 기반 데이터 로드)
# @MX:NOTE: [AUTO] 약관 공시 페이지: CION3200G.jsp → serviceAction.do?menuId=100932
# @MX:NOTE: [AUTO] 상품 목록: ajax.xhi POST tranId=HHMK0020M09S → slYProdList/slNProdList
# @MX:NOTE: [AUTO] PDF URL 변환: HHCA0310M26S tranId → {savPath, savFileNm, flExts}
# @MX:NOTE: [AUTO] PDF URL 패턴: /FileActionServlet/preview/0{savPath}/{savFileNm}.{ext}
# @MX:NOTE: [AUTO] 전체 상품 수: 판매중≈2289, 판매중지≈4447 (2026-03 검증)
# @MX:WARN: [AUTO] Playwright 세션 쿠키를 httpx에 전달해야 HHCA0310M26S API 응답이 옴
# @MX:REASON: ajax.xhi는 HH_JSESSIONID 세션 쿠키 없이 빈 응답 반환
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import re
from dataclasses import dataclass
from collections.abc import Awaitable, Callable
from typing import Any

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

_BASE_URL = "https://www.hi.co.kr"
# 실제 동작하는 약관 공시 페이지 (CION3200G → menuId=100932 리다이렉트)
_CION_URL = f"{_BASE_URL}/bin/CI/ON/CION3200G.jsp"
_AJAX_URL = f"{_BASE_URL}/ajax.xhi"
_FILE_SERVLET = f"{_BASE_URL}/FileActionServlet/preview/0"
_SERVICE_URL = f"{_BASE_URL}/serviceAction.do?menuId=100932"


@dataclass
class _Product:
    """내부 상품 데이터 (AJAX slYProdList/slNProdList 항목)."""

    prod_nm: str
    sale_status: str          # "Y" = 판매중, "N" = 판매중지
    prod_cat_cd: str
    clau_apnfl_id: str | None  # 약관 파일 UUID


def _make_gid() -> str:
    """현대해상 ajax.xhi 요청용 랜덤 gId 생성."""
    return "".join(str(random.randint(0, 9)) for _ in range(28))


class HyundaiMarineCrawler(BaseCrawler):
    """현대해상화재보험 약관 크롤러

    동작 방식 (2026-03 검증):
    1. Playwright로 CION3200G.jsp 로드 → ajax.xhi AJAX 응답 캡처
    2. slYProdList (판매중) + slNProdList (판매중지) 전체 상품 수신
    3. Playwright 세션 쿠키 추출 → httpx에 전달
    4. HHCA0310M26S API 병렬 호출로 UUID → PDF URL 일괄 변환
    5. processed_urls 체크 후 신규 PDF만 httpx 다운로드
    """

    def __init__(
        self,
        storage: StorageBackend,
        rate_limit_seconds: float = 1.0,
        max_retries: int = 3,
        fail_threshold: float = 0.05,
        fail_min_samples: int = 5,
        url_resolve_concurrency: int = 10,
        download_concurrency: int = 3,
    ) -> None:
        """
        Args:
            storage: PDF 파일 저장 백엔드
            rate_limit_seconds: PDF 다운로드 간 대기 시간(초)
            max_retries: PDF 다운로드 최대 재시도 횟수
            fail_threshold: 실패율 임계값 (초과 시 즉시 중단)
            fail_min_samples: 최소 처리 건수 이후 임계값 적용
            url_resolve_concurrency: HHCA0310M26S 동시 호출 수
            download_concurrency: PDF 동시 다운로드 수
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
        self.url_resolve_concurrency = url_resolve_concurrency
        self.download_concurrency = download_concurrency

    # ──────────────────────────────────────────────────────────────────
    # Internal helpers
    # ──────────────────────────────────────────────────────────────────

    def _is_valid_pdf(self, data: bytes) -> bool:
        # %PDF 시그니처가 첫 1KB 이내에 있으면 유효한 PDF로 간주
        # (일부 PDF는 UTF-8 BOM \xef\xbb\xbf 또는 바이너리 헤더를 앞에 붙임)
        return b"%PDF" in data[:1024] and len(data) > 1000

    def _get_storage_path(self, uuid: str, sale_status: str, filename: str) -> str:
        """UUID와 판매상태로 저장 경로 결정.

        Returns:
            예: hyundai-marine/on-sale/c1b7b31f/03.약관_20260101_상품명.pdf
        """
        status_dir = "on-sale" if sale_status == "Y" else "discontinued"
        uid_prefix = uuid.replace("-", "")[:8] if uuid else "unknown"
        safe_name = re.sub(r'[\\/:*?"<>|]', "_", filename)
        return f"hyundai-marine/{status_dir}/{uid_prefix}/{safe_name}"

    async def _fetch_product_list(self, page: Any) -> dict[str, list[_Product]]:
        """CION3200G 로드 후 AJAX 응답에서 전체 상품 목록 수집.

        Returns:
            {"Y": [...판매중...], "N": [...판매중지...]}
        """
        captured: dict = {}

        async def _on_resp(resp: Any) -> None:
            if _AJAX_URL not in resp.url:
                return
            try:
                body = await resp.text()
                d = json.loads(body)
                inner = d.get("data", {})
                if inner.get("slYProdList") or inner.get("slNProdList"):
                    captured.update(inner)
            except Exception:
                pass

        page.on("response", _on_resp)

        logger.info("[현대해상] CION3200G.jsp 로드 시작")
        await page.goto(_CION_URL, timeout=60_000, wait_until="networkidle")
        # AJAX 데이터 로드 완료 대기
        await asyncio.sleep(6)

        def _parse(raw: dict, status: str) -> _Product:
            return _Product(
                prod_nm=(raw.get("prodNm") or "미확인").strip(),
                sale_status=status,
                prod_cat_cd=raw.get("prodCatCd") or "",
                clau_apnfl_id=raw.get("clauApnflId"),
            )

        sly = [_parse(r, "Y") for r in captured.get("slYProdList", [])]
        sln = [_parse(r, "N") for r in captured.get("slNProdList", [])]

        logger.info(
            "[현대해상] 상품 목록 수신: 판매중=%d, 판매중지=%d",
            len(sly),
            len(sln),
        )
        return {"Y": sly, "N": sln}

    async def _extract_cookies(self, context: Any) -> str:
        """Playwright 컨텍스트에서 쿠키 문자열 추출."""
        cookies = await context.cookies()
        return "; ".join(f"{c['name']}={c['value']}" for c in cookies)

    async def _resolve_uuid_batch(
        self,
        client: httpx.AsyncClient,
        uuids: list[str],
        sem: asyncio.Semaphore,
    ) -> dict[str, dict]:
        """UUID 리스트를 병렬로 HHCA0310M26S 호출해 PDF 파일 정보 획득.

        Returns:
            {uuid: {savPath, savFileNm, flExts, originalFileNm}} 매핑
        """

        async def _resolve_one(uuid: str) -> tuple[str, dict | None]:
            async with sem:
                payload = {
                    "header": {
                        "gId": _make_gid(),
                        "tranId": "HHCA0310M26S",
                        "channelId": "HI-HOME",
                        "clientIp": "127.0.0.1",
                        "menuId": "100932",
                        "loginId": None,
                    },
                    "request": {"apnflId": uuid},
                }
                for attempt in range(3):
                    try:
                        resp = await client.post(_AJAX_URL, json=payload, timeout=20.0)
                        resp.raise_for_status()
                        inner = resp.json().get("data", {})
                        if inner.get("savFileNm"):
                            return uuid, inner
                        return uuid, None
                    except Exception as e:
                        if attempt < 2:
                            await asyncio.sleep(1.0)
                        else:
                            logger.debug("[현대해상] UUID 해결 실패 (%s): %s", uuid[:8], e)
                return uuid, None

        tasks = [_resolve_one(u) for u in uuids]
        results = await asyncio.gather(*tasks)
        return {k: v for k, v in results if v is not None}

    def _build_pdf_url(self, file_info: dict) -> str:
        sav_path = file_info.get("savPath", "")
        sav_nm = file_info.get("savFileNm", "")
        ext = file_info.get("flExts", "pdf")
        return f"{_FILE_SERVLET}{sav_path}/{sav_nm}.{ext}"

    async def _download_pdf(self, client: httpx.AsyncClient, pdf_url: str) -> bytes:
        """httpx로 PDF 다운로드 (재시도 포함)."""
        # 연결 10s, 본문 읽기 120s (오래된 PDF 파일은 서버 응답이 느림)
        _timeout = httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=30.0)
        for attempt in range(self.max_retries):
            try:
                resp = await client.get(pdf_url, timeout=_timeout)
                resp.raise_for_status()
                content_type = resp.headers.get("content-type", "")
                if "html" in content_type.lower() and not self._is_valid_pdf(resp.content):
                    logger.warning("[현대해상] HTML 응답 (PDF 아님): %s", pdf_url[-60:])
                    return b""
                if self._is_valid_pdf(resp.content):
                    return resp.content
                logger.warning("[현대해상] PDF 검증 실패: %s (%d bytes)", pdf_url[-60:], len(resp.content))
                return b""
            except Exception as e:
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(2.0 * (attempt + 1))
                else:
                    logger.warning("[현대해상] 다운로드 최종 실패 [%s]: %s", pdf_url[-60:], e)
        return b""

    # ──────────────────────────────────────────────────────────────────
    # Public interface
    # ──────────────────────────────────────────────────────────────────

    # ── BaseCrawler 추상 메서드 스텁 ─────────────────────────────────────
    # 현대해상 크롤러는 crawl()에서 모든 로직을 직접 처리하므로
    # 이 템플릿 메서드들은 사용되지 않음.

    async def parse_listing(self, page: Any) -> list[PolicyListing]:
        raise NotImplementedError("현대해상 크롤러는 crawl()에서 직접 처리합니다.")

    async def download_pdf(self, listing: PolicyListing) -> bytes:
        raise NotImplementedError("현대해상 크롤러는 crawl()에서 직접 처리합니다.")

    async def detect_changes(self, listings: list[PolicyListing]) -> DeltaResult:
        raise NotImplementedError("현대해상 크롤러는 crawl()에서 직접 처리합니다.")

    # @MX:ANCHOR: [AUTO] HyundaiMarineCrawler.crawl - 현대해상 크롤링 진입점
    # @MX:REASON: crawl_and_ingest_hyundai_marine.py에서 직접 호출됨
    async def crawl(
        self,
        processed_urls: set[str] | None = None,
        on_download: Callable[[bytes, dict], Awaitable[None]] | None = None,
    ) -> CrawlRunResult:
        """현대해상 약관 크롤링 메인 진입점.

        1. Playwright로 CION3200G.jsp 로드 → 전체 상품 목록 수신
        2. Playwright 세션 쿠키로 httpx 클라이언트 구성
        3. HHCA0310M26S 병렬 호출 → UUID → PDF URL 일괄 변환
        4. processed_urls 체크 → 신규만 다운로드
        5. 실패율 임계값 초과 시 즉시 중단

        Args:
            processed_urls: 이미 처리된 source_url 집합 (DB에서 로드). 해당 URL 다운로드 스킵.

        Returns:
            크롤링 실행 결과 요약
        """
        from playwright.async_api import async_playwright

        processed_urls = processed_urls or set()

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
                    user_agent=(
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/120.0.0.0 Safari/537.36"
                    ),
                )
                page = await context.new_page()

                # 1단계: 전체 상품 목록 수집
                all_products = await self._fetch_product_list(page)
                sly = all_products.get("Y", [])
                sln = all_products.get("N", [])
                total_found = len(sly) + len(sln)

                logger.info(
                    "[현대해상] 전체: 판매중=%d, 판매중지=%d, 합계=%d",
                    len(sly),
                    len(sln),
                    total_found,
                )

                if total_found == 0:
                    logger.error(
                        "[현대해상] 상품 목록이 비어있음. "
                        "페이지 구조 변경 또는 AJAX 캡처 실패."
                    )
                    return CrawlRunResult(
                        total_found=0,
                        new_count=0,
                        updated_count=0,
                        skipped_count=0,
                        failed_count=0,
                        results=[],
                    )

                # 2단계: Playwright 쿠키 추출 → httpx 설정
                cookie_str = await self._extract_cookies(context)
                http_headers = {
                    "Content-Type": "application/json",
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": _SERVICE_URL,
                    "Origin": _BASE_URL,
                    "User-Agent": (
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/120.0.0.0 Safari/537.36"
                    ),
                    "Cookie": cookie_str,
                }
                dl_headers = {
                    "User-Agent": http_headers["User-Agent"],
                    "Referer": _SERVICE_URL,
                    "Accept": "application/pdf,*/*",
                    "Cookie": cookie_str,
                }

                sem = asyncio.Semaphore(self.url_resolve_concurrency)

                # 3단계: 전체 UUID 수집 및 배치 URL 변환
                all_products_flat = [(p, "Y") for p in sly] + [(p, "N") for p in sln]
                uuids_with_prod: list[tuple[str, _Product]] = [
                    (p.clau_apnfl_id, p)
                    for p, _ in all_products_flat
                    if p.clau_apnfl_id
                ]
                skipped_count += (total_found - len(uuids_with_prod))  # UUID 없음 스킵

                logger.info(
                    "[현대해상] UUID 해결 대상: %d개 (동시 %d개)",
                    len(uuids_with_prod),
                    self.url_resolve_concurrency,
                )

                # 배치 크기로 나눠서 URL 해결 (서버 부하 방지)
                batch_size = 50
                uuid_to_info: dict[str, dict] = {}

                async with httpx.AsyncClient(
                    headers=http_headers, follow_redirects=True, timeout=30.0
                ) as api_client:
                    for i in range(0, len(uuids_with_prod), batch_size):
                        batch = uuids_with_prod[i : i + batch_size]
                        batch_uuids = [u for u, _ in batch]
                        batch_result = await self._resolve_uuid_batch(api_client, batch_uuids, sem)
                        uuid_to_info.update(batch_result)
                        resolved = len(batch_result)
                        total_resolved = len(uuid_to_info)
                        logger.info(
                            "[현대해상] URL 해결 진행: %d/%d (이번 배치 성공=%d)",
                            total_resolved,
                            len(uuids_with_prod),
                            resolved,
                        )
                        # 배치 간 짧은 대기
                        await asyncio.sleep(0.5)

                logger.info(
                    "[현대해상] URL 해결 완료: %d/%d",
                    len(uuid_to_info),
                    len(uuids_with_prod),
                )

                # 4단계: PDF 다운로드
                products_attempted = 0
                aborted = False

                async with httpx.AsyncClient(
                    headers=dl_headers, follow_redirects=True, timeout=60.0
                ) as dl_client:
                    for uuid, prod in uuids_with_prod:
                        if aborted:
                            break

                        file_info = uuid_to_info.get(uuid)
                        if not file_info:
                            logger.debug("[현대해상] URL 해결 실패 스킵: %s", uuid[:8])
                            failed_count += 1
                            products_attempted += 1
                            continue

                        pdf_url = self._build_pdf_url(file_info)
                        orig_nm = file_info.get("originalFileNm") or f"{uuid}.pdf"
                        filename = re.sub(r'[\\/:*?"<>|]', "_", orig_nm.split("/")[-1] or f"{uuid}.pdf")

                        # DB 기반 스킵 (이미 처리된 URL)
                        if pdf_url in processed_urls:
                            skipped_count += 1
                            logger.debug("[현대해상] 스킵(DB): %s", filename[:60])
                            continue

                        storage_path = self._get_storage_path(uuid, prod.sale_status, filename)

                        # 로컬 스토리지 기반 스킵 (이미 다운로드된 파일)
                        if self.storage.exists(storage_path):
                            skipped_count += 1
                            continue

                        # PDF 다운로드
                        try:
                            pdf_data = await self._download_pdf(dl_client, pdf_url)

                            if self._is_valid_pdf(pdf_data):
                                result_info = {
                                    "product_code": uuid,
                                    "product_name": prod.prod_nm,
                                    "sale_status": (
                                        SaleStatus.ON_SALE
                                        if prod.sale_status == "Y"
                                        else SaleStatus.DISCONTINUED
                                    ),
                                    "pdf_url": pdf_url,
                                    "filename": filename,
                                }
                                if on_download is not None:
                                    await on_download(pdf_data, result_info)
                                else:
                                    self.storage.save(pdf_data, storage_path)
                                    logger.debug(
                                        "[현대해상] 저장: %s (%d bytes)",
                                        filename[:60],
                                        len(pdf_data),
                                    )
                                new_count += 1
                                results.append({**result_info, "status": "downloaded"})
                            else:
                                failed_count += 1
                                logger.warning("[현대해상] PDF 무효: %s", pdf_url[-60:])

                        except Exception as e:
                            failed_count += 1
                            logger.error("[현대해상] 다운로드 오류 [%s]: %s", filename[:40], e)

                        products_attempted += 1

                        # 실패율 체크
                        if products_attempted >= self.fail_min_samples:
                            fail_rate = failed_count / max(products_attempted, 1)
                            if fail_rate > self.fail_threshold:
                                logger.error(
                                    "[현대해상] 실패율 %.1f%% > 임계값 %.1f%% "
                                    "(%d건 중 %d건 실패) → 수집 중단",
                                    fail_rate * 100,
                                    self.fail_threshold * 100,
                                    products_attempted,
                                    failed_count,
                                )
                                aborted = True
                                break

                        await asyncio.sleep(self.rate_limit_seconds)

                if aborted:
                    logger.error("[현대해상] 실패율 임계값 초과로 수집 중단됨.")

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
