#!/usr/bin/env python3
"""pub.insure.or.kr 회사별 분포 분석"""
from __future__ import annotations

import re
import httpx

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://pub.insure.or.kr",
    "Accept": "text/html,*/*",
    "Accept-Language": "ko-KR,ko;q=0.9",
}

LISTING_URL = "https://pub.insure.or.kr/compareDis/prodCompare/assurance/listNew.do"
FILE_DOWN_PATTERN = re.compile(r"fn_fileDown\('(\d+)',\s*'(\d+)'\)")

# 라벨에서 회사명 추출 (더 정확한 방법)
MEMBER_NM_PATTERN = re.compile(r'id="l_memberNm_([^"]+)"[^>]*>([^<]+)<')
PROD_NM_PATTERN = re.compile(r'id="l_prodNm_([^"]+)"[^>]*>([^<]+)<')

def extract_labels(html: str) -> dict[str, dict[str, str]]:
    """HTML에서 product_key -> {member_nm, prod_nm} 매핑 추출"""
    result = {}
    for m in MEMBER_NM_PATTERN.finditer(html):
        key = m.group(1)
        if key not in result:
            result[key] = {}
        result[key]["company"] = m.group(2).strip()
    for m in PROD_NM_PATTERN.finditer(html):
        key = m.group(1)
        if key not in result:
            result[key] = {}
        result[key]["product"] = m.group(2).strip()
    return result

# 종신보험 1페이지
params = {
    "pageIndex": "1",
    "pageUnit": "100",
    "search_columnArea": "simple",
    "all_search_memberCd": "all",
    "search_prodGroup": "024400010001",
}

r = httpx.post(LISTING_URL, data=params, headers=HEADERS, timeout=30, follow_redirects=True)
html = r.text

labels = extract_labels(html)
print(f"제품 라벨 수: {len(labels)}")

# 회사별 분포
companies: dict[str, int] = {}
for key, info in labels.items():
    company = info.get("company", "?")
    companies[company] = companies.get(company, 0) + 1

print("\n종신보험 1페이지 회사별 제품 수:")
for co, cnt in sorted(companies.items(), key=lambda x: -x[1]):
    print(f"  {co}: {cnt}개")

# fn_fileDown과 label 매핑
file_infos = FILE_DOWN_PATTERN.findall(html)
print(f"\nfn_fileDown: {len(file_infos)}개")

# 각 fn_fileDown에 대해 근처의 productKey 찾기
def find_product_for_filedown(html: str, file_no: str, seq: str) -> dict[str, str]:
    # fn_fileDown 위치 찾기
    pattern = rf"fn_fileDown\('{re.escape(file_no)}',\s*'{re.escape(seq)}'\)"
    match = re.search(pattern, html)
    if not match:
        return {}
    pos = match.start()
    # 가장 가까운 productKey 찾기 (앞쪽에서)
    segment = html[max(0, pos-3000):pos]
    label_matches = list(MEMBER_NM_PATTERN.finditer(segment))
    if label_matches:
        last_match = label_matches[-1]
        return {"company": last_match.group(2).strip()}
    return {}

print("\n처음 10개 fn_fileDown의 회사:")
for file_no, seq in file_infos[:10]:
    info = find_product_for_filedown(html, file_no, seq)
    print(f"  fn_fileDown({file_no}, {seq}) -> {info.get('company', '?')}")

# 전체 페이지 수 확인
total_count_match = re.search(r'totalCount["\s:]+(\d+)', html)
if total_count_match:
    print(f"\n전체 종신보험 제품 수: {total_count_match.group(1)}")

# 2페이지도 확인
params["pageIndex"] = "2"
r2 = httpx.post(LISTING_URL, data=params, headers=HEADERS, timeout=30, follow_redirects=True)
labels2 = extract_labels(r2.text)
companies2: dict[str, int] = {}
for key, info in labels2.items():
    company = info.get("company", "?")
    companies2[company] = companies2.get(company, 0) + 1
print("\n종신보험 2페이지 회사별:")
for co, cnt in sorted(companies2.items(), key=lambda x: -x[1]):
    print(f"  {co}: {cnt}개")
