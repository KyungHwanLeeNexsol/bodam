#!/usr/bin/env python3
"""비생명보험사 Playwright 기반 약관 PDF 크롤러

11개 손해보험사 웹사이트에서 질병/상해 관련 보험약관 PDF를 수집한다.
삼성화재(API 방식)와 하나손해보험(사이트 다운)은 제외.

실행:
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python scripts/crawl_nonlife_playwright.py
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python scripts/crawl_nonlife_playwright.py --company hyundai_marine

# @MX:NOTE: Playwright 기반 SPA 크롤러 - 각 사이트마다 다른 접근법이 필요함
# @MX:NOTE: 네트워크 응답 인터셉트 패턴을 사용하여 PDF URL 또는 API 엔드포인트를 탐지
# @MX:WARN: 각 보험사 사이트마다 JavaScript 실행 방식, 인코딩, 로딩 방식이 다름
# @MX:REASON: SPA 사이트는 HTML 파싱만으로 데이터를 얻을 수 없어 브라우저 자동화가 필요
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)

# 현재 스크립트 기준으로 경로 설정
SCRIPT_DIR = Path(__file__).parent
BASE_DATA_DIR = SCRIPT_DIR.parent / "data"

# 크롤링 대상 회사 정보
# @MX:NOTE: hana_insurance 제외 (사이트 다운 확인됨)
COMPANY_CONFIG: dict[str, dict[str, Any]] = {
    "hyundai_marine": {
        "name": "현대해상",
        "url": "https://www.hi.co.kr",
        "method": "hyundai_marine",
    },
    "db_insurance": {
        "name": "DB손해보험",
        "url": "https://www.idbins.com/FWMAIV1534.do",
        "method": "db_insurance",
    },
    "kb_insurance": {
        "name": "KB손해보험",
        "url": "https://www.kbinsure.co.kr",
        "method": "kb_insurance",
    },
    "meritz_fire": {
        "name": "메리츠화재",
        "url": "https://www.meritzfire.com/customer/publicTerms/list.do",
        "method": "meritz_fire",
    },
    "hanwha_general": {
        "name": "한화손해보험",
        "url": "https://www.hwgeneralins.com",
        "method": "hanwha_general",
    },
    "heungkuk_fire": {
        "name": "흥국화재",
        "url": "https://www.heungkukfire.co.kr/consumer/terms/list.do",
        "method": "heungkuk_fire",
    },
    "axa_general": {
        "name": "AXA손해보험",
        "url": "https://www.axa.co.kr/cui/",
        "method": "axa_general",
    },
    "mg_insurance": {
        "name": "MG손해보험",
        "url": "https://www.yebyeol.co.kr/PB031210DM.scp",
        "method": "mg_insurance",
    },
    "nh_fire": {
        "name": "NH농협손해보험",
        "url": "https://www.nhfire.co.kr",
        "method": "nh_fire",
    },
    "lotte_insurance": {
        "name": "롯데손해보험",
        "url": "https://www.lotteins.co.kr",
        "method": "lotte_insurance",
    },
    # nh_insurance는 nh_fire의 별칭
    "nh_insurance": {
        "name": "NH농협손해보험",
        "url": "https://www.nhfire.co.kr",
        "method": "nh_fire",
    },
}

# 질병/상해 관련 키워드
DISEASE_INJURY_KEYWORDS = [
    "질병", "상해", "건강", "암", "치아", "치매", "간병", "실손", "의료", "종합",
    "상해보험", "건강보험", "질병보험", "의료보험",
]

# 제외 키워드
EXCLUDE_KEYWORDS = [
    "자동차", "화재", "보증", "책임", "배상", "운전자", "해상보험", "항공", "펫",
]

# 페이지 로딩 대기 시간 (초)
PAGE_TIMEOUT = 30_000  # 30초 (ms)
NETWORK_IDLE_TIMEOUT = 10_000  # 10초 (ms)


def is_disease_injury(text: str) -> bool:
    """텍스트에 질병/상해 관련 키워드가 포함되어 있는지 확인한다."""
    for kw in EXCLUDE_KEYWORDS:
        if kw in text:
            return False
    for kw in DISEASE_INJURY_KEYWORDS:
        if kw in text:
            return True
    return False


def save_pdf(
    data: bytes,
    company_id: str,
    company_name: str,
    product_name: str,
    product_category: str,
    source_url: str,
    sale_status: str = "ON_SALE",
) -> dict[str, Any]:
    """PDF 파일을 저장하고 메타데이터를 기록한다.

    # @MX:ANCHOR: 모든 회사 크롤러가 공통으로 사용하는 PDF 저장 함수
    # @MX:REASON: 각 회사 크롤러 메서드에서 직접 호출됨 (fan_in >= 5)
    """
    import hashlib
    from datetime import datetime, timezone

    company_dir = BASE_DATA_DIR / company_id
    company_dir.mkdir(parents=True, exist_ok=True)

    # 파일명 생성
    safe_name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", product_name.strip())
    safe_name = safe_name.strip(".").strip()[:80] or "unknown"
    file_hash = hashlib.sha256(data).hexdigest()
    file_name = f"{safe_name}.pdf"
    file_path = company_dir / file_name

    # 중복 처리
    if file_path.exists():
        existing_hash = hashlib.sha256(file_path.read_bytes()).hexdigest()
        if existing_hash == file_hash:
            logger.info("  [중복 스킵] %s (동일 파일 이미 존재)", file_name)
            return {"skipped": True, "file_path": str(file_path)}
        file_name = f"{safe_name}_{file_hash[:8]}.pdf"
        file_path = company_dir / file_name

    file_path.write_bytes(data)

    metadata = {
        "company_id": company_id,
        "company_name": company_name,
        "product_name": product_name,
        "product_type": product_category,
        "product_category": product_category,
        "source_url": source_url,
        "file_path": f"{company_id}/{file_name}",
        "file_hash": f"sha256:{file_hash}",
        "sale_status": sale_status,
        "crawled_at": datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+09:00"),
        "file_size_bytes": len(data),
    }

    meta_path = file_path.with_suffix(".json")
    meta_path.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    logger.info(
        "  [저장완료] %s (%d bytes)",
        file_path.name,
        len(data),
    )
    return {"file_path": str(file_path), "metadata": metadata}


async def download_pdf_bytes(url: str, context: Any) -> bytes | None:
    """Playwright context를 통해 PDF를 다운로드한다."""
    try:
        page = await context.new_page()
        try:
            response = await page.request.get(url, timeout=30_000)
            if response.ok:
                return await response.body()
            logger.warning("  PDF 다운로드 실패 (status=%d): %s", response.status, url)
            return None
        finally:
            await page.close()
    except Exception as exc:
        logger.warning("  PDF 다운로드 오류: %s -> %s", url, exc)
        return None


async def try_click_discontinued_tab_pl(page: Any, company_name: str) -> bool:
    """판매중지 탭을 찾아 클릭한다. 응답 인터셉트 활성 상태에서 호출해야 효과 있음.

    # @MX:NOTE: 클릭 성공 시 3초 대기하여 새로운 API 응답 캡처 시간 확보

    Returns:
        True: 판매중지 탭 클릭 성공, False: 탭 미발견 또는 클릭 실패
    """
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
            logger.info("[%s] 판매중지 탭 클릭 성공", company_name)
            return True
        return False
    except Exception as exc:
        logger.debug("[%s] 판매중지 탭 탐색 오류: %s", company_name, exc)
        return False


# =============================================================================
# 현대해상 크롤러
# =============================================================================

async def crawl_hyundai_marine(context: Any) -> int:
    """현대해상 약관 PDF를 수집한다.

    SPA 사이트에서 약관 전용 API를 탐색하고 PDF를 다운로드한다.
    ajax.xhi 패턴과 직접 약관 페이지 탐색을 병행한다.

    # @MX:NOTE: 현대해상은 onclick="fn_goMenu('100931')" 패턴으로 메뉴 이동
    # @MX:NOTE: PDF URL 패턴: /data/PM/.../*.pdf
    # @MX:NOTE: AJAX 요청 패턴: ajax.xhi 또는 /ajax/*.do
    """
    company_id = "hyundai_marine"
    company_name = "현대해상"
    downloaded = 0
    found_pdfs: list[dict] = []
    all_requests: list[str] = []

    # 네트워크 응답 인터셉트
    async def on_response(response: Any) -> None:
        url = response.url
        # 정적 에셋 제외
        if any(ext in url.lower() for ext in [".css", ".png", ".jpg", ".gif", ".ico", ".woff", ".svg"]):
            return
        # PDF 직접 링크
        if url.lower().endswith(".pdf") or "/data/PM/" in url or "/pdf/" in url.lower():
            found_pdfs.append({"type": "pdf", "url": url})
            logger.info("[현대해상] PDF URL 탐지: %s", url)
            return

        # 모든 API 요청 기록 (디버깅용)
        if any(x in url for x in [".do", ".json", "ajax", "api"]):
            all_requests.append(url)

        # JSON/XML API 응답 탐색
        ct = response.headers.get("content-type", "")
        if "json" in ct or "xml" in ct or "text/plain" in ct:
            try:
                body = await response.body()
                if len(body) > 200:
                    text = body.decode("utf-8", errors="ignore")
                    # 약관 관련 데이터 탐지 (더 넓은 범위)
                    if any(kw in text for kw in ["fileNm", "filePath", "pdfUrl", "약관", "yakgwan", ".pdf", "PM/", "insur"]):
                        try:
                            data = json.loads(text)
                            found_pdfs.append({"type": "json", "url": url, "data": data})
                            logger.info("[현대해상] JSON 약관 데이터 탐지: %s (%d bytes)", url, len(body))
                        except Exception:
                            # XML 또는 일반 텍스트도 처리
                            if ".pdf" in text.lower():
                                pdf_matches = re.findall(r'https?://[^\s"<>]+\.pdf', text, re.IGNORECASE)
                                for pm in pdf_matches:
                                    found_pdfs.append({"type": "pdf", "url": pm})
            except Exception:
                pass

    page = await context.new_page()
    page.on("response", on_response)

    try:
        logger.info("[현대해상] 메인 페이지 로딩...")
        await page.goto("https://www.hi.co.kr", timeout=PAGE_TIMEOUT, wait_until="domcontentloaded")
        await asyncio.sleep(3)

        # fn_goMenu 함수로 공시실(100931) 이동 시도
        logger.info("[현대해상] 공시실 메뉴 이동 시도...")
        for menu_id in ["100931", "100930", "100932", "100933"]:
            try:
                await page.evaluate(f"fn_goMenu('{menu_id}')")
                await asyncio.sleep(2)
                content = await page.content()
                if any(kw in content for kw in ["약관", "보험약관"]):
                    logger.info("[현대해상] 약관 페이지 발견 (menu_id=%s)", menu_id)
                    break
            except Exception:
                pass

        await asyncio.sleep(2)

        # 약관 관련 네비게이션 직접 클릭
        await page.evaluate("""
            () => {
                const els = Array.from(document.querySelectorAll('a, button, li, span'));
                for (const el of els) {
                    const text = el.textContent.trim();
                    if (text === '보험약관' || text === '약관' || text.includes('약관조회')) {
                        el.click();
                        break;
                    }
                }
            }
        """)
        await asyncio.sleep(3)

        # 약관 전용 URL 시도 + AJAX 엔드포인트 탐색
        term_urls = [
            "https://www.hi.co.kr/cms/display.do?menuId=100931",
            "https://www.hi.co.kr/hi/customer/publicTerms.do",
            "https://www.hi.co.kr/about/publicTerms.do",
            "https://www.hi.co.kr/customer/publicTerms.do",
        ]
        for turl in term_urls:
            try:
                await page.goto(turl, timeout=PAGE_TIMEOUT, wait_until="domcontentloaded")
                await asyncio.sleep(3)
                content = await page.content()
                if any(kw in content for kw in ["약관", "보험약관"]) and len(content) > 2000:
                    logger.info("[현대해상] 약관 페이지 접근 성공: %s", turl)

                    # 카테고리 탐색
                    for cat in ["건강", "상해", "질병", "종합"]:
                        await page.evaluate(f"""
                            () => {{
                                Array.from(document.querySelectorAll('button, a, li, td, span')).forEach(el => {{
                                    if (el.textContent.trim() === '{cat}' || el.textContent.trim().includes('{cat}')) {{
                                        el.click();
                                    }}
                                }});
                            }}
                        """)
                        await asyncio.sleep(2)

                    # 더보기/페이지네이션 클릭
                    for _ in range(5):
                        more_clicked = await page.evaluate("""
                            () => {
                                const btns = Array.from(document.querySelectorAll('button, a'));
                                for (const btn of btns) {
                                    const text = btn.textContent.trim();
                                    if (text === '더보기' || text === '다음' || text.includes('more')) {
                                        btn.click();
                                        return true;
                                    }
                                }
                                return false;
                            }
                        """)
                        if more_clicked:
                            await asyncio.sleep(2)
                        else:
                            break
                    break
            except Exception as exc:
                logger.warning("[현대해상] URL 접근 실패: %s -> %s", turl, exc)

        # 페이지에서 PDF 링크 수집
        logger.info("[현대해상] 페이지에서 약관 링크 탐색...")
        links = await page.evaluate("""
            () => {
                const results = [];
                document.querySelectorAll('a[href], [onclick]').forEach(el => {
                    const href = el.getAttribute('href') || '';
                    const onclick = el.getAttribute('onclick') || '';
                    const text = (el.textContent || '').trim();
                    if (href.toLowerCase().endsWith('.pdf') || href.includes('/PM/') ||
                        href.includes('/pdf/') || onclick.toLowerCase().includes('.pdf') ||
                        onclick.includes('download') || onclick.includes('Down')) {
                        results.push({href, onclick, text});
                    }
                });
                return results;
            }
        """)

        logger.info("[현대해상] 발견된 약관 링크: %d개", len(links))
        for link in links[:50]:
            href = link.get("href", "")
            if href and (href.lower().endswith(".pdf") or "/PM/" in href):
                pdf_url = urljoin("https://www.hi.co.kr", href)
                found_pdfs.append({"type": "pdf_link", "url": pdf_url, "text": link.get("text", "")})

        # 판매중지 탭 클릭 전 경계 기록
        on_sale_boundary = len(found_pdfs)
        # 판매중지 탭 클릭 시도 (응답 인터셉트가 활성화된 상태)
        await try_click_discontinued_tab_pl(page, company_name)

        # 발견된 PDF 처리
        seen_urls: set[str] = set()
        for idx, item in enumerate(found_pdfs):
            status = "ON_SALE" if idx < on_sale_boundary else "DISCONTINUED"
            if item["type"] in ("pdf", "pdf_link"):
                pdf_url = item["url"]
                if pdf_url in seen_urls:
                    continue
                seen_urls.add(pdf_url)

                product_name = item.get("text", "") or Path(urlparse(pdf_url).path).stem
                if not product_name:
                    product_name = "약관"

                logger.info("[현대해상] PDF 다운로드: %s", pdf_url)
                data_bytes = await download_pdf_bytes(pdf_url, context)
                if data_bytes and len(data_bytes) > 1000:
                    result = save_pdf(
                        data=data_bytes,
                        company_id=company_id,
                        company_name=company_name,
                        product_name=product_name,
                        product_category="약관",
                        source_url=pdf_url,
                        sale_status=status,
                    )
                    if not result.get("skipped"):
                        downloaded += 1
                await asyncio.sleep(1)

            elif item["type"] == "json":
                data = item.get("data", {})
                pdf_links = extract_pdf_links_from_json(data, "https://www.hi.co.kr")
                for pdf_info in pdf_links:
                    if pdf_info["url"] in seen_urls:
                        continue
                    if not is_disease_injury(pdf_info["name"]):
                        continue
                    seen_urls.add(pdf_info["url"])
                    data_bytes = await download_pdf_bytes(pdf_info["url"], context)
                    if data_bytes and len(data_bytes) > 1000:
                        result = save_pdf(
                            data=data_bytes,
                            company_id=company_id,
                            company_name=company_name,
                            product_name=pdf_info["name"],
                            product_category=pdf_info.get("category", "약관"),
                            source_url=pdf_info["url"],
                        )
                        if not result.get("skipped"):
                            downloaded += 1
                    await asyncio.sleep(1)

        # 현대해상 약관 전용 페이지 추가 탐색
        if downloaded == 0:
            logger.info("[현대해상] 보험약관 서브페이지 탐색...")
            # 공시자료 약관 전용 탭 구조 탐색
            # 약관 정보는 하위 메뉴에서 AJAX로 로드됨 - 직접 URL 접근 시도
            extra_urls = [
                "https://www.hi.co.kr/cms/display.do?menuId=100932",
                "https://www.hi.co.kr/cms/display.do?menuId=100933",
                "https://www.hi.co.kr/cms/display.do?menuId=100934",
                "https://www.hi.co.kr/cms/display.do?menuId=100935",
                "https://www.hi.co.kr/cms/display.do?menuId=100936",
            ]
            for extra_url in extra_urls:
                try:
                    await page.goto(extra_url, timeout=PAGE_TIMEOUT, wait_until="domcontentloaded")
                    await asyncio.sleep(2)
                    # goPdfFileView 호출 패턴 탐색
                    pdf_elements = await page.evaluate("""
                        () => {
                            const results = [];
                            document.querySelectorAll('[onclick*="goPdfFileView"]').forEach(el => {
                                const m = el.getAttribute('onclick').match(/goPdfFileView\\(['"]([^'"]+)['"]\\)/);
                                if (m) results.push({path: m[1], text: el.textContent.trim()});
                            });
                            return results;
                        }
                    """)
                    for item in pdf_elements:
                        path = item["path"]
                        text = item["text"]
                        if is_disease_injury(text) or "상해" in path or "건강" in path or "질병" in path:
                            pdf_url = urljoin("https://www.hi.co.kr", path)
                            if pdf_url not in seen_urls:
                                seen_urls.add(pdf_url)
                                data_bytes = await download_pdf_bytes(pdf_url, context)
                                if data_bytes and len(data_bytes) > 1000:
                                    result = save_pdf(
                                        data=data_bytes,
                                        company_id=company_id,
                                        company_name=company_name,
                                        product_name=text or Path(urlparse(pdf_url).path).stem,
                                        product_category="약관",
                                        source_url=pdf_url,
                                    )
                                    if not result.get("skipped"):
                                        downloaded += 1
                                await asyncio.sleep(1)
                except Exception as exc:
                    logger.debug("[현대해상] 서브페이지 접근 실패: %s -> %s", extra_url, exc)

        if downloaded == 0:
            logger.info("[현대해상] 캡처된 API 요청 목록 (%d개):", len(all_requests))
            for req in all_requests[:20]:
                logger.info("  %s", req)
            logger.info("[현대해상] 참고: 현대해상 약관은 동적 로딩 방식으로 직접 크롤링 어려움")
            logger.info("[현대해상] 대안: https://www.hi.co.kr/cms/display.do?menuId=100931 수동 확인 필요")

    finally:
        await page.close()

    logger.info("[현대해상] 총 %d개 PDF 수집 완료", downloaded)
    return downloaded


# =============================================================================
# DB손해보험 크롤러
# =============================================================================

async def crawl_db_insurance(context: Any) -> int:
    """DB손해보험 약관 PDF를 수집한다.

    보험약관 기초서류 페이지에서 건강/상해/질병 카테고리를 클릭하여
    AJAX로 약관 목록을 가져온 후 PDF를 다운로드한다.

    # @MX:NOTE: DB손해보험 약관 다운로드 URL: /cYakgwanDown.do?FilePath=InsProduct/{BIZ_MDDC_FINM}
    # @MX:NOTE: 단계별 상품 선택 UI를 통해 약관 목록 탐색
    """
    company_id = "db_insurance"
    company_name = "DB손해보험"
    downloaded = 0
    found_items: list[dict] = []

    all_responses: list[dict] = []

    async def on_response(response: Any) -> None:
        url = response.url
        if any(ext in url.lower() for ext in [".css", ".png", ".jpg", ".gif", ".ico", ".woff", ".svg"]):
            return
        ct = response.headers.get("content-type", "")
        if url.lower().endswith(".pdf"):
            found_items.append({"type": "pdf", "url": url})
            return
        if "json" in ct or "text" in ct or ".do" in url or "ajax" in url.lower():
            try:
                body = await response.body()
                if len(body) > 100:
                    text = body.decode("utf-8", errors="ignore")
                    all_responses.append({"url": url, "size": len(body), "snippet": text[:200]})
                    try:
                        data = json.loads(text)
                        data_str = json.dumps(data, ensure_ascii=False)
                        if any(kw in data_str for kw in ["SQNO", "BIZ_MDDC_FINM", "yakgwan", "약관", "fileNm", "FilePath", ".pdf"]):
                            found_items.append({"url": url, "data": data})
                            logger.info("[DB손해보험] 약관 데이터 API 탐지: %s (%d bytes)", url, len(body))
                    except Exception:
                        if ".pdf" in text.lower():
                            pdf_matches = re.findall(r'https?://[^\s"<>]+\.pdf', text, re.IGNORECASE)
                            for pm in pdf_matches:
                                found_items.append({"type": "pdf", "url": pm})
            except Exception:
                pass

    page = await context.new_page()
    page.on("response", on_response)

    try:
        logger.info("[DB손해보험] 약관 페이지 로딩...")
        await page.goto("https://www.idbins.com/FWMAIV1534.do", timeout=PAGE_TIMEOUT, wait_until="networkidle")
        await asyncio.sleep(4)

        # 현재 페이지 내용 확인
        content = await page.content()
        logger.info("[DB손해보험] 페이지 로드됨 (%d bytes)", len(content))

        # 단계별 카테고리 선택 (스텝1: 보험종류 선택)
        # 먼저 전체 버튼/선택 요소 파악
        buttons_info = await page.evaluate("""
            () => {
                const results = [];
                document.querySelectorAll('button, input[type="button"], a.btn, li.step-item, .category-item').forEach(el => {
                    const text = el.textContent.trim();
                    const id = el.id || '';
                    const cls = el.className || '';
                    if (text) results.push({text: text.substring(0, 50), id, cls: cls.substring(0, 50)});
                });
                return results.slice(0, 30);
            }
        """)
        logger.info("[DB손해보험] 버튼/항목 목록: %s", json.dumps(buttons_info, ensure_ascii=False))

        # 카테고리 클릭 순서: 보험종류 먼저, 그 다음 건강/상해 선택
        categories = ["건강", "상해", "질병", "종합", "의료", "실손"]
        for cat in categories:
            logger.info("[DB손해보험] '%s' 카테고리 클릭 시도...", cat)
            try:
                clicked = await page.evaluate(f"""
                    () => {{
                        const els = Array.from(document.querySelectorAll('button, a, li, td, th, span, div.item, div.menu'));
                        for (const el of els) {{
                            const text = el.textContent.trim();
                            if (text === '{cat}') {{
                                el.click();
                                return true;
                            }}
                        }}
                        // 더 넓은 범위
                        for (const el of els) {{
                            if (el.textContent.trim().includes('{cat}') && el.children.length === 0) {{
                                el.click();
                                return true;
                            }}
                        }}
                        return false;
                    }}
                """)
                if clicked:
                    await asyncio.sleep(2)
            except Exception as exc:
                logger.debug("[DB손해보험] 카테고리 '%s' 클릭 실패: %s", cat, exc)

        # 약관 목록 조회 버튼 클릭
        await page.evaluate("""
            () => {
                const btns = Array.from(document.querySelectorAll('button, input[type="button"], a.btn'));
                for (const btn of btns) {
                    const text = btn.textContent.trim();
                    if (text.includes('조회') || text.includes('검색') || text.includes('확인')) {
                        btn.click();
                        break;
                    }
                }
            }
        """)
        await asyncio.sleep(3)

        # 판매중지 탭 클릭 전 경계 기록
        on_sale_boundary = len(found_items)
        # 판매중지 탭 클릭 시도
        await try_click_discontinued_tab_pl(page, company_name)

        # 발견된 JSON에서 약관 파일 정보 추출
        seen_files: set[str] = set()
        for idx_item, item in enumerate(found_items):
            item_status = "ON_SALE" if idx_item < on_sale_boundary else "DISCONTINUED"
            if item.get("type") == "pdf":
                url = item["url"]
                if url not in seen_files:
                    seen_files.add(url)
                    name = Path(urlparse(url).path).stem
                    data_bytes = await download_pdf_bytes(url, context)
                    if data_bytes and len(data_bytes) > 1000:
                        result = save_pdf(
                            data=data_bytes,
                            company_id=company_id,
                            company_name=company_name,
                            product_name=name,
                            product_category="약관",
                            source_url=url,
                            sale_status=item_status,
                        )
                        if not result.get("skipped"):
                            downloaded += 1
                    await asyncio.sleep(1)
                continue

            data = item.get("data", {})
            # DB손해보험 특유의 데이터 구조 처리
            items_list = []
            if isinstance(data, list):
                items_list = data
            elif isinstance(data, dict):
                for key in ["list", "data", "items", "result", "body", "rows", "records"]:
                    if key in data:
                        val = data[key]
                        if isinstance(val, list):
                            items_list = val
                            break
                        elif isinstance(val, dict):
                            for subkey in ["list", "data", "items", "rows"]:
                                if subkey in val and isinstance(val[subkey], list):
                                    items_list = val[subkey]
                                    break

            for entry in items_list:
                if not isinstance(entry, dict):
                    continue
                # BIZ_MDDC_FINM 또는 FilePath 패턴
                file_nm = (
                    entry.get("BIZ_MDDC_FINM") or entry.get("filePath") or
                    entry.get("fileNm") or entry.get("FILE_NM") or ""
                )
                prod_name = (
                    entry.get("PRDT_NM") or entry.get("productName") or
                    entry.get("PRD_NM") or entry.get("prdtNm") or
                    entry.get("name") or entry.get("title") or file_nm or "약관"
                )

                if not file_nm or file_nm in seen_files:
                    continue
                seen_files.add(file_nm)

                if not is_disease_injury(str(prod_name)):
                    continue

                # DB손해보험 다운로드 URL 구성
                if file_nm.startswith("http"):
                    pdf_url = file_nm
                elif file_nm.endswith(".pdf"):
                    pdf_url = f"https://www.idbins.com/cYakgwanDown.do?FilePath=InsProduct/{file_nm}"
                else:
                    pdf_url = f"https://www.idbins.com/cYakgwanDown.do?FilePath=InsProduct/{file_nm}"

                logger.info("[DB손해보험] PDF 다운로드: %s (%s)", prod_name, file_nm)
                data_bytes = await download_pdf_bytes(pdf_url, context)
                if data_bytes and len(data_bytes) > 1000:
                    result = save_pdf(
                        data=data_bytes,
                        company_id=company_id,
                        company_name=company_name,
                        product_name=str(prod_name),
                        product_category="질병/상해",
                        source_url=pdf_url,
                        sale_status=item_status,
                    )
                    if not result.get("skipped"):
                        downloaded += 1
                await asyncio.sleep(1)

        # 직접 페이지에서 PDF 링크 탐색
        logger.info("[DB손해보험] 페이지에서 직접 PDF 링크 탐색...")
        links = await page.evaluate("""
            () => Array.from(document.querySelectorAll('a[href*=".pdf"], a[href*="Down"], a[onclick*="pdf"], a[onclick*="down"], a[onclick*="Down"]'))
                .map(a => ({href: a.href || '', onclick: a.getAttribute('onclick') || '', text: a.textContent.trim()}))
                .filter(a => a.href || a.onclick)
        """)
        logger.info("[DB손해보험] 직접 PDF 링크: %d개", len(links))
        for link in links[:50]:
            href = link.get("href", "")
            text = link.get("text", "")
            if href and href not in seen_files and not any(exc_kw in text for exc_kw in EXCLUDE_KEYWORDS):
                seen_files.add(href)
                data_bytes = await download_pdf_bytes(href, context)
                if data_bytes and len(data_bytes) > 1000:
                    result = save_pdf(
                        data=data_bytes,
                        company_id=company_id,
                        company_name=company_name,
                        product_name=text or Path(urlparse(href).path).stem,
                        product_category="약관",
                        source_url=href,
                    )
                    if not result.get("skipped"):
                        downloaded += 1
                await asyncio.sleep(1)

        if downloaded == 0:
            logger.info("[DB손해보험] 캡처된 응답 목록:")
            for resp in all_responses[:15]:
                logger.info("  URL: %s (%d bytes) | %s", resp["url"], resp["size"], resp["snippet"][:80])

    finally:
        await page.close()

    logger.info("[DB손해보험] 총 %d개 PDF 수집 완료", downloaded)
    return downloaded


# =============================================================================
# KB손해보험 크롤러
# =============================================================================

async def crawl_kb_insurance(context: Any) -> int:
    """KB손해보험 약관 PDF를 수집한다.

    레거시 사이트 (포트 :8543 사용 가능), EUC-KR 인코딩 가능성 있음.

    # @MX:NOTE: KB손해보험은 비표준 포트 :8543을 사용할 수 있음
    # @MX:NOTE: EUC-KR 인코딩 대응 필요
    """
    company_id = "kb_insurance"
    company_name = "KB손해보험"
    downloaded = 0

    urls_to_try = [
        "https://www.kbinsure.co.kr/CG302120001.ec",
        "https://www.kbinsure.co.kr/CG302120001.html",
        "https://www.kbinsure.co.kr/terms",
        "https://www.kbinsure.co.kr",
        "https://www.kbinsure.co.kr:8543",
    ]

    page = await context.new_page()
    found_pdfs: list[dict] = []

    async def on_response(response: Any) -> None:
        url = response.url
        if url.lower().endswith(".pdf") or "pdf" in url.lower():
            found_pdfs.append({"url": url})

    page.on("response", on_response)

    try:
        for try_url in urls_to_try:
            logger.info("[KB손해보험] 접속 시도: %s", try_url)
            try:
                await page.goto(try_url, timeout=PAGE_TIMEOUT, wait_until="domcontentloaded")
                await asyncio.sleep(3)

                content = await page.content()
                if "약관" in content or "보험" in content:
                    logger.info("[KB손해보험] 접속 성공: %s", try_url)

                    # 약관 메뉴 탐색
                    await page.evaluate("""
                        () => {
                            const links = Array.from(document.querySelectorAll('a'));
                            for (const a of links) {
                                if (a.textContent.includes('약관') || a.textContent.includes('공시')) {
                                    a.click();
                                    break;
                                }
                            }
                        }
                    """)
                    await asyncio.sleep(3)

                    # 판매중지 탭 클릭 전 경계 기록 (response interception 없으므로 링크 기준)
                    # PDF 링크 수집 (판매중)
                    on_sale_links = await page.evaluate("""
                        () => {
                            const results = [];
                            document.querySelectorAll('a').forEach(a => {
                                const href = a.href || '';
                                const text = a.textContent.trim();
                                if (href.endsWith('.pdf') || href.includes('pdf') || href.includes('download')) {
                                    results.push({href, text});
                                }
                            });
                            return results;
                        }
                    """)

                    # 판매중지 탭 클릭 시도
                    await try_click_discontinued_tab_pl(page, company_name)

                    # PDF 링크 수집 (판매중지)
                    disc_links = await page.evaluate("""
                        () => {
                            const results = [];
                            document.querySelectorAll('a').forEach(a => {
                                const href = a.href || '';
                                const text = a.textContent.trim();
                                if (href.endsWith('.pdf') || href.includes('pdf') || href.includes('download')) {
                                    results.push({href, text});
                                }
                            });
                            return results;
                        }
                    """)

                    seen: set[str] = set()
                    for link_status, link_list in [("ON_SALE", on_sale_links), ("DISCONTINUED", disc_links)]:
                        for link in link_list[:50]:
                            href = link.get("href", "")
                            text = link.get("text", "")
                            if not href or href in seen:
                                continue
                            seen.add(href)
                            if is_disease_injury(text) or not text:
                                data_bytes = await download_pdf_bytes(href, context)
                                if data_bytes and len(data_bytes) > 1000:
                                    result = save_pdf(
                                        data=data_bytes,
                                        company_id=company_id,
                                        company_name=company_name,
                                        product_name=text or Path(urlparse(href).path).stem,
                                        product_category="약관",
                                        source_url=href,
                                        sale_status=link_status,
                                    )
                                    if not result.get("skipped"):
                                        downloaded += 1
                                await asyncio.sleep(1)
                    break
            except Exception as exc:
                logger.warning("[KB손해보험] 접속 실패 (%s): %s", try_url, exc)

    finally:
        await page.close()

    logger.info("[KB손해보험] 총 %d개 PDF 수집 완료", downloaded)
    return downloaded


# =============================================================================
# 메리츠화재 크롤러
# =============================================================================

async def crawl_meritz_fire(context: Any) -> int:
    """메리츠화재 약관 PDF를 수집한다.

    Angular SPA, /customer/publicTerms/list.do 페이지에서 약관 목록 수집.

    # @MX:NOTE: 메리츠화재는 Angular SPA, REST API로 약관 목록 반환
    """
    company_id = "meritz_fire"
    company_name = "메리츠화재"
    downloaded = 0
    found_items: list[dict] = []

    async def on_response(response: Any) -> None:
        url = response.url
        if any(ext in url.lower() for ext in [".css", ".png", ".jpg", ".gif", ".ico", ".woff", ".svg", ".js"]):
            return
        if url.lower().endswith(".pdf"):
            found_items.append({"type": "pdf", "url": url, "name": Path(urlparse(url).path).stem})
            return
        ct = response.headers.get("content-type", "")
        if "json" in ct:
            try:
                body = await response.body()
                if len(body) > 500:
                    try:
                        data = json.loads(body)
                        data_str = json.dumps(data, ensure_ascii=False)
                        if any(kw in data_str for kw in ["약관", "fileNm", "pdfUrl", "filePath", "fileName"]):
                            found_items.append({"type": "json", "url": url, "data": data})
                    except Exception:
                        pass
            except Exception:
                pass

    page = await context.new_page()
    page.on("response", on_response)

    try:
        logger.info("[메리츠화재] 약관 페이지 로딩...")
        await page.goto(
            "https://www.meritzfire.com/customer/publicTerms/list.do",
            timeout=PAGE_TIMEOUT,
            wait_until="networkidle",
        )
        await asyncio.sleep(4)

        # 카테고리 클릭
        for cat in ["건강", "상해", "질병", "종합"]:
            try:
                clicked = await page.evaluate(f"""
                    () => {{
                        const els = Array.from(document.querySelectorAll('button, a, li'));
                        for (const el of els) {{
                            if (el.textContent.trim().includes('{cat}')) {{
                                el.click();
                                return true;
                            }}
                        }}
                        return false;
                    }}
                """)
                if clicked:
                    await asyncio.sleep(2)
            except Exception:
                pass

        # 모든 항목 로드를 위해 스크롤
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await asyncio.sleep(2)

        # 판매중지 탭 클릭 전 경계 기록
        on_sale_boundary = len(found_items)
        # 판매중지 탭 클릭 시도
        await try_click_discontinued_tab_pl(page, company_name)

        # 페이지에서 직접 PDF 링크 탐색
        links = await page.evaluate("""
            () => {
                const results = [];
                document.querySelectorAll('a[href*=".pdf"], button[onclick*="pdf"]').forEach(el => {
                    const href = el.getAttribute('href') || el.getAttribute('onclick') || '';
                    const text = el.textContent.trim();
                    results.push({href, text});
                });
                return results;
            }
        """)

        seen: set[str] = set()
        for idx, item in enumerate(found_items):
            status = "ON_SALE" if idx < on_sale_boundary else "DISCONTINUED"
            if item["type"] == "pdf":
                url = item["url"]
                if url not in seen:
                    seen.add(url)
                    name = item.get("name", "약관")
                    data_bytes = await download_pdf_bytes(url, context)
                    if data_bytes and len(data_bytes) > 1000:
                        result = save_pdf(
                            data=data_bytes,
                            company_id=company_id,
                            company_name=company_name,
                            product_name=name,
                            product_category="약관",
                            source_url=url,
                            sale_status=status,
                        )
                        if not result.get("skipped"):
                            downloaded += 1
                    await asyncio.sleep(1)

            elif item["type"] == "json":
                pdf_links = extract_pdf_links_from_json(item["data"], "https://www.meritzfire.com")
                for pdf_info in pdf_links:
                    if pdf_info["url"] in seen:
                        continue
                    if not is_disease_injury(pdf_info["name"]):
                        continue
                    seen.add(pdf_info["url"])
                    data_bytes = await download_pdf_bytes(pdf_info["url"], context)
                    if data_bytes and len(data_bytes) > 1000:
                        result = save_pdf(
                            data=data_bytes,
                            company_id=company_id,
                            company_name=company_name,
                            product_name=pdf_info["name"],
                            product_category=pdf_info.get("category", "약관"),
                            source_url=pdf_info["url"],
                            sale_status=status,
                        )
                        if not result.get("skipped"):
                            downloaded += 1
                    await asyncio.sleep(1)

        for link in links[:50]:
            href = link.get("href", "")
            text = link.get("text", "")
            full_url = urljoin("https://www.meritzfire.com", href) if href else ""
            if full_url and full_url not in seen and full_url.endswith(".pdf"):
                seen.add(full_url)
                data_bytes = await download_pdf_bytes(full_url, context)
                if data_bytes and len(data_bytes) > 1000:
                    result = save_pdf(
                        data=data_bytes,
                        company_id=company_id,
                        company_name=company_name,
                        product_name=text or Path(urlparse(full_url).path).stem,
                        product_category="약관",
                        source_url=full_url,
                    )
                    if not result.get("skipped"):
                        downloaded += 1
                await asyncio.sleep(1)

    finally:
        await page.close()

    logger.info("[메리츠화재] 총 %d개 PDF 수집 완료", downloaded)
    return downloaded


# =============================================================================
# 한화손해보험 크롤러
# =============================================================================

async def crawl_hanwha_general(context: Any) -> int:
    """한화손해보험 약관 PDF를 수집한다.

    # @MX:NOTE: 한화손해보험 사이트는 순수 SPA (HTML에 링크 거의 없음)
    # @MX:NOTE: 네트워크 응답 인터셉트로 API 엔드포인트 탐지
    """
    company_id = "hanwha_general"
    company_name = "한화손해보험"
    downloaded = 0
    found_items: list[dict] = []

    async def on_response(response: Any) -> None:
        url = response.url
        if any(ext in url.lower() for ext in [".css", ".png", ".jpg", ".gif", ".ico", ".woff", ".svg"]):
            return
        if url.lower().endswith(".pdf"):
            found_items.append({"type": "pdf", "url": url})
            return
        ct = response.headers.get("content-type", "")
        if "json" in ct:
            try:
                body = await response.body()
                if len(body) > 300:
                    try:
                        data = json.loads(body)
                        data_str = json.dumps(data, ensure_ascii=False)
                        if any(kw in data_str for kw in ["약관", "fileNm", "fileName", "filePath", "pdfUrl"]):
                            found_items.append({"type": "json", "url": url, "data": data})
                    except Exception:
                        pass
            except Exception:
                pass

    page = await context.new_page()
    page.on("response", on_response)

    try:
        logger.info("[한화손해보험] 메인 페이지 로딩...")
        await page.goto("https://www.hwgeneralins.com", timeout=PAGE_TIMEOUT, wait_until="domcontentloaded")
        await asyncio.sleep(4)

        # 약관 메뉴 클릭 시도
        for nav_text in ["약관", "보험약관", "공시", "약관정보"]:
            try:
                clicked = await page.evaluate(f"""
                    () => {{
                        const els = Array.from(document.querySelectorAll('a, button, li, span'));
                        for (const el of els) {{
                            const text = el.textContent.trim();
                            if (text === '{nav_text}' || text.includes('{nav_text}')) {{
                                el.click();
                                return true;
                            }}
                        }}
                        return false;
                    }}
                """)
                if clicked:
                    await asyncio.sleep(3)
                    break
            except Exception:
                pass

        # 약관 전용 URL 직접 시도
        term_urls = [
            "https://www.hwgeneralins.com/terms",
            "https://www.hwgeneralins.com/customer/terms",
            "https://www.hwgeneralins.com/about/terms",
            "https://www.hwgeneralins.com/info/terms",
        ]
        for turl in term_urls:
            try:
                await page.goto(turl, timeout=PAGE_TIMEOUT, wait_until="domcontentloaded")
                await asyncio.sleep(3)
                content = await page.content()
                if "약관" in content:
                    logger.info("[한화손해보험] 약관 페이지 발견: %s", turl)
                    break
            except Exception:
                pass

        # 판매중지 탭 클릭 전 경계 기록
        on_sale_boundary = len(found_items)
        # 판매중지 탭 클릭 시도
        await try_click_discontinued_tab_pl(page, company_name)

        seen: set[str] = set()
        for idx, item in enumerate(found_items):
            status = "ON_SALE" if idx < on_sale_boundary else "DISCONTINUED"
            if item["type"] == "pdf":
                url = item["url"]
                if url not in seen:
                    seen.add(url)
                    name = Path(urlparse(url).path).stem
                    data_bytes = await download_pdf_bytes(url, context)
                    if data_bytes and len(data_bytes) > 1000:
                        result = save_pdf(
                            data=data_bytes,
                            company_id=company_id,
                            company_name=company_name,
                            product_name=name,
                            product_category="약관",
                            source_url=url,
                            sale_status=status,
                        )
                        if not result.get("skipped"):
                            downloaded += 1
                    await asyncio.sleep(1)

            elif item["type"] == "json":
                pdf_links = extract_pdf_links_from_json(item["data"], "https://www.hwgeneralins.com")
                for pdf_info in pdf_links:
                    if pdf_info["url"] in seen:
                        continue
                    if not is_disease_injury(pdf_info["name"]):
                        continue
                    seen.add(pdf_info["url"])
                    data_bytes = await download_pdf_bytes(pdf_info["url"], context)
                    if data_bytes and len(data_bytes) > 1000:
                        result = save_pdf(
                            data=data_bytes,
                            company_id=company_id,
                            company_name=company_name,
                            product_name=pdf_info["name"],
                            product_category=pdf_info.get("category", "약관"),
                            source_url=pdf_info["url"],
                            sale_status=status,
                        )
                        if not result.get("skipped"):
                            downloaded += 1
                    await asyncio.sleep(1)

    finally:
        await page.close()

    logger.info("[한화손해보험] 총 %d개 PDF 수집 완료", downloaded)
    return downloaded


# =============================================================================
# 흥국화재 크롤러
# =============================================================================

async def crawl_heungkuk_fire(context: Any) -> int:
    """흥국화재 보험상품공시 페이지에서 약관 PDF를 수집한다.

    # @MX:NOTE: 실제 약관 페이지 URL: /FRW/announce/insGoodsGongsiSale.do
    # @MX:NOTE: 다운로드 방식: fn_filedownX → downForm.submit() → Playwright expect_download
    # @MX:NOTE: fn_filedownX 파라미터: (path, displayName, saveName) saveName이 실제 파일 ID
    # @MX:NOTE: 페이지네이션: goPage(n) 함수 호출, 판매중 ~6페이지 / 판매중지 ~215페이지 이상
    # @MX:NOTE: 상품약관 파일만 수집 (사업방법서, 상품요약서 제외)
    # @MX:ANCHOR: 다운로드 방식 변경 금지 - form submit 방식만 정상 동작함
    # @MX:REASON: /common/download.do?temp=타임스탬프 패턴, FILE_NAME 직접 접근 불가
    """
    import re as _re
    import tempfile

    company_id = "heungkuk_fire"
    company_name = "흥국화재"
    base_url = "https://www.heungkukfire.co.kr"
    terms_url = f"{base_url}/FRW/announce/insGoodsGongsiSale.do"
    downloaded = 0
    seen: set[str] = set()  # save_name 기준 중복 방지

    async def extract_yakgwan_links(pg: Any) -> list[dict]:
        """현재 페이지에서 상품약관 fn_filedownX 링크를 파싱한다."""
        items = await pg.evaluate("""
        () => {
            return Array.from(document.querySelectorAll('a[onclick*="fn_filedownX"]'))
                .filter(a => a.textContent.trim() === '상품약관')
                .map(a => ({
                    text: a.textContent.trim(),
                    onclick: a.getAttribute('onclick')
                }));
        }
        """)
        result = []
        for item in items:
            onclick = item.get("onclick", "")
            # fn_filedownX(path, displayName, saveName) - 3개 파라미터 파싱
            m = _re.search(r"fn_filedownX\('([^']+)',\s*'([^']*)',\s*'([^']+)'", onclick)
            if m:
                path, display_name, save_name = m.groups()
                source_url = f"{base_url}/common/download.do?FILE_NAME={path}{save_name}"
                # display_name에서 상품명 추출 (한글 파일명)
                product_name = display_name.replace(".pdf", "").replace("_약관", "").strip()
                result.append({
                    "path": path,
                    "display_name": display_name,
                    "save_name": save_name,
                    "product_name": product_name,
                    "source_url": source_url,
                })
        return result

    async def get_last_page(pg: Any) -> int:
        """페이지네이션에서 마지막 페이지 번호를 반환한다."""
        try:
            last = await pg.evaluate("""
            () => {
                const links = Array.from(document.querySelectorAll('.paginate a, .paging a'));
                const nums = links
                    .map(a => {
                        const h = a.href || '';
                        const m = h.match(/goPage\\((\\d+)\\)/);
                        return m ? parseInt(m[1]) : 0;
                    })
                    .filter(n => n > 0);
                return nums.length > 0 ? Math.max(...nums) : 1;
            }
            """)
            return last
        except Exception:
            return 1

    async def download_via_form(pg: Any, path: str, display_name: str, save_name: str) -> bytes | None:
        """downForm을 직접 submit하여 PDF를 다운로드한다."""
        try:
            # Playwright download 이벤트로 form submit 결과 캡처
            async with pg.expect_download(timeout=30_000) as dl_info:
                await pg.evaluate(f"""
                () => {{
                    const frm = document.getElementById('downForm');
                    if (!frm) return;
                    frm.filePath.value = '{path}';
                    frm.fileRealName.value = '{display_name.replace("'", "\\'")}';
                    frm.fileSaveName.value = '{save_name}';
                    frm.action = '/common/download.do?temp=' + new Date().getTime();
                    frm.submit();
                }}
                """)
            download = await dl_info.value
            tmp_path = await download.path()
            if tmp_path:
                with open(tmp_path, "rb") as f:
                    data = f.read()
                # 다운로드 임시 파일 삭제
                await download.delete()
                if data and data[:4] == b"%PDF":
                    return data
                logger.warning("[흥국화재] 다운로드 파일이 PDF가 아님: %s", save_name)
            return None
        except Exception as exc:
            logger.warning("[흥국화재] form 다운로드 실패 (%s): %s", save_name, exc)
            return None

    async def process_page(pg: Any, sale_status: str) -> int:
        """현재 페이지의 상품약관을 모두 다운로드한다."""
        count = 0
        links = await extract_yakgwan_links(pg)
        logger.info("[흥국화재] %s 페이지 약관 링크: %d개", sale_status, len(links))
        for lnk in links:
            save_name = lnk["save_name"]
            seen_key = f"{sale_status}:{save_name}"
            if seen_key in seen:
                logger.debug("[흥국화재] %s 중복(seen): %s", sale_status, save_name)
                continue
            seen.add(seen_key)
            data_bytes = await download_via_form(pg, lnk["path"], lnk["display_name"], save_name)
            if data_bytes and len(data_bytes) > 1000:
                result = save_pdf(
                    data=data_bytes,
                    company_id=company_id,
                    company_name=company_name,
                    product_name=lnk["product_name"] or save_name.replace(".pdf", ""),
                    product_category="약관",
                    source_url=lnk["source_url"],
                    sale_status=sale_status,
                )
                if not result.get("skipped"):
                    count += 1
                    logger.info("[흥국화재] 저장 완료: %s", save_name)
            await asyncio.sleep(1)
        return count

    page = await context.new_page()
    try:
        logger.info("[흥국화재] 보험상품공시 페이지 로딩: %s", terms_url)
        await page.goto(terms_url, timeout=PAGE_TIMEOUT, wait_until="networkidle")
        await asyncio.sleep(3)

        title = await page.title()
        if "흥국화재" not in title:
            logger.warning("[흥국화재] 예상치 못한 페이지 제목: %s", title)

        # ── 판매중 탭 전체 페이지 수집 ──────────────────────────────────────
        total_on_sale = await get_last_page(page)
        logger.info("[흥국화재] 판매중 총 페이지: %d", total_on_sale)

        for pg_num in range(1, total_on_sale + 1):
            if pg_num > 1:
                try:
                    await page.evaluate(f"goPage({pg_num})")
                    await asyncio.sleep(2)
                except Exception as exc:
                    logger.warning("[흥국화재] 판매중 페이지 %d 이동 오류: %s", pg_num, exc)
                    continue
            downloaded += await process_page(page, "ON_SALE")

        # ── 판매중지 탭 클릭 후 전체 페이지 수집 ─────────────────────────────
        logger.info("[흥국화재] 판매중지 탭 클릭 시도")
        clicked = await try_click_discontinued_tab_pl(page, company_name)
        if clicked:
            total_disc = await get_last_page(page)
            logger.info("[흥국화재] 판매중지 총 페이지: %d", total_disc)

            for pg_num in range(1, total_disc + 1):
                if pg_num > 1:
                    try:
                        await page.evaluate(f"goPage({pg_num})")
                        await asyncio.sleep(2)
                        # goPage() 호출 후 탭이 ON_SALE로 리셋되는 경우 재클릭
                        tab_status = await page.evaluate("""
