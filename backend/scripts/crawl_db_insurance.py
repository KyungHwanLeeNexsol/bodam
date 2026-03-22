#!/usr/bin/env python3
"""DB손해보험 약관 PDF 크롤러

AJAX Step API를 직접 호출하여 약관 PDF를 수집한다.
DOM 클릭 대신 httpx로 직접 API 호출 (이전 Playwright 크롤러의 0 PDF 버그 해결).

실행:
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_db_insurance
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_db_insurance --dry-run

# @MX:NOTE: DB손보는 5단계 AJAX API (Step2~Step5)
# @MX:NOTE: Step2(상품목록) → Step3(판매기간) → Step4(약관 파일명) → PDF 다운로드
# @MX:NOTE: PDF URL: /cYakgwanDown.do?FilePath=InsProduct/{INPL_FINM}
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
COMPANY_ID = "db_insurance"
COMPANY_NAME = "DB손해보험"
BASE_URL = "https://www.idbins.com"

STEP2_URL = f"{BASE_URL}/insuPcPbanFindProductStep2_AX.do"
STEP3_URL = f"{BASE_URL}/insuPcPbanFindProductStep3_AX.do"
STEP4_URL = f"{BASE_URL}/insuPcPbanFindProductStep4_AX.do"
DOWNLOAD_URL = f"{BASE_URL}/cYakgwanDown.do"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": f"{BASE_URL}/FWMAIV1534.do",
}

# 질병/상해 관련 카테고리
TARGET_CATEGORIES = [
    {"ln": "장기보험", "sn": "Off-Line", "mn": "간병", "label": "장기-오프라인-간병"},
    {"ln": "장기보험", "sn": "Off-Line", "mn": "건강", "label": "장기-오프라인-건강"},
    {"ln": "장기보험", "sn": "Off-Line", "mn": "상해", "label": "장기-오프라인-상해"},
    {"ln": "장기보험", "sn": "Off-Line", "mn": "질병", "label": "장기-오프라인-질병"},
    {"ln": "장기보험", "sn": "TM/CM", "mn": "간병", "label": "장기-TM/CM-간병"},
    {"ln": "장기보험", "sn": "TM/CM", "mn": "건강", "label": "장기-TM/CM-건강"},
    {"ln": "장기보험", "sn": "TM/CM", "mn": "상해", "label": "장기-TM/CM-상해"},
    {"ln": "장기보험", "sn": "TM/CM", "mn": "질병", "label": "장기-TM/CM-질병"},
    {"ln": "장기보험", "sn": "방카슈랑스", "mn": "간병", "label": "장기-방카-간병"},
    {"ln": "장기보험", "sn": "방카슈랑스", "mn": "건강", "label": "장기-방카-건강"},
    {"ln": "장기보험", "sn": "방카슈랑스", "mn": "상해", "label": "장기-방카-상해"},
    {"ln": "장기보험", "sn": "방카슈랑스", "mn": "질병", "label": "장기-방카-질병"},
    {"ln": "일반", "sn": "99", "mn": "상해", "label": "일반-상해"},
]


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


async def crawl_category(client: httpx.AsyncClient, cat: dict[str, str], dry_run: bool = False) -> dict[str, int]:
    """특정 카테고리의 약관 PDF를 수집한다."""
    stats = {"products": 0, "downloaded": 0, "skipped": 0, "failed": 0}
    label = cat["label"]

    # Step 2: 상품 목록 조회 (판매중 + 판매중지 모두)
    products = []
    for sl_yn in ["1", "0"]:  # 1=판매중, 0=판매중지
        try:
            resp2 = await client.post(STEP2_URL, json={
                "arc_knd_lgcg_nm": cat["ln"], "sl_chn_nm": cat["sn"],
                "arc_knd_mdcg_nm": cat["mn"], "arc_pdc_sl_yn": sl_yn,
            }, headers={"Content-Type": "application/json"}, timeout=60.0)
            data2 = resp2.json()
            items = data2.get("result", [])
            for item in items:
                item["_sl_yn"] = sl_yn
            products.extend(items)
        except Exception as e:
            logger.error("  [%s] Step2 실패 (sl_yn=%s): %s", label, sl_yn, e)

    stats["products"] = len(products)
    if not products:
        return stats

    for prod in products:
        pdc_nm = prod.get("PDC_NM", "")
        if not pdc_nm:
            continue

        # Step 3: 판매기간 조회
        try:
            sl_yn = prod.get("_sl_yn", "1")
            resp3 = await client.post(
                STEP3_URL,
                json={"pdc_nm": pdc_nm, "arc_pdc_sl_yn": sl_yn},
                headers={"Content-Type": "application/json"},
                timeout=60.0,
            )
            data3 = resp3.json()
            periods = data3.get("result", [])
        except Exception as e:
            logger.debug("  Step3 실패 [%s]: %s", pdc_nm[:30], e)
            stats["failed"] += 1
            continue

        if not periods:
            stats["failed"] += 1
            continue

        # 최신 판매기간 선택
        latest = periods[0]
        sl_str_dt = latest.get("SL_STR_DT", "")
        sqno = latest.get("SQNO", "")

        # Step 4: 약관 파일명 조회
        try:
            resp4 = await client.post(
                STEP4_URL,
                json={"sqno": str(sqno), "arc_pdc_sl_yn": sl_yn},
                headers={"Content-Type": "application/json"},
                timeout=60.0,
            )
            data4 = resp4.json()
            files = data4.get("result", [])
        except Exception as e:
            logger.debug("  Step4 실패 [%s]: %s", pdc_nm[:30], e)
            stats["failed"] += 1
            continue

        if not files:
            stats["failed"] += 1
            continue

        file_info = files[0]
        inpl_finm = file_info.get("INPL_FINM", "")

        if not inpl_finm:
            stats["failed"] += 1
            continue

        if dry_run:
            logger.info("  [DRY] %s -> %s", pdc_nm[:50], inpl_finm)
            continue

        # PDF 다운로드
        pdf_url = f"{DOWNLOAD_URL}?FilePath=InsProduct/{quote(inpl_finm)}"
        try:
            resp_pdf = await client.get(pdf_url, timeout=30.0)
            if resp_pdf.status_code == 200 and resp_pdf.content[:4] == b"%PDF" and len(resp_pdf.content) > 1000:
                prod_status = "DISCONTINUED" if sl_yn == "0" else "ON_SALE"
                result = save_pdf(resp_pdf.content, pdc_nm, label, pdf_url, sale_status=prod_status)
                if result.get("skipped"):
                    stats["skipped"] += 1
                else:
                    stats["downloaded"] += 1
                    logger.info("  [OK] %s (%d bytes)", pdc_nm[:50], len(resp_pdf.content))
            else:
                stats["failed"] += 1
        except Exception as e:
            logger.error("  [ERROR] %s: %s", pdc_nm[:30], e)
            stats["failed"] += 1

        await asyncio.sleep(0.5)

    return stats


async def main(dry_run: bool = False) -> None:
    logger.info("=" * 60)
    logger.info("DB손해보험 약관 크롤링 시작%s", " (DRY RUN)" if dry_run else "")
    logger.info("=" * 60)

    total = {"products": 0, "downloaded": 0, "skipped": 0, "failed": 0}

    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True) as client:
        # 세션 초기화: 메인 페이지 접속
        await client.get(f"{BASE_URL}/FWMAIV1534.do", timeout=120.0)

        for cat in TARGET_CATEGORIES:
            label = cat["label"]
            logger.info("[%s] 카테고리: %s", COMPANY_NAME, label)
            stats = await crawl_category(client, cat, dry_run)

            for k in total:
                total[k] += stats[k]

            logger.info(
                "[%s] %s: %d상품, %d다운, %d스킵, %d실패",
                COMPANY_NAME, label, stats["products"], stats["downloaded"], stats["skipped"], stats["failed"],
            )
            await asyncio.sleep(1)

    logger.info("=" * 60)
    logger.info("DB손해보험 크롤링 완료: %d다운, %d스킵, %d실패 (총 %d상품)", total["downloaded"], total["skipped"], total["failed"], total["products"])
    logger.info("=" * 60)

    report_path = BASE_DATA_DIR / "db_insurance_report.json"
    report = {"company_id": COMPANY_ID, "company_name": COMPANY_NAME,
              "crawled_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "dry_run": dry_run, **total}
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("리포트: %s", report_path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DB손해보험 약관 크롤러")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    asyncio.run(main(dry_run=args.dry_run))
