#!/usr/bin/env python3
"""KB손해보험 약관 PDF 크롤러

상품목록(약관) 페이지에서 약관 PDF를 수집한다.
필터 드롭다운(search_onsale_yn, search_gubun)을 활용하여 카테고리별 + 판매상태별 정확한 수집.

실행:
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_kb_insurance
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_kb_insurance --dry-run

# @MX:NOTE: KB손보 서버렌더링, 폼 필터: search_onsale_yn(Y/N), search_gubun(c/d/a/b)
# @MX:NOTE: 페이지네이션: goPage(startRow) 10개/페이지
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

# 카테고리 코드 → 이름 매핑 (search_gubun 값)
TARGET_CATEGORIES: dict[str, str] = {
    "c": "상해보험",
    "d": "질병보험",
    "a": "통합보험",
    "b": "운전자보험",
}

# 판매상태 코드 → sale_status 매핑 (search_onsale_yn 값)
SALE_STATUS_MAP: dict[str, str] = {
    "Y": "ON_SALE",
    "N": "DISCONTINUED",
}


def save_pdf(
    data: bytes,
    product_name: str,
    product_code: str,
    category: str,
    source_url: str,
    sale_status: str = "ON_SALE",
) -> dict[str, Any]:
    """PDF 파일과 JSON 메타데이터를 저장한다."""
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
                # sale_status가 없거나 다르면 JSON 메타데이터 업데이트
                if existing.get("sale_status") != sale_status:
                    existing["sale_status"] = sale_status
                    meta_path.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
                    return {"skipped": True, "meta_updated": True}
                return {"skipped": True}
        except Exception:
            pass
    pdf_path.write_bytes(data)
    meta = {
        "company_id": COMPANY_ID,
        "company_name": COMPANY_NAME,
        "product_name": product_name.strip(),
        "product_code": product_code,
        "category": category,
        "source_url": source_url,
        "content_hash": content_hash,
        "file_size": len(data),
        "sale_status": sale_status,
        "crawled_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
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


async def collect_filtered_products(
    page: Any,
    sale_yn: str,
    gubun_code: str,
    sale_status: str,
    category_name: str,
) -> list[dict[str, Any]]:
    """필터를 적용한 후 전체 페이지를 순회하여 상품 목록을 수집한다."""
    # 필터 설정 후 검색
    await page.goto(f"{BASE_URL}/CG802030001.ec", timeout=30000, wait_until="networkidle")
    await asyncio.sleep(2)

    await page.select_option("#search_onsale_yn", sale_yn)
    await page.select_option("#search_gubun", gubun_code)
    await asyncio.sleep(0.5)

    # 검색 버튼 클릭 또는 폼 제출
    try:
        search_btn = page.locator("a:has-text('검색'), button:has-text('검색'), input[type='submit']")
        if await search_btn.count() > 0:
            async with page.expect_navigation(wait_until="networkidle", timeout=15000):
                await search_btn.first.click()
        else:
            async with page.expect_navigation(wait_until="networkidle", timeout=15000):
                await page.evaluate("document.prdtList.submit()")
    except Exception:
        await asyncio.sleep(3)

    await asyncio.sleep(2)

    products: list[dict[str, Any]] = []
    page_num = 1

    while True:
        page_products = await get_products_from_page(page)
        if not page_products:
            break

        for p in page_products:
            p["_sale_status"] = sale_status
            p["_filter_category"] = category_name
        products.extend(page_products)

        # 다음 페이지
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

        if page_num > 200:
            break

    return products


async def main(dry_run: bool = False) -> None:
    from playwright.async_api import async_playwright

    logger.info("=" * 60)
    logger.info("KB손해보험 약관 크롤링 시작%s", " (DRY RUN)" if dry_run else "")
    logger.info("필터 기반 수집: 카테고리(%d) × 판매상태(2)", len(TARGET_CATEGORIES))
    logger.info("=" * 60)

    all_products: list[dict] = []
    downloaded = 0
    skipped = 0
    failed = 0
    meta_updated = 0

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            accept_downloads=True,
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        )
        page = await context.new_page()

        # 1. 카테고리별 × 판매상태별 필터 검색으로 상품 수집
        existing_keys: set[tuple[str, str]] = set()

        for gubun_code, cat_name in TARGET_CATEGORIES.items():
            for sale_yn, sale_status in SALE_STATUS_MAP.items():
                logger.info("[%s] %s / %s 상품 수집 중...", COMPANY_NAME, cat_name, sale_status)

                products = await collect_filtered_products(
                    page, sale_yn, gubun_code, sale_status, cat_name,
                )

                # 중복 제거
                new_count = 0
                for p in products:
                    key = (p["code"], p["seq"])
                    if key not in existing_keys:
                        all_products.append(p)
                        existing_keys.add(key)
                        new_count += 1

                logger.info(
                    "  → %s / %s: %d개 발견 (%d개 신규)",
                    cat_name, sale_status, len(products), new_count,
                )

        # 통계 출력
        from collections import Counter
        status_dist = Counter(p["_sale_status"] for p in all_products)
        cat_dist = Counter(p.get("_filter_category", p.get("category")) for p in all_products)

        logger.info("[%s] 전체 %d개 상품 수집 완료", COMPANY_NAME, len(all_products))
        logger.info("  판매상태: %s", dict(status_dist))
        logger.info("  카테고리: %s", dict(cat_dist))

        if dry_run:
            for t in all_products:
                logger.info(
                    "  [DRY] [%s] %s (%s, code=%s)",
                    t["_sale_status"], t["name"][:50], t.get("_filter_category", t["category"]), t["code"],
                )
            await browser.close()
            return

        # 2. 각 상품 상세 페이지에서 PDF 다운로드
        total = len(all_products)
        async with httpx.AsyncClient(
            headers={"User-Agent": "Mozilla/5.0", "Referer": f"{BASE_URL}/CG802030001.ec"},
            follow_redirects=True,
        ) as client:
            for i, prod in enumerate(all_products):
                name = prod["name"]
                code = prod["code"]
                cat = prod.get("_filter_category", prod.get("category", ""))
                prod_status = prod.get("_sale_status", "ON_SALE")

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
                        result = save_pdf(resp.content, name, code, cat, pdf_url, sale_status=prod_status)
                        if result.get("skipped"):
                            skipped += 1
                            if result.get("meta_updated"):
                                meta_updated += 1
                        else:
                            downloaded += 1
                            if downloaded % 20 == 0:
                                logger.info("  진행: %d/%d 다운로드 (%d/%d 처리)", downloaded, total, i + 1, total)
                    else:
                        failed += 1

                except Exception as e:
                    logger.error("  [ERROR] %s: %s", name[:40], e)
                    failed += 1

                await asyncio.sleep(0.3)

                # 진행 상황 (100개마다)
                if (i + 1) % 100 == 0:
                    logger.info("  진행: %d/%d 처리 완료 (다운:%d, 스킵:%d, 실패:%d)", i + 1, total, downloaded, skipped, failed)

        await browser.close()

    logger.info("=" * 60)
    logger.info(
        "KB손해보험 크롤링 완료: %d 다운로드, %d 스킵(%d 메타갱신), %d 실패 (총 %d)",
        downloaded, skipped, meta_updated, failed, len(all_products),
    )
    logger.info("=" * 60)

    report_path = BASE_DATA_DIR / "kb_insurance_report.json"
    report = {
        "company_id": COMPANY_ID,
        "company_name": COMPANY_NAME,
        "crawled_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "dry_run": dry_run,
        "total_target": len(all_products),
        "downloaded": downloaded,
        "skipped": skipped,
        "meta_updated": meta_updated,
        "failed": failed,
        "by_status": dict(Counter(p["_sale_status"] for p in all_products)),
        "by_category": dict(Counter(p.get("_filter_category", p.get("category")) for p in all_products)),
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("리포트: %s", report_path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="KB손해보험 약관 크롤러")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    asyncio.run(main(dry_run=args.dry_run))
