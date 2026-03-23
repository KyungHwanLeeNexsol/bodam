"""Use Playwright to capture actual Kyobo Life PDF download URL by intercepting network"""

import asyncio
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

        all_requests = []

        async def on_request(request):
            url = request.url
            if "kyobo" in url or "pdf" in url.lower():
                all_requests.append({"method": request.method, "url": url})

        async def on_response(response):
            url = response.url
            ct = response.headers.get("content-type", "")
            if "pdf" in ct.lower() or url.lower().endswith(".pdf"):
                print(f"!!! PDF FOUND: {url}")
                print(f"    Content-Type: {ct}")

        page.on("request", on_request)
        page.on("response", on_response)

        # Navigate to the old-style terms page
        print("Loading old Kyobo terms page...")
        try:
            await page.goto(
                "https://www.kyobo.com/dgt/web/pc/dtm/html/pr/DTMPRPRI010210M.html",
                wait_until="networkidle",
                timeout=20000,
            )
            title = await page.title()
            content = await page.content()
            print(f"Title: {title}, Content size: {len(content)}")
        except Exception as e:
            print(f"Error: {e}")

        # Try accessing the actual terms list page (old web app style)
        test_pages = [
            "https://www.kyobo.com/dgt/web/pc/dtm/html/pr/DTMPRPRI010200M.html",
            "https://www.kyobo.com/prdt/terms/list",
            "https://www.kyobo.com/prdt/terms",
        ]

        for page_url in test_pages:
            print(f"\nTrying: {page_url}")
            try:
                resp = await page.goto(page_url, wait_until="domcontentloaded", timeout=15000)
                await page.wait_for_timeout(2000)
                title = await page.title()
                content_len = len(await page.content())
                print(f"  Status: {resp.status if resp else '?'}, Title: {title}, Size: {content_len}")
            except Exception as e:
                print(f"  Error: {e}")

        # Check all captured requests
        print(f"\nAll requests: {len(all_requests)}")
        for req in all_requests:
            if "terms" in req["url"].lower() or "pdf" in req["url"].lower() or "file" in req["url"].lower():
                print(f"  {req['method']} {req['url']}")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
