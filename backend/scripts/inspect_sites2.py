#!/usr/bin/env python3
"""보험 약관 공시 사이트 심층 분석"""

import re
import time
from pathlib import Path

OUT_DIR = Path(__file__).parent.parent / "data" / "site_inspection"
OUT_DIR.mkdir(parents=True, exist_ok=True)

def inspect_page(url: str, label: str) -> None:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        try:
            print(f"\n[{label}] {url}")
            page.goto(url, timeout=30000, wait_until="networkidle")
            time.sleep(3)
            html = page.content()
            print(f"  크기: {len(html)} bytes")

            # PDF/다운로드 링크 찾기
            pdf_links = re.findall(
                r'href=["\']([^"\']*(?:\.pdf|download|fileDown|pdfDown|view)[^"\']*)["\']',
                html, re.IGNORECASE
            )
            print(f"  PDF/다운로드 링크: {len(pdf_links)}개")
            for l in pdf_links[:10]:
                print(f"    {l[:100]}")

            # 약관 관련 링크
            policy_links = []
            links = page.query_selector_all("a")
            for link in links:
                try:
                    href = link.get_attribute("href") or ""
                    text = link.inner_text().strip()
                    if any(kw in text+href for kw in ["약관", "policy", "보험상품", "상품공시", "공시"]):
                        policy_links.append((text[:40], href[:80]))
                except Exception:
                    pass

            if policy_links:
                print(f"  약관 링크 ({len(policy_links)}개):")
                for text, href in policy_links[:15]:
                    print(f"    {text:30} -> {href}")

            # 테이블 구조
            tables = re.findall(r'<table[^>]*class=["\']([^"\']*)["\']', html, re.IGNORECASE)
            print(f"  테이블 클래스: {tables[:5]}")

            # HTML 저장
            safe_label = re.sub(r'[^\w]', '_', label)
            (OUT_DIR / f"deep_{safe_label}.html").write_text(html, encoding="utf-8")

        except Exception as e:
            print(f"  오류: {e}")
        finally:
            browser.close()


if __name__ == "__main__":
    # 생명보험 통합공시 시스템
    inspect_page("https://pub.insure.or.kr/", "insure_pub_main")
    inspect_page("https://pub.insure.or.kr/rps/RPSAA0001M.aspx", "insure_life_policy")

    # 손해보험 공시 시스템
    inspect_page("https://kpub.knia.or.kr/productDisc/guide/productInf.do", "knia_pub_product")

    # KNIA 약관 신상품 검토 (실제 페이지)
    inspect_page("https://www.knia.or.kr/report/new-review/new-review01", "knia_new_review")

    # 금감원 보험다모아 (통합 비교공시)
    inspect_page("https://www.e-insmarket.or.kr/", "einsmarket")
