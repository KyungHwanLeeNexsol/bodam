#!/usr/bin/env python3
"""손해보험사 약관 URL 패턴 탐색 - 사이트맵 및 표준 경로 시도"""
from __future__ import annotations

import re
import httpx
import time

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9",
}

# 손해보험사별 도메인 및 시도할 약관 URL 경로
COMPANY_URLS = {
    "samsung_fire": {
        "name": "삼성화재",
        "domain": "https://www.samsungfire.com",
        "term_paths": [
            "/consumer/contract/terms.do",
            "/consumer/commonprovisions/contractTermsKo.do",
            "/consumer/commonprovisions/termsSearch.do",
            "/contract/terms/list.do",
        ],
    },
    "hyundai_marine": {
        "name": "현대해상",
        "domain": "https://www.hi.co.kr",
        "term_paths": [
            "/consumer/terms/list.do",
            "/consumer/contract/terms.do",
            "/terms/list.do",
        ],
    },
    "db_insurance": {
        "name": "DB손해보험",
        "domain": "https://www.idbins.com",
        "term_paths": [
            "/consumer/terms/list.do",
            "/customer/terms.do",
            "/terms.do",
        ],
    },
    "kb_insurance": {
        "name": "KB손해보험",
        "domain": "https://www.kbinsure.co.kr",
        "term_paths": [
            "/CG302000000.ec",
            "/consumer/terms/list.do",
            "/contract/clause/list.do",
        ],
    },
    "meritz_fire": {
        "name": "메리츠화재",
        "domain": "https://www.meritzfire.com",
        "term_paths": [
            "/terms-clause/terms.html",
            "/consumer/terms/list.do",
            "/terms/list.do",
        ],
    },
    "nh_insurance": {
        "name": "NH농협손해보험",
        "domain": "https://www.nhfire.co.kr",
        "term_paths": [
            "/customer/terms/main.do",
            "/consumer/terms/list.do",
            "/terms/list.do",
        ],
    },
    "lotte_insurance": {
        "name": "롯데손해보험",
        "domain": "https://www.lotteins.co.kr",
        "term_paths": [
            "/consumer/terms/list.do",
            "/terms/list.do",
            "/contract/terms.do",
        ],
    },
    "axa_general": {
        "name": "AXA손해보험",
        "domain": "https://www.axa.co.kr",
        "term_paths": [
            "/cui/consumer/terms.do",
            "/consumer/terms/list.do",
            "/terms/list.do",
        ],
    },
}

for cid, info in COMPANY_URLS.items():
    name = info["name"]
    domain = info["domain"]
    print(f"\n=== {name} ===")

    for path in info["term_paths"]:
        url = domain + path
        try:
            r = httpx.get(url, headers=HEADERS, timeout=8, follow_redirects=True)
            html = r.text
            pdf_count = len(re.findall(r"\.pdf", html, re.I))
            dl_count = len(re.findall(r"(?:download|filedown|파일)", html, re.I))
            fn_count = len(re.findall(r"fn_fileDown|fn_download", html, re.I))
            if r.status_code == 200 and len(html) > 5000:
                print(f"  ✅ [{r.status_code}] {path}: size={len(html)} pdfs={pdf_count} dl={dl_count} fn={fn_count}")
                if pdf_count > 0 or fn_count > 0:
                    print(f"     → PDF/다운로드 발견!")
                    # PDF 링크 출력
                    pdf_links = re.findall(r'href="([^"]*\.pdf[^"]*)"', html, re.I)
                    for pl in pdf_links[:3]:
                        print(f"       {pl}")
                break
            else:
                print(f"  ❌ [{r.status_code}] {path}: size={len(html)}")
        except Exception as e:
            print(f"  💥 {path}: {str(e)[:60]}")
        time.sleep(0.3)
