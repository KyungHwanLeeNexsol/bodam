"""Find Kyobo SPA JS bundles and analyze for product terms PDF download URL"""

import asyncio
import re
import httpx
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")


async def main():
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://www.kyobo.com/",
    }

    async with httpx.AsyncClient(verify=False, follow_redirects=True, timeout=30) as client:
        # Get main page
        resp = await client.get("https://www.kyobo.com/", headers=headers)
        content = resp.text

        # Find all script sources
        script_pattern = re.compile(r'<script[^>]+src="([^"]+)"')
        scripts = [m.group(1) for m in script_pattern.finditer(content)]
        print(f"Scripts in main page: {len(scripts)}")

        # Also find dynamically loaded JS via link preload
        preload_pattern = re.compile(r'<link[^>]+href="([^"]+\.js)"')
        preloads = [m.group(1) for m in preload_pattern.finditer(content)]
        print(f"Preloaded JS: {len(preloads)}")

        # Try to find the Vite/webpack manifest
        manifest_urls = [
            "https://www.kyobo.com/asset-manifest.json",
            "https://www.kyobo.com/manifest.json",
            "https://www.kyobo.com/vite-manifest.json",
            "https://www.kyobo.com/.vite/manifest.json",
        ]

        for m_url in manifest_urls:
            try:
                m_resp = await client.get(m_url, headers=headers)
                if m_resp.status_code == 200 and "json" in m_resp.headers.get("content-type", ""):
                    print(f"\nFound manifest: {m_url}")
                    data = m_resp.json()
                    print(str(data)[:500])
            except Exception:
                pass

        # The SPA uses a different domain structure
        # Try to access the app bundle directly
        # Find any chunk/bundle references in the HTML
        bundle_refs = re.findall(r'"(/[^"]+\.(js|css))"', content)
        print(f"\nBundle refs: {len(bundle_refs)}")
        for ref, ext in bundle_refs[:20]:
            print(f"  {ref}")

        # Now look for product-official API in the new SPA structure
        # The API /dtc/product-official/find-allProductSearch is confirmed working
        # Let's search for related endpoints in swagger/openapi docs
        api_docs = [
            "https://www.kyobo.com/dtc/v3/api-docs",
            "https://www.kyobo.com/dtc/swagger-ui/index.html",
            "https://www.kyobo.com/api/swagger",
        ]

        for doc_url in api_docs:
            try:
                doc_resp = await client.get(doc_url, headers=headers)
                if doc_resp.status_code == 200:
                    print(f"\nAPI docs found: {doc_url}")
                    print(doc_resp.text[:500])
            except Exception:
                pass

        # Brute force: try variations of the find-allProductSearch endpoint
        print("\nTrying product-official API variations:")
        payloads = [{"termSeq": "2325", "saleYn": "N"}]

        api_variations = [
            "/dtc/product-official/find-termsFileInfo",
            "/dtc/product-official/find-termsFileUrl",
            "/dtc/product-official/find-termsFilePath",
            "/dtc/product-official/get-fileInfo",
            "/dtc/product-official/getTermsFile",
            "/dtc/product-official/find-allProductSearchDetail",
        ]

        for api_path in api_variations:
            url = f"https://www.kyobo.com{api_path}"
            for payload in payloads:
                try:
                    resp = await client.post(url, json=payload, headers={**headers, "Content-Type": "application/json"})
                    body = resp.json()
                    code = body.get("header", {}).get("code", "?") if isinstance(body, dict) else "?"
                    if code != "404":
                        print(f"  NON-404: {api_path} -> {code}")
                        print(f"    {str(body)[:200]}")
                    else:
                        print(f"  404: {api_path}")
                except Exception as e:
                    print(f"  ERR: {api_path}: {str(e)[:40]}")


if __name__ == "__main__":
    asyncio.run(main())
