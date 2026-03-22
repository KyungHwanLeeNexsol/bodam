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
    """흥국화재 약관 PDF를 수집한다.

    # @MX:NOTE: 흥국화재 메인은 타임아웃 발생 가능, 약관 전용 URL 직접 접근
    # @MX:NOTE: /consumer/terms/list.do 경로 확인됨
    """
    company_id = "heungkuk_fire"
    company_name = "흥국화재"
    downloaded = 0
    found_pdfs: list[dict] = []

    async def on_response(response: Any) -> None:
        url = response.url
        if url.lower().endswith(".pdf"):
            found_pdfs.append({"url": url, "name": Path(urlparse(url).path).stem})
        ct = response.headers.get("content-type", "")
        if "json" in ct:
            try:
                body = await response.body()
                if len(body) > 300:
                    try:
                        data = json.loads(body)
                        data_str = json.dumps(data, ensure_ascii=False)
                        if any(kw in data_str for kw in ["약관", "fileNm", "pdfUrl", "filePath"]):
                            found_pdfs.append({"type": "json", "url": url, "data": data})
                    except Exception:
                        pass
            except Exception:
                pass

    page = await context.new_page()
    page.on("response", on_response)

    try:
        # 약관 전용 URL 먼저 시도 (메인보다 응답이 빠름)
        term_urls = [
            "https://www.heungkukfire.co.kr/consumer/terms/list.do",
            "https://www.heungkukfire.co.kr/disclosure/terms/list.do",
            "https://www.heungkukfire.co.kr",
        ]

        for turl in term_urls:
            logger.info("[흥국화재] URL 접속 시도: %s", turl)
            try:
                await page.goto(turl, timeout=PAGE_TIMEOUT, wait_until="domcontentloaded")
                await asyncio.sleep(3)
                content = await page.content()
                if len(content) > 500:
                    logger.info("[흥국화재] 접속 성공: %s (%d bytes)", turl, len(content))

                    # 약관 카테고리 클릭
                    for cat in ["건강", "상해", "질병", "종합"]:
                        try:
                            await page.evaluate(f"""
                                () => {{
                                    Array.from(document.querySelectorAll('a, button, li, span')).forEach(el => {{
                                        if (el.textContent.trim().includes('{cat}')) el.click();
                                    }});
                                }}
                            """)
                            await asyncio.sleep(2)
                        except Exception:
                            pass

                    # 판매중 링크 수집 후 경계 기록
                    on_sale_links = await page.evaluate("""
                        () => Array.from(document.querySelectorAll('a[href*=".pdf"], a[href*="download"], a[href*="Down"]'))
                            .map(a => ({href: a.href, text: a.textContent.trim()}))
                    """)
                    on_sale_boundary_json = len([f for f in found_pdfs if not isinstance(f, dict) or f.get("type") != "json"])

                    # 판매중지 탭 클릭 시도
                    await try_click_discontinued_tab_pl(page, company_name)

                    # 판매중지 링크 수집
                    disc_links = await page.evaluate("""
                        () => Array.from(document.querySelectorAll('a[href*=".pdf"], a[href*="download"], a[href*="Down"]'))
                            .map(a => ({href: a.href, text: a.textContent.trim()}))
                    """)

                    seen: set[str] = set()
                    for link_status, link_list in [("ON_SALE", on_sale_links), ("DISCONTINUED", disc_links)]:
                        for link in link_list[:50]:
                            href = link.get("href", "")
                            text = link.get("text", "")
                            if not href or href in seen:
                                continue
                            seen.add(href)
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

                    # JSON 응답에서 PDF 추출
                    for item in found_pdfs:
                        if isinstance(item, dict) and item.get("type") == "json":
                            pdf_links = extract_pdf_links_from_json(item["data"], "https://www.heungkukfire.co.kr")
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
                                    )
                                    if not result.get("skipped"):
                                        downloaded += 1
                                await asyncio.sleep(1)
                    break
            except Exception as exc:
                logger.warning("[흥국화재] URL 접속 실패 (%s): %s", turl, exc)

    finally:
        await page.close()

    logger.info("[흥국화재] 총 %d개 PDF 수집 완료", downloaded)
    return downloaded


