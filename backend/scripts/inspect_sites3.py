#!/usr/bin/env python3
"""보험 약관 공시 사이트 심층 분석 - 실제 약관 PDF 찾기"""

import re
import time
from pathlib import Path

OUT_DIR = Path(__file__).parent.parent / "data" / "site_inspection"
OUT_DIR.mkdir(parents=True, exist_ok=True)

def inspect_and_save(url: str, label: str, follow_links: bool = False) -> None:
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

            # 약관 관련 링크 분석
            links = page.query_selector_all("a")
            found = []
            for link in links:
                try:
                    href = link.get_attribute("href") or ""
                    text = link.inner_text().strip()
                    if any(k in text+href for k in ["약관", "term", "clause", "policy", "prd", "상품", "비교공시", "공시", "보험료"]):
                        found.append((text[:50], href[:100]))
                except Exception:
                    pass

            print(f"  관련 링크 {len(found)}개:")
            for t, h in found[:20]:
                print(f"    {t:40} -> {h}")

            # /file/download 링크 수
            downloads = set(re.findall(r'(?:href=["\'])?(/file/download/[A-Za-z0-9+=/]+)', html))
            if downloads:
                print(f"  다운로드: {len(downloads)}개")

            safe = re.sub(r'[^\w]', '_', label)
            (OUT_DIR / f"v3_{safe}.html").write_text(html, encoding="utf-8")

        except Exception as e:
            print(f"  오류: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    # KLIA: 약관 공시 실제 위치 확인
    inspect_and_save("https://pub.insure.or.kr/summary/term/disclosureTerm.do", "klia_term_disclosure")
    inspect_and_save("https://pub.insure.or.kr/compareDis/mdclInsrn/contChange/etc.do", "klia_compare_dis")
    inspect_and_save("https://pub.insure.or.kr/summary/disRegal/list.do", "klia_disregal")

    # KNIA: 실제 상품공시 (약관 있는 곳)
    inspect_and_save("https://kpub.knia.or.kr/productDisc/nonlife/nonlifeDisclosure.do", "knia_nonlife_disc")
    inspect_and_save("https://consumer.knia.or.kr/disclosure.do", "knia_consumer_disc")

    # KNIA 신상품 검토 나머지 페이지
    inspect_and_save("https://www.knia.or.kr/report/new-review/new-review02", "knia_review02")
    inspect_and_save("https://www.knia.or.kr/report/new-review/new-review04", "knia_review04")
