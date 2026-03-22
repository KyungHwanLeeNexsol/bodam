#!/usr/bin/env python3
"""메리츠화재 약관 PDF 크롤러

공시실 상품목록 페이지에서 카테고리별 약관 PDF를 수집한다.
Playwright로 SPA 네비게이션 후 다운로드 이벤트를 통해 PDF를 저장.

실행:
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_meritz_fire
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_meritz_fire --dry-run
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_meritz_fire --category 질병보험

# @MX:NOTE: 메리츠화재 공시실은 AngularJS SPA, 카테고리 클릭 시 json.smart API 호출
# @MX:NOTE: PDF 다운로드는 pdfDown() → POST /hp/fileDownload.do (암호화된 경로 사용)
# @MX:WARN: 직접 HTTP GET으로 PDF URL 접근 불가, Playwright 다운로드 이벤트 필수
# @MX:REASON: SPA 내부에서 파일 경로를 암호화하여 fileDownload.do에 POST 하는 방식
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
COMPANY_ID = "meritz_fire"
COMPANY_NAME = "메리츠화재"
BASE_URL = "https://www.meritzfire.com"
DISCLOSURE_URL = f"{BASE_URL}/disclosure/product-announcement/product-list.do"

# 수집 대상 카테고리
TARGET_CATEGORIES = ["질병보험", "상해보험", "암보험", "어린이보험", "통합보험"]

NEGATIVE_KEYWORDS = ["자동차", "화재", "보증", "책임", "배상", "해상", "항공"]


def is_target_product(name: str) -> bool:
    """질병/상해 관련 상품인지 확인한다."""
    return not any(kw in name for kw in NEGATIVE_KEYWORDS)


def save_pdf(
    data: bytes,
    product_name: str,
    category: str,
    source_url: str,
) -> dict[str, Any]:
    """PDF를 저장하고 메타데이터를 기록한다."""
    out_dir = BASE_DATA_DIR / COMPANY_ID
    out_dir.mkdir(parents=True, exist_ok=True)

    content_hash = hashlib.sha256(data).hexdigest()[:16]

    # 파일명 정리
    safe_name = product_name.replace("/", "_").replace("\\", "_").replace(":", "_")
    safe_name = safe_name.replace("?", "").replace('"', "").replace("<", "").replace(">", "")
    safe_name = safe_name.replace("*", "").replace("|", "")
    if len(safe_name) > 80:
        safe_name = safe_name[:80]

    pdf_path = out_dir / f"{safe_name}_{content_hash}.pdf"
    meta_path = pdf_path.with_suffix(".json")

    # 중복 체크 (해시 기반)
    if pdf_path.exists() and meta_path.exists():
        try:
            existing = json.loads(meta_path.read_text(encoding="utf-8"))
            if existing.get("content_hash") == content_hash:
                return {"skipped": True, "reason": "duplicate", "path": str(pdf_path)}
        except Exception:
            pass

    pdf_path.write_bytes(data)
    meta = {
        "company_id": COMPANY_ID,
        "company_name": COMPANY_NAME,
        "product_name": product_name,
        "category": category,
        "source_url": source_url,
        "content_hash": content_hash,
        "file_size": len(data),
        "crawled_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"skipped": False, "path": str(pdf_path)}


async def crawl_category(
    page: Any,
    category: str,
    dry_run: bool = False,
    sale_status: str = "판매",
) -> list[dict[str, Any]]:
    """특정 카테고리의 약관 PDF를 Playwright 다운로드로 수집한다.

    # @MX:NOTE: sale_status="판매중지"로 호출하면 판매중지 탭 클릭 후 수집
    """
    results: list[dict[str, Any]] = []

    # 카테고리 클릭
    clicked = await page.evaluate(
        f"""() => {{
        const anchors = Array.from(document.querySelectorAll('a'));
        for (const a of anchors) {{
            if (a.textContent.trim() === '{category}') {{
                a.click();
                return true;
            }}
        }}
        return false;
    }}"""
    )

    if not clicked:
        logger.warning("[%s] 카테고리 '%s' 클릭 실패", COMPANY_NAME, category)
        return results

    await asyncio.sleep(4)

    # 판매중지 탭 클릭 (sale_status가 "판매중지"인 경우)
    if sale_status == "판매중지":
        tab_clicked = await page.evaluate("""() => {
            const elements = document.querySelectorAll('a, li, button, span');
            for (const el of elements) {
                if (el.textContent.trim() === '판매중지') {
                    el.click();
                    return true;
                }
            }
            return false;
        }""")
        if tab_clicked:
            logger.info("[%s] 판매중지 탭 클릭 성공 (%s)", COMPANY_NAME, category)
            await asyncio.sleep(3)
        else:
            logger.warning("[%s] 판매중지 탭을 찾지 못함 (%s)", COMPANY_NAME, category)
            return results

    # 테이블 행 수와 상품명 가져오기
    row_info = await page.evaluate("""() => {
        const rows = document.querySelectorAll('table tbody tr');
        return Array.from(rows).map((tr, idx) => {
            const tds = tr.querySelectorAll('td');
            const name = tds[0] ? tds[0].textContent.trim() : '';
            const hasFile = tds[3] && tds[3].querySelector('a.btn_file') !== null;
            return {idx, name, hasFile};
        });
    }""")

    total = len(row_info)
    with_file = sum(1 for r in row_info if r["hasFile"])
    logger.info("[%s] %s: %d개 상품 (%d개 약관 파일)", COMPANY_NAME, category, total, with_file)

    if dry_run:
        for r in row_info:
            if r["hasFile"]:
                logger.info("  [DRY] %s", r["name"])
                results.append({"name": r["name"], "status": "dry_run"})
        return results

    # 각 행의 약관 다운로드 버튼 클릭
    for r in row_info:
        if not r["hasFile"]:
            continue

        name = r["name"]
        idx = r["idx"]

        if not is_target_product(name):
            continue

        try:
            # 다운로드 이벤트 대기 + 클릭
            async with page.expect_download(timeout=15000) as download_info:
                await page.evaluate(
                    f"""() => {{
                    const rows = document.querySelectorAll('table tbody tr');
                    const row = rows[{idx}];
                    if (row) {{
                        const btn = row.querySelectorAll('td')[3]?.querySelector('a.btn_file');
                        if (btn) btn.click();
                    }}
                }}"""
                )

            download = await download_info.value
            # 다운로드된 파일 읽기
            tmp_path = await download.path()
            if tmp_path:
                data = Path(tmp_path).read_bytes()
                # PDF 유효성 확인
                if data[:4] == b"%PDF" and len(data) > 1000:
                    save_result = save_pdf(
                        data=data,
                        product_name=name,
                        category=category,
                        source_url=download.url,
                    )
                    if save_result.get("skipped"):
                        results.append({"name": name, "status": "skipped"})
                    else:
                        logger.info("  [OK] %s (%d bytes)", name, len(data))
                        results.append({"name": name, "status": "downloaded", "size": len(data)})
                else:
                    logger.warning("  [INVALID] %s - PDF가 아님 (%d bytes)", name, len(data))
                    results.append({"name": name, "status": "invalid"})
            else:
                logger.warning("  [FAIL] %s - 다운로드 경로 없음", name)
                results.append({"name": name, "status": "failed"})

        except TimeoutError:
            logger.warning("  [TIMEOUT] %s", name)
            results.append({"name": name, "status": "timeout"})
        except Exception as e:
            logger.error("  [ERROR] %s: %s", name, e)
            results.append({"name": name, "status": "error", "error": str(e)})

        await asyncio.sleep(0.3)

    return results


async def main(dry_run: bool = False, categories: list[str] | None = None) -> None:
    """메리츠화재 약관 크롤러 메인 함수."""
    from playwright.async_api import async_playwright

    target_cats = categories or TARGET_CATEGORIES

    logger.info("=" * 60)
    logger.info("메리츠화재 약관 크롤링 시작%s", " (DRY RUN)" if dry_run else "")
    logger.info("대상 카테고리: %s", ", ".join(target_cats))
    logger.info("=" * 60)

    all_results: dict[str, list[dict]] = {}
    total_downloaded = 0

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            accept_downloads=True,
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        )

        page = await context.new_page()

        logger.info("[%s] 공시실 페이지 로딩...", COMPANY_NAME)
        await page.goto(DISCLOSURE_URL, timeout=30000, wait_until="networkidle")
        await asyncio.sleep(4)

        for category in target_cats:
            all_results[category] = []
            for sale_status in ["판매", "판매중지"]:
                logger.info("[%s] 카테고리: %s (%s)", COMPANY_NAME, category, sale_status)

                # 탭/카테고리 전환 전 페이지 재로딩으로 SPA 상태 초기화
                await page.goto(DISCLOSURE_URL, timeout=30000, wait_until="networkidle")
                await asyncio.sleep(4)

                cat_results = await crawl_category(page, category, dry_run, sale_status)
                all_results[category].extend(cat_results)
                downloaded = sum(1 for r in cat_results if r["status"] == "downloaded")
                total_downloaded += downloaded
                logger.info(
                    "[%s] %s (%s) 완료: %d개 다운로드, %d개 스킵, %d개 타임아웃/실패",
                    COMPANY_NAME,
                    category,
                    sale_status,
                    downloaded,
                    sum(1 for r in cat_results if r["status"] == "skipped"),
                    sum(1 for r in cat_results if r["status"] in ("failed", "error", "timeout", "invalid")),
                )
                await asyncio.sleep(2)

        await browser.close()

    # 결과 요약
    logger.info("=" * 60)
    logger.info("메리츠화재 크롤링 완료")
    logger.info("=" * 60)
    for cat, cat_results in all_results.items():
        downloaded = sum(1 for r in cat_results if r["status"] == "downloaded")
        skipped = sum(1 for r in cat_results if r["status"] == "skipped")
        logger.info("  %s: %d개 다운로드, %d개 스킵 (총 %d개)", cat, downloaded, skipped, len(cat_results))
    logger.info("총 다운로드: %d개 PDF", total_downloaded)

    # 리포트 저장
    report_path = BASE_DATA_DIR / "meritz_fire_report.json"
    report = {
        "company_id": COMPANY_ID,
        "company_name": COMPANY_NAME,
        "crawled_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "dry_run": dry_run,
        "total_downloaded": total_downloaded,
        "categories": {cat: len(r) for cat, r in all_results.items()},
        "details": all_results,
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("리포트 저장: %s", report_path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="메리츠화재 약관 크롤러")
    parser.add_argument("--dry-run", action="store_true", help="PDF 다운로드 없이 목록만 확인")
    parser.add_argument("--category", type=str, help="특정 카테고리만 수집 (예: 질병보험)")
    args = parser.parse_args()

    cats = [args.category] if args.category else None
    asyncio.run(main(dry_run=args.dry_run, categories=cats))
