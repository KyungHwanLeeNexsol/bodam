#!/usr/bin/env python3
"""손해보험 12개사 약관 PDF Playwright 크롤러 (SPEC-CRAWL-001)

SPA 기반 손해보험사 사이트에서 약관 PDF를 수집한다.
네트워크 요청 인터셉트 및 DOM 파싱을 통해 PDF 링크를 추출한다.

실행:
    cd backend && PYTHONPATH=. python scripts/crawl_nonlife.py

# @MX:NOTE: 손해보험 12개사는 SPA 기반 사이트 - Playwright 필수
# @MX:NOTE: headless=True 기본, 디버깅 시 HEADLESS=0 환경변수로 변경 가능
# @MX:SPEC: SPEC-CRAWL-001
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx

# Playwright 비동기 API
from playwright.async_api import (
    Page,
    Response,
    async_playwright,
)

from scripts.crawl_constants import NONLIFE_COMPANY_IDS, save_pdf_with_metadata

# =============================================================================
# UTF-8 출력 설정 (Windows 환경 대응)
# =============================================================================
if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]

# =============================================================================
# 로거 설정
# =============================================================================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)

# =============================================================================
# 경로 상수
# =============================================================================
# @MX:NOTE: BASE_DIR은 backend/data/, INSPECT_DIR은 디버깅용 HTML 저장 경로
BASE_DIR = Path(__file__).parent.parent / "data"
INSPECT_DIR = BASE_DIR / "nonlife_inspection"
BASE_DIR.mkdir(parents=True, exist_ok=True)
INSPECT_DIR.mkdir(parents=True, exist_ok=True)

REPORT_PATH = BASE_DIR / "nonlife_crawl_report.json"

# =============================================================================
# 크롤링 설정
# =============================================================================
HEADLESS = os.environ.get("HEADLESS", "1") != "0"
REQUEST_DELAY_SEC = 2.0    # 요청 간 딜레이 (초)
PAGE_TIMEOUT_MS = 30_000   # 페이지 로드 타임아웃 (밀리초)
MAX_RETRIES = 2             # 실패 시 재시도 횟수

# =============================================================================
# 회사별 약관 페이지 설정
# =============================================================================
# @MX:NOTE: 각 회사의 약관 페이지 URL 후보 목록 (우선순위 순)
COMPANY_CONFIGS: dict[str, dict[str, Any]] = {
    "samsung_fire": {
        "name": "삼성화재",
        "base_url": "https://www.samsungfire.com",
        "terms_paths": [
            "/consumer/commonprovisions/termsSearch.do",
            "/consumer/terms/list.do",
            "/terms/list.do",
        ],
        "click_selectors": ["button[type='submit']", ".btn-search", "#btnSearch"],
        "pdf_link_patterns": [".pdf", "fileDown", "download"],
    },
    "hyundai_marine": {
        "name": "현대해상",
        "base_url": "https://www.hi.co.kr",
        "terms_paths": [
            "/consumer/terms/list.do",
            "/customer/terms/index.do",
            "/consumer/termsInfo.do",
        ],
        "click_selectors": [".btn-search", "#btnSearch", "button[type='submit']"],
        "pdf_link_patterns": [".pdf", "fileDown", "download"],
    },
    "db_insurance": {
        "name": "DB손해보험",
        "base_url": "https://www.idbins.com",
        "terms_paths": [
            "/consumer/terms/list.do",
            "/consumer/terms/terms.do",
            "/termscls/listByKinds.do",
        ],
        "click_selectors": [".btn-search", "#btnSearch", "button[type='submit']"],
        "pdf_link_patterns": [".pdf", "fileDown", "download"],
    },
    "kb_insurance": {
        "name": "KB손해보험",
        "base_url": "https://www.kbinsure.co.kr",
        "terms_paths": [
            "/CG302000000.ec",
            "/CO011020000.ec",
            "/consumer/terms/list.do",
        ],
        "click_selectors": [".btn-search", "#btnSearch", "button[type='submit']"],
        "pdf_link_patterns": [".pdf", "fileDown", "download", ".ec"],
    },
    "meritz_fire": {
        "name": "메리츠화재",
        "base_url": "https://www.meritzfire.com",
        "terms_paths": [
            "/terms-clause/terms.html",
            "/terms/list.do",
            "/consumer/terms/list.do",
        ],
        "click_selectors": [".btn-search", "#btnSearch", "button[type='submit']"],
        "pdf_link_patterns": [".pdf", "fileDown", "download"],
    },
    "hanwha_general": {
        "name": "한화손해보험",
        "base_url": "https://www.hanwhainsurance.com",
        "fallback_base_urls": [
            "https://www.hanwhafire.com",
            "https://www.hwgeneralins.com",
        ],
        "terms_paths": [
            "/consumer/terms/list.do",
            "/terms/list.do",
            "/customer/terms/list.do",
        ],
        "click_selectors": [".btn-search", "#btnSearch", "button[type='submit']"],
        "pdf_link_patterns": [".pdf", "fileDown", "download"],
    },
    "heungkuk_fire": {
        "name": "흥국화재",
        "base_url": "https://www.heungkukfire.co.kr",
        "terms_paths": [
            "/consumer/terms/list.do",
            "/terms/list.do",
            "/customer/terms/list.do",
        ],
        "click_selectors": [".btn-search", "#btnSearch", "button[type='submit']"],
        "pdf_link_patterns": [".pdf", "fileDown", "download"],
    },
    "axa_general": {
        "name": "AXA손해보험",
        "base_url": "https://www.axa.co.kr",
        "terms_paths": [
            "/cui/consumer/terms.do",
            "/consumer/terms/list.do",
            "/terms/list.do",
        ],
        "click_selectors": [".btn-search", "#btnSearch", "button[type='submit']"],
        "pdf_link_patterns": [".pdf", "fileDown", "download"],
    },
    "hana_insurance": {
        "name": "하나손해보험",
        "base_url": "https://www.hana-insurance.co.kr",
        "terms_paths": [
            "/consumer/terms/list.do",
            "/terms/list.do",
            "/customer/terms/index.do",
        ],
        "click_selectors": [".btn-search", "#btnSearch", "button[type='submit']"],
        "pdf_link_patterns": [".pdf", "fileDown", "download"],
    },
    "mg_insurance": {
        "name": "MG손해보험",
        "base_url": "https://www.mgfire.co.kr",
        "fallback_base_urls": [
            "https://www.mg-ins.com",
            "https://www.mgi.co.kr",
        ],
        "terms_paths": [
            "/consumer/terms/list.do",
            "/terms/list.do",
            "/customer/terms/list.do",
        ],
        "click_selectors": [".btn-search", "#btnSearch", "button[type='submit']"],
        "pdf_link_patterns": [".pdf", "fileDown", "download"],
    },
    "nh_insurance": {
        "name": "NH농협손해보험",
        "base_url": "https://www.nhfire.co.kr",
        "terms_paths": [
            "/customer/terms/main.do",
            "/consumer/terms/list.do",
            "/terms/list.do",
        ],
        "click_selectors": [".btn-search", "#btnSearch", "button[type='submit']"],
        "pdf_link_patterns": [".pdf", "fileDown", "download"],
    },
    "lotte_insurance": {
        "name": "롯데손해보험",
        "base_url": "https://www.lotteins.co.kr",
        "terms_paths": [
            "/consumer/terms/list.do",
            "/terms/list.do",
            "/customer/terms/list.do",
        ],
        "click_selectors": [".btn-search", "#btnSearch", "button[type='submit']"],
        "pdf_link_patterns": [".pdf", "fileDown", "download"],
    },
}

# =============================================================================
# 헬퍼 함수
# =============================================================================


def is_pdf_url(url: str, patterns: list[str]) -> bool:
    """URL이 PDF 다운로드 링크인지 판별한다."""
    url_lower = url.lower()
    return any(p.lower() in url_lower for p in patterns)


async def save_html_for_inspection(page: Page, company_id: str) -> None:
    """디버깅용으로 렌더링된 HTML을 파일에 저장한다."""
    try:
        content = await page.content()
        html_path = INSPECT_DIR / f"{company_id}.html"
        html_path.write_text(content, encoding="utf-8")
        logger.info("[%s] HTML 저장 완료: %s", company_id, html_path)
    except Exception as exc:
        logger.warning("[%s] HTML 저장 실패: %s", company_id, exc)


async def download_pdf(
    url: str,
    company_id: str,
    product_name: str,
    company_name: str,
    http_client: httpx.AsyncClient,
    sale_status: str = "ON_SALE",
) -> dict[str, Any] | None:
    """PDF URL에서 파일을 다운로드하고 저장한다.

    # @MX:NOTE: httpx AsyncClient 재사용으로 커넥션 풀 최적화
    """
    try:
        response = await http_client.get(url, follow_redirects=True, timeout=30.0)
        if response.status_code != 200:
            logger.warning(
                "[%s] PDF 다운로드 실패 (HTTP %d): %s",
                company_id,
                response.status_code,
                url,
            )
            return None

        # Content-Type 확인
        content_type = response.headers.get("content-type", "")
        if "pdf" not in content_type.lower() and not url.lower().endswith(".pdf"):
            # 실제로 PDF인지 매직 바이트로 확인
            if not response.content.startswith(b"%PDF"):
                logger.warning(
                    "[%s] PDF 아닌 응답 (content-type: %s): %s",
                    company_id,
                    content_type,
                    url,
                )
                return None

        result = save_pdf_with_metadata(
            data=response.content,
            company_id=company_id,
            company_name=company_name,
            product_name=product_name,
            product_type="약관",
            source_url=url,
            base_dir=BASE_DIR,
            sale_status=sale_status,
        )
        logger.info(
            "[%s] PDF 저장 완료: %s (%d bytes)",
            company_id,
            product_name,
            len(response.content),
        )
        return result

    except httpx.TimeoutException:
        logger.warning("[%s] PDF 다운로드 타임아웃: %s", company_id, url)
        return None
    except Exception as exc:
        logger.warning("[%s] PDF 다운로드 오류: %s - %s", company_id, url, exc)
        return None


def extract_product_name_from_url(url: str, fallback_index: int = 0) -> str:
    """URL에서 상품명을 추출하거나 기본값을 반환한다."""
    parsed = urlparse(url)
    path_parts = parsed.path.rstrip("/").split("/")
    # 파일명 부분에서 확장자 제거
    if path_parts:
        name = path_parts[-1]
        if "." in name:
            name = name.rsplit(".", 1)[0]
        if name and len(name) > 2:
            return name
    # 쿼리 파라미터에서 이름 관련 값 추출
    for param in ["prodNm", "product_nm", "termNm", "title", "fileName"]:
        if param in parsed.query:
            for part in parsed.query.split("&"):
                if part.startswith(f"{param}="):
                    value = part.split("=", 1)[1]
                    if value:
                        return value
    return f"약관_{fallback_index + 1}"


# =============================================================================
# 인터셉트 기반 PDF 링크 수집
# =============================================================================


async def collect_pdf_links_via_intercept(
    page: Page,
    url: str,
    pdf_patterns: list[str],
) -> list[str]:
    """네트워크 응답을 인터셉트하여 PDF 관련 URL을 수집한다.

    # @MX:ANCHOR: 네트워크 인터셉트의 핵심 함수 - 모든 회사 크롤링에서 호출
    # @MX:REASON: COMPANY_CONFIGS 기반으로 12개사 모두에서 사용됨
    """
    intercepted_urls: list[str] = []

    async def on_response(response: Response) -> None:
        """응답 URL이 PDF 패턴에 매칭되면 수집한다."""
        resp_url = response.url
        if is_pdf_url(resp_url, pdf_patterns):
            if resp_url not in intercepted_urls:
                intercepted_urls.append(resp_url)
                logger.info("  [인터셉트] PDF URL 발견: %s", resp_url)

    page.on("response", on_response)

    try:
        await page.goto(url, wait_until="networkidle", timeout=PAGE_TIMEOUT_MS)
    except Exception as exc:
        logger.warning("  페이지 로드 실패: %s - %s", url, exc)

    # 추가 대기: JS 렌더링 완료 기다림
    await asyncio.sleep(2)

    return intercepted_urls


async def collect_pdf_links_from_dom(
    page: Page,
    base_url: str,
    pdf_patterns: list[str],
) -> list[str]:
    """렌더링된 DOM에서 PDF 링크를 추출한다."""
    pdf_links: list[str] = []

    try:
        # 모든 a 태그의 href 수집
        hrefs = await page.evaluate(
            """() => {
                const links = [];
                document.querySelectorAll('a[href]').forEach(a => {
                    links.push(a.href);
                });
                return links;
            }"""
        )

        for href in hrefs:
            if href and is_pdf_url(href, pdf_patterns):
                full_url = urljoin(base_url, href)
                if full_url not in pdf_links:
                    pdf_links.append(full_url)

        # onclick에서 PDF 관련 함수 호출 추출
        onclick_patterns = await page.evaluate(
            """() => {
                const results = [];
                document.querySelectorAll('[onclick]').forEach(el => {
                    const onclick = el.getAttribute('onclick') || '';
                    results.push({onclick: onclick, text: el.textContent.trim()});
                });
                return results;
            }"""
        )

        for item in onclick_patterns:
            onclick = item.get("onclick", "")
            if "pdf" in onclick.lower() or "down" in onclick.lower() or "file" in onclick.lower():
                logger.debug("  onclick PDF 패턴 발견: %s", onclick[:100])

    except Exception as exc:
        logger.warning("  DOM PDF 링크 추출 오류: %s", exc)

    return pdf_links


async def try_click_discontinued_tab(page: Page, company_id: str) -> bool:
    """판매중지 탭을 찾아 클릭한다. 탭이 없으면 False 반환한다."""
    try:
        result = await page.evaluate("""() => {
            const candidates = document.querySelectorAll('a, li, button, span, div');
            for (const el of candidates) {
                const text = el.textContent.trim();
                if (text === '판매중지' || text === '판매 중지') {
                    el.click();
                    return true;
                }
            }
            return false;
        }""")
        if result:
            await asyncio.sleep(3)
            logger.info("  [%s] 판매중지 탭 클릭 성공", company_id)
        return bool(result)
    except Exception as exc:
        logger.debug("  [%s] 판매중지 탭 탐색 오류: %s", company_id, exc)
        return False


async def try_click_search_button(page: Page, selectors: list[str]) -> bool:
    """검색/조회 버튼을 찾아서 클릭한다.

    Returns:
        클릭 성공 여부
    """
    # 텍스트 기반 버튼 탐색 (전체조회, 검색, 조회)
    text_candidates = ["전체", "조회", "검색", "전체조회", "약관검색"]
    for text in text_candidates:
        try:
            button = page.get_by_role("button", name=text)
            if await button.count() > 0:
                await button.first.click()
                await asyncio.sleep(2)
                logger.info("  버튼 클릭 성공 (텍스트: '%s')", text)
                return True
        except Exception:
            pass

    # CSS 셀렉터 기반 탐색
    for selector in selectors:
        try:
            elements = await page.query_selector_all(selector)
            if elements:
                await elements[0].click()
                await asyncio.sleep(2)
                logger.info("  버튼 클릭 성공 (셀렉터: '%s')", selector)
                return True
        except Exception:
            pass

    return False


# =============================================================================
# 회사별 크롤링 함수
# =============================================================================


async def crawl_company(
    company_id: str,
    config: dict[str, Any],
    http_client: httpx.AsyncClient,
) -> dict[str, Any]:
    """단일 회사의 약관 PDF를 크롤링한다.

    # @MX:ANCHOR: 회사별 크롤링의 진입점 함수
    # @MX:REASON: crawl_all_companies에서 각 회사에 대해 호출됨
    """
    company_name = config["name"]
    pdf_patterns = config.get("pdf_link_patterns", [".pdf", "fileDown", "download"])
    click_selectors = config.get("click_selectors", [])

    # 시도할 base_url 목록 구성
    base_urls = [config["base_url"]]
    base_urls.extend(config.get("fallback_base_urls", []))

    result: dict[str, Any] = {
        "company_id": company_id,
        "company_name": company_name,
        "status": "failed",
        "pdf_count": 0,
        "saved_files": [],
        "errors": [],
    }

    logger.info("=" * 60)
    logger.info("[%s] %s 크롤링 시작", company_id, company_name)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=HEADLESS)
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            ignore_https_errors=True,
        )
        page = await context.new_page()
        page.set_default_timeout(PAGE_TIMEOUT_MS)

        all_pdf_urls: list[str] = []
        on_sale_boundary: int = -1  # -1: 판매중지 탭 미클릭 (전체 ON_SALE)
        found_page = False

        for base_url in base_urls:
            if found_page:
                break

            for terms_path in config.get("terms_paths", []):
                full_url = base_url + terms_path

                for attempt in range(MAX_RETRIES):
                    try:
                        logger.info(
                            "  [%s] 시도 %d/%d: %s",
                            company_id,
                            attempt + 1,
                            MAX_RETRIES,
                            full_url,
                        )

                        # 네트워크 인터셉트로 PDF URL 수집
                        intercepted = await collect_pdf_links_via_intercept(
                            page, full_url, pdf_patterns
                        )
                        all_pdf_urls.extend(intercepted)

                        # 버튼 클릭 시도 후 추가 수집
                        await try_click_search_button(page, click_selectors)
                        await asyncio.sleep(1)

                        # DOM에서 PDF 링크 추출
                        dom_links = await collect_pdf_links_from_dom(
                            page, base_url, pdf_patterns
                        )
                        for link in dom_links:
                            if link not in all_pdf_urls:
                                all_pdf_urls.append(link)

                        # 판매중지 탭 클릭 후 추가 PDF 링크 수집
                        pre_disc_count = len(all_pdf_urls)
                        discontinued = await try_click_discontinued_tab(page, company_id)
                        if discontinued:
                            on_sale_boundary = pre_disc_count
                            disc_links = await collect_pdf_links_from_dom(
                                page, base_url, pdf_patterns
                            )
                            for link in disc_links:
                                if link not in all_pdf_urls:
                                    all_pdf_urls.append(link)
                            logger.info(
                                "  [%s] 판매중지 탭에서 PDF %d개 추가",
                                company_id,
                                len(disc_links),
                            )

                        # HTML 저장 (디버깅용)
                        await save_html_for_inspection(page, company_id)

                        if all_pdf_urls:
                            found_page = True
                            logger.info(
                                "  [%s] PDF URL %d개 발견", company_id, len(all_pdf_urls)
                            )
                        else:
                            logger.info("  [%s] PDF URL 없음: %s", company_id, full_url)

                        break  # 성공 시 재시도 루프 종료

                    except Exception as exc:
                        logger.warning(
                            "  [%s] 오류 (시도 %d): %s",
                            company_id,
                            attempt + 1,
                            exc,
                        )
                        if attempt < MAX_RETRIES - 1:
                            await asyncio.sleep(REQUEST_DELAY_SEC)
                        else:
                            result["errors"].append(str(exc))

                if found_page and all_pdf_urls:
                    break  # 해당 base_url에서 성공하면 다음 URL 시도 안 함

        await context.close()
        await browser.close()

    # PDF 다운로드
    if all_pdf_urls:
        logger.info("[%s] PDF 다운로드 시작 (%d개)", company_id, len(all_pdf_urls))
        for idx, pdf_url in enumerate(all_pdf_urls):
            product_name = extract_product_name_from_url(pdf_url, idx)
            pdf_status = "ON_SALE" if on_sale_boundary < 0 or idx < on_sale_boundary else "DISCONTINUED"
            save_result = await download_pdf(
                url=pdf_url,
                company_id=company_id,
                product_name=product_name,
                company_name=company_name,
                http_client=http_client,
                sale_status=pdf_status,
            )
            if save_result:
                result["saved_files"].append(save_result)
            await asyncio.sleep(REQUEST_DELAY_SEC)

        result["pdf_count"] = len(result["saved_files"])
        result["status"] = "success" if result["pdf_count"] > 0 else "no_pdfs"
    else:
        result["status"] = "no_pdfs"
        logger.info("[%s] PDF를 찾을 수 없음", company_id)

    logger.info(
        "[%s] 완료 - 상태: %s, PDF: %d개",
        company_id,
        result["status"],
        result["pdf_count"],
    )
    return result


# =============================================================================
# 전체 크롤링 오케스트레이션
# =============================================================================


async def crawl_all_companies(
    target_ids: list[str] | None = None,
) -> dict[str, Any]:
    """12개 손해보험사 전체 크롤링을 실행한다.

    Args:
        target_ids: 특정 회사만 크롤링할 경우 company_id 목록. None이면 전체 실행.

    Returns:
        전체 크롤링 결과 dict
    """
    ids_to_crawl = target_ids or NONLIFE_COMPANY_IDS

    # 설정에 없는 company_id는 경고 후 스킵
    valid_ids = [cid for cid in ids_to_crawl if cid in COMPANY_CONFIGS]
    skipped = set(ids_to_crawl) - set(valid_ids)
    if skipped:
        logger.warning("설정 없는 company_id 스킵: %s", skipped)

    overall_report: dict[str, Any] = {
        "crawled_at": __import__("datetime").datetime.now().isoformat(),
        "total_companies": len(valid_ids),
        "success_count": 0,
        "no_pdfs_count": 0,
        "failed_count": 0,
        "total_pdfs": 0,
        "results": [],
    }

    # httpx AsyncClient 재사용으로 커넥션 풀 활용
    async with httpx.AsyncClient(
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            )
        },
        follow_redirects=True,
        timeout=30.0,
    ) as http_client:
        for company_id in valid_ids:
            config = COMPANY_CONFIGS[company_id]
            try:
                result = await crawl_company(company_id, config, http_client)
            except Exception as exc:
                logger.error("[%s] 치명적 오류: %s", company_id, exc)
                result = {
                    "company_id": company_id,
                    "company_name": config.get("name", company_id),
                    "status": "failed",
                    "pdf_count": 0,
                    "saved_files": [],
                    "errors": [str(exc)],
                }

            overall_report["results"].append(result)

            # 통계 집계
            if result["status"] == "success":
                overall_report["success_count"] += 1
            elif result["status"] == "no_pdfs":
                overall_report["no_pdfs_count"] += 1
            else:
                overall_report["failed_count"] += 1
            overall_report["total_pdfs"] += result.get("pdf_count", 0)

            # 회사 간 딜레이
            await asyncio.sleep(REQUEST_DELAY_SEC)

    return overall_report


def save_report(report: dict[str, Any]) -> None:
    """크롤링 결과 리포트를 JSON 파일로 저장한다."""
    REPORT_PATH.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    logger.info("리포트 저장 완료: %s", REPORT_PATH)


def print_summary(report: dict[str, Any]) -> None:
    """크롤링 결과 요약을 콘솔에 출력한다."""
    print("\n" + "=" * 60)
    print("손해보험 약관 크롤링 결과 요약")
    print("=" * 60)
    print(f"총 회사 수: {report['total_companies']}")
    print(f"성공 (PDF 수집): {report['success_count']}")
    print(f"PDF 없음: {report['no_pdfs_count']}")
    print(f"실패: {report['failed_count']}")
    print(f"총 PDF 수: {report['total_pdfs']}")
    print("-" * 60)

    for result in report.get("results", []):
        status_icon = {
            "success": "[성공]",
            "no_pdfs": "[없음]",
            "failed": "[실패]",
        }.get(result["status"], "[?]")
        print(
            f"  {status_icon} {result['company_name']} ({result['company_id']}): "
            f"PDF {result['pdf_count']}개"
        )
        if result.get("errors"):
            for err in result["errors"][:2]:  # 최대 2개 오류만 출력
                print(f"         오류: {err[:80]}")

    print("=" * 60)
    print(f"리포트 파일: {REPORT_PATH}")


# =============================================================================
# 엔트리포인트
# =============================================================================


async def main() -> None:
    """메인 실행 함수."""
    import argparse

    parser = argparse.ArgumentParser(description="손해보험 12개사 약관 PDF 크롤러")
    parser.add_argument(
        "--companies",
        nargs="*",
        help="크롤링할 company_id 목록 (기본: 전체)",
        choices=list(COMPANY_CONFIGS.keys()),
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        default=True,
        help="headless 모드로 실행 (기본: True)",
    )
    args = parser.parse_args()

    # 환경변수로도 headless 제어 가능
    global HEADLESS
    HEADLESS = args.headless or (os.environ.get("HEADLESS", "1") != "0")

    logger.info("손해보험 약관 크롤러 시작 (headless=%s)", HEADLESS)
    logger.info("대상 회사: %s", args.companies or "전체 12개사")

    start_time = time.time()
    report = await crawl_all_companies(target_ids=args.companies)
    elapsed = time.time() - start_time

    report["elapsed_seconds"] = round(elapsed, 2)
    save_report(report)
    print_summary(report)

    logger.info("크롤링 완료 (소요시간: %.1f초)", elapsed)


if __name__ == "__main__":
    asyncio.run(main())