() => {
    const tabs = Array.from(document.querySelectorAll('a, button, li'));
    for (const t of tabs) {
        const txt = t.textContent.trim();
        const isActive = t.classList.contains('active') || t.classList.contains('on') || t.getAttribute('aria-selected') === 'true';
        if ((txt === '판매중지' || txt === '판매 중지') && isActive) return 'DISCONTINUED';
        if ((txt === '판매중' || txt === '판매 중') && isActive) return 'ON_SALE';
    }
    return 'UNKNOWN';
}
""")
                        if tab_status != 'DISCONTINUED':
                            logger.warning("[흥국화재] 페이지 이동 후 탭 전환됨: %s, 재클릭 시도", tab_status)
                            await try_click_discontinued_tab_pl(page, company_name)
                            await asyncio.sleep(2)
                    except Exception as exc:
                        logger.warning("[흥국화재] 판매중지 페이지 %d 이동 오류: %s", pg_num, exc)
                        continue
                downloaded += await process_page(page, "DISCONTINUED")
        else:
            logger.warning("[흥국화재] 판매중지 탭 클릭 실패")

    except Exception as exc:
        logger.error("[흥국화재] 크롤링 오류: %s", exc)
    finally:
        await page.close()

    logger.info("[흥국화재] 총 %d개 PDF 수집 완료", downloaded)
    return downloaded


# =============================================================================
# AXA손해보험 크롤러
# =============================================================================

async def crawl_axa_general(context: Any) -> int:
    """AXA손해보험 약관 PDF를 수집한다.

    # @MX:NOTE: AXA는 별도 HTML 공시 페이지에서 PDF 링크를 직접 추출 (EUC-KR 인코딩)
    # @MX:NOTE: SPA(/cui/) 방식은 네트워크 인터셉트로 PDF를 얻을 수 없음 - 공시 페이지 사용
    # @MX:ANCHOR: AXA 공시 페이지 URL이 변경되면 이 함수 전체를 재검토해야 함
    # @MX:REASON: 사이트 구조 조사로 확인된 유일한 PDF 수집 경로
    """
    company_id = "axa_general"
    company_name = "AXA손해보험"
    downloaded = 0
    base_url = "https://www.axa.co.kr"
    # AXA 공시 페이지: EUC-KR 인코딩된 HTML에 약관 PDF 링크가 직접 포함됨
    disclosure_url = (
        "https://www.axa.co.kr/AsianPlatformInternet/html/axacms/common/intro"
        "/disclosure/insurance/index.html"
    )

    page = await context.new_page()
    try:
        logger.info("[AXA손해보험] 공시 페이지 로딩: %s", disclosure_url)
        response = await page.request.get(
            disclosure_url,
            headers={"Accept-Charset": "EUC-KR"},
            timeout=30_000,
        )
        if not response.ok:
            logger.warning("[AXA손해보험] 공시 페이지 로드 실패 (status=%d)", response.status)
            return 0

        raw_bytes = await response.body()
        # EUC-KR 인코딩 디코딩
        html_text = raw_bytes.decode("euc-kr", errors="ignore")
        logger.info("[AXA손해보험] 공시 페이지 수신 (%d bytes)", len(raw_bytes))

        # PDF href 링크 추출: /AsianPlatformInternet/doc/ 경로 포함 링크
        pdf_pattern = re.compile(r'href=["\']([^"\']*\.pdf)["\']', re.IGNORECASE)
        all_hrefs = pdf_pattern.findall(html_text)
        logger.info("[AXA손해보험] 총 %d개 PDF 링크 발견", len(all_hrefs))

        # 링크 텍스트와 함께 추출하여 제품명으로 사용
        link_pattern = re.compile(
            r'href=["\']([^"\']*\.pdf)["\'][^>]*>([^<]*)</a>',
            re.IGNORECASE | re.DOTALL,
        )
        link_matches = link_pattern.findall(html_text)

        # URL -> 제품명 매핑 구성
        href_name_map: dict[str, str] = {}
        for href, link_text in link_matches:
            clean_text = re.sub(r'\s+', ' ', link_text).strip()
            if clean_text:
                href_name_map[href] = clean_text

        # 중복 제거 및 정렬
        seen_urls: set[str] = set()
        pdf_items: list[dict[str, str]] = []
        for href in all_hrefs:
            # 상대 경로를 절대 URL로 변환
            if href.startswith("http"):
                full_url = href
            elif href.startswith("/"):
                full_url = base_url + href
            else:
                full_url = base_url + "/" + href

            if full_url in seen_urls:
                continue
            seen_urls.add(full_url)

            # 제품명: href_name_map에서 찾거나 파일명 사용
            name = href_name_map.get(href, "")
            if not name:
                name = Path(urlparse(full_url).path).stem
            name = re.sub(r'\s+', ' ', name).strip() or Path(urlparse(full_url).path).stem

            pdf_items.append({"url": full_url, "name": name})

        logger.info("[AXA손해보험] 중복 제거 후 %d개 고유 PDF", len(pdf_items))

        # 약관 PDF 필터링 및 다운로드
        # /AsianPlatformInternet/doc/ 경로만 대상으로 함 (공시 약관 문서)
        doc_items = [
            item for item in pdf_items
            if "/AsianPlatformInternet/doc/" in item["url"]
            or "/doc/internet/public/" in item["url"]
        ]
        logger.info("[AXA손해보험] 약관 문서 경로 필터링 후 %d개", len(doc_items))

        # 필터 결과가 없으면 전체 PDF를 대상으로 함
        target_items = doc_items if doc_items else pdf_items

        for item in target_items:
            url = item["url"]
            # URL stem을 파일명으로 사용 (링크 텍스트가 '약관' 단어 하나여서 의미 없음)
            name = Path(urlparse(url).path).stem or item["name"]

            data_bytes = await download_pdf_bytes(url, context)
            if data_bytes and len(data_bytes) > 1000:
                result = save_pdf(
                    data=data_bytes,
                    company_id=company_id,
                    company_name=company_name,
                    product_name=name,
                    product_category="약관",
                    source_url=url,
                    sale_status="ON_SALE",
                )
                if not result.get("skipped"):
                    downloaded += 1
            await asyncio.sleep(0.5)

    finally:
        await page.close()

    logger.info("[AXA손해보험] 총 %d개 PDF 수집 완료", downloaded)
    return downloaded


# =============================================================================
# MG손해보험(예별) 크롤러
# =============================================================================

async def crawl_mg_insurance(context: Any) -> int:
    """MG손해보험 약관 PDF를 수집한다.

    # @MX:NOTE: yebyeol.co.kr, LG CNS SmartChannelPlatform(SCP) 기반
    # @MX:NOTE: API 흐름:
    # @MX:NOTE:   1단계: GET /PB031210DM.scp → comToken(CSRF) 획득
    # @MX:NOTE:   2단계: POST /PB031210_001.ajax → 상품별 dataIdno 목록 조회
    # @MX:NOTE:   3단계: POST /PB031130_003.form (form submit) → PDF 바이너리 다운로드
    # @MX:NOTE: searchPrdtLccd: 대분류(L=생명, P=손해보험 등)
    # @MX:NOTE: searchPrdtMccd: 중분류 코드 (01~21)
    # @MX:NOTE: searchPrdtSaleYn: 0=판매중, 1=판매중지
    # @MX:NOTE: docCfcd: 1=상품설명서, 2=약관, 3=보험안내자료
    # @MX:WARN: comToken은 세션당 1회 발급되는 CSRF 토큰 - Playwright 세션 내에서만 유효
    # @MX:REASON: SCP 프레임워크는 FRM_TOK_003 오류로 유효하지 않은 토큰 요청을 거부함
    """
    company_id = "mg_insurance"
    company_name = "MG손해보험"
    base_url = "https://www.yebyeol.co.kr"
    downloaded = 0
    seen: set[str] = set()

    # 상품 대분류/중분류 코드 목록 - yebyeol.co.kr select 옵션에서 확인한 실제 코드
    # prdtLccd: L=장기보험, A=자동차보험, G=일반보험, B/P/C=기타
    # codeL: 06=건강, 07=운전자, 09=여행, 15=의료, 16=상해, 17=질병(실손), 18~21=기타
    # @MX:NOTE: prcSts=N이어도 list.rows에 데이터가 있을 수 있음 (API 특성)
    product_categories = [
        ("L", "06"),  # 건강보험
        ("L", "07"),  # 운전자보험
        ("L", "09"),  # 여행보험
        ("L", "15"),  # 의료보험
        ("L", "16"),  # 상해보험
        ("L", "17"),  # 질병/실손보험
        ("L", "18"),  # 기타장기1
        ("L", "19"),  # 기타장기2
        ("L", "20"),  # 종합보험
        ("L", "21"),  # 실손의료비
        ("A", "01"),  # 자동차(개인용)
        ("A", "02"),  # 자동차(업무용)
        ("A", "03"),  # 자동차(영업용)
        ("A", "04"),  # 자동차(이륜차)
        ("A", "05"),  # 자동차(이동장치)
        ("G", "01"),  # 일반-재물보험
        ("G", "02"),  # 일반-일반
        ("G", "03"),  # 일반-특종보험
        ("G", "04"),  # 일반-화재보험
        ("G", "05"),  # 일반-적하보험
        ("B", "01"),  # B-일반
        ("B", "02"),  # B-기타
        ("P", "01"),  # P-단체
        ("C", "01"),  # C-전체
    ]

    page = await context.new_page()

    try:
        logger.info("[MG손해보험] 약관 페이지 로딩 및 CSRF 토큰 획득...")
        await page.goto(
            f"{base_url}/PB031210DM.scp",
            timeout=PAGE_TIMEOUT,
            wait_until="domcontentloaded",
        )
        await asyncio.sleep(3)

        # CSRF 토큰 획득 (페이지 hidden input에서 추출)
        com_token = await page.evaluate("""
            () => {
                const el = document.querySelector('input[name="comToken"]');
                return el ? el.value : null;
            }
        """)
        if not com_token:
            logger.warning("[MG손해보험] comToken을 찾지 못함 - API 호출 실패 가능성 높음")
        else:
            logger.info("[MG손해보험] comToken 획득 성공: %s...", com_token[:10])

        # 판매중/판매중지 구분하여 모든 카테고리 조회
        sale_yn_list = [("0", "ON_SALE"), ("1", "DISCONTINUED")]

        for sale_yn, sale_status in sale_yn_list:
            logger.info("[MG손해보험] %s 상품 조회 중...", sale_status)

            for prdtLccd, prdtMccd in product_categories:
                try:
                    # Playwright fetch API를 통해 AJAX 호출 (쿠키/세션 자동 포함)
                    api_result = await page.evaluate(f"""
                        async () => {{
                            const tokenEl = document.querySelector('input[name="comToken"]');
                            const token = tokenEl ? tokenEl.value : '';
                            const resp = await fetch('/PB031210_001.ajax', {{
                                method: 'POST',
                                headers: {{'Content-Type': 'application/x-www-form-urlencoded'}},
                                body: new URLSearchParams({{
                                    searchPrdtLccd: '{prdtLccd}',
                                    searchPrdtMccd: '{prdtMccd}',
                                    searchPrdtSaleYn: '{sale_yn}',
                                    searchText: '',
                                    comToken: token,
                                    devonTokenFieldSessionscope: 'comToken',
                                }}).toString()
                            }});
                            const text = await resp.text();
                            try {{ return JSON.parse(text); }} catch(e) {{ return null; }}
                        }}
                    """)

                    if not api_result:
                        continue

                    # prcSts=N이어도 list.rows에 데이터가 있을 수 있음 (MG손해보험 API 특성)
                    rows = api_result.get("list", {}).get("rows", [])
                    if not rows:
                        continue

                    logger.info(
                        "[MG손해보험] Lccd=%s Mccd=%s SaleYn=%s → %d개 항목",
                        prdtLccd, prdtMccd, sale_yn, len(rows),
                    )

                    for row in rows:
                        data_idno = str(row.get("dataIdno", "")).strip()
                        if not data_idno:
                            continue

                        inskd_nm = row.get("inskdAbbrNm", row.get("inskdNm", "알수없음"))

                        # docCfcd: 1=상품설명서, 2=약관, 3=보험안내자료
                        # doc1Org/doc2Org/doc3Org: None이면 해당 문서 없음
                        for doc_cf, doc_type_name in [("1", "상품설명서"), ("2", "약관"), ("3", "보험안내자료")]:
                            doc_key = f"doc{doc_cf}Org"
                            if row.get(doc_key) is None:
                                continue  # 해당 문서 없음

                            unique_key = f"{data_idno}_{doc_cf}"
                            if unique_key in seen:
                                continue
                            seen.add(unique_key)

                            # form submit 방식으로 PDF 다운로드
                            pdf_bytes = await page.evaluate(f"""
                                async () => {{
                                    try {{
                                        const resp = await fetch('/PB031130_003.form', {{
                                            method: 'POST',
                                            headers: {{'Content-Type': 'application/x-www-form-urlencoded'}},
                                            body: new URLSearchParams({{
                                                dataIdno: '{data_idno}',
                                                docCfcd: '{doc_cf}',
                                            }}).toString()
                                        }});
                                        if (!resp.ok) return null;
                                        const ct = resp.headers.get('content-type') || '';
                                        if (!ct.includes('pdf') && !ct.includes('octet')) return null;
                                        const buf = await resp.arrayBuffer();
                                        return Array.from(new Uint8Array(buf));
                                    }} catch(e) {{
                                        return null;
                                    }}
                                }}
                            """)

                            if not pdf_bytes:
                                continue

                            data_bytes = bytes(pdf_bytes)
                            if len(data_bytes) < 1000:
                                continue

                            product_name = f"{inskd_nm}_{doc_type_name}"
                            source_url = f"{base_url}/PB031130_003.form?dataIdno={data_idno}&docCfcd={doc_cf}"

                            result = save_pdf(
                                data=data_bytes,
                                company_id=company_id,
                                company_name=company_name,
                                product_name=product_name,
                                product_category=doc_type_name,
                                source_url=source_url,
                                sale_status=sale_status,
                            )
                            if not result.get("skipped"):
                                downloaded += 1
                                logger.info(
                                    "[MG손해보험] 저장: %s (%s, %s)",
                                    product_name, doc_type_name, sale_status,
                                )
                            await asyncio.sleep(0.5)

                except Exception as exc:
                    logger.warning(
                        "[MG손해보험] 카테고리 처리 오류 (Lccd=%s, Mccd=%s): %s",
                        prdtLccd, prdtMccd, exc,
                    )
                    continue

                await asyncio.sleep(0.3)

    finally:
        await page.close()

    logger.info("[MG손해보험] 총 %d개 PDF 수집 완료", downloaded)
    return downloaded


# =============================================================================
# NH농협손해보험 크롤러
# =============================================================================

async def crawl_nh_fire(context: Any) -> int:
    """NH농협손해보험 약관 PDF를 수집한다.

    # @MX:NOTE: API 흐름 파악: 보험상품공시 페이지에서 단계별 AJAX 호출
    # @MX:NOTE: 1단계: POST /front/announce/retrievePdtDcd.ajax (상품군 코드)
    # @MX:NOTE: 2단계: POST /front/announce/retrievePdtCd.ajax (상품 목록)
    # @MX:NOTE: 3단계: POST /front/announce/retrievePdtInfo.ajax (파일 ID)
    # @MX:NOTE: 4단계: POST /imageView/downloadFile.ajax (PDF 다운로드)
    # @MX:WARN: jsessionid 없이는 다운로드가 실패할 수 있어 Playwright 컨텍스트 사용 필수
    # @MX:REASON: nhfire.co.kr은 서버 세션 기반으로 AJAX 요청마다 jsessionid 필요
    """
    import xml.etree.ElementTree as ET

    company_id = "nh_fire"
    company_name = "NH농협손해보험"
    downloaded = 0
    base_url = "https://www.nhfire.co.kr"

    # 세션 획득을 위한 초기 페이지 로딩
    page = await context.new_page()
    session_cookies: dict[str, str] = {}

    async def _post_ajax(endpoint: str, data: dict[str, str]) -> bytes | None:
        """nhfire AJAX 엔드포인트에 JS fetch로 POST 요청을 보낸다.

        # @MX:NOTE: page.request.post()는 세션 쿠키(jsessionid)를 URL에 자동 포함하지 않아
        # 빈 응답을 받는다. JS fetch는 브라우저 컨텍스트에서 세션을 그대로 사용하므로 정상 동작.
        """
        try:
            body_str = "&".join(f"{k}={v}" for k, v in data.items())
            result = await page.evaluate(f"""
                async () => {{
                    const resp = await fetch('{endpoint}', {{
                        method: 'POST',
                        headers: {{
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'X-Requested-With': 'XMLHttpRequest'
                        }},
                        body: '{body_str}'
                    }});
                    if (!resp.ok) return null;
                    return await resp.text();
                }}
            """)
            if result is None:
                logger.warning("[NH농협손해보험] AJAX 실패: %s", endpoint)
                return None
            return result.encode("utf-8")
        except Exception as exc:
            logger.warning("[NH농협손해보험] AJAX 오류: %s -> %s", endpoint, exc)
            return None

    def _parse_xml_values(xml_bytes: bytes, tag: str) -> list[str]:
        """XML 응답에서 특정 태그의 CDATA 값 목록을 추출한다."""
        try:
            decoded = xml_bytes.decode("utf-8", errors="replace")
            return re.findall(rf"<{tag}><!\[CDATA\[([^\]]+)\]\]></{tag}>", decoded)
        except Exception:
            return []

    def _parse_pdt_info(xml_bytes: bytes) -> list[dict[str, str]]:
        """retrievePdtInfo.ajax 응답에서 파일 정보를 추출한다."""
        try:
            decoded = xml_bytes.decode("utf-8", errors="replace")
            results = []
            # 각 LMultiData 블록 파싱
            pdt_nms = re.findall(r"<pdtNm><!\[CDATA\[([^\]]*)\]\]>", decoded)
            file_ids = re.findall(r"<fileId><!\[CDATA\[([^\]]*)\]\]>", decoded)
            plcnd_seqns = re.findall(r"<plcndAfileSeqn><!\[CDATA\[([^\]]*)\]\]>", decoded)
            plcnd_nms = re.findall(r"<plcndAfileNm><!\[CDATA\[([^\]]*)\]\]>", decoded)
            # 판매 상태
            sel_st_dts = re.findall(r"<pdtSelStDt><!\[CDATA\[([^\]]*)\]\]>", decoded)
            sel_ed_dts = re.findall(r"<pdtSelEdDt><!\[CDATA\[([^\]]*)\]\]>", decoded)

            for i, file_id in enumerate(file_ids):
                if not file_id:
                    continue
                plcnd_seqn = plcnd_seqns[i] if i < len(plcnd_seqns) else ""
                plcnd_nm = plcnd_nms[i] if i < len(plcnd_nms) else ""
                pdt_nm = pdt_nms[i] if i < len(pdt_nms) else ""
                sel_ed_dt = sel_ed_dts[i] if i < len(sel_ed_dts) else "99991231"
                # 판매중지 여부: 종료일이 과거이면 판매중지
                import datetime
                today = datetime.date.today().strftime("%Y%m%d")
                status = "DISCONTINUED" if sel_ed_dt < today else "ON_SALE"

                if plcnd_seqn and plcnd_nm:
                    results.append({
                        "file_id": file_id,
                        "seqn": plcnd_seqn,
                        "name": plcnd_nm.replace(".pdf", "").strip(),
                        "pdt_name": pdt_nm,
                        "status": status,
                    })
            return results
        except Exception as exc:
            logger.warning("[NH농협손해보험] pdt_info 파싱 오류: %s", exc)
            return []

    try:
        logger.info("[NH농협손해보험] 보험상품공시 페이지 로딩...")
        await page.goto(
            f"{base_url}/announce/productAnnounce/retrieveInsuranceProductsAnnounce.nhfire",
            timeout=PAGE_TIMEOUT,
            wait_until="domcontentloaded",
        )
        await asyncio.sleep(3)

        # 상품군 코드: 01=장기보험, 02=일반보험 (질병/상해 관련만 수집)
        target_pdt_gr_cds = ["01", "02"]

        seen_keys: set[str] = set()  # (file_id, seqn) 중복 방지

        for pdt_gr_cd in target_pdt_gr_cds:
            logger.info("[NH농협손해보험] 상품군 %s 처리 중...", pdt_gr_cd)

            # 상품 목록 가져오기
            pdt_cd_resp = await _post_ajax(
                "/front/announce/retrievePdtCd.ajax",
                {"type": "ajax", "pdtSelYn": "Y", "pdtGrCd": pdt_gr_cd, "pdtDcd": ""},
            )
            if not pdt_cd_resp:
                continue

            pdt_cds = _parse_xml_values(pdt_cd_resp, "pdtCd")
            pdt_nms_raw = _parse_xml_values(pdt_cd_resp, "pdtNm")
            logger.info("[NH농협손해보험] 상품군 %s: 상품 %d개 발견", pdt_gr_cd, len(pdt_cds))

            # 각 상품의 약관 파일 정보 조회
            for pdt_idx, pdt_cd in enumerate(pdt_cds):
                pdt_nm_raw = pdt_nms_raw[pdt_idx] if pdt_idx < len(pdt_nms_raw) else pdt_cd

                # 질병/상해 관련 상품 필터링 (종합, 건강, 실손 등도 포함)
                # NH농협은 상품명으로 필터링하되 너무 엄격하게 하지 않음
                # 장기보험은 대부분 질병/상해 관련이므로 전체 수집
                if pdt_gr_cd == "02" and not is_disease_injury(pdt_nm_raw):
                    continue

                info_resp = await _post_ajax(
                    "/front/announce/retrievePdtInfo.ajax",
                    {"type": "ajax", "fileType": "05", "pdtCd": pdt_cd},
                )
                if not info_resp:
                    continue

                file_infos = _parse_pdt_info(info_resp)
                if not file_infos:
                    continue

                for fi in file_infos:
                    key = f"{fi['file_id']}_{fi['seqn']}"
                    if key in seen_keys:
                        continue
                    seen_keys.add(key)

                    # PDF 다운로드 (JS fetch + base64)
                    try:
                        file_id = fi["file_id"]
                        seqn = fi["seqn"]
                        b64 = await page.evaluate(f"""
                            async () => {{
                                const resp = await fetch('/imageView/downloadFile.ajax', {{
                                    method: 'POST',
                                    headers: {{'Content-Type': 'application/x-www-form-urlencoded'}},
                                    body: 'fileId={file_id}&afileSeqn={seqn}'
                                }});
                                if (!resp.ok) return null;
                                const buf = await resp.arrayBuffer();
                                const bytes = new Uint8Array(buf);
                                let binary = '';
                                for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                                return btoa(binary);
                            }}
                        """)
                        if b64:
                            import base64
                            pdf_bytes = base64.b64decode(b64)
                            if pdf_bytes and len(pdf_bytes) > 1000:
                                file_name = fi["name"] or pdt_nm_raw
                                result = save_pdf(
                                    data=pdf_bytes,
                                    company_id=company_id,
                                    company_name=company_name,
                                    product_name=file_name,
                                    product_category="약관",
                                    source_url=f"{base_url}/imageView/downloadFile.ajax",
                                    sale_status=fi["status"],
                                )
                                if not result.get("skipped"):
                                    downloaded += 1
                        else:
                            logger.debug("[NH농협손해보험] 다운로드 실패: %s/%s", fi["file_id"], fi["seqn"])
                    except Exception as dl_exc:
                        logger.debug("[NH농협손해보험] 다운로드 오류: %s", dl_exc)

                    await asyncio.sleep(0.5)

                # 상품 간 대기
                if (pdt_idx + 1) % 20 == 0:
                    logger.info("[NH농협손해보험] %d/%d 상품 처리 완료, 현재 %d개 수집", pdt_idx + 1, len(pdt_cds), downloaded)
                    await asyncio.sleep(1)

        # 판매중지 상품도 수집 (pdtSelYn=N)
        logger.info("[NH농협손해보험] 판매중지 상품 수집 시작...")
        for pdt_gr_cd in target_pdt_gr_cds:
            pdt_cd_resp = await _post_ajax(
                "/front/announce/retrievePdtCd.ajax",
                {"type": "ajax", "pdtSelYn": "N", "pdtGrCd": pdt_gr_cd, "pdtDcd": ""},
            )
            if not pdt_cd_resp:
                continue

            pdt_cds_disc = _parse_xml_values(pdt_cd_resp, "pdtCd")
            pdt_nms_disc = _parse_xml_values(pdt_cd_resp, "pdtNm")
            logger.info("[NH농협손해보험] 판매중지 상품군 %s: %d개", pdt_gr_cd, len(pdt_cds_disc))

            for pdt_idx, pdt_cd in enumerate(pdt_cds_disc[:50]):  # 판매중지는 최대 50개
                pdt_nm_raw = pdt_nms_disc[pdt_idx] if pdt_idx < len(pdt_nms_disc) else pdt_cd

                info_resp = await _post_ajax(
                    "/front/announce/retrievePdtInfo.ajax",
                    {"type": "ajax", "fileType": "05", "pdtCd": pdt_cd},
                )
                if not info_resp:
                    continue

                file_infos = _parse_pdt_info(info_resp)
                for fi in file_infos:
                    key = f"{fi['file_id']}_{fi['seqn']}"
                    if key in seen_keys:
                        continue
                    seen_keys.add(key)

                    try:
                        file_id = fi["file_id"]
                        seqn = fi["seqn"]
                        b64 = await page.evaluate(f"""
                            async () => {{
                                const resp = await fetch('/imageView/downloadFile.ajax', {{
                                    method: 'POST',
                                    headers: {{'Content-Type': 'application/x-www-form-urlencoded'}},
                                    body: 'fileId={file_id}&afileSeqn={seqn}'
                                }});
                                if (!resp.ok) return null;
                                const buf = await resp.arrayBuffer();
                                const bytes = new Uint8Array(buf);
                                let binary = '';
                                for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                                return btoa(binary);
                            }}
                        """)
                        if b64:
                            import base64
                            pdf_bytes = base64.b64decode(b64)
                            if pdf_bytes and len(pdf_bytes) > 1000:
                                result = save_pdf(
                                    data=pdf_bytes,
                                    company_id=company_id,
                                    company_name=company_name,
                                    product_name=fi["name"] or pdt_nm_raw,
                                    product_category="약관",
                                    source_url=f"{base_url}/imageView/downloadFile.ajax",
                                    sale_status="DISCONTINUED",
                                )
                                if not result.get("skipped"):
                                    downloaded += 1
                    except Exception:
                        pass
                    await asyncio.sleep(0.5)

    finally:
        await page.close()

    logger.info("[NH농협손해보험] 총 %d개 PDF 수집 완료", downloaded)
    return downloaded


# =============================================================================
# 롯데손해보험 크롤러
# =============================================================================

async def crawl_lotte_insurance(context: Any) -> int:
    """롯데손해보험 약관 PDF를 수집한다.

    # @MX:NOTE: lotteins.co.kr, JSP 기반 사이트 - step2/step3/step4 단계별 약관 조회
    # @MX:NOTE: /web/C/D/H/cdh190.jsp 페이지에서 CChannelSvl POST로 약관 목록 로드
    # @MX:NOTE: PDF URL 패턴: https://www.lotteins.co.kr/upload/C/newProduct/XXXX_yak.pdf
    """
    import re as _re

    company_id = "lotte_insurance"
    company_name = "롯데손해보험"
    downloaded = 0
    base_url = "https://www.lotteins.co.kr"

    # 조회 대상 카테고리: (lcode, mcode, name) - 건강/상해/질병 위주
    categories = [
        ("02", "01", "일반"),
        ("03", "01", "상해,질병"),
        ("03", "02", "저축"),
        ("03", "03", "운전자"),
        ("03", "04", "재물"),
        ("03", "05", "연금보험"),
    ]

    page = await context.new_page()
    await page.set_extra_http_headers({
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    })

    try:
        logger.info("[롯데손해보험] 약관 페이지 로딩...")
        # 세션 초기화
        await page.goto(
            f"{base_url}/web/main.jsp",
            timeout=PAGE_TIMEOUT,
            wait_until="domcontentloaded",
        )
        await asyncio.sleep(2)

        # 약관 페이지로 이동
        await page.goto(
            f"{base_url}/web/C/D/H/cdh190.jsp",
            timeout=PAGE_TIMEOUT,
            wait_until="networkidle",
        )
        await asyncio.sleep(3)

        content = await page.content()
        if "약관" not in content or len(content) < 5000:
            logger.warning("[롯데손해보험] 약관 페이지 접근 실패")
            return 0

        seen: set[str] = set()

        async def collect_pdfs_for_issale(issale: str) -> int:
            """판매중(Y) 또는 판매중지(N) 상품의 약관 PDF를 수집한다."""
            count = 0
            status = "ON_SALE" if issale == "Y" else "DISCONTINUED"

            for lcode, mcode, cat_name in categories:
                try:
                    # 판매 구분 설정
                    await page.evaluate(f"procTask('{issale}');")
                    await asyncio.sleep(0.5)

                    # step2: 카테고리 선택 → 상품 목록 로드
                    await page.evaluate(f"step2('{lcode}', '{mcode}', 0, 1);")
                    await asyncio.sleep(3)

                    step2_html = await page.evaluate(
                        "document.getElementById('step2view') ? document.getElementById('step2view').innerHTML : ''"
                    )
                    if not step2_html:
                        continue

                    # scode 목록 추출
                    scode_pattern = rf"step3\('{_re.escape(lcode)}','{_re.escape(mcode)}','(\d+)'\)"
                    scode_list = _re.findall(scode_pattern, step2_html)
                    logger.info(
                        "[롯데손해보험] %s(%s) %s: %d개 상품",
                        status, cat_name, issale, len(scode_list),
                    )

                    for scode in scode_list:
                        try:
                            # step3: 상품 버전(날짜) 목록 로드
                            await page.evaluate(f"step3('{lcode}', '{mcode}', '{scode}');")
                            await asyncio.sleep(2)

                            step3_html = await page.evaluate(
                                "document.getElementById('step3view') ? document.getElementById('step3view').innerHTML : ''"
                            )
                            if not step3_html:
                                continue

                            # startdate 목록 추출
                            date_pattern = rf"step4\('{_re.escape(lcode)}','{_re.escape(mcode)}','{_re.escape(scode)}','(\d{{8}})'\)"
                            startdate_list = _re.findall(date_pattern, step3_html)

                            for startdate in startdate_list:
                                try:
                                    # step4: 실제 PDF 링크 로드
                                    await page.evaluate(
                                        f"step4('{lcode}', '{mcode}', '{scode}', '{startdate}');"
                                    )
                                    await asyncio.sleep(2)

                                    step4_html = await page.evaluate(
                                        "document.getElementById('step4view') ? document.getElementById('step4view').innerHTML : ''"
                                    )
                                    if not step4_html:
                                        continue

                                    # 상품명 추출
                                    product_name_match = _re.search(
                                        r"<dt>상품명</dt><dd><span>([^<]+)</span>",
                                        step4_html,
                                    )
                                    product_name = (
                                        product_name_match.group(1).strip()
                                        if product_name_match
                                        else f"{cat_name}_{scode}_{startdate}"
                                    )

                                    # 약관(_yak) PDF만 수집
                                    pdf_hrefs = _re.findall(
                                        r'href=["\']([^"\']+_yak\.pdf)["\']',
                                        step4_html,
                                        _re.IGNORECASE,
                                    )

                                    for href in pdf_hrefs:
                                        if not href.startswith("http"):
                                            href = base_url + href
                                        if href in seen:
                                            continue
                                        seen.add(href)

                                        data_bytes = await download_pdf_bytes(href, context)
                                        if data_bytes and len(data_bytes) > 1000:
                                            result = save_pdf(
                                                data=data_bytes,
                                                company_id=company_id,
                                                company_name=company_name,
                                                product_name=product_name,
                                                product_category=cat_name,
                                                source_url=href,
                                                sale_status=status,
                                            )
                                            if not result.get("skipped"):
                                                count += 1
                                                logger.info(
                                                    "[롯데손해보험] 수집: %s (%s)",
                                                    product_name, status,
                                                )
                                        await asyncio.sleep(0.5)

                                except Exception as e:
                                    logger.debug("[롯데손해보험] step4 오류 scode=%s date=%s: %s", scode, startdate, e)

                        except Exception as e:
                            logger.debug("[롯데손해보험] step3 오류 scode=%s: %s", scode, e)

                except Exception as e:
                    logger.warning("[롯데손해보험] 카테고리 %s/%s 오류: %s", lcode, mcode, e)

            return count

        # 판매중 상품 수집
        on_sale_count = await collect_pdfs_for_issale("Y")
        downloaded += on_sale_count
        logger.info("[롯데손해보험] 판매중 %d개 수집", on_sale_count)

        # 판매중지 상품 수집
        disc_count = await collect_pdfs_for_issale("N")
        downloaded += disc_count
        logger.info("[롯데손해보험] 판매중지 %d개 수집", disc_count)

    finally:
        await page.close()

    logger.info("[롯데손해보험] 총 %d개 PDF 수집 완료", downloaded)
    return downloaded


# =============================================================================
# 공통 유틸리티
# =============================================================================

def extract_pdf_links_from_json(data: Any, base_url: str) -> list[dict]:
    """JSON 데이터에서 PDF 링크와 상품명을 재귀적으로 추출한다.

    # @MX:ANCHOR: 모든 JSON 기반 크롤러에서 사용하는 PDF 링크 추출 함수
    # @MX:REASON: 각 보험사 크롤러 내 on_response 콜백에서 공통으로 호출됨 (fan_in >= 6)
    """
    results = []

    # 알려진 필드명 패턴
    file_fields = ["fileNm", "fileName", "filePath", "pdfUrl", "pdf_url", "FILE_NM", "FILE_PATH", "BIZ_MDDC_FINM"]
    name_fields = ["productName", "prdtNm", "PRDT_NM", "PRD_NM", "name", "title", "prodNm", "prdNm"]

    def _extract(obj: Any) -> None:
        if isinstance(obj, dict):
            file_val = None
            name_val = "약관"
            for ff in file_fields:
                if ff in obj and obj[ff]:
                    file_val = str(obj[ff])
                    break
            for nf in name_fields:
                if nf in obj and obj[nf]:
                    name_val = str(obj[nf])
                    break

            if file_val:
                # URL 조합
                if file_val.startswith("http"):
                    pdf_url = file_val
                elif file_val.startswith("/"):
                    pdf_url = urljoin(base_url, file_val)
                else:
                    # 상대 경로 또는 파일명만 있는 경우
                    if file_val.endswith(".pdf"):
                        pdf_url = urljoin(base_url, file_val)
                    else:
                        pdf_url = urljoin(base_url, f"/{file_val}")

                category = (
                    obj.get("category") or obj.get("CTGR") or
                    obj.get("gunGb") or obj.get("prdGb") or "약관"
                )
                results.append({
                    "url": pdf_url,
                    "name": name_val,
                    "category": str(category),
                })

            # 재귀 탐색
            for val in obj.values():
                _extract(val)

        elif isinstance(obj, list):
            for item in obj:
                _extract(item)

    _extract(data)
    return results


# =============================================================================
# 메인 크롤러 실행기
# =============================================================================

# @MX:NOTE: 회사별 크롤러 함수 매핑
CRAWLER_MAP: dict[str, Any] = {
    "hyundai_marine": crawl_hyundai_marine,
    "db_insurance": crawl_db_insurance,
    "kb_insurance": crawl_kb_insurance,
    "meritz_fire": crawl_meritz_fire,
    "hanwha_general": crawl_hanwha_general,
    "heungkuk_fire": crawl_heungkuk_fire,
    "axa_general": crawl_axa_general,
    "mg_insurance": crawl_mg_insurance,
    "nh_fire": crawl_nh_fire,
    "nh_insurance": crawl_nh_fire,  # 별칭
    "lotte_insurance": crawl_lotte_insurance,
}


async def run_company(company_id: str) -> dict[str, Any]:
    """단일 회사 크롤러를 실행한다.

    # @MX:ANCHOR: 단일 회사 크롤링의 진입점, main 함수에서 호출됨
    # @MX:REASON: main() 및 CLI 인터페이스에서 공통 사용
    """
    try:
        from playwright.async_api import async_playwright  # type: ignore[import]
    except ImportError:
        logger.error("playwright가 설치되어 있지 않습니다. 다음 명령으로 설치하세요:")
        logger.error("  pip install playwright && playwright install chromium")
        return {"company_id": company_id, "downloaded": 0, "error": "playwright not installed"}

    config = COMPANY_CONFIG.get(company_id)
    if not config:
        logger.error("알 수 없는 회사 ID: %s", company_id)
        return {"company_id": company_id, "downloaded": 0, "error": "unknown company"}

    crawler_fn = CRAWLER_MAP.get(company_id) or CRAWLER_MAP.get(config.get("method", ""))
    if not crawler_fn:
        logger.error("크롤러 함수를 찾을 수 없습니다: %s", company_id)
        return {"company_id": company_id, "downloaded": 0, "error": "no crawler function"}

    logger.info("=" * 60)
    logger.info("크롤링 시작: %s (%s)", config["name"], company_id)
    logger.info("=" * 60)

    for attempt in range(1, 3):  # 최대 2회 재시도
        try:
            async with async_playwright() as pw:
                browser = await pw.chromium.launch(
                    headless=True,
                    args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
                )
                context = await browser.new_context(
                    user_agent=(
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/120.0.0.0 Safari/537.36"
                    ),
                    locale="ko-KR",
                    timezone_id="Asia/Seoul",
                    extra_http_headers={
                        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
                    },
                )
                try:
                    downloaded = await crawler_fn(context)
                    await browser.close()
                    return {
                        "company_id": company_id,
                        "company_name": config["name"],
                        "downloaded": downloaded,
                        "success": True,
                    }
                except Exception as exc:
                    await browser.close()
                    if attempt < 2:
                        logger.warning(
                            "[%s] 시도 %d 실패, 재시도 중: %s",
                            config["name"], attempt, exc,
                        )
                        await asyncio.sleep(3)
                    else:
                        raise
        except Exception as exc:
            logger.error("[%s] 크롤링 실패 (시도 %d/2): %s", config["name"], attempt, exc)
            if attempt >= 2:
                return {
                    "company_id": company_id,
                    "company_name": config["name"],
                    "downloaded": 0,
                    "success": False,
                    "error": str(exc),
                }

    return {"company_id": company_id, "downloaded": 0, "success": False}


async def main(companies: list[str] | None = None) -> None:
    """메인 실행 함수.

    # @MX:ANCHOR: CLI 진입점, 전체 또는 선택적 회사 크롤링 실행
    # @MX:REASON: if __name__ == '__main__' 블록과 argparse에서 호출됨
    """
    if companies is None:
        companies = list(CRAWLER_MAP.keys())
        # 중복 제거 (nh_insurance = nh_fire 별칭)
        seen = []
        seen_methods = set()
        for c in companies:
            method = COMPANY_CONFIG.get(c, {}).get("method", c)
            if method not in seen_methods:
                seen_methods.add(method)
                seen.append(c)
        companies = seen

    results = []
    total_downloaded = 0

    for company_id in companies:
        result = await run_company(company_id)
        results.append(result)
        total_downloaded += result.get("downloaded", 0)
        if len(companies) > 1:
            await asyncio.sleep(2)  # 회사 간 레이트 리밋

    # 결과 요약
    logger.info("\n%s", "=" * 60)
    logger.info("크롤링 완료 요약")
    logger.info("=" * 60)
    for r in results:
        status = "성공" if r.get("success") else "실패"
        logger.info(
            "  %-20s: %s (%d개 수집)",
            r.get("company_name", r.get("company_id", "")),
            status,
            r.get("downloaded", 0),
        )
        if r.get("error"):
            logger.info("    오류: %s", r["error"])
    logger.info("총 수집: %d개 PDF", total_downloaded)

    # 결과를 JSON으로 저장
    report_path = BASE_DATA_DIR / "nonlife_playwright_report.json"
    report_path.write_text(
        json.dumps(results, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    logger.info("결과 저장: %s", report_path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="손해보험사 약관 PDF Playwright 크롤러",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
사용 예시:
  # 전체 회사 크롤링
  cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python scripts/crawl_nonlife_playwright.py

  # 특정 회사만 크롤링
  cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python scripts/crawl_nonlife_playwright.py --company hyundai_marine
  cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python scripts/crawl_nonlife_playwright.py --company db_insurance

  # 여러 회사
  cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python scripts/crawl_nonlife_playwright.py --company hyundai_marine --company db_insurance

지원 회사:
""" + "\n".join(f"  {cid}: {cfg['name']}" for cid, cfg in COMPANY_CONFIG.items() if cid != "nh_insurance"),
    )
    parser.add_argument(
        "--company",
        action="append",
        dest="companies",
        choices=list(COMPANY_CONFIG.keys()),
        help="크롤링할 회사 ID (여러 개 지정 가능)",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="지원하는 회사 목록 출력",
    )

    args = parser.parse_args()

    if args.list:
        print("지원 회사 목록:")
        for cid, cfg in COMPANY_CONFIG.items():
            if cid != "nh_insurance":  # 별칭 제외
                print(f"  {cid}: {cfg['name']} ({cfg['url']})")
        sys.exit(0)

    asyncio.run(main(companies=args.companies))
