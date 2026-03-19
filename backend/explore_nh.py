import asyncio
from playwright.async_api import async_playwright

async def explore_nh():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        )
        page = await context.new_page()

        responses_captured = []
        async def capture_response(response):
            url = response.url
            if any(x in url.lower() for x in ['nhfire', 'pdf', 'file', 'download', 'announce', 'product']):
                ct = response.headers.get('content-type', '')
                responses_captured.append({'url': url, 'status': response.status, 'ct': ct})

        page.on('response', capture_response)

        base_url = 'https://www.nhfire.co.kr'
        url = base_url + '/announce/productAnnounce/retrieveInsuranceProductsAnnounce.nhfire'
        print(f'Navigating to: {url}')
        try:
            await page.goto(url, wait_until='networkidle', timeout=30000)
            title = await page.title()
            print(f'Title: {title}')
            content = await page.content()
            print(f'Content length: {len(content)}')
            print(content[:5000])
        except Exception as e:
            print(f'Error: {e}')

        print('\nCaptured responses:')
        for r in responses_captured[:20]:
            print(r)

        await browser.close()

asyncio.run(explore_nh())
