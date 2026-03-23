"""Kyobo Life PDF URL pattern finder"""

import asyncio
import re
from playwright.async_api import async_playwright


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        api_calls = {}

        async def on_response(response):
            url = response.url
            ct = response.headers.get("content-type", "")
            if "kyobo.com" in url and ("json" in ct or "pdf" in ct):
                try:
                    if "pdf" in ct:
                        api_calls[url] = {"type": "PDF", "size": len(await response.body())}
                    else:
                        body = await response.json()
                        body_str = str(body)
                        if ".pdf" in body_str.lower():
                            api_calls[url] = {"type": "JSON_WITH_PDF", "body": body_str[:500]}
                        else:
                            api_calls[url] = {"type": "JSON", "body": body_str[:200]}
                except Exception as e:
                    api_calls[url] = {"type": "ERR", "err": str(e)[:50]}

        page.on("response", on_response)

        print("Loading page...")
        await page.goto(
            "https://www.kyobo.com/individual/customer/publicnotice/terms",
            wait_until="networkidle",
            timeout=30000,
        )
        await page.wait_for_timeout(5000)

        # Find all clickable elements that might be terms items
        print("Page loaded, finding elements...")

        # Try to find download links by text
        download_buttons = await page.query_selector_all(
            'a:has-text("PDF"), a:has-text("다운"), button:has-text("PDF"), '
            'a[href*="pdf"], a[href*="download"], a[href*="file"]'
        )
        print(f"Download buttons found: {len(download_buttons)}")

        # Find any table rows
        table_rows = await page.query_selector_all("table tr")
        print(f"Table rows: {len(table_rows)}")

        # Get all links
        all_links = await page.query_selector_all("a")
        print(f"All links: {len(all_links)}")

        # Print first 10 links
        for i, link in enumerate(all_links[:10]):
            href = await link.get_attribute("href")
            text = await link.inner_text()
            print(f"  Link {i}: href={href}, text={text[:50]}")

        # Try clicking the first table row
        if table_rows and len(table_rows) > 1:
            print("\nClicking first data row...")
            await table_rows[1].click()
            await page.wait_for_timeout(3000)

            # Check for new requests
            print(f"API calls captured: {len(api_calls)}")

        # Look for PDF link that appeared after click
        new_links = await page.query_selector_all('a[href*=".pdf"], a[href*="pdf"]')
        print(f"PDF links after click: {len(new_links)}")
        for link in new_links[:5]:
            href = await link.get_attribute("href")
            print(f"  PDF href: {href}")

        # Save page source
        content = await page.content()
        with open("/tmp/kyobo_terms_page.html", "w", encoding="utf-8") as f:
            f.write(content)
        print("\nPage source saved to /tmp/kyobo_terms_page.html")

        await browser.close()

        print("\nAll API calls:")
        for url, data in api_calls.items():
            print(f"\nURL: {url}")
            print(f"  Type: {data['type']}")
            if "body" in data:
                print(f"  Body: {data['body'][:300]}")


if __name__ == "__main__":
    asyncio.run(main())
