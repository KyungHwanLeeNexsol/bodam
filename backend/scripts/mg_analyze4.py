"""MG손해보험 모든 카테고리 코드 및 PDF 다운로드 테스트."""
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

        # 실제 중분류 코드 - codeL select에서 확인된 값
        # L: 장기보험 (06=건강, 07=운전자, 15=의료, 16=상해, 09=여행)
        # A: 자동차보험 (01~05)
        # G: 일반보험 (01~05)
        # B: (01~02)
        # P: (01)
        # C: (01)

        all_categories = [
            ("L", "06"), ("L", "07"), ("L", "09"), ("L", "15"), ("L", "16"), ("L", "17"),
            ("L", "18"), ("L", "19"), ("L", "20"), ("L", "21"),
            ("A", "01"), ("A", "02"), ("A", "03"), ("A", "04"), ("A", "05"),
            ("G", "01"), ("G", "02"), ("G", "03"), ("G", "04"), ("G", "05"),
            ("B", "01"), ("B", "02"),
            ("P", "01"), ("C", "01"),
        ]

        print("\n[2] 판매중(SaleYn=0) 전체 카테고리 조회:")
        for lccd, mccd in all_categories:
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
                    try {{ return JSON.parse(text); }} catch(e) {{ return {{error: text.substring(0, 100)}}; }}
                }}
            """)
            rows = result.get("list", {}).get("rows", []) if result else []
            prc = result.get("prcSts", "?") if result else "?"
            if rows:
                print(f"  *** Lccd={lccd} Mccd={mccd}: prcSts={prc}, rows={len(rows)}")
                for r in rows[:2]:
                    print(f"      dataIdno={r.get('dataIdno')}, name={str(r.get('inskdAbbrNm', ''))[:40]}")
                    print(f"      doc2Org={str(r.get('doc2Org', ''))[:50]}")
            else:
                print(f"  Lccd={lccd} Mccd={mccd}: prcSts={prc}, rows=0")

        print("\n[3] 판매중지(SaleYn=1) 전체 카테고리 조회:")
        for lccd, mccd in all_categories[:8]:  # 샘플만
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
                            searchPrdtSaleYn: '1',
                            searchText: '',
                            comToken: token,
                            devonTokenFieldSessionscope: 'comToken',
                        }}).toString()
                    }});
                    const text = await resp.text();
                    try {{ return JSON.parse(text); }} catch(e) {{ return {{error: text.substring(0, 100)}}; }}
                }}
            """)
            rows = result.get("list", {}).get("rows", []) if result else []
            prc = result.get("prcSts", "?") if result else "?"
            if rows:
                print(f"  *** Lccd={lccd} Mccd={mccd}: prcSts={prc}, rows={len(rows)}")

        # PDF 다운로드 테스트 (dataIdno=3055, docCfcd=2 - 약관)
        print("\n[4] PDF 다운로드 테스트 (dataIdno=3055, docCfcd=2):")
        pdf_result = await page.evaluate("""
            async () => {
                try {
                    const resp = await fetch('/PB031130_003.form', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                        body: new URLSearchParams({
                            dataIdno: '3055',
                            docCfcd: '2',
                        }).toString()
                    });
                    const ct = resp.headers.get('content-type') || '';
                    const cl = resp.headers.get('content-length') || '?';
                    const cd = resp.headers.get('content-disposition') || '';
                    const status = resp.status;
                    // 처음 8바이트만 확인 (PDF 시그니처)
                    const buf = await resp.arrayBuffer();
                    const bytes = new Uint8Array(buf.slice(0, 8));
                    const sig = Array.from(bytes).map(b => String.fromCharCode(b)).join('');
                    return {status, ct, cl, cd, sig, totalLen: buf.byteLength};
                } catch(e) {
                    return {error: e.toString()};
                }
            }
        """)
        print(f"  결과: {pdf_result}")

        await browser.close()


asyncio.run(main())
