#!/usr/bin/env python3
"""consumer.knia.or.kr 내부 API 및 다운로드 링크 탐색"""
from __future__ import annotations

import re
import httpx

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,*/*",
    "Accept-Language": "ko-KR,ko;q=0.9",
}

r = httpx.get(
    "https://consumer.knia.or.kr/disclosure/company/All/08.do",
    headers=HEADERS, timeout=15, follow_redirects=True
)
html = r.text
print(f"크기: {len(html)}")

# JS 파일들
js_files = re.findall(r'src=["\'](/[^"\']*\.js[^"\']*)["\']', html)
print("JS 파일들:", js_files[:5])

# .do 경로들
paths = re.findall(r'["\'](/[a-z][a-zA-Z0-9/_\-]*\.do)["\']', html)
unique_paths = sorted(set(paths))
print("경로들:", unique_paths[:20])

# ajax 패턴
ajax = re.findall(r'(?:url|href|action)\s*[:=]\s*["\'](/[^"\']+)["\']', html)
print("Ajax URL들:", sorted(set(ajax))[:15])

# 약관 관련 텍스트 (컨텍스트 포함)
for match in re.finditer(r'.{0,50}(약관|terms|clause|download|파일).{0,50}', html, re.IGNORECASE)[:5]:
    print("약관/다운로드 컨텍스트:", match.group(0)[:100])

# 인라인 JS에서 API 찾기
inline_js = re.findall(r'<script[^>]*>(.*?)</script>', html, re.DOTALL)
all_js = " ".join(inline_js)
api_calls = re.findall(r'(?:ajax|fetch|axios|http).*?["\']([^"\']+\.do)["\']', all_js)
print("JS 내 API 호출:", api_calls[:10])

# HTML 샘플 (중간 부분)
mid = len(html) // 2
print("HTML 중간 샘플:", html[mid:mid+500])
