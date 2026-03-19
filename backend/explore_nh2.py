import asyncio
import json
from playwright.async_api import async_playwright

async def explore_nh():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        )
        page = await context.new_page()

        ajax_responses = []
        async def capture_response(response):
            url = response.url
            ct = response.headers.get('content-type', '')
            if 'json' in ct or 'nhfire' in url:
                try:
                    body = await response.text()
                    if len(body) < 50000:
                        ajax_responses.append({'url': url, 'status': response.status, 'body': body[:2000]})
                    else:
                        ajax_responses.append({'url': url, 'status': response.status, 'body': body[:500] + '...'})
                except:
                    ajax_responses.append({'url': url, 'status': response.status, 'body': 'binary'})

        page.on('response', capture_response)

        base_url = 'https://www.nhfire.co.kr'
        url = base_url + '/announce/productAnnounce/retrieveInsuranceProductsAnnounce.nhfire'
        await page.goto(url, wait_until='networkidle', timeout=30000)
        await page.wait_for_timeout(2000)

        # Look for product list items and PDF links
        print("=== Page analysis ===")

        # Find all links with pdf
        pdf_links = await page.evaluate("""() => {
            const links = Array.from(document.querySelectorAll('a'));
            return links
                .filter(a => a.href && (a.href.includes('pdf') || a.href.includes('PDF') || a.href.includes('download') || a.href.includes('file')))
                .map(a => ({href: a.href, text: a.textContent.trim().substring(0, 50)}))
                .slice(0, 20);
        }""")
        print("PDF/Download links:", json.dumps(pdf_links, ensure_ascii=False, indent=2))

        # Find all onclick handlers
        onclick_links = await page.evaluate("""() => {
            const links = Array.from(document.querySelectorAll('[onclick]'));
            return links
                .map(el => ({onclick: el.getAttribute('onclick'), text: el.textContent.trim().substring(0, 50)}))
                .filter(x => x.onclick && (x.onclick.includes('pdf') || x.onclick.includes('PDF') || x.onclick.includes('download') || x.onclick.includes('file') || x.onclick.includes('view')))
                .slice(0, 20);
        }""")
        print("\nOnclick with pdf/download:", json.dumps(onclick_links, ensure_ascii=False, indent=2))

        # Find the product table structure
        table_info = await page.evaluate("""() => {
            const tables = Array.from(document.querySelectorAll('table'));
            return tables.map(t => ({
                rows: t.rows.length,
                sample: t.textContent.trim().substring(0, 200)
            })).filter(t => t.rows > 0).slice(0, 5);
        }""")
        print("\nTables:", json.dumps(table_info, ensure_ascii=False, indent=2))

        # Find select/option elements for filtering
        selects = await page.evaluate("""() => {
            const selects = Array.from(document.querySelectorAll('select'));
            return selects.map(s => ({
                id: s.id, name: s.name,
                options: Array.from(s.options).map(o => ({value: o.value, text: o.textContent.trim()}))
            }));
        }""")
        print("\nSelects:", json.dumps(selects, ensure_ascii=False, indent=2))

        # Find forms
        forms = await page.evaluate("""() => {
            const forms = Array.from(document.querySelectorAll('form'));
            return forms.map(f => ({
                id: f.id, action: f.action, method: f.method,
                inputs: Array.from(f.querySelectorAll('input,select')).map(i => ({
                    name: i.name, type: i.type, value: i.value
                }))
            }));
        }""")
        print("\nForms:", json.dumps(forms, ensure_ascii=False, indent=2))

        print("\n=== AJAX responses captured ===")
        for r in ajax_responses[:10]:
            print(r)

        await browser.close()

asyncio.run(explore_nh())
