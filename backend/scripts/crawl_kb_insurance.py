#!/usr/bin/env python3
"""KB손해보험 약관 PDF 크롤러

상품목록(약관) 페이지에서 약관 PDF를 수집한다.
Playwright로 전체 상품 목록을 페이지네이션하여 수집 후, 상세 페이지에서 PDF 다운로드.

실행:
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_kb_insurance
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_kb_insurance --dry-run

# @MX:NOTE: KB손보 서버렌더링 euc-kr, 페이지네이션: goPage(startRow) 10개/페이지
# @MX:NOTE: PDF 다운: CG802030003.ec?fileNm=상품코드_회차_1.pdf (직접 다운)
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
import sys
import time
from pathlib import Path
from typing import Any

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
COMPANY_ID = "kb_insurance"
COMPANY_NAME = "KB손해보험"
BASE_URL = "https://www.kbinsure.co.kr"

TARGET_CATEGORIES = {"상해보험", "질병보험", "통합보험", "운전자보험"}


def save_pdf(data: bytes, product_name: str, product_code: str, category: str, source_url: str) -> dict[str, Any]:
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
            "product_code": product_code, "category": category, "source_url": source_url,
            "content_hash": content_hash, "file_size": len(data), "crawled_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"skipped": False}


async def get_products_from_page(page: Any) -> list[dict[str, str]]:
    """현재 페이지의 상품 목록을 파싱한다."""
    return await page.evaluate("""() => {
        const results = [];
        document.querySelectorAll('table tr').forEach(tr => {
            const tds = tr.querySelectorAll('td');
            if (tds.length >= 4) {
                const anchor = tds[3]?.querySelector('a');
                if (anchor) {
                    const href = anchor.getAttribute('href') || '';
                    const match = href.match(/detail\\('(\\d+)','([^']+)','([^']+)'\\)/);
                    if (match) {
                        results.push({
                            code: match[1], catCode: match[2], seq: match[3],
                            name: anchor.textContent.trim(),
                            status: tds[0]?.textContent?.trim() || '',
                            category: tds[1]?.textContent?.trim() || '',
                        });
                    }
                }
            }
        });
        return results;
    }""")


async def main(dry_run: bool = False) -> None:
    from playwright.async_api import async_playwright

    logger.info("=" * 60)
    logger.info("KB손해보험 약관 크롤링 시작%s", " (DRY RUN)" if dry_run else "")
    logger.info("=" * 60)

    all_products: list[dict] = []
    downloaded = 0
    skipped = 0
    failed = 0

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            accept_downloads=True,
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        )
        page = await context.new_page()

        # 1. 전체 상품 목록 페이지네이션
        await page.goto(f"{BASE_URL}/CG802030001.ec", timeout=30000, wait_until="networkidle")
        await asyncio.sleep(3)

        page_num = 1
        while True:
            products = await get_products_from_page(page)
            if not products:
                break
            all_products.extend(products)

            # 다음 페이지 확인
            page_num += 1
            start_row = (page_num - 1) * 10 + 1
            has_next = await page.evaluate(f"""() => {{
                const links = document.querySelectorAll('.paging a, [class*=pag] a');
                for (const a of links) {{
                    const onclick = a.getAttribute('onclick') || '';
                    if (onclick.includes("goPage('{start_row}')")) return true;
                }}
                return false;
            }}""")

            if not has_next:
                break

            try:
                async with page.expect_navigation(wait_until="networkidle", timeout=15000):
                    await page.evaluate(f"goPage('{start_row}')")
            except Exception:
                await asyncio.sleep(3)
            await asyncio.sleep(1)

            if page_num > 100:
                break

        logger.info("[%s] 전체 %d개 상품 수집 완료 (%d 페이지)", COMPANY_NAME, len(all_products), page_num)

        # 판매중지 탭 클릭 시도 - 추가 상품 수집
        disc_clicked = await page.evaluate("""() => {
            const elements = document.querySelectorAll('a, li, button, span, div');
            for (const el of elements) {
                const text = el.textContent.trim();
                if (text === '판매중지' || text === '판매 중지') {
                    el.click();
                    return true;
                }
            }
            return false;
        }""")
        if disc_clicked:
            logger.info("[%s] 판매중지 탭 클릭 - 추가 상품 수집 중...", COMPANY_NAME)
            await asyncio.sleep(3)
            existing_keys = {(p["code"], p["seq"]) for p in all_products}
            disc_page_num = 1
            while True:
                disc_products = await get_products_from_page(page)
                if not disc_products:
                    break
                for p in disc_products:
                    key = (p["code"], p["seq"])
                    if key not in existing_keys:
                        all_products.append(p)
                        existing_keys.add(key)
                disc_page_num += 1
                start_row = (disc_page_num - 1) * 10 + 1
                has_next = await page.evaluate(f"""() => {{
                    const links = document.querySelectorAll('.paging a, [class*=pag] a');
                    for (const a of links) {{
                        const onclick = a.getAttribute('onclick') || '';
                        if (onclick.includes("goPage('{start_row}')")) return true;
                    }}
                    return false;
                }}""")
                if not has_next:
                    break
                try:
                    async with page.expect_navigation(wait_until="networkidle", timeout=15000):
                        await page.evaluate(f"goPage('{start_row}')")
                except Exception:
                    await asyncio.sleep(3)
                await asyncio.sleep(1)
                if disc_page_num > 100:
                    break
            logger.info("[%s] 판매중지 포함 총 %d개 상품", COMPANY_NAME, len(all_products))
        else:
            logger.info("[%s] 판매중지 탭 없음 또는 이미 전체 포함", COMPANY_NAME)

        # 2. 대상 카테고리 필터링
        targets = [p for p in all_products if p.get("category") in TARGET_CATEGORIES]
        logger.info("[%s] 대상 카테고리 %d개 상품", COMPANY_NAME, len(targets))

        from collections import Counter
        cat_dist = Counter(p["category"] for p in targets)
        for cat, cnt in cat_dist.most_common():
            logger.info("  %s: %d개", cat, cnt)

        if dry_run:
            for t in targets:
                logger.info("  [DRY] [%s] %s (%s, code=%s)", t["status"], t["name"][:50], t["category"], t["code"])
            await browser.close()
            return

        # 3. 각 상품 상세 페이지에서 PDF 다운로드
        async with httpx.AsyncClient(
            headers={"User-Agent": "Mozilla/5.0", "Referer": f"{BASE_URL}/CG802030001.ec"},
            follow_redirects=True,
        ) as client:
            for i, prod in enumerate(targets):
                name = prod["name"]
                code = prod["code"]
                cat = prod["category"]

                try:
                    # 상세 페이지 이동 (form POST)
                    await page.goto(f"{BASE_URL}/CG802030001.ec", timeout=15000, wait_until="networkidle")
                    await asyncio.sleep(1)

                    await page.evaluate(f"""() => {{
                        document.getElementById('bojongNo').value = '{code}';
                        document.getElementById('gubun').value = '{prod["catCode"]}';
                        document.getElementById('bojongSeq').value = '{prod["seq"]}';
                        const form = document.prdtList;
                        form.target = '_self';
                        form.action = '/CG802030002.ec';
                        form.submit();
                    }}""")
                    await asyncio.sleep(2)

                    # 약관 PDF 링크 추출 (_1.pdf = 약관)
                    pdf_links = await page.evaluate("""() => {
                        const links = [];
                        document.querySelectorAll('a[href*="CG802030003"]').forEach(a => {
                            const href = a.getAttribute('href') || '';
                            if (href.includes('_1.pdf')) links.push(href);
                        });
                        return links;
                    }""")

                    if not pdf_links:
                        failed += 1
                        continue

                    # 최신(마지막) 약관 PDF 다운로드
                    pdf_url = f"{BASE_URL}{pdf_links[-1]}"
                    resp = await client.get(pdf_url, timeout=30.0)

                    if resp.status_code == 200 and resp.content[:4] == b"%PDF" and len(resp.content) > 1000:
                        result = save_pdf(resp.content, name, code, cat, pdf_url)
                        if result.get("skipped"):
                            skipped += 1
                        else:
                            downloaded += 1
                            if downloaded % 20 == 0:
                                logger.info("  진행: %d/%d 다운로드", downloaded, len(targets))
                    else:
                        failed += 1

                except Exception as e:
                    logger.error("  [ERROR] %s: %s", name[:40], e)
                    failed += 1

                await asyncio.sleep(0.3)

        await browser.close()

    logger.info("=" * 60)
    logger.info("KB손해보험 크롤링 완료: %d 다운로드, %d 스킵, %d 실패 (총 %d)", downloaded, skipped, failed, len(targets))
    logger.info("=" * 60)

    report_path = BASE_DATA_DIR / "kb_insurance_report.json"
    report = {"company_id": COMPANY_ID, "company_name": COMPANY_NAME,
              "crawled_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "dry_run": dry_run,
              "total_target": len(targets), "downloaded": downloaded, "skipped": skipped, "failed": failed}
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("리포트: %s", report_path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="KB손해보험 약관 크롤러")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    asyncio.run(main(dry_run=args.dry_run))