# =============================================================================
# AXA손해보험 크롤러
# =============================================================================

async def crawl_axa_general(context: Any) -> int:
    """AXA손해보험 약관 PDF를 수집한다.

    # @MX:NOTE: AXA는 SPA (/cui/ 경로), 메뉴 클릭으로 약관 섹션 탐색
    """
    company_id = "axa_general"
    company_name = "AXA손해보험"
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
                        if any(kw in data_str for kw in ["약관", "fileNm", "filePath", "pdfUrl"]):
                            found_items.append({"type": "json", "url": url, "data": data})
                    except Exception:
                        pass
            except Exception:
                pass

    page = await context.new_page()
    page.on("response", on_response)

    try:
        logger.info("[AXA손해보험] SPA 로딩...")
        await page.goto("https://www.axa.co.kr/cui/", timeout=PAGE_TIMEOUT, wait_until="networkidle")
        await asyncio.sleep(4)

        # 약관 메뉴 탐색 및 클릭
        for nav_text in ["약관", "보험약관", "공시", "약관정보", "상품안내"]:
            try:
                clicked = await page.evaluate(f"""
                    () => {{
                        const els = Array.from(document.querySelectorAll('a, button, li, nav'));
                        for (const el of els) {{
                            if (el.textContent.trim().includes('{nav_text}')) {{
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

        # 약관 전용 URL 시도
        for turl in ["https://www.axa.co.kr/cui/#/terms", "https://www.axa.co.kr/terms", "https://www.axa.co.kr/info/terms"]:
            try:
                await page.goto(turl, timeout=PAGE_TIMEOUT, wait_until="domcontentloaded")
                await asyncio.sleep(3)
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
                pdf_links = extract_pdf_links_from_json(item["data"], "https://www.axa.co.kr")
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

    logger.info("[AXA손해보험] 총 %d개 PDF 수집 완료", downloaded)
    return downloaded


# =============================================================================
# MG손해보험(예별) 크롤러
# =============================================================================

async def crawl_mg_insurance(context: Any) -> int:
    """MG손해보험 약관 PDF를 수집한다.

    # @MX:NOTE: yebyeol.co.kr, 독자적인 .scp 확장자 시스템
    """
    company_id = "mg_insurance"
    company_name = "MG손해보험"
    downloaded = 0
    found_items: list[dict] = []

    async def on_response(response: Any) -> None:
        url = response.url
        if any(ext in url.lower() for ext in [".css", ".png", ".jpg", ".gif", ".ico", ".woff", ".svg"]):
            return
        if url.lower().endswith(".pdf") or "/pdf/" in url.lower():
            found_items.append({"type": "pdf", "url": url})
            return
        ct = response.headers.get("content-type", "")
        if "json" in ct or "text" in ct:
            try:
                body = await response.body()
                if len(body) > 300:
                    try:
                        data = json.loads(body)
                        data_str = json.dumps(data, ensure_ascii=False)
                        if any(kw in data_str for kw in ["약관", "fileNm", "filePath", "pdfUrl", "fileName"]):
                            found_items.append({"type": "json", "url": url, "data": data})
                    except Exception:
                        pass
            except Exception:
                pass

    page = await context.new_page()
    page.on("response", on_response)

    try:
        logger.info("[MG손해보험] 약관 페이지 로딩...")
        await page.goto(
            "https://www.yebyeol.co.kr/PB031210DM.scp",
            timeout=PAGE_TIMEOUT,
            wait_until="domcontentloaded",
        )
        await asyncio.sleep(4)

        # 카테고리 클릭
        for cat in ["건강", "상해", "질병", "종합", "실손"]:
            try:
                await page.evaluate(f"""
                    () => {{
                        Array.from(document.querySelectorAll('a, button, li, td')).forEach(el => {{
                            if (el.textContent.trim().includes('{cat}')) el.click();
                        }});
                    }}
                """)
                await asyncio.sleep(2)
            except Exception:
                pass

        # 판매중지 탭 클릭 전 경계 기록
        on_sale_boundary = len(found_items)
        # 판매중지 탭 클릭 시도
        await try_click_discontinued_tab_pl(page, company_name)

        # PDF 링크 수집
        links = await page.evaluate("""
            () => {
                const results = [];
                document.querySelectorAll('a').forEach(a => {
                    const href = a.href || a.getAttribute('href') || '';
                    const onclick = a.getAttribute('onclick') || '';
                    const text = a.textContent.trim();
                    if (href.includes('pdf') || href.includes('down') || href.endsWith('.pdf') ||
                        onclick.includes('pdf') || onclick.includes('down')) {
                        results.push({href, onclick, text});
                    }
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
                pdf_links = extract_pdf_links_from_json(item["data"], "https://www.yebyeol.co.kr")
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

        for link in links[:30]:
            href = link.get("href", "")
            text = link.get("text", "")
            if href and href not in seen and not is_disease_injury(text) is False:
                seen.add(href)
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

    finally:
        await page.close()

    logger.info("[MG손해보험] 총 %d개 PDF 수집 완료", downloaded)
    return downloaded


# =============================================================================
# NH농협손해보험 크롤러
# =============================================================================

async def crawl_nh_fire(context: Any) -> int:
    """NH농협손해보험 약관 PDF를 수집한다.

    # @MX:NOTE: nhfire.co.kr, .nhfire 독자 확장자 가능성
    """
    company_id = "nh_fire"
    company_name = "NH농협손해보험"
    downloaded = 0
    found_items: list[dict] = []

    async def on_response(response: Any) -> None:
        url = response.url
        if any(ext in url.lower() for ext in [".css", ".png", ".jpg", ".gif", ".ico", ".woff", ".svg"]):
            return
        if url.lower().endswith(".pdf") or "/pdf/" in url.lower():
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
                        if any(kw in data_str for kw in ["약관", "fileNm", "pdfUrl", "filePath"]):
                            found_items.append({"type": "json", "url": url, "data": data})
                    except Exception:
                        pass
            except Exception:
                pass

    page = await context.new_page()
    page.on("response", on_response)

    try:
        logger.info("[NH농협손해보험] 메인 페이지 로딩...")
        await page.goto("https://www.nhfire.co.kr", timeout=PAGE_TIMEOUT, wait_until="domcontentloaded")
        await asyncio.sleep(3)

        # 약관 메뉴 탐색
        for nav_text in ["약관", "보험약관", "공시실", "약관조회"]:
            try:
                clicked = await page.evaluate(f"""
                    () => {{
                        const els = Array.from(document.querySelectorAll('a, button, li'));
                        for (const el of els) {{
                            if (el.textContent.trim().includes('{nav_text}')) {{
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

        # 약관 전용 URL 시도
        term_urls = [
            "https://www.nhfire.co.kr/front/consumer/publicTerms.nhfire",
            "https://www.nhfire.co.kr/consumer/terms",
            "https://www.nhfire.co.kr/about/terms",
        ]
        for turl in term_urls:
            try:
                await page.goto(turl, timeout=PAGE_TIMEOUT, wait_until="domcontentloaded")
                await asyncio.sleep(3)
                content = await page.content()
                if "약관" in content and len(content) > 1000:
                    logger.info("[NH농협손해보험] 약관 페이지 접근 성공: %s", turl)
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
                pdf_links = extract_pdf_links_from_json(item["data"], "https://www.nhfire.co.kr")
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

        # 페이지에서 직접 PDF 링크 탐색
        links = await page.evaluate("""
            () => Array.from(document.querySelectorAll('a[href*=".pdf"], a[href*="download"], a[href*="Down"]'))
                .map(a => ({href: a.href, text: a.textContent.trim()}))
        """)
        for link in links[:30]:
            href = link.get("href", "")
            text = link.get("text", "")
            if href and href not in seen:
                seen.add(href)
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

    finally:
        await page.close()

    logger.info("[NH농협손해보험] 총 %d개 PDF 수집 완료", downloaded)
    return downloaded


# =============================================================================
# 롯데손해보험 크롤러
# =============================================================================

async def crawl_lotte_insurance(context: Any) -> int:
    """롯데손해보험 약관 PDF를 수집한다.

    # @MX:NOTE: lotteins.co.kr, JSP 기반 사이트
    """
    company_id = "lotte_insurance"
    company_name = "롯데손해보험"
    downloaded = 0
    found_items: list[dict] = []

    async def on_response(response: Any) -> None:
        url = response.url
        if any(ext in url.lower() for ext in [".css", ".png", ".jpg", ".gif", ".ico", ".woff", ".svg"]):
            return
        if url.lower().endswith(".pdf") or "/pdf/" in url.lower():
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
                        if any(kw in data_str for kw in ["약관", "fileNm", "pdfUrl", "filePath"]):
                            found_items.append({"type": "json", "url": url, "data": data})
                    except Exception:
                        pass
            except Exception:
                pass

    page = await context.new_page()
    page.on("response", on_response)

    try:
        logger.info("[롯데손해보험] 메인 페이지 로딩...")
        await page.goto("https://www.lotteins.co.kr", timeout=PAGE_TIMEOUT, wait_until="domcontentloaded")
        await asyncio.sleep(3)

        # 약관 메뉴 탐색
        for nav_text in ["약관", "보험약관", "공시", "약관조회", "약관정보"]:
            try:
                clicked = await page.evaluate(f"""
                    () => {{
                        const els = Array.from(document.querySelectorAll('a, button, li'));
                        for (const el of els) {{
                            if (el.textContent.trim().includes('{nav_text}')) {{
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

        # JSP 특유의 약관 URL 패턴 시도
        term_urls = [
            "https://www.lotteins.co.kr/html/terms/termsList.jsp",
            "https://www.lotteins.co.kr/html/terms/terms.jsp",
            "https://www.lotteins.co.kr/terms",
            "https://www.lotteins.co.kr/consumer/terms",
        ]
        for turl in term_urls:
            try:
                await page.goto(turl, timeout=PAGE_TIMEOUT, wait_until="domcontentloaded")
                await asyncio.sleep(3)
                content = await page.content()
                if "약관" in content and len(content) > 1000:
                    logger.info("[롯데손해보험] 약관 페이지 접근 성공: %s", turl)

                    # 카테고리 클릭
                    for cat in ["건강", "상해", "질병", "종합"]:
                        try:
                            await page.evaluate(f"""
                                () => {{
                                    Array.from(document.querySelectorAll('a, button, li, td')).forEach(el => {{
                                        if (el.textContent.trim().includes('{cat}')) el.click();
                                    }});
                                }}
                            """)
                            await asyncio.sleep(2)
                        except Exception:
                            pass
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
                pdf_links = extract_pdf_links_from_json(item["data"], "https://www.lotteins.co.kr")
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

        # 페이지에서 직접 PDF 링크 탐색
        links = await page.evaluate("""
            () => Array.from(document.querySelectorAll('a[href*=".pdf"], a[href*="download"], a[href*="Down"]'))
                .map(a => ({href: a.href, text: a.textContent.trim()}))
        """)
        for link in links[:30]:
            href = link.get("href", "")
            text = link.get("text", "")
            if href and href not in seen:
                seen.add(href)
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
