"""Find Kyobo Life terms-related JS files and PDF download patterns"""

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
        "Accept": "*/*",
    }

    async with httpx.AsyncClient(verify=False, follow_redirects=True, timeout=30) as client:
        # Test terms-related JS files
        test_paths = [
            "/dgt/web/pc/dtm/scripts/pr/DTMPRPRI010M.js",
            "/dgt/web/pc/dtm/scripts/pr/DTMPRPRI010200M.js",
            "/dgt/web/pc/dtm/scripts/pr/DTMPRPRI010210M.js",
            "/dgt/web/pc/dtm/scripts/co/DTMCO010.js",
            "/dgt/web/pc/dtm/scripts/co/DTMCOFTL001.js",
            "/dgt/web/pc/dtm/scripts/co/DTMCOFTL010.js",
        ]

        for path in test_paths:
            url = f"https://www.kyobo.com{path}"
            resp = await client.get(url, headers=headers)
            if resp.status_code == 200 and len(resp.text) > 500:
                print(f"FOUND: {path} ({len(resp.text)} chars)")
                content = resp.text
                # Search for download patterns
                for kw in ["download", "pdf", "fileNm", "filePath", "a2"]:
                    if kw.lower() in content.lower():
                        idx = content.lower().find(kw.lower())
                        snippet = content[max(0, idx - 60):idx + 200]
                        print(f"  [{kw}]: ...{snippet[:200]}...")
            else:
                print(f"{resp.status_code} | {path}")

        # Get main page and find all JS files
        print("\nChecking main page JS files...")
        resp = await client.get("https://www.kyobo.com/", headers=headers)
        content = resp.text

        js_pattern = re.compile(r'src="((?:https?:)?//[^"]+\.js|/[^"]+\.js)"')
        js_files = [m.group(1) for m in js_pattern.finditer(content)]
        print(f"All JS files: {len(js_files)}")
        for js in js_files:
            print(f"  {js}")

        # Try /file/ajax/ patterns
        print("\nTesting /file/ajax/ patterns:")
        filename = "1267683303497"  # Use partial filename without Korean chars
        file_patterns = [
            f"/file/ajax/display-img?fName=/upload/terms/{filename}",
            f"/file/ajax/download?fName=/upload/terms/{filename}.pdf",
            f"/dtc/file/download?fName={filename}.pdf",
        ]
        for path in file_patterns:
            url = f"https://www.kyobo.com{path}"
            try:
                resp = await client.head(url, headers=headers)
                ct = resp.headers.get("content-type", "")
                print(f"  {resp.status_code} | {ct[:30]} | {path}")
            except Exception as e:
                print(f"  ERR | {str(e)[:40]} | {path}")


if __name__ == "__main__":
    asyncio.run(main())
