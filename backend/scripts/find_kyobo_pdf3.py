"""Kyobo Life PDF URL - check multiple pages and capture network traffic"""

import asyncio
import json
from playwright.async_api import async_playwright


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            extra_http_headers={
                "Accept-Language": "ko-KR,ko;q=0.9",
            },
        )
        page = await context.new_page()

        api_calls = []

        async def on_response(response):
            url = response.url
            ct = response.headers.get("content-type", "")
            if "kyobo.com" in url:
                if "pdf" in ct.lower():
                    try:
                        size = len(await response.body())
                        api_calls.append({"url": url, "type": "PDF", "size": size})
                    except Exception:
                        api_calls.append({"url": url, "type": "PDF_ERR"})
                elif "json" in ct.lower():
                    try:
                        body = await response.json()
                        body_str = json.dumps(body, ensure_ascii=False)
                        if ".pdf" in body_str.lower() or "file" in body_str.lower():
                            api_calls.append({"url": url, "type": "JSON_FILE", "body": body_str[:600]})
                    except Exception:
                        pass

        page.on("response", on_response)

        # Try the working page URL
        test_urls = [
            "https://www.kyobo.com/product/terms/list",
            "https://www.kyobo.com/individual/products/disclosure/sales/PDO-PRPRI010200M",
            "https://www.kyobo.com/individual/products/disclosure/terms",
            "https://www.kyobo.com/prdt/crdt/ltrmDoc",
        ]

        for url in test_urls:
            print(f"\nTesting: {url}")
            try:
                resp = await page.goto(url, wait_until="networkidle", timeout=20000)
                await page.wait_for_timeout(2000)
                status = resp.status if resp else "?"
                title = await page.title()
                print(f"  Status: {status}, Title: {title}")

                # Get page content snippet
                content = await page.content()
                print(f"  Content size: {len(content)}")
                if len(content) > 2000:
                    print("  Page has real content")
                    # Check for PDF links
                    pdf_links = await page.query_selector_all('a[href*=".pdf"]')
                    print(f"  PDF links: {len(pdf_links)}")
                    if pdf_links:
                        for link in pdf_links[:3]:
                            href = await link.get_attribute("href")
                            print(f"    {href}")
            except Exception as e:
                print(f"  Error: {e}")

        print(f"\nAll API calls with file references: {len(api_calls)}")
        for call in api_calls:
            print(f"\nURL: {call['url']}")
            print(f"Type: {call['type']}")
            if "body" in call:
                print(f"Body: {call['body'][:400]}")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
