#!/usr/bin/env python3
"""cont.insure.or.kr JS 번들에서 API 엔드포인트 탐색"""
from __future__ import annotations

import re
import httpx

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "ko-KR,ko;q=0.9",
}


def fetch_text(url: str) -> str:
    try:
        r = httpx.get(url, headers=HEADERS, timeout=15, follow_redirects=True)
        return r.text if r.status_code == 200 else ""
    except Exception as e:
        print(f"  오류: {e}")
        return ""


# 1. 메인 페이지에서 JS 번들 파일 찾기
print("=== cont.insure.or.kr JS 번들 탐색 ===")
main_html = fetch_text("https://cont.insure.or.kr/cont_web/intro.do")
print(f"메인 페이지 크기: {len(main_html)}")

# JS 파일 링크 찾기
js_links = re.findall(r'src=["\']([^"\']+\.js[^"\']*)["\']', main_html)
print(f"JS 파일 수: {len(js_links)}")
for j in js_links[:5]:
    print(f"  {j}")

# 직접 알려진 JS 번들 패턴 시도
js_bundles = [
    "https://cont.insure.or.kr/cont_web/js/app.js",
    "https://cont.insure.or.kr/cont_web/js/main.js",
    "https://cont.insure.or.kr/cont_web/js/chunk-vendors.js",
    "https://cont.insure.or.kr/cont_web/static/js/app.js",
    "https://cont.insure.or.kr/cont_web/static/js/main.js",
]

for url in js_bundles:
    r = httpx.get(url, headers=HEADERS, timeout=10, follow_redirects=True)
    if r.status_code == 200 and len(r.text) > 1000:
        js_content = r.text
        print(f"\n✅ 발견: {url} (크기: {len(js_content)})")
        # API 패턴 찾기
        apis = re.findall(r'["\']([/][a-z][a-zA-Z0-9/_-]*(?:\.do|/api/[^"\']+))["\']', js_content)
        unique_apis = sorted(set(apis))
        print(f"  API 경로 ({len(unique_apis)}개):")
        for api in unique_apis[:20]:
            print(f"    {api}")
        break
    else:
        print(f"  [{r.status_code}] {url.split('/')[-1]}")

# 2. 실손보험 API 직접 테스트
print("\n=== cont.insure.or.kr API 직접 테스트 ===")
test_apis = [
    "https://cont.insure.or.kr/cont_web/api/v1/products",
    "https://cont.insure.or.kr/cont_web/api/products",
    "https://cont.insure.or.kr/api/v1/terms/search",
    "https://cont.insure.or.kr/api/terms",
    "https://cont.insure.or.kr/cont_web/terms",
    "https://cont.insure.or.kr/cont_web/api/terms",
]

for url in test_apis:
    r = httpx.get(url, headers={**HEADERS, "Accept": "application/json"}, timeout=5)
    print(f"  [{r.status_code}] {url.split('/', 3)[-1][:50]}: size={len(r.text)}")
