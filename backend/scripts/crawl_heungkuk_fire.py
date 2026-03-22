#!/usr/bin/env python3
"""흥국화재 약관 PDF 크롤러

보험상품공시 페이지에서 약관 PDF를 수집한다.
Playwright로 테이블 파싱 + httpx로 PDF 다운로드.

실행:
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_heungkuk_fire

# @MX:NOTE: 흥국화재 fn_filedownX(path, displayName, serverFileName) → /common/download.do
# @MX:NOTE: 판매 상품 + 판매중지 상품 모두 수집 가능
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx

if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)

SCRIPT_DIR = Path(__file__).parent
BASE_DATA_DIR = SCRIPT_DIR.parent / "data"
COMPANY_ID = "heungkuk_fire"
COMPANY_NAME = "흥국화재"
BASE_URL = "https://www.heungkukfire.co.kr"
PAGE_URL = f"{BASE_URL}/FRW/announce/insGoodsGongsiSale.do"
DOWNLOAD_URL = f"{BASE_URL}/common/download.do"

TARGET_CATEGORIES = {"의료/건강", "운전자/상해", "자녀/실버"}


def save_pdf(data: bytes, product_name: str, category: str, source_url: str, sale_status: str = "ON_SALE") -> dict[str, Any]:
    out_dir = BASE_DATA_DIR / COMPANY_ID
    out_dir.mkdir(parents=True, exist_ok=True)
    content_hash = hashlib.sha256(data).hexdigest()[:16]
    safe_name = product_name.strip()
    for ch in ['/', '\\', ':', '?', '"', '<', '>', '*', '|']:
        safe_name = safe_name.replace(ch, '_')
    if len(safe_name) > 80:
        safe_name = safe_name[:80]
    pdf_path = out_dir / f"{safe_name}_{content_hash}.pdf"
    meta_path = pdf_path.with_suffix(".json")
    if pdf_path.exists() and meta_path.exists():
        try:
            existing = json.loads(meta_path.read_text(encoding="utf-8"))
            if existing.get("content_hash") == content_hash:
                return {"skipped": True}
        except Exception:
            pass
    pdf_path.write_bytes(data)
    meta = {"company_id": COMPANY_ID, "company_name": COMPANY_NAME, "product_name": product_name.strip(),
            "category": category, "source_url": source_url, "content_hash": content_hash,
            "file_size": len(data), "sale_status": sale_status, "crawled_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"skipped": False}


async def main() -> None:
    from playwright.async_api import async_playwright

    logger.info("=" * 60)
    logger.info("흥국화재 약관 크롤링 시작")
    logger.info("=" * 60)

    downloaded = 0
    skipped = 0
    failed = 0

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context()
        page = await ctx.new_page()

        async with httpx.AsyncClient(
            headers={"User-Agent": "Mozilla/5.0", "Referer": PAGE_URL},
            follow_redirects=True,
        ) as client:
            # 판매 + 판매중지 탭 순회
            for tab_label, tab_idx in [("판매", 0), ("판매중지", 1)]:
                await page.goto(PAGE_URL, timeout=30000, wait_until="networkidle")
                await asyncio.sleep(3)

                if tab_idx == 1:
                    # 판매중지 탭 클릭
                    await page.evaluate("""() => {
                        const tabs = document.querySelectorAll('a, li, button');
                        for (const t of tabs) {
                            if (t.textContent.trim() === '판매중지') { t.click(); return; }
                        }
                    }""")
                    await asyncio.sleep(3)

                # 약관 다운로드 링크 추출
                items = await page.evaluate("""() => {
                    const results = [];
                    document.querySelectorAll('a[onclick*="fn_filedownX"]').forEach(a => {
                        const onclick = a.getAttribute('onclick') || '';
                        const text = a.textContent.trim();
                        if (!text.includes('약관')) return;
                        // fn_filedownX('/path/', 'displayName.pdf', 'serverName.pdf')
                        const match = onclick.match(/fn_filedownX\\('([^']+)','([^']+)',\\s*'([^']+)'\\)/);
                        if (match) {
                            // 상품명/카테고리는 부모 tr에서 추출
                            const tr = a.closest('tr');
                            const tds = tr ? tr.querySelectorAll('td') : [];
                            results.push({
                                path: match[1],
                                displayName: match[2],
                                serverName: match[3],
                                category: tds[0]?.textContent?.trim() || '',
                                productName: tds[2]?.textContent?.trim() || match[2].replace('_약관.pdf', ''),
                            });
                        }
                    });
                    return results;
                }""")

                logger.info("[%s] %s: %d개 약관 발견", COMPANY_NAME, tab_label, len(items))

                for item in items:
                    cat = item["category"]
                    name = item["productName"]
                    server_name = item["serverName"]
                    path = item["path"]

                    if cat not in TARGET_CATEGORIES:
                        continue

                    # PDF 다운로드
                    file_path = f"{path}{server_name}"
                    try:
                        resp = await client.get(
                            DOWNLOAD_URL,
                            params={"FILE_NAME": file_path, "TYPE": "filedownX", "FILE_EXT_NAME": item["displayName"]},
                            timeout=60.0,
                        )
                        if resp.status_code == 200 and resp.content[:4] == b"%PDF" and len(resp.content) > 1000:
                            tab_status = "DISCONTINUED" if tab_label == "판매중지" else "ON_SALE"
                            result = save_pdf(resp.content, name, cat, f"{DOWNLOAD_URL}?FILE_NAME={file_path}", sale_status=tab_status)
                            if result.get("skipped"):
                                skipped += 1
                            else:
                                downloaded += 1
                                logger.info("  [OK] %s (%d bytes)", name[:50], len(resp.content))
                        else:
                            failed += 1
                    except Exception as e:
                        logger.error("  [ERROR] %s: %s", name[:30], e)
                        failed += 1

                    await asyncio.sleep(0.5)

        await browser.close()

    logger.info("=" * 60)
    logger.info("흥국화재 크롤링 완료: %d 다운로드, %d 스킵, %d 실패", downloaded, skipped, failed)
    logger.info("=" * 60)

    report_path = BASE_DATA_DIR / "heungkuk_fire_report.json"
    report = {"company_id": COMPANY_ID, "company_name": COMPANY_NAME,
              "crawled_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
              "downloaded": downloaded, "skipped": skipped, "failed": failed}
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(main())
