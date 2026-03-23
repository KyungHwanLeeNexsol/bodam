"""교보생명 PDF 다운로드 URL 패턴 탐색"""

import asyncio
import re
from playwright.async_api import async_playwright


async def capture_kyobo_pdf_url():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        pdf_urls = []
        api_calls = []

        async def on_response(response):
            url = response.url
            ct = response.headers.get("content-type", "")
            if "pdf" in ct.lower() or url.endswith(".pdf"):
                pdf_urls.append(url)
                print(f"PDF RESPONSE: {url}")
            elif "json" in ct.lower() and "kyobo" in url and ("terms" in url.lower() or "product" in url.lower()):
                api_calls.append(url)
                try:
                    body = await response.json()
                    body_str = str(body)
                    if ".pdf" in body_str.lower():
                        print(f"JSON API with PDF: {url}")
                        print(f"  -> {body_str[:400]}")
                    elif url not in ["https://www.kyobo.com/dtc/product-official/find-allProductSearch"]:
                        print(f"JSON API: {url}")
                        print(f"  -> {body_str[:200]}")
                except Exception:
                    pass

        async def on_request(request):
            url = request.url
            if "download" in url.lower() or "pdf" in url.lower():
                print(f"REQUEST: {request.method} {url}")

        page.on("response", on_response)
        page.on("request", on_request)

        print("교보생명 약관 페이지 로딩...")
        await page.goto(
            "https://www.kyobo.com/individual/customer/publicnotice/terms",
            wait_until="networkidle",
            timeout=30000,
        )
        await page.wait_for_timeout(3000)

        # 첫 번째 항목에서 PDF 다운로드 링크 클릭
        print("\n첫 번째 약관 항목 클릭 시도...")

        # 테이블 행이나 리스트 아이템 찾기
        rows = await page.query_selector_all("table tbody tr, .list-item, li.item")
        print(f"행/아이템 수: {len(rows)}")

        if rows:
            # 첫 번째 행 클릭
            await rows[0].click()
            await page.wait_for_timeout(2000)

        # PDF 다운로드 버튼/링크 찾기
        pdf_links = await page.query_selector_all(
            'a[href*=".pdf"], a[href*="download"], a[href*="file"], '
            'button[onclick*="pdf"], button[onclick*="download"]'
        )
        print(f"PDF 관련 링크: {len(pdf_links)}개")

        for link in pdf_links[:5]:
            href = await link.get_attribute("href")
            onclick = await link.get_attribute("onclick")
            text = await link.inner_text()
            print(f"  링크: href={href}, onclick={onclick}, text={text[:30]}")

        # 페이지 소스 분석
        content = await page.content()

        # PDF URL 패턴
        pdf_patterns = re.findall(r'["\'](https?://[^"\']*\.pdf)["\']', content)
        if pdf_patterns:
            print("\nHTML 내 PDF URL:")
            for p_url in pdf_patterns[:10]:
                print(f"  {p_url}")

        # 상대 경로 PDF
        pdf_rel = re.findall(r'["\']([^"\']*\.pdf)["\']', content)
        if pdf_rel:
            print("\nHTML 내 상대 PDF 경로:")
            for p_url in pdf_rel[:10]:
                print(f"  {p_url}")

        # JavaScript에서 API URL
        api_in_js = re.findall(r'["\'](/dtc/[^"\']+)["\']', content)
        if api_in_js:
            print("\nJavaScript API 경로:")
            for api in sorted(set(api_in_js)):
                print(f"  {api}")

        # 'terms' 관련 URL
        terms_urls = re.findall(r'["\']([^"\']*terms[^"\']*)["\']', content)
        if terms_urls:
            print("\n'terms' 관련 URL:")
            for t_url in sorted(set(terms_urls))[:10]:
                print(f"  {t_url}")

        await browser.close()

        print(f"\n캡처된 PDF URL: {len(pdf_urls)}개")
        print(f"캡처된 JSON API: {len(api_calls)}개")
        for url in api_calls:
            print(f"  {url}")


if __name__ == "__main__":
    asyncio.run(capture_kyobo_pdf_url())
