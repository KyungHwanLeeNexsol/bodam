"""Search Kyobo JS bundles for PDF download API patterns"""

import asyncio
import re
import httpx


async def main():
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "*/*",
        "Referer": "https://www.kyobo.com/",
    }

    async with httpx.AsyncClient(verify=False, follow_redirects=True, timeout=30) as client:
        # Get main page
        resp = await client.get("https://www.kyobo.com/", headers=headers)
        content = resp.text

        # Extract JS files
        js_files = re.findall(r'src="(/[^"]+\.js)"', content)
        js_files2 = re.findall(r"src='(/[^']+\.js)'", content)
        all_js = list(set(js_files + js_files2))
        print(f"Found {len(all_js)} JS files")

        # Also look for script tags with asset paths
        script_srcs = re.findall(r'"(/assets/[^"]+\.js)"', content)
        print(f"Asset JS files: {len(script_srcs)}")
        for s in script_srcs[:5]:
            print(f"  {s}")

        # Try to find the terms-related API in JS bundles
        search_terms = ["download", "termSeq", "fileDown", "pdfUrl", "fileUrl", "a2"]

        for js_url in all_js[:10]:
            full_url = f"https://www.kyobo.com{js_url}"
            try:
                js_resp = await client.get(full_url, headers=headers)
                js_content = js_resp.text

                found_any = any(term in js_content for term in search_terms)
                if found_any:
                    print(f"\nRelevant JS: {js_url}")
                    # Extract API patterns near download keywords
                    for term in search_terms:
                        if term in js_content:
                            idx = js_content.find(term)
                            snippet = js_content[max(0, idx - 100):idx + 200]
                            print(f"  [{term}]: ...{snippet}...")
                            break
            except Exception as e:
                print(f"  Error loading {js_url}: {e}")

        # Try specific API patterns with different termSeq values
        print("\n\nTrying direct PDF URL patterns:")
        term_seq = "2325"
        filename = "1267683303497_" + "\ufffd\ufffd" + "119" + "\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd" + "(98.04.01).pdf"

        # Common CDN/storage URL patterns
        cdn_patterns = [
            f"https://cdn.kyobo.com/terms/{filename}",
            f"https://file.kyobo.com/terms/{filename}",
            f"https://static.kyobo.com/terms/{filename}",
            f"https://www.kyobo.com/upload/terms/{filename}",
            f"https://www.kyobo.com/storage/terms/{filename}",
        ]

        for url in cdn_patterns:
            try:
                r = await client.head(url, headers=headers)
                print(f"  {r.status_code} | {url[:60]}")
            except Exception as e:
                print(f"  ERR | {str(e)[:40]} | {url[:60]}")


if __name__ == "__main__":
    asyncio.run(main())
