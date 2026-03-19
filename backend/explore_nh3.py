import asyncio
import json
import re
from playwright.async_api import async_playwright

async def explore_nh():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            locale='ko-KR'
        )
        page = await context.new_page()

        ajax_responses = []
        async def capture_response(response):
            url = response.url
            ct = response.headers.get('content-type', '')
            if 'nhfire' in url and ('nhfire' in url.split('/')[-1] or 'json' in ct):
                try:
                    body = await response.text()
                    ajax_responses.append({'url': url, 'status': response.status, 'ct': ct, 'len': len(body), 'body': body[:3000]})
                except:
                    ajax_responses.append({'url': url, 'status': response.status, 'ct': ct, 'body': 'error reading'})

        page.on('response', capture_response)

        base_url = 'https://www.nhfire.co.kr'
        url = base_url + '/announce/productAnnounce/retrieveInsuranceProductsAnnounce.nhfire'
        await page.goto(url, wait_until='networkidle', timeout=30000)
        await page.wait_for_timeout(3000)

        # Get page source directly in JS to avoid encoding issues
        result = await page.evaluate("""() => {
            // Find product list containers
            const containers = document.querySelectorAll('div.prodList, ul.prodList, .product-list, #prodList, .list_area');
            const info = [];
            containers.forEach(c => info.push({tag: c.tagName, id: c.id, cls: c.className, html: c.innerHTML.substring(0, 500)}));

            // Find links with various patterns
            const allLinks = Array.from(document.querySelectorAll('a'));
            const pdfLinks = allLinks.filter(a => {
                const h = a.href || '';
                const o = a.getAttribute('onclick') || '';
                return h.includes('.pdf') || o.includes('.pdf') || h.includes('download') || o.includes('download')
                    || o.includes('openFile') || o.includes('viewFile') || o.includes('yakgwan');
            }).map(a => ({href: a.href, onclick: a.getAttribute('onclick'), text: a.textContent.trim().substring(0, 40)}));

            // Get all scripts to find AJAX patterns
            const scripts = Array.from(document.querySelectorAll('script:not([src])'))
                .map(s => s.textContent)
                .join('\\n');
            const fnMatch = scripts.match(/function\\s+[a-zA-Z]+.*?\\n[^}]+nhfire[^}]+}/g) || [];

            return {
                containers: info,
                pdfLinks: pdfLinks.slice(0, 20),
                scriptSnippets: fnMatch.slice(0, 5),
                bodyText: document.body.innerText.substring(0, 1000)
            };
        }""")

        print("Body text:", result['bodyText'])
        print("\nContainers:", json.dumps(result['containers'], ensure_ascii=False, indent=2))
        print("\nPDF Links:", json.dumps(result['pdfLinks'], ensure_ascii=False, indent=2))
        print("\nScript snippets:", result['scriptSnippets'])

        # Try to find what kind of search/filter is available
        search_result = await page.evaluate("""() => {
            // Get all visible text content from product area
            const mainContent = document.querySelector('#contents, .contents, main, #main');
            if (mainContent) return mainContent.innerText.substring(0, 2000);
            return document.body.innerText.substring(0, 2000);
        }""")
        print("\nMain content text:", search_result)

        print("\n=== AJAX responses ===")
        for r in ajax_responses:
            print(f"URL: {r['url']}")
            print(f"Status: {r['status']}, CT: {r['ct']}, Len: {r['len']}")
            print(f"Body: {r['body'][:500]}")
            print()

        await browser.close()

asyncio.run(explore_nh())
