#!/usr/bin/env python3
"""삼성화재 약관 PDF 크롤러 (API 직접 호출 방식)

VH.HDIF0103.do API로 전체 약관 목록 수집 후 질병/상해 관련 PDF 다운로드.

실행:
    cd backend && PYTHONPATH=. python scripts/crawl_samsung_fire.py

# @MX:NOTE: 삼성화재는 SPA지만 VH.HDIF0103.do API로 모든 약관 데이터 직접 수집 가능
# @MX:NOTE: PDF URL 패턴: /publication/pdf/{prdCode}_{jongGb}_{date}_file{n}.pdf
# @MX:SPEC: SPEC-CRAWL-001
"""
from __future__ import annotations

import hashlib
import json
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s",
                    handlers=[logging.StreamHandler(sys.stdout)])
logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent.parent / "data" / "samsung_fire"
BASE_DIR.mkdir(parents=True, exist_ok=True)

API_URL = "https://www.samsungfire.com/vh/data/VH.HDIF0103.do"
PDF_BASE = "https://www.samsungfire.com"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.samsungfire.com",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "ko-KR,ko;q=0.9",
    "X-Requested-With": "XMLHttpRequest",
}

# # @MX:NOTE: 질병/상해 관련 카테고리 기준
# - 장기: 건강, 상해, 종합, 자녀, 통합, 통합형
# - 일반보험: 상해, 종합
TARGET_GUN_GB: dict[str, set[str]] = {
    "장기": {"건강", "상해", "종합", "자녀", "통합", "통합형"},
    "일반보험": {"상해", "종합"},
}

# 전체 과거 약관 포함 (판매중지 상품 모두 수집)
MIN_SALE_END_DT = "19000101"

RATE_LIMIT = 0.5  # 초


def fetch_all_products() -> list[dict]:
    """API에서 전체 약관 목록을 가져온다."""
    logger.info("삼성화재 약관 API 조회 중...")
    resp = httpx.post(API_URL, headers=HEADERS, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    items: list[dict] = data["responseMessage"]["body"]["data"]["list"]
    logger.info("전체 %d개 항목 조회 완료", len(items))
    return items


def filter_disease_injury(items: list[dict]) -> list[dict]:
    """질병/상해 관련 항목만 필터링한다."""
    result = []
    for item in items:
        gun = item.get("prdGun", "")
        gb = item.get("prdGb", "")
        sale_end = item.get("saleEnDt", "0")
        f1 = item.get("prdfilename1", "")

        if gun not in TARGET_GUN_GB:
            continue
        if gb not in TARGET_GUN_GB[gun]:
            continue
        if sale_end < MIN_SALE_END_DT:
            continue
        if not f1:
            continue
        result.append(item)
    return result


def download_pdf(path: str) -> bytes:
    """PDF를 다운로드한다."""
    url = f"{PDF_BASE}{path}"
    try:
        resp = httpx.get(url, headers=HEADERS, timeout=60, follow_redirects=True)
        if resp.status_code >= 400:
            return b""
        data = resp.content
        if data[:4] != b"%PDF":
            return b""
        return data
    except Exception as e:
        logger.warning("PDF 다운로드 실패 %s: %s", path, e)
        return b""


def crawl() -> dict:
    """삼성화재 약관 PDF를 수집한다."""
    items = fetch_all_products()
    targets = filter_disease_injury(items)

    logger.info("질병/상해 수집 대상: %d개", len(targets))

    results: list[dict] = []
    failed: list[dict] = []
    seen: set[str] = set()

    for i, item in enumerate(targets, 1):
        prd_code = item.get("prdCode", "unknown")
        prd_name = item.get("prdName", "")
        prd_gun = item.get("prdGun", "")
        prd_gb = item.get("prdGb", "")
        sale_end = item.get("saleEnDt", "")

        # file1, file2 모두 수집
        for fkey in ("prdfilename1", "prdfilename2"):
            fpath = item.get(fkey, "")
            if not fpath:
                continue
            if fpath in seen:
                continue
            seen.add(fpath)

            # 파일명: prdCode_jongGb_date_file1.pdf 형태 그대로 사용
            fname = Path(fpath).name
            dest = BASE_DIR / fname

            if dest.exists():
                logger.debug("스킵(기존): %s", fname)
                continue

            time.sleep(RATE_LIMIT)
            pdf_bytes = download_pdf(fpath)

            if not pdf_bytes:
                failed.append({"path": fpath, "product": prd_name})
                logger.warning("[%d/%d] 실패: %s", i, len(targets), fname)
                continue

            dest.write_bytes(pdf_bytes)

            today_str = datetime.now(tz=timezone.utc).strftime("%Y%m%d")
            sale_status = "ON_SALE" if (not sale_end or sale_end >= today_str) else "DISCONTINUED"

            meta = {
                "company_id": "samsung_fire",
                "company_name": "삼성화재",
                "product_name": prd_name,
                "product_code": prd_code,
                "product_type": prd_gun,
                "product_category": prd_gb,
                "sale_end_dt": sale_end,
                "sale_status": sale_status,
                "source_url": f"{PDF_BASE}{fpath}",
                "file_path": str(dest.relative_to(BASE_DIR.parent)),
                "file_hash": f"sha256:{hashlib.sha256(pdf_bytes).hexdigest()}",
                "crawled_at": datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+09:00"),
                "file_size_bytes": len(pdf_bytes),
            }
            dest.with_suffix(".json").write_text(
                json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
            )

            results.append(meta)
            if i % 50 == 0 or len(results) % 100 == 0:
                logger.info("[%d/%d] 저장: %s (%s/%s)", i, len(targets), fname, prd_gun, prd_gb)

    report = {
        "generated_at": datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+09:00"),
        "company": "samsung_fire",
        "total_saved": len(results),
        "total_failed": len(failed),
        "failed_items": failed[:20],  # 최대 20개만 기록
    }

    report_path = BASE_DIR.parent / "samsung_fire_crawl_report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n{'='*60}")
    print(f"삼성화재 완료: {len(results)}개 저장 / {len(failed)}개 실패")
    print(f"리포트: {report_path}")
    print("="*60)

    return report


if __name__ == "__main__":
    crawl()
