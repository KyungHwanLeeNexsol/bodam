"""Analyze Kyobo common JS for file download patterns"""

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

    async with httpx.AsyncClient(verify=False, follow_redirects=True, timeout=15) as client:
        # Analyze common JS files
        js_files = [
            "https://www.kyobo.com/dgt/web/common/js/dtm/kyobo.common.js",
            "https://www.kyobo.com/dgt/web/pc/common/js/util.js",
            "https://www.kyobo.com/dgt/web/pc/common/js/ajax_common.js",
        ]

        for js_url in js_files:
            resp = await client.get(js_url, headers=headers)
            if resp.status_code != 200:
                print(f"SKIP: {js_url}")
                continue

            content = resp.text
            print(f"\n=== {js_url} ({len(content)} chars) ===")

            # Find URL patterns
            url_pattern = re.compile(r"""['"](/[^'"<>{}\s]{5,80})['"]""")
            all_urls = [m.group(1) for m in url_pattern.finditer(content)]
            download_urls = [u for u in all_urls if any(kw in u.lower() for kw in ["download", "pdf", "file", "ajax"])]

            print(f"Download-related URLs:")
            for u in sorted(set(download_urls)):
                print(f"  {u}")

            # Find download/file keywords in context
            for kw in ["download", "fileDown", "fileNm", "filePath", "pdfUrl", "a2"]:
                idx = content.lower().find(kw.lower())
                if idx != -1:
                    snippet = content[max(0, idx - 80):idx + 250]
                    print(f"\n[{kw}]: ...{snippet[:300]}...")


if __name__ == "__main__":
    asyncio.run(main())
