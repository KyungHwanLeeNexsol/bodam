#!/usr/bin/env python3
"""pub.insure.or.kr HTML rowspan 문제 분석 - 회사명 추출 검증"""
from __future__ import annotations

import re
import httpx

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://pub.insure.or.kr",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
}

LISTING_URL = "https://pub.insure.or.kr/compareDis/prodCompare/assurance/listNew.do"
FILE_DOWN_PATTERN = re.compile(r"fn_fileDown\('(\d+)',\s*'(\d+)'\)")

# 종신보험 카테고리 (024400010001) 첫 페이지 가져오기
params = {
    "pageIndex": "1",
    "pageUnit": "100",
    "search_columnArea": "simple",
    "all_search_memberCd": "all",
    "search_prodGroup": "024400010001",
}

r = httpx.post(LISTING_URL, data=params, headers=HEADERS, timeout=30, follow_redirects=True)
html = r.text
print(f"HTML 크기: {len(html)}")

# fn_fileDown 패턴 찾기
file_infos = FILE_DOWN_PATTERN.findall(html)
print(f"fn_fileDown 패턴: {len(file_infos)}개")

# 각 fn_fileDown에 대해 회사명 추출 시도 (현재 extract_product_info 방식)
def extract_product_info(html: str, file_no: str, seq: str) -> tuple[str, str]:
    pattern = rf"<tr[^>]*>(.*?)fn_fileDown\('{re.escape(file_no)}',\s*'{re.escape(seq)}'\)"
    match = re.search(pattern, html, re.DOTALL)
    if not match:
        return "", ""
    tr_content = match.group(1)
    tds = re.findall(r"<td[^>]*>(.*?)</td>", tr_content, re.DOTALL)
    texts = []
    for td in tds:
        clean = re.sub(r"<[^>]+>", "", td).strip()
        clean = re.sub(r"\s+", " ", clean).strip()
        if clean:
            texts.append(clean)
    company_name = texts[0] if texts else ""
    product_name = texts[1] if len(texts) > 1 else ""
    return company_name, product_name

# 처음 15개 확인
found_companies = set()
missing_companies = []
print("\n회사명 추출 결과 (처음 20개):")
for i, (file_no, seq) in enumerate(file_infos[:20]):
    company, product = extract_product_info(html, file_no, seq)
    status = "✅" if company else "❌"
    print(f"  [{i+1}] {status} company='{company[:20]}' product='{product[:30]}'")
    if company:
        found_companies.add(company)
    else:
        missing_companies.append((file_no, seq))

print(f"\n발견된 회사들: {found_companies}")
print(f"회사명 없는 항목: {len(missing_companies)}개 / {len(file_infos)}개")

# HTML 구조 일부 출력 (테이블 부분)
table_match = re.search(r'<table[^>]*class="[^"]*compare[^"]*"[^>]*>(.*?)</table>', html, re.DOTALL | re.IGNORECASE)
if table_match:
    table_content = table_match.group(1)[:2000]
    print(f"\n테이블 구조 샘플 (2000자):")
    print(table_content)
else:
    # tbody 찾기
    tbody_match = re.search(r'<tbody[^>]*>(.*?)</tbody>', html, re.DOTALL)
    if tbody_match:
        print(f"\ntbody 샘플 (2000자):")
        print(tbody_match.group(1)[:2000])
