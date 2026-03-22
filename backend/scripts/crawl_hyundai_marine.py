#!/usr/bin/env python3
"""현대해상 약관 PDF 크롤러

공시실 > 보험상품공시(menuId=100932) 페이지에서 약관 PDF를 수집한다.
ajax.xhi API로 상품 목록을 가져온 후, openPdf(uuid)로 다운로드.

실행:
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_hyundai_marine
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_hyundai_marine --dry-run

# @MX:NOTE: 현대해상 SPA, ajax.xhi POST로 상품 목록 반환
# @MX:NOTE: openPdf(clauApnflId)로 새 탭 열며 PDF 다운로드 트리거
# @MX:NOTE: prodCatCd 03xx=장기보험, 0100=일반보험, 0200=자동차보험
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
COMPANY_ID = "hyundai_marine"
COMPANY_NAME = "현대해상"
BASE_URL = "https://www.hi.co.kr"

# 질병/상해 관련 키워드
DISEASE_KEYWORDS = [
    "질병", "상해", "건강", "암", "치아", "치매", "간병", "실손", "의료",
    "어린이", "통합", "종합", "케어", "뇌", "심장", "CI", "GI",
]

# 제외 키워드
EXCLUDE_KEYWORDS = ["자동차", "화재", "보증", "책임", "배상", "해상", "항공", "운전", "적하"]


def is_disease_injury(name: str) -> bool:
    """질병/상해 관련 상품인지 확인한다."""
    if any(kw in name for kw in EXCLUDE_KEYWORDS):
        return False
    return any(kw in name for kw in DISEASE_KEYWORDS)


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

    safe_name = product_name.strip().lstrip("\t")
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
                return {"skipped": True, "path": str(pdf_path)}
        except Exception:
            pass

    pdf_path.write_bytes(data)
    meta = {
        "company_id": COMPANY_ID,
        "company_name": COMPANY_NAME,
        "product_name": product_name.strip(),
        "category": category,
        "source_url": source_url,
        "content_hash": content_hash,
        "file_size": len(data),
        "crawled_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"skipped": False, "path": str(pdf_path)}


async def get_product_list(page: Any) -> list[dict[str, Any]]:
    """ajax.xhi API에서 전체 상품 목록을 가져온다."""
    product_data: list[dict] = []
    # slYProdList/slNProdList 포함 응답 도착 시 set
    data_received = asyncio.Event()

    async def on_response(resp: Any) -> None:
        ct = resp.headers.get("content-type", "")
        if resp.status == 200 and "json" in ct and "ajax.xhi" in resp.url:
            try:
                body = await resp.body()
                data = json.loads(body)
                if "data" in data:
                    inner = data["data"]
                    # slYProdList: 판매중, slNProdList: 판매중지
                    found = False
                    for key in ("slYProdList", "slNProdList"):
                        if key in inner and isinstance(inner[key], list):
                            product_data.extend(inner[key])
                            found = True
                    if found:
                        data_received.set()
            except Exception:
                pass

    page.on("response", on_response)

    logger.info("[%s] 공시실 상품목록 로딩...", COMPANY_NAME)
    await page.goto(f"{BASE_URL}/serviceAction.do", timeout=30000, wait_until="networkidle")
    await asyncio.sleep(3)
    await page.evaluate("fn_goMenu('100932')")

    # 상품 데이터 응답을 받을 때까지 최대 60초 대기
    try:
        await asyncio.wait_for(data_received.wait(), timeout=60)
    except asyncio.TimeoutError:
        logger.warning("[%s] 상품 목록 응답 타임아웃 (60초)", COMPANY_NAME)

    page.remove_listener("response", on_response)
    logger.info("[%s] 전체 %d개 상품 로드 완료", COMPANY_NAME, len(product_data))
    return product_data


def filter_products(products: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """질병/상해 관련 상품만 필터링한다."""
    filtered = []
    for prod in products:
        name = prod.get("prodNm", "").strip()
        cat_cd = prod.get("prodCatCd", "")
        clause_id = prod.get("clauApnflId", "")

        if not clause_id:
            continue

        # 장기보험 (03xx) 중 관련 카테고리
        # 0302=건강, 0303=어린이, 0304=실손, 0305=암
        if cat_cd in ("0302", "0303", "0304", "0305"):
            filtered.append(prod)
            continue

        # 일반보험 (0100) 중 질병/상해 키워드
        if cat_cd == "0100" and is_disease_injury(name):
            filtered.append(prod)
            continue

    return filtered


async def download_pdf_via_playwright(
    page: Any,
    context: Any,
    clause_id: str,
    product_name: str,
) -> bytes | None:
    """openPdf(uuid) 호출 후 Playwright 다운로드로 PDF를 가져온다."""
    try:
        async with page.expect_event("popup", timeout=10000) as popup_info:
            await page.evaluate(f'openPdf("{clause_id}")')

        popup = await popup_info.value
        await asyncio.sleep(2)

        # 팝업 페이지에서 다운로드 URL 추출
        url = popup.url
        if url and "FileActionServlet" in url:
            # 직접 다운로드
            import httpx
            async with httpx.AsyncClient(
                headers={"User-Agent": "Mozilla/5.0", "Referer": f"{BASE_URL}/serviceAction.do"},
                follow_redirects=True,
                cookies={c["name"]: c["value"] for c in await context.cookies()},
            ) as client:
                resp = await client.get(url, timeout=30.0)
                if resp.status_code == 200 and resp.content[:4] == b"%PDF":
                    await popup.close()
                    return resp.content

        # 팝업 닫기
        try:
            await popup.close()
        except Exception:
            pass

    except TimeoutError:
        pass
    except Exception as e:
        logger.debug("  Download error for %s: %s", product_name[:30], e)

    return None


async def download_pdf_direct(
    page: Any,
    context: Any,
    clause_id: str,
) -> tuple[bytes | None, str]:
    """openPdf 호출 후 다운로드 이벤트로 PDF를 가져온다."""
    try:
        # 다운로드 대기
        async with page.expect_download(timeout=15000) as dl_info:
            await page.evaluate(f'openPdf("{clause_id}")')

        download = await dl_info.value
        tmp_path = await download.path()
        if tmp_path:
            data = Path(tmp_path).read_bytes()
            if data[:4] == b"%PDF" and len(data) > 1000:
                return data, download.url

    except Exception:
        pass

    # 팝업 방식 시도
    try:
        pages_before = set(p.url for p in context.pages)
        await page.evaluate(f'openPdf("{clause_id}")')
        await asyncio.sleep(3)

        for pg in context.pages:
            if pg.url not in pages_before and "FileActionServlet" in pg.url:
                url = pg.url
                try:
                    await pg.close()
                except Exception:
                    pass

                import httpx
                cookies = {c["name"]: c["value"] for c in await context.cookies()}
                async with httpx.AsyncClient(
                    headers={"User-Agent": "Mozilla/5.0"},
                    follow_redirects=True,
                    cookies=cookies,
                ) as client:
                    resp = await client.get(url, timeout=30.0)
                    if resp.status_code == 200 and resp.content[:4] == b"%PDF":
                        return resp.content, url

    except Exception:
        pass

    return None, ""


async def main(dry_run: bool = False) -> None:
    """현대해상 약관 크롤러 메인 함수."""
    from playwright.async_api import async_playwright

    logger.info("=" * 60)
    logger.info("현대해상 약관 크롤링 시작%s", " (DRY RUN)" if dry_run else "")
    logger.info("=" * 60)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            accept_downloads=True,
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        )

        page = await context.new_page()

        # 1. 상품 목록 로드
        all_products = await get_product_list(page)

        # 2. 질병/상해 관련 필터
        targets = filter_products(all_products)
        logger.info("[%s] 질병/상해 관련 상품: %d개", COMPANY_NAME, len(targets))

        if dry_run:
            for t in targets:
                name = t.get("prodNm", "").strip()
                cat = t.get("prodCatCd", "")
                logger.info("  [DRY] %s (cat=%s)", name, cat)
            await browser.close()
            return

        # 3. PDF 다운로드
        downloaded = 0
        skipped = 0
        failed = 0

        for i, prod in enumerate(targets):
            name = prod.get("prodNm", "").strip()
            clause_id = prod.get("clauApnflId", "")
            cat_cd = prod.get("prodCatCd", "")

            data, url = await download_pdf_direct(page, context, clause_id)

            if data:
                result = save_pdf(data=data, product_name=name, category=cat_cd, source_url=url)
                if result.get("skipped"):
                    skipped += 1
                else:
                    downloaded += 1
                    if downloaded % 20 == 0:
                        logger.info("  진행: %d/%d 다운로드 완료", downloaded, len(targets))
            else:
                failed += 1
                logger.warning("  [FAIL] %s", name[:50])

            await asyncio.sleep(0.5)

            # 열린 팝업 정리
            while len(context.pages) > 1:
                try:
                    await context.pages[-1].close()
                except Exception:
                    break

        await browser.close()

    # 결과 요약
    logger.info("=" * 60)
    logger.info("현대해상 크롤링 완료")
    logger.info("=" * 60)
    logger.info("  다운로드: %d개", downloaded)
    logger.info("  스킵(중복): %d개", skipped)
    logger.info("  실패: %d개", failed)
    logger.info("  총 대상: %d개", len(targets))

    # 리포트 저장
    report_path = BASE_DATA_DIR / "hyundai_marine_report.json"
    report = {
        "company_id": COMPANY_ID,
        "company_name": COMPANY_NAME,
        "crawled_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "dry_run": dry_run,
        "total_target": len(targets),
        "downloaded": downloaded,
        "skipped": skipped,
        "failed": failed,
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("리포트 저장: %s", report_path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="현대해상 약관 크롤러")
    parser.add_argument("--dry-run", action="store_true", help="PDF 다운로드 없이 목록만 확인")
    args = parser.parse_args()
    asyncio.run(main(dry_run=args.dry_run))
