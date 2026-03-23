"""Capture API calls from Kyobo product terms page by navigating the SPA"""

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

        all_json_responses = {}

        async def on_response(response):
            url = response.url
            ct = response.headers.get("content-type", "")
            if "kyobo" in url:
                try:
                    if "pdf" in ct.lower():
                        body = await response.body()
                        all_json_responses[url] = {"type": "PDF", "size": len(body)}
                        print(f"!!! PDF: {url} ({len(body)} bytes)")
                    elif "json" in ct.lower():
                        body = await response.json()
                        all_json_responses[url] = {"type": "JSON", "data": body}
                except Exception:
                    pass

        page.on("response", on_response)

        # Load the main site to get cookies/session
        print("1. Loading main page...")
        await page.goto("https://www.kyobo.com/", wait_until="networkidle", timeout=20000)
        await page.wait_for_timeout(2000)

        # Navigate to the product page using the SPA navigation
        print("2. Navigating to product terms page...")
        # Try using JavaScript to navigate within the SPA
        try:
            await page.evaluate(
                "window.location.href = '/dgt/web/customer/finance-information/insurance-term/list'"
            )
            await page.wait_for_load_state("networkidle", timeout=15000)
            await page.wait_for_timeout(3000)
            title = await page.title()
            print(f"   Title: {title}")
        except Exception as e:
            print(f"   Error: {e}")

        # Try the find-allProductSearch page
        print("3. Navigating to product search page...")
        try:
            # This is the actual product terms (약관) search page
            await page.goto(
                "https://www.kyobo.com/individual/products/public-notice/terms",
                wait_until="domcontentloaded",
                timeout=15000,
            )
            await page.wait_for_timeout(5000)
            title = await page.title()
            size = len(await page.content())
            print(f"   Title: {title}, Size: {size}")
        except Exception as e:
            print(f"   Error: {e}")

        # Check what API calls were made
        print(f"\n4. API responses captured: {len(all_json_responses)}")

        # Report all except 404s
        for url, data in all_json_responses.items():
            if data["type"] == "PDF":
                print(f"\n  PDF: {url}")
            else:
                body = data["data"]
                code = body.get("header", {}).get("code", "?") if isinstance(body, dict) else "?"
                if code != "404" and "/dtc/" in url:
                    print(f"\n  URL: {url}")
                    print(f"  Code: {code}")
                    body_str = json.dumps(body, ensure_ascii=False)
                    if "pdf" in body_str.lower() or "file" in body_str.lower() or "url" in body_str.lower():
                        print(f"  Body: {body_str[:400]}")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
