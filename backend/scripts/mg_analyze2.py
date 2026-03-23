"""MG손해보험 페이지 form/tran 구조 상세 분석."""
import httpx
import re

base = "https://www.yebyeol.co.kr"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": base + "/PB031210DM.scp",
}

r = httpx.get(base + "/PB031210DM.scp", verify=False, timeout=20, follow_redirects=True, headers=headers)
content = r.content.decode("euc-kr", errors="replace")

# form action 찾기
print("=== Form 구조 ===")
form_blocks = re.findall(r'<form[^>]+(?:name|id)=["\']dataForm\d["\'][^>]*>', content, re.IGNORECASE)
for f in form_blocks:
    print(f"  {f[:200]}")

# hidden input들
print("\n=== Hidden Inputs ===")
hidden = re.findall(r'<input[^>]+type=["\']hidden["\'][^>]*/>', content, re.IGNORECASE)
for h in hidden[:30]:
    name_m = re.search(r'name=["\']([^"\']+)["\']', h)
    val_m = re.search(r'value=["\']([^"\']*)["\']', h)
    if name_m:
        print(f"  {name_m.group(1)} = {val_m.group(1) if val_m else ''}")

# tran.sendData 호출 찾기
print("\n=== tran.sendData 호출 ===")
tran_calls = re.findall(r"tran\.sendData\(['\"]([^'\"]+)['\"]", content)
for t in tran_calls:
    print(f"  tradeId: {t}")

# sui_config.js에서 base URL 찾기
print("\n=== sui_config.js 분석 ===")
cfg_r = httpx.get(base + "/webdocs/resources/scripts/smartui/config/sui_config.js", verify=False, timeout=10, headers=headers)
cfg = cfg_r.content.decode("utf-8", errors="replace")
print(cfg[:2000])

# 실제 API 호출 시도: PB031210_001 트랜잭션
print("\n=== API 직접 호출 시도 ===")
# yebyeol.co.kr 는 SmartUI 기반 - 일반적으로 /[TRADE_ID].ajax 또는 /ajax/trade.ajax 형태
test_endpoints = [
    ("/PB031210_001.ajax", "POST"),
    ("/ajax/PB031210_001.ajax", "POST"),
    ("/front/PB031210_001.ajax", "POST"),
    ("/biz/pb/PB031210_001.ajax", "POST"),
]
for ep, method in test_endpoints:
    try:
        if method == "POST":
            resp = httpx.post(
                base + ep,
                data={
                    "searchPrdtSaleYn": "0",
                    "searchPrdtLccd": "L",
                    "searchPrdtMccd": "15",
                    "searchText": "",
                },
                verify=False,
                timeout=10,
                headers=headers,
            )
        ct = resp.headers.get("content-type", "")
        print(f"  {method} {ep}: {resp.status_code}, ct={ct[:50]}, len={len(resp.content)}")
        if len(resp.content) < 1000 and resp.content:
            print(f"    응답: {resp.content.decode('utf-8', errors='replace')[:300]}")
    except Exception as e:
        print(f"  {method} {ep}: 오류 - {e}")
