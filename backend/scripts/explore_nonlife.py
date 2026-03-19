#!/usr/bin/env python3
"""손해보험사 약관 페이지 탐색 스크립트"""
from __future__ import annotations

import re
import httpx

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9",
}


def check_page(name: str, url: str) -> None:
    try:
        r = httpx.get(url, headers=HEADERS, timeout=10, follow_redirects=True)
        html = r.text
        links = re.findall(r'href=["\']([^"\']+)["\']', html)
        term_links = [l for l in links if any(k in l.lower() for k in ["term", "clause", "약관", "contract", "규정"])]
        pdf_links = [l for l in links if ".pdf" in l.lower()]
        dl_links = [l for l in links if any(k in l.lower() for k in ["download", "filedown", "file_down"])]
        print(f"\n[{r.status_code}] {name}: size={len(html)} final_url={r.url}")
        if term_links:
            print(f"  약관링크({len(term_links)}): {term_links[:5]}")
        if pdf_links:
            print(f"  PDF링크({len(pdf_links)}): {pdf_links[:3]}")
        if dl_links:
            print(f"  다운로드링크({len(dl_links)}): {dl_links[:3]}")
        if not any([term_links, pdf_links, dl_links]):
            print(f"  (관련 링크 없음)")
    except Exception as e:
        print(f"\n[ERR] {name}: {e}")


# 손해보험사 약관 URL 시도
tests = [
    ("삼성화재_메인", "https://www.samsungfire.com"),
    ("삼성화재_약관", "https://www.samsungfire.com/consumer/commonprovisions/contractTerms.do"),
    ("현대해상_메인", "https://www.hi.co.kr"),
    ("현대해상_약관", "https://www.hi.co.kr/consumer/terms/contractTermsList.do"),
    ("DB손보_메인", "https://www.idbins.com"),
    ("메리츠화재_메인", "https://www.meritzfire.com"),
    ("메리츠화재_약관", "https://www.meritzfire.com/terms-clause/terms.html"),
    ("KB손보_메인", "https://www.kbinsure.co.kr"),
    ("롯데손보_메인", "https://www.lotteins.co.kr"),
    ("AXA손보_메인", "https://www.axa.co.kr"),
    ("흥국화재_메인", "https://www.hungkukfire.co.kr"),
    ("하나손보_메인", "https://www.hanaiins.com"),
    ("MG손보_메인", "https://www.mgfire.co.kr"),
    ("NH농협손보_메인", "https://www.nhfire.co.kr"),
    ("한화손보_메인", "https://www.hwgeneralins.co.kr"),
]

for name, url in tests:
    check_page(name, url)
