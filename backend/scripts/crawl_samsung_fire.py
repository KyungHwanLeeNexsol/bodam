#!/usr/bin/env python3
"""삼성화재 약관 PDF 크롤러 (API 직접 호출 방식)

VH.HDIF0103.do API로 전체 약관 목록 수집 후 질병/상해 관련 PDF 다운로드.
실패율 임계값 초과 시 자동 중단하여 디버깅 후 재수집 가능.

실행:
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_samsung_fire
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_samsung_fire --dry-run
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_samsung_fire --fail-threshold 0.03

# @MX:NOTE: 삼성화재는 SPA지만 VH.HDIF0103.do API로 모든 약관 데이터 직접 수집 가능
# @MX:NOTE: PDF URL 패턴: /publication/pdf/{prdCode}_{jongGb}_{date}_file{n}.pdf
# @MX:NOTE: 저장 경로: samsung-fire/{prdGun}-{prdGb}/{fname}.pdf (카테고리별 분류)
# @MX:NOTE: fail-stop: 최소 10건 처리 후 실패율 > FAIL_THRESHOLD 시 즉시 중단
# @MX:SPEC: SPEC-CRAWL-001
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
import time
from datetime import datetime, timezone
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

# 외부 저장 경로 (KB/DB손보와 동일한 bodam-data 디렉터리)
BASE_DATA_DIR = Path(r"D:\bodam-data\crawled_pdfs")
COMPANY_ID = "samsung-fire"
COMPANY_NAME = "삼성화재"

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

# @MX:NOTE: 질병/상해 관련 카테고리 기준
# - 장기: 건강, 상해, 종합, 자녀, 통합, 통합형
# - 일반보험: 상해, 종합
TARGET_GUN_GB: dict[str, set[str]] = {
    "장기": {"건강", "상해", "종합", "자녀", "통합", "통합형"},
    "일반보험": {"상해", "종합"},
}

# 전체 과거 약관 포함 (판매중지 상품 모두 수집)
MIN_SALE_END_DT = "19000101"

RATE_LIMIT = 1.0  # 초 (0.5s → 1.0s, 503 방지)
DEFAULT_FAIL_THRESHOLD = 0.05  # 실패율 5% 초과 시 중단
FAIL_MIN_SAMPLES = 10  # 최소 처리 건수 이후 임계값 적용


async def fetch_all_products(client: httpx.AsyncClient) -> list[dict]:
    """API에서 전체 약관 목록을 가져온다."""
    logger.info("삼성화재 약관 API 조회 중...")
    resp = await client.post(API_URL, timeout=60.0)
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


def get_storage_path(gun: str, gb: str, fname: str) -> str:
    """카테고리별 저장 경로를 생성한다.

    형식: samsung-fire/{gun}-{gb}/{fname}
    예: samsung-fire/장기-건강/12345_L_20240101_file1.pdf
    """
    # 경로에 쓸 수 없는 문자 정규화
    safe_gun = gun.replace("/", "-").replace(" ", "")
    safe_gb = gb.replace("/", "-").replace(" ", "")
    return f"{COMPANY_ID}/{safe_gun}-{safe_gb}/{fname}"


async def download_pdf(client: httpx.AsyncClient, path: str) -> bytes:
    """약관 파일을 다운로드한다. PDF와 DOCX 형식 모두 지원.

    # @MX:NOTE: 삼성화재는 대부분 PDF이지만 일부 DOCX로 제공 (예: ZPB410010_file2.docx)
    # 파일 확장자를 기준으로 유효성 검사 방식을 분기함
    """
    url = f"{PDF_BASE}{path}"
    ext = Path(path).suffix.lower()
    try:
        resp = await client.get(url, timeout=30.0, follow_redirects=True)
        if resp.status_code >= 400:
            logger.debug("HTTP %d: %s", resp.status_code, path)
            return b""
        data = resp.content
        if len(data) < 1000:
            logger.debug("파일 크기 너무 작음 (%d bytes): %s", len(data), path)
            return b""
        if ext == ".pdf" and data[:4] != b"%PDF":
            logger.debug("PDF 매직바이트 불일치 (%d bytes): %s", len(data), path)
            return b""
        # DOCX: PK zip 헤더 확인 (Optional - 크기만 확인해도 충분)
        if ext == ".docx" and data[:2] != b"PK":
            logger.debug("DOCX 헤더 불일치 (%d bytes): %s", len(data), path)
            return b""
        return data
    except Exception as e:
        logger.warning("파일 다운로드 실패 %s: %s", path, e)
        return b""


def save_pdf(data: bytes, storage_path: str) -> dict[str, Any]:
    """약관 파일(PDF/DOCX)을 외부 저장소에 저장한다. 이미 존재하면 스킵."""
    full_path = BASE_DATA_DIR / storage_path
    if full_path.exists():
        return {"skipped": True}
    full_path.parent.mkdir(parents=True, exist_ok=True)
    full_path.write_bytes(data)
    return {"skipped": False}


async def crawl(dry_run: bool = False, fail_threshold: float = DEFAULT_FAIL_THRESHOLD) -> dict:
    """삼성화재 약관 PDF를 수집한다.

    Args:
        dry_run: True이면 파일 저장 없이 수집 대상만 출력
        fail_threshold: 실패율 임계값 (초과 시 즉시 중단)
    """
    today_str = datetime.now(tz=timezone.utc).strftime("%Y%m%d")
    stats = {"downloaded": 0, "skipped": 0, "failed": 0, "total": 0}
    failed_items: list[dict] = []

    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True) as client:
        items = await fetch_all_products(client)
        targets = filter_disease_injury(items)
        stats["total"] = len(targets)

        logger.info("질병/상해 수집 대상: %d개%s", len(targets), " (DRY RUN)" if dry_run else "")

        if dry_run:
            # dry-run: 수집 대상 및 카테고리 분포만 출력
            cat_dist: dict[str, int] = {}
            seen_check: set[str] = set()
            for item in targets:
                gun = item.get("prdGun", "")
                gb = item.get("prdGb", "")
                key = f"{gun}-{gb}"
                cat_dist[key] = cat_dist.get(key, 0) + 1

                for fkey in ("prdfilename1", "prdfilename2"):
                    fpath = item.get(fkey, "")
                    if fpath and fpath not in seen_check:
                        seen_check.add(fpath)
                        fname = Path(fpath).name
                        storage_path = get_storage_path(gun, gb, fname)
                        full_path = BASE_DATA_DIR / storage_path
                        exists = full_path.exists()
                        logger.info("  [DRY] %s (%s/%s) → %s%s",
                                    fname, gun, gb, storage_path,
                                    " [기존]" if exists else "")

            print(f"\n{'='*60}")
            print(f"[DRY RUN] 삼성화재 수집 대상: {len(targets)}개 상품, {len(seen_check)}개 파일")
            print("\n카테고리 분포:")
            for cat, cnt in sorted(cat_dist.items(), key=lambda x: -x[1]):
                print(f"  {cat}: {cnt}개")
            print("="*60)
            return {"dry_run": True, **stats}

        # 실제 수집
        seen: set[str] = set()
        processed = 0  # 다운로드 시도 건수 (스킵 제외)

        for i, item in enumerate(targets, 1):
            prd_code = item.get("prdCode", "unknown")
            prd_name = item.get("prdName", "")
            prd_gun = item.get("prdGun", "")
            prd_gb = item.get("prdGb", "")
            sale_end = item.get("saleEnDt", "")
            sale_status = "ON_SALE" if (not sale_end or sale_end >= today_str) else "DISCONTINUED"

            for fkey in ("prdfilename1", "prdfilename2"):
                fpath = item.get(fkey, "")
                if not fpath or fpath in seen:
                    continue
                seen.add(fpath)

                fname = Path(fpath).name
                storage_path = get_storage_path(prd_gun, prd_gb, fname)

                # 이미 존재하는 파일 스킵
                full_path = BASE_DATA_DIR / storage_path
                if full_path.exists():
                    stats["skipped"] += 1
                    logger.debug("스킵(기존): %s", fname)
                    continue

                await asyncio.sleep(RATE_LIMIT)
                pdf_bytes = await download_pdf(client, fpath)
                processed += 1

                if not pdf_bytes:
                    stats["failed"] += 1
                    failed_items.append({
                        "path": fpath,
                        "product": prd_name,
                        "product_code": prd_code,
                    })
                    logger.warning("[%d/%d] 실패: %s (%s/%s)", i, len(targets), fname, prd_gun, prd_gb)

                    # @MX:NOTE: fail-stop 로직: 최소 FAIL_MIN_SAMPLES 이후 실패율 > fail_threshold 시 중단
                    if processed >= FAIL_MIN_SAMPLES:
                        fail_rate = stats["failed"] / processed
                        if fail_rate > fail_threshold:
                            logger.error(
                                "실패율 %.1f%% > 임계값 %.1f%% (처리 %d건 중 %d건 실패) → 수집 중단",
                                fail_rate * 100, fail_threshold * 100,
                                processed, stats["failed"],
                            )
                            _save_report(stats, failed_items, aborted=True)
                            sys.exit(1)
                    continue

                result = save_pdf(pdf_bytes, storage_path)
                if result["skipped"]:
                    stats["skipped"] += 1
                else:
                    stats["downloaded"] += 1
                    logger.info("[%d/%d] 저장: %s (%s/%s, %s)",
                                i, len(targets), fname, prd_gun, prd_gb, sale_status)

    _save_report(stats, failed_items, aborted=False)

    print(f"\n{'='*60}")
    print(f"삼성화재 완료: {stats['downloaded']}개 저장 / {stats['skipped']}개 스킵 / {stats['failed']}개 실패")
    print(f"리포트: {BASE_DATA_DIR / 'samsung_fire_report.json'}")
    print("="*60)

    return stats


def _save_report(stats: dict, failed_items: list[dict], aborted: bool) -> None:
    """수집 결과 리포트를 저장한다."""
    report = {
        "company_id": COMPANY_ID,
        "company_name": COMPANY_NAME,
        "crawled_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "aborted": aborted,
        **stats,
        "failed_items": failed_items[:50],
    }
    BASE_DATA_DIR.mkdir(parents=True, exist_ok=True)
    report_path = BASE_DATA_DIR / "samsung_fire_report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("리포트 저장: %s", report_path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="삼성화재 약관 크롤러")
    parser.add_argument("--dry-run", action="store_true", help="파일 저장 없이 수집 대상만 확인")
    parser.add_argument(
        "--fail-threshold",
        type=float,
        default=DEFAULT_FAIL_THRESHOLD,
        help=f"실패율 임계값 (기본값: {DEFAULT_FAIL_THRESHOLD:.0%})",
    )
    args = parser.parse_args()
    asyncio.run(crawl(dry_run=args.dry_run, fail_threshold=args.fail_threshold))
