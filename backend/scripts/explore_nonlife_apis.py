#!/usr/bin/env python3
"""손해보험사 약관 API 탐색 스크립트 (Playwright 네트워크 인터셉트)

각 보험사 사이트에서 약관 페이지를 방문하고 API 엔드포인트를 탐색한다.
발견된 PDF URL 패턴을 저장하여 크롤러 구축에 활용한다.

실행:
    cd backend && PYTHONPATH=. python scripts/explore_nonlife_apis.py
    cd backend && PYTHONPATH=. python scripts/explore_nonlife_apis.py --company hyundai_marine

# @MX:NOTE: 각 회사의 약관 API 패턴 발견용 탐색 스크립트
# @MX:SPEC: SPEC-CRAWL-001
"""
from __future__ import annotations

import asyncio
import json
import logging
import sys
import re
import argparse
from pathlib import Path
from urllib.parse import urlparse

if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s",
                    handlers=[logging.StreamHandler(sys.stdout)])
logger = logging.getLogger(__name__)

from playwright.async_api import async_playwright, Page, Response

OUTPUT_DIR = Path(__file__).parent.parent / "data" / "api_discovery"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# 각 회사별 약관 탐색 설정
COMPANY_TARGETS = {
    "hyundai_marine": {
        "name": "현대해상",
        "main_url": "https://www.hi.co.kr",
        "terms_nav_keywords": ["약관", "보험약관", "약관찾기"],
        "search_params": {"보험종류": "상해", "건강": "건강"},
    },
    "db_insurance": {
        "name": "DB손해보험",
        "main_url": "https://www.idbins.com",
        "terms_nav_keywords": ["약관", "보험약관", "기초서류"],
        "direct_url": "https://www.idbins.com/FWMAIV1534.do",
    },
    "kb_insurance": {
        "name": "KB손해보험",
        "main_url": "https://www.kbinsure.co.kr",
        "terms_nav_keywords": ["약관", "보험약관"],
    },
    "meritz_fire": {
        "name": "메리츠화재",
        "main_url": "https://www.meritzfire.com",
        "terms_nav_keywords": ["약관", "보험약관"],
        "direct_url": "https://www.meritzfire.com/customer/publicTerms/list.do",
    },
    "hanwha_general": {
        "name": "한화손해보험",
        "main_url": "https://www.hwgeneralins.com",
        "terms_nav_keywords": ["약관", "보험약관"],
    },
    "heungkuk_fire": {
        "name": "흥국화재",
        "main_url": "https://www.heungkukfire.co.kr",
        "terms_nav_keywords": ["약관", "보험약관"],
    },
    "axa_general": {
        "name": "AXA손해보험",
        "main_url": "https://www.axa.co.kr",
        "terms_nav_keywords": ["약관", "보험약관"],
    },
    "mg_insurance": {
        "name": "MG손해보험(예별)",
        "main_url": "https://www.yebyeol.co.kr",
        "terms_nav_keywords": ["약관", "보험약관"],
        "direct_url": "https://www.yebyeol.co.kr/PB031210DM.scp",
    },
    "nh_fire": {
        "name": "NH농협손해보험",
        "main_url": "https://www.nhfire.co.kr",
        "terms_nav_keywords": ["약관", "보험약관"],
    },
    "lotte_insurance": {
        "name": "롯데손해보험",
        "main_url": "https://www.lotteins.co.kr",
        "terms_nav_keywords": ["약관", "보험약관"],
    },
    "hana_insurance": {
        "name": "하나손해보험",
        "main_url": "https://www.hanaworldwide.com",
        "terms_nav_keywords": ["약관", "보험약관"],
    },
}


def is_pdf_url(url: str) -> bool:
    """URL이 PDF를 가리키는지 확인한다."""
    return ".pdf" in url.lower() or "yakgwan" in url.lower() or "filedown" in url.lower()


def is_terms_api(url: str, body: str) -> bool:
    """응답이 약관 API인지 확인한다."""
    url_lower = url.lower()
    if any(kw in url_lower for kw in ["terms", "clause", "yakgwan", "약관"]):
        return True
    if body and len(body) > 5000:
        if any(kw in body for kw in ["prdName", "약관명", "상품명", "fileNm", "filePath"]):
            return True
    return False


