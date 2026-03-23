"""Capture ALL API calls on Kyobo Life product terms page (판매중지 약관)"""

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

        all_responses = {}

        async def on_response(response):
            url = response.url
            ct = response.headers.get("content-type", "")
            if "kyobo" in url:
                try:
                    if "pdf" in ct.lower():
                        body = await response.body()
                        all_responses[url] = {"type": "PDF", "size": len(body)}
                    elif "json" in ct.lower():
                        body = await response.json()
                        all_responses[url] = {"type": "JSON", "body": body}
                except Exception:
                    pass

        page.on("response", on_response)

        # Find the actual product terms (약관) page
        test_pages = [
            "https://www.kyobo.com/dgt/web/product/insurance/variable_insurance_fund_service/findMarketConditionsInformationExpert",
            "https://www.kyobo.com/dgt/web/disclosure/product_disclosure/variable_insurance/findProductDisclosureList",
        ]

        # First, find the actual product terms search page URL via API
        print("Testing find-allProductSearch API via page navigation...")
        await page.goto("https://www.kyobo.com/", wait_until="networkidle", timeout=20000)
        await page.wait_for_timeout(2000)

        # Navigate to the new product terms page
        for page_url in test_pages:
            print(f"\nLoading: {page_url}")
            try:
                resp = await page.goto(page_url, wait_until="networkidle", timeout=20000)
                await page.wait_for_timeout(3000)
                title = await page.title()
                content_len = len(await page.content())
                print(f"  Status: {resp.status if resp else '?'}, Title: {title}, Size: {content_len}")
            except Exception as e:
                print(f"  Error: {e}")

        # Now try to directly access the product info page
        print("\nLoading product official page...")
        await page.goto(
            "https://www.kyobo.com/individual/products/disclosure/sales/PDO-PRPRI010210M",
            wait_until="domcontentloaded",
            timeout=20000,
        )
        await page.wait_for_timeout(5000)
        title = await page.title()
        content = await page.content()
        print(f"Title: {title}, Size: {len(content)}")

        # Save the page source for analysis
        with open("/tmp/kyobo_product_page.html", "w", encoding="utf-8") as f:
            f.write(content)

        print(f"\nCaptured {len(all_responses)} API responses:")
        for url, data in all_responses.items():
            if "/dtc/" in url or "/dgt/" in url:
                print(f"\n  URL: {url}")
                if data["type"] == "PDF":
                    print(f"    PDF: {data['size']} bytes")
                else:
                    body_str = json.dumps(data["body"], ensure_ascii=False)
                    print(f"    JSON: {body_str[:300]}")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
