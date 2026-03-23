"""MG손해보험(yebyeol.co.kr) 사이트 구조 조사 스크립트."""
import httpx
import re
import json

base = "https://www.yebyeol.co.kr"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://www.yebyeol.co.kr/PB031210DM.scp",
}

# 약관 공시 페이지 소스 가져오기
r = httpx.get(base + "/PB031210DM.scp", verify=False, timeout=20, follow_redirects=True, headers=headers)
text = r.text

print(f"상태코드: {r.status_code}, URL: {r.url}")
print(f"본문 길이: {len(text)}")

# JavaScript 파일 목록 추출
js_files = re.findall(r'src=["\']([^"\']+\.js[^"\']*)["\']', text)
print("\n=== JS 파일 목록 ===")
for js in js_files[:15]:
    print(f"  {js}")

# ajax/do/scp URL 패턴 추출
ajax_patterns = re.findall(r'["\'](/[A-Za-z0-9/._-]+\.(?:ajax|do|scp))["\']', text)
print("\n=== AJAX/DO/SCP URL 패턴 ===")
for u in list(set(ajax_patterns))[:20]:
    print(f"  {u}")

# function/url 패턴 추출
url_in_js = re.findall(r'url\s*:\s*["\']([^"\']+)["\']', text)
print("\n=== JS 내 url 파라미터 ===")
for u in list(set(url_in_js))[:20]:
    print(f"  {u}")

# 페이지 내 특별한 키워드 찾기
kws = ["약관", "fileNm", "filePath", "pdf", "download", "terms", "PB03"]
print("\n=== 키워드 주변 컨텍스트 ===")
for kw in kws:
    idx = text.find(kw)
    if idx >= 0:
        snippet = text[max(0, idx-100):idx+200].replace("\n", " ").strip()
        print(f"\n  [{kw}]: ...{snippet[:300]}...")

# include된 JS 파일 중 하나 가져와서 분석
print("\n=== 약관 관련 JS 파일 분석 ===")
for js in js_files:
    if any(kw in js.lower() for kw in ["pb03", "terms", "yakgwan", "clause"]):
        js_url = base + js if js.startswith("/") else js
        try:
            js_r = httpx.get(js_url, verify=False, timeout=10, headers=headers)
            if js_r.status_code == 200:
                print(f"\n  파일: {js_url}")
                print(f"  내용 앞 500자: {js_r.text[:500]}")
        except Exception as e:
            print(f"  실패: {js_url} - {e}")

# 직접 POST API 호출 시도
print("\n=== API 호출 시도 ===")
# 일반적인 약관 조회 패턴 시도
api_candidates = [
    "/PB031210DM.scp",
    "/ajax/getTermsList.ajax",
    "/front/terms/list.ajax",
    "/terms/getList.do",
]
for api in api_candidates:
    try:
        resp = httpx.post(
            base + api,
            data={"insType": "01", "pageNo": "1"},
            verify=False,
            timeout=10,
            headers=headers,
        )
        ct = resp.headers.get("content-type", "")
        print(f"  POST {api}: {resp.status_code}, ct={ct}, len={len(resp.text)}")
        if "json" in ct or resp.text.strip().startswith("{"):
            print(f"    응답: {resp.text[:300]}")
    except Exception as e:
        print(f"  POST {api}: 실패 - {e}")
