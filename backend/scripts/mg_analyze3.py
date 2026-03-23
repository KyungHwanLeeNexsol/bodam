"""MG손해보험 실제 카테고리 코드 및 API 응답 확인."""
import asyncio
from playwright.async_api import async_playwright


async def main() -> None:
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        print("[1] 페이지 로딩...")
        await page.goto("https://www.yebyeol.co.kr/PB031210DM.scp", timeout=30000, wait_until="domcontentloaded")
        await asyncio.sleep(3)

        # select 옵션 추출
        print("\n[2] prdtLccd select 옵션:")
        lccd_options = await page.evaluate("""
            () => {
                const sel = document.querySelector('#prdtLccd');
                if (!sel) return 'NOT FOUND';
                return Array.from(sel.options).map(o => ({value: o.value, text: o.textContent.trim()}));
            }
        """)
        print(f"  {lccd_options}")

        print("\n[3] 모든 select 요소:")
        all_selects = await page.evaluate("""
            () => {
                return Array.from(document.querySelectorAll('select')).map(sel => ({
                    id: sel.id,
                    name: sel.name,
                    options: Array.from(sel.options).map(o => ({v: o.value, t: o.textContent.trim()}))
                }));
            }
        """)
        for s in all_selects:
            print(f"  id={s['id']}, name={s['name']}: {s['options'][:5]}")

        # comToken 확인
        token = await page.evaluate("""
            () => {
                const el = document.querySelector('input[name="comToken"]');
                return el ? el.value : null;
            }
        """)
        print(f"\n[4] comToken: {token[:15] if token else 'NOT FOUND'}...")

        # 각 카테고리 코드로 API 호출 테스트
        print("\n[5] API 테스트 (searchPrdtSaleYn=0, 각 코드별):")
        test_codes = [("L", "15"), ("L", "16"), ("L", "17"), ("", ""), ("P", "15")]
        for lccd, mccd in test_codes:
            result = await page.evaluate(f"""
                async () => {{
                    const tokenEl = document.querySelector('input[name="comToken"]');
                    const token = tokenEl ? tokenEl.value : '';
                    const resp = await fetch('/PB031210_001.ajax', {{
                        method: 'POST',
                        headers: {{'Content-Type': 'application/x-www-form-urlencoded'}},
                        body: new URLSearchParams({{
                            searchPrdtLccd: '{lccd}',
                            searchPrdtMccd: '{mccd}',
                            searchPrdtSaleYn: '0',
                            searchText: '',
                            comToken: token,
                            devonTokenFieldSessionscope: 'comToken',
                        }}).toString()
                    }});
                    const text = await resp.text();
                    try {{ return JSON.parse(text); }} catch(e) {{ return {{error: text.substring(0, 200)}}; }}
                }}
            """)
            rows = result.get("list", {}).get("rows", []) if result else []
            prc = result.get("prcSts", "?") if result else "?"
            rows_count = len(rows)
            print(f"  Lccd={lccd!r} Mccd={mccd!r}: prcSts={prc}, rows={rows_count}")
            if rows_count > 0:
                print(f"    첫 행 키: {list(rows[0].keys())[:8]}")
                print(f"    첫 행 샘플: inskdAbbrNm={rows[0].get('inskdAbbrNm')}, dataIdno={rows[0].get('dataIdno')}")
                print(f"    doc1Org={rows[0].get('doc1Org')}, doc2Org={rows[0].get('doc2Org')}, doc3Org={rows[0].get('doc3Org')}")

        # JavaScript 함수로 직접 onSearch 호출 테스트
        print("\n[6] 판매중인 상품 전체 조회 (searchPrdtMccd='') :")
        result2 = await page.evaluate("""
            async () => {
                const tokenEl = document.querySelector('input[name="comToken"]');
                const token = tokenEl ? tokenEl.value : '';
                const resp = await fetch('/PB031210_001.ajax', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                    body: new URLSearchParams({
                        searchPrdtLccd: 'L',
                        searchPrdtMccd: '',
                        searchPrdtSaleYn: '0',
                        searchText: '',
                        comToken: token,
                        devonTokenFieldSessionscope: 'comToken',
                    }).toString()
                });
                const text = await resp.text();
                try { return JSON.parse(text); } catch(e) { return {error: text.substring(0, 300)}; }
            }
        """)
        rows2 = result2.get("list", {}).get("rows", []) if result2 else []
        print(f"  prcSts={result2.get('prcSts')}, rows={len(rows2)}")
        if rows2:
            print(f"  첫 행: {rows2[0]}")

        await browser.close()


asyncio.run(main())
