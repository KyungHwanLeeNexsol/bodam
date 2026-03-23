"""Search Kyobo JS bundles for PDF download API URL"""

import asyncio
import re
import httpx
import sys

# Force UTF-8 output
if sys.stdout.encoding != "utf-8":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")


async def main():
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "*/*",
        "Referer": "https://www.kyobo.com/",
    }

    async with httpx.AsyncClient(verify=False, follow_redirects=True, timeout=30) as client:
        resp = await client.get("https://www.kyobo.com/", headers=headers)
        content = resp.text

        # Extract JS files
        js_files = re.findall(r'src="(/[^"]+\.js)"', content)
        js_files2 = re.findall(r"src='(/[^']+\.js)'", content)
        all_js = list(set(js_files + js_files2))
        print(f"Found {len(all_js)} JS files", flush=True)
        for js in all_js[:5]:
            print(f"  {js}", flush=True)

        # Search each JS file for download/file patterns
        keywords = ["download", "fileDown", "termSeq", "filePath", "fileUrl", "pdfUrl", "a2"]

        for js_url in all_js:
            full_url = f"https://www.kyobo.com{js_url}"
            try:
                js_resp = await client.get(full_url, headers=headers)
                js_content = js_resp.text

                for kw in keywords:
                    if kw in js_content:
                        # Find surrounding context
                        idx = 0
                        while True:
                            idx = js_content.find(kw, idx)
                            if idx == -1:
                                break
                            snippet = js_content[max(0, idx - 80):idx + 150]
                            # Only show if it looks like an API path
                            if "/dtc/" in snippet or "download" in snippet.lower() or "file" in snippet.lower():
                                print(f"\nJS: {js_url} [{kw}]:", flush=True)
                                print(f"  ...{snippet}...", flush=True)
                            idx += len(kw)

            except Exception as e:
                print(f"Error loading {js_url}: {str(e)[:50]}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
