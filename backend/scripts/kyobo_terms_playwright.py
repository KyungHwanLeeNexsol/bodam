"""Capture all API calls on Kyobo Life insurance terms page"""

import asyncio
import json
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

from playwright.async_api import async_playwright


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        page = await context.new_page()

        json_responses = {}

        async def on_response(response):
            url = response.url
            ct = response.headers.get("content-type", "")
            if "kyobo" in url and ("json" in ct or "pdf" in ct):
                try:
                    if "pdf" in ct.lower():
                        body = await response.body()
                        json_responses[url] = {"type": "PDF", "size": len(body)}
                    else:
                        body = await response.json()
                        json_responses[url] = {"type": "JSON", "body": body}
                except Exception:
                    pass

        page.on("response", on_response)

        # Try the insurance term list page from sitemap
        print("Loading Kyobo insurance terms list page...")
        try:
            resp = await page.goto(
                "https://www.kyobo.com/dgt/web/customer/finance-information/insurance-term/list",
                wait_until="networkidle",
                timeout=30000,
            )
            await page.wait_for_timeout(5000)
            title = await page.title()
            content = await page.content()
            print(f"Status: {resp.status if resp else '?'}, Title: {title}, Size: {len(content)}")

            # Look for list items
            rows = await page.query_selector_all("table tbody tr, .list-item, li.item, .tbl-list tr")
            print(f"Rows found: {len(rows)}")

            # Look for any download button
            dl_buttons = await page.query_selector_all(
                'a[href*=".pdf"], button[onclick*="pdf"], a[href*="download"], .btn-download'
            )
            print(f"Download buttons: {len(dl_buttons)}")

            # Print first few links
            all_links = await page.query_selector_all("a")
            print(f"All links: {len(all_links)}")
            for i, link in enumerate(all_links[:10]):
                href = await link.get_attribute("href")
                text = await link.inner_text()
                if href and len(href) > 3:
                    print(f"  Link: href={href[:80]}, text={text[:40]}")

            # Click first row if exists
            if rows:
                print("\nClicking first row...")
                await rows[0].click()
                await page.wait_for_timeout(3000)

        except Exception as e:
            print(f"Error: {e}")

        print(f"\nCaptured JSON API responses: {len(json_responses)}")
        for url, data in json_responses.items():
            print(f"\nURL: {url}")
            if data["type"] == "PDF":
                print(f"  PDF file, size: {data['size']}")
            else:
                body = data["body"]
                body_str = json.dumps(body, ensure_ascii=False)
                if ".pdf" in body_str.lower() or "file" in body_str.lower():
                    print(f"  JSON with file reference:")
                    print(f"  {body_str[:500]}")
                else:
                    print(f"  JSON: {body_str[:200]}")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
