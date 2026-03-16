#!/usr/bin/env python3
"""보험협회 사이트 구조 분석 - 실제 약관 목록 URL 및 HTML 패턴 파악"""

import re
import time
from pathlib import Path

OUT_DIR = Path(__file__).parent.parent / "data" / "site_inspection"
OUT_DIR.mkdir(parents=True, exist_ok=True)

KLIA_BASE = "https://www.klia.or.kr"
KNIA_BASE = "https://www.knia.or.kr"

def inspect_site(base_url: str, name: str) -> None:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        print(f"\n{'='*60}")
        print(f"[{name}] {base_url} 사이트 분석")
        print('='*60)

        # 메인 페이지 접속
        page.goto(base_url, timeout=30000, wait_until="networkidle")
        time.sleep(2)

        html = page.content()
        (OUT_DIR / f"{name}_main.html").write_text(html, encoding="utf-8")
        print(f"  메인 페이지: {len(html)} bytes 저장")

        # 메인 페이지에서 약관 관련 링크 찾기
        links = page.query_selector_all("a")
        policy_links = []
        for link in links:
            href = link.get_attribute("href") or ""
            text = link.inner_text().strip()
            if any(kw in text + href for kw in ["약관", "policy", "prd", "prod", "상품"]):
                policy_links.append((href, text))

        print(f"\n  약관 관련 링크 ({len(policy_links)}개):")
        for href, text in policy_links[:20]:
            print(f"    {text[:30]:30} -> {href[:60]}")

        # 약관 페이지 후보 방문
        candidate_urls = []
        for href, text in policy_links:
            if href.startswith("/"):
                candidate_urls.append(f"{base_url}{href}")
            elif href.startswith("http"):
                candidate_urls.append(href)

        # 중복 제거
        candidate_urls = list(dict.fromkeys(candidate_urls))[:5]

        for url in candidate_urls:
            try:
                print(f"\n  후보 페이지: {url}")
                page.goto(url, timeout=20000, wait_until="networkidle")
                time.sleep(2)
                page_html = page.content()

                # PDF 링크 개수 확인
                pdf_count = len(re.findall(r'\.pdf|fileDown|pdfDown|download', page_html, re.IGNORECASE))
                print(f"    크기: {len(page_html)} bytes, PDF 관련: {pdf_count}개")

                if pdf_count > 0:
                    safe_name = re.sub(r'[^\w]', '_', url[len(base_url):])[:50]
                    (OUT_DIR / f"{name}_{safe_name}.html").write_text(page_html, encoding="utf-8")
                    print(f"    저장됨!")

                    # 첫 번째 PDF 링크 출력
                    pdf_matches = re.findall(
                        r'href=["\']([^"\']*(?:\.pdf|fileDown|pdfDown|download)[^"\']*)["\']',
                        page_html, re.IGNORECASE
                    )[:5]
                    print(f"    PDF 링크 샘플:")
                    for m in pdf_matches:
                        print(f"      {m[:80]}")

                    # 테이블 구조 확인
                    tables = re.findall(r'<table[^>]*>(.*?)</table>', page_html, re.DOTALL)
                    print(f"    테이블: {len(tables)}개")

                    # div 구조 확인
                    divs_with_data = len(re.findall(r'<div[^>]*class=["\'][^"\']*(?:list|item|row|product)[^"\']*["\']', page_html, re.IGNORECASE))
                    print(f"    데이터 div: {divs_with_data}개")

            except Exception as e:
                print(f"    실패: {e}")

        browser.close()

if __name__ == "__main__":
    inspect_site(KLIA_BASE, "klia")
    inspect_site(KNIA_BASE, "knia")
    print(f"\n분석 결과 저장됨: {OUT_DIR}")
