#!/usr/bin/env python3
"""삼성생명 제품의 company 추출 디버깅"""
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
MEMBER_NM_PATTERN = re.compile(r'id="l_memberNm_([^"]+)"[^>]*>([^<]+)<')

# 종신보험 1페이지 (삼성생명이 있는 페이지)
params = {
    "pageIndex": "1",
    "pageUnit": "100",
    "search_columnArea": "simple",
    "all_search_memberCd": "all",
    "search_prodGroup": "024400010001",
}

r = httpx.post(LISTING_URL, data=params, headers=HEADERS, timeout=30, follow_redirects=True)
html = r.text

# 삼성생명 제품의 fileNo 찾기
samsung_keys = []
for m in MEMBER_NM_PATTERN.finditer(html):
    if "삼성생명" in m.group(2):
        samsung_keys.append(m.group(1))

print(f"삼성생명 제품 키: {len(samsung_keys)}개")
print(f"첫 번째 키: {samsung_keys[0][:60] if samsung_keys else '없음'}")

# 삼성생명 키에 해당하는 fn_fileDown 찾기
# 키는 productCode의 일부일 가능성
# HTML에서 samsung_keys[0] 주변 찾기
if samsung_keys:
    key = samsung_keys[0]
    # 이 키 주변 3000자 확인
    key_pos = html.find(key)
    if key_pos >= 0:
        nearby = html[key_pos:key_pos+3000]
        fn_downs = FILE_DOWN_PATTERN.findall(nearby)
        print(f"키 주변 fn_fileDown: {fn_downs[:3]}")

        # HTML 구조 확인
        print("\n키 주변 HTML (500자):")
        print(nearby[:500])

# extract_product_info 방식으로 삼성생명 제품 추출 시도
file_infos = FILE_DOWN_PATTERN.findall(html)
print(f"\n전체 fn_fileDown: {len(file_infos)}개")

# 첫 5개에 대해 company 추출 (현재 방식)
def extract_product_info_orig(html: str, file_no: str, seq: str) -> tuple[str, str]:
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
            texts.append(clean[:50])
    company = texts[0][:30] if texts else ""
    product = texts[1][:40] if len(texts) > 1 else ""
    return company, product

# 삼성생명에 해당하는 fn_fileDown을 찾아야 함
# samsung_keys[0]와 fn_fileDown을 연결해보자
if samsung_keys:
    key = samsung_keys[0]
    # 키를 포함하는 fn_fileDown 찾기
    key_in_html = html.find(key)
    if key_in_html >= 0:
        segment = html[key_in_html:key_in_html+5000]
        samsung_fns = FILE_DOWN_PATTERN.findall(segment)
        if samsung_fns:
            fn_no, fn_seq = samsung_fns[0]
            company, product = extract_product_info_orig(html, fn_no, fn_seq)
            print(f"\n삼성생명 fn_fileDown({fn_no}, {fn_seq}):")
            print(f"  company='{company}'")
            print(f"  product='{product}'")

            # 이 extract가 '삼성생명'을 포함하는지
            print(f"  '삼성생명' in company: {'삼성생명' in company}")

# 삼성생명 파일을 특정 회사로 필터링해서 테스트
params2 = {
    "pageIndex": "1",
    "pageUnit": "100",
    "search_columnArea": "simple",
    "all_search_memberCd": "L03",  # 삼성생명 코드
    "search_prodGroup": "024400010001",
}
r2 = httpx.post(LISTING_URL, data=params2, headers=HEADERS, timeout=30, follow_redirects=True)
html2 = r2.text
fi2 = FILE_DOWN_PATTERN.findall(html2)
print(f"\n삼성생명(L03) 필터 결과: {len(fi2)}개 fn_fileDown")
if fi2:
    company, product = extract_product_info_orig(html2, fi2[0][0], fi2[0][1])
    print(f"  첫 번째: company='{company[:40]}' product='{product[:40]}'")
    print(f"  '삼성생명' 포함: {'삼성생명' in company}")