async def explore_company(company_id: str, config: dict) -> dict:
    """특정 보험사의 약관 API를 탐색한다."""
    name = config["name"]
    logger.info("탐색 시작: %s (%s)", name, company_id)

    discovered = {
        "company_id": company_id,
        "company_name": name,
        "api_urls": [],
        "pdf_urls": [],
        "pdf_patterns": [],
        "errors": [],
    }

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
            locale="ko-KR",
        )
        page = await context.new_page()

        # 네트워크 인터셉트
        captured_apis: list[dict] = []
        captured_pdfs: list[str] = []

        async def on_response(response: Response):
            url = response.url
            if is_pdf_url(url):
                captured_pdfs.append(url)
                logger.info("  PDF URL 발견: %s", url)
                return
            # JSON/AJAX 응답 체크
            content_type = response.headers.get("content-type", "")
            if "json" in content_type or "javascript" in content_type:
                try:
                    body = await response.text()
                    if is_terms_api(url, body):
                        captured_apis.append({"url": url, "size": len(body), "sample": body[:200]})
                        logger.info("  API 발견: %s (%d bytes)", url, len(body))
                except Exception:
                    pass

        page.on("response", on_response)

        # 메인 페이지 방문
        main_url = config.get("direct_url") or config["main_url"]
        try:
            await page.goto(main_url, timeout=30000, wait_until="networkidle")
            logger.info("  %s 로드 완료", main_url)

            # 현재 페이지에서 약관 링크 찾기
            nav_keywords = config.get("terms_nav_keywords", ["약관"])
            for keyword in nav_keywords:
                try:
                    links = await page.query_selector_all(f"a:has-text('{keyword}')")
                    for link in links[:3]:
                        href = await link.get_attribute("href")
                        if href and href != "#":
                            logger.info("  약관 링크 발견: %s -> %s", keyword, href)
                            # 링크 클릭 또는 직접 이동
                            try:
                                await page.goto(
                                    href if href.startswith("http") else f"{config['main_url']}{href}",
                                    timeout=20000, wait_until="networkidle"
                                )
                                await asyncio.sleep(2)

                                # 페이지 소스에서 PDF 링크 추출
                                page_content = await page.content()
                                pdf_hrefs = re.findall(r"['\"]([^'\"]*\.pdf[^'\"]*)['\"]", page_content)
                                for ph in pdf_hrefs[:5]:
                                    if ph not in captured_pdfs:
                                        captured_pdfs.append(ph)
                                        logger.info("  페이지 PDF: %s", ph)
                            except Exception as e:
                                logger.warning("  링크 이동 실패: %s", e)
                            break
                except Exception:
                    pass

            # 직접 URL이 메인과 다른 경우, 메인 탐색 후 direct URL도 방문
            if config.get("direct_url") and config["direct_url"] != main_url:
                try:
                    await page.goto(config["direct_url"], timeout=20000, wait_until="networkidle")
                    await asyncio.sleep(2)
                    page_content = await page.content()
                    pdf_hrefs = re.findall(r"['\"]([^'\"]*\.pdf[^'\"]*)['\"]", page_content)
                    for ph in pdf_hrefs[:5]:
                        if ph not in captured_pdfs:
                            captured_pdfs.append(ph)
                except Exception as e:
                    logger.warning("  direct URL 방문 실패: %s", e)

        except Exception as e:
            logger.error("  %s 탐색 실패: %s", name, e)
            discovered["errors"].append(str(e))

        await browser.close()

        discovered["api_urls"] = captured_apis
        discovered["pdf_urls"] = captured_pdfs[:20]

        # PDF 패턴 추출
        for url in captured_pdfs:
            parsed = urlparse(url)
            # 파일명 패턴 추출
            path = parsed.path
            pattern = re.sub(r"/\d{4,}", "/{ID}", path)
            pattern = re.sub(r"/[A-Z0-9]{6,}", "/{CODE}", pattern)
            if pattern not in discovered["pdf_patterns"]:
                discovered["pdf_patterns"].append(pattern)

    return discovered


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--company", help="특정 회사만 탐색 (company_id)")
    args = parser.parse_args()

    if args.company:
        companies = {args.company: COMPANY_TARGETS[args.company]} if args.company in COMPANY_TARGETS else {}
    else:
        companies = COMPANY_TARGETS

    if not companies:
        print(f"알 수 없는 회사: {args.company}")
        print(f"사용 가능: {list(COMPANY_TARGETS.keys())}")
        return

    all_results = []

    for company_id, config in companies.items():
        try:
            result = await explore_company(company_id, config)
            all_results.append(result)

            print(f"\n{'='*50}")
            print(f"[{config['name']}] 탐색 결과")
            print(f"  API 발견: {len(result['api_urls'])}개")
            for api in result["api_urls"]:
                print(f"    - {api['url']} ({api['size']}b)")
                print(f"      샘플: {api['sample'][:100]}")
            print(f"  PDF URL 발견: {len(result['pdf_urls'])}개")
            for pdf in result["pdf_urls"][:5]:
                print(f"    - {pdf}")
            print(f"  PDF 패턴: {result['pdf_patterns']}")
            if result["errors"]:
                print(f"  오류: {result['errors']}")

        except Exception as e:
            logger.error("%s 탐색 중 예외: %s", company_id, e)
            all_results.append({"company_id": company_id, "error": str(e)})

    # 결과 저장
    output_path = OUTPUT_DIR / "nonlife_api_discovery.json"
    output_path.write_text(json.dumps(all_results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n결과 저장: {output_path}")

    # 요약
    print(f"\n{'='*50}")
    print("탐색 요약")
    for r in all_results:
        name = r.get("company_name", r.get("company_id"))
        api_count = len(r.get("api_urls", []))
        pdf_count = len(r.get("pdf_urls", []))
        print(f"  {name}: API {api_count}개, PDF {pdf_count}개")


if __name__ == "__main__":
    asyncio.run(main())
