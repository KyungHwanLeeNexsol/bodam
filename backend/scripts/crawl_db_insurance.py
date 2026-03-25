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
# 외부 저장 경로 (KB손보와 동일한 bodam-data 디렉터리)
BASE_DATA_DIR = Path(r"D:\bodam-data\crawled_pdfs")
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
    {"ln": "장기보험", "sn": "TM/CM", "mn": "간병", "label": "장기-TMCM-간병"},
    {"ln": "장기보험", "sn": "TM/CM", "mn": "건강", "label": "장기-TMCM-건강"},
    {"ln": "장기보험", "sn": "TM/CM", "mn": "상해", "label": "장기-TMCM-상해"},
    {"ln": "장기보험", "sn": "TM/CM", "mn": "질병", "label": "장기-TMCM-질병"},
    {"ln": "장기보험", "sn": "방카슈랑스", "mn": "간병", "label": "장기-방카-간병"},
    {"ln": "장기보험", "sn": "방카슈랑스", "mn": "건강", "label": "장기-방카-건강"},
    {"ln": "장기보험", "sn": "방카슈랑스", "mn": "상해", "label": "장기-방카-상해"},
    {"ln": "장기보험", "sn": "방카슈랑스", "mn": "질병", "label": "장기-방카-질병"},
    {"ln": "일반", "sn": "99", "mn": "상해", "label": "일반-상해"},
]

# @MX:NOTE: fail-stop: 최소 FAIL_MIN_SAMPLES 이후 실패율 > DEFAULT_FAIL_THRESHOLD 시 즉시 중단
DEFAULT_FAIL_THRESHOLD = 0.05  # 실패율 5% 초과 시 중단
FAIL_MIN_SAMPLES = 10  # 최소 처리 건수 이후 임계값 적용


def save_pdf(data: bytes, product_name: str, category: str, source_url: str, sale_status: str = "ON_SALE") -> dict[str, Any]:
    # DBNonLifeCrawler와 동일한 경로 규칙: db-nonlife/{category}/{safe_name}.pdf
    safe_name = product_name.strip()
    for ch in ['/', '\\', ':', '?', '"', '<', '>', '*', '|']:
        safe_name = safe_name.replace(ch, '_')
    out_dir = BASE_DATA_DIR / "db-nonlife" / category
    out_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = out_dir / f"{safe_name}.pdf"
    if pdf_path.exists():
        return {"skipped": True}
    pdf_path.write_bytes(data)
    return {"skipped": False}


async def crawl_category(
    client: httpx.AsyncClient, cat: dict[str, str], dry_run: bool = False
) -> tuple[dict[str, int], list[dict]]:
    """특정 카테고리의 약관 PDF를 수집한다."""
    stats = {"products": 0, "downloaded": 0, "skipped": 0, "failed": 0}
    failed_items: list[dict] = []
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
        return stats, failed_items

    for prod in products:
        pdc_nm = prod.get("PDC_NM", "")
        if not pdc_nm:
            continue

        # Step 3: 판매기간 조회 (503 시 최대 3회 재시도)
        sl_yn = prod.get("_sl_yn", "1")
        periods = []
        for attempt in range(3):
            try:
                resp3 = await client.post(
                    STEP3_URL,
                    json={"pdc_nm": pdc_nm, "arc_pdc_sl_yn": sl_yn},
                    headers={"Content-Type": "application/json"},
                    timeout=60.0,
                )
                if resp3.status_code == 503:
                    wait = 5.0 * (attempt + 1)
                    logger.warning("  Step3 503 [%s] → %ds 후 재시도", pdc_nm[:30], wait)
                    await asyncio.sleep(wait)
                    continue
                periods = resp3.json().get("result", [])
                break
            except Exception as e:
                logger.debug("  Step3 실패 [%s]: %s", pdc_nm[:30], e)
                break

        # @MX:NOTE: sl_yn=0(판매중지) Step3 empty 시 sl_yn=1(판매중)으로 폴백
        # 오래된 판매중지 상품은 서버에 판매기간 데이터가 없어 sl_yn=1로도 조회 가능
        if not periods and sl_yn == "0":
            logger.info("  Step3 sl_yn=0 empty → sl_yn=1 폴백 시도 [%s]", pdc_nm[:40])
            try:
                resp3_fb = await client.post(
                    STEP3_URL,
                    json={"pdc_nm": pdc_nm, "arc_pdc_sl_yn": "1"},
                    headers={"Content-Type": "application/json"},
                    timeout=60.0,
                )
                periods = resp3_fb.json().get("result", [])
                if periods:
                    logger.info("  Step3 폴백 성공 [%s]: %d개 판매기간", pdc_nm[:40], len(periods))
            except Exception as e:
                logger.debug("  Step3 폴백 실패 [%s]: %s", pdc_nm[:30], e)

        if not periods:
            logger.warning("  [실패] Step3 empty [%s] (sl_yn=%s, 폴백 포함)", pdc_nm[:50], sl_yn)
            stats["failed"] += 1
            failed_items.append({"product": pdc_nm, "reason": "Step3 empty (폴백 포함)", "label": label})
            continue

        # 최신 판매기간 선택
        latest = periods[0]
        sqno = latest.get("SQNO", "")

        # Step 4: 약관 파일명 조회 (503 시 최대 3회 재시도)
        files = []
        for attempt in range(3):
            try:
                resp4 = await client.post(
                    STEP4_URL,
                    json={"sqno": str(sqno), "arc_pdc_sl_yn": sl_yn},
                    headers={"Content-Type": "application/json"},
                    timeout=60.0,
                )
                if resp4.status_code == 503:
                    wait = 5.0 * (attempt + 1)
                    logger.warning("  Step4 503 [%s] → %ds 후 재시도", pdc_nm[:30], wait)
                    await asyncio.sleep(wait)
                    continue
                files = resp4.json().get("result", [])
                break
            except Exception as e:
                logger.debug("  Step4 실패 [%s]: %s", pdc_nm[:30], e)
                break

        if not files:
            logger.warning("  [실패] Step4 empty [%s] (sqno=%s)", pdc_nm[:50], sqno)
            stats["failed"] += 1
            failed_items.append({"product": pdc_nm, "reason": "Step4 empty", "label": label})
            continue

        file_info = files[0]
        inpl_finm = file_info.get("INPL_FINM", "")

        if not inpl_finm:
            # 다른 파일명 필드 시도
            for alt_key in ("INPL_NM", "FILE_NM", "FILE_NAME", "FILENAME"):
                inpl_finm = file_info.get(alt_key, "")
                if inpl_finm:
                    logger.info("  INPL_FINM 대체 필드 사용 (%s): %s", alt_key, inpl_finm[:40])
                    break
            if not inpl_finm:
                logger.warning(
                    "  [실패] INPL_FINM 없음 [%s] - Step4 응답 키: %s",
                    pdc_nm[:50], list(file_info.keys()),
                )
                stats["failed"] += 1
                failed_items.append({
                    "product": pdc_nm,
                    "reason": "INPL_FINM 없음",
                    "label": label,
                    "step4_keys": list(file_info.keys()),
                })
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
                failed_items.append({"product": pdc_nm, "reason": "PDF 다운로드 실패", "url": pdf_url, "label": label})
        except Exception as e:
            logger.error("  [ERROR] %s: %s", pdc_nm[:30], e)
            stats["failed"] += 1
            failed_items.append({"product": pdc_nm, "reason": str(e), "label": label})

        await asyncio.sleep(2.0)

    return stats, failed_items


def _save_report(total: dict, failed_items: list[dict], aborted: bool, dry_run: bool = False) -> None:
    """수집 결과 리포트를 저장한다."""
    report = {
        "company_id": COMPANY_ID,
        "company_name": COMPANY_NAME,
        "crawled_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "aborted": aborted,
        "dry_run": dry_run,
        **total,
        "failed_items": failed_items[:50],
    }
    BASE_DATA_DIR.mkdir(parents=True, exist_ok=True)
    report_path = BASE_DATA_DIR / "db_insurance_report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("리포트 저장: %s", report_path)


async def main(dry_run: bool = False, fail_threshold: float = DEFAULT_FAIL_THRESHOLD) -> None:
    logger.info("=" * 60)
    logger.info("DB손해보험 약관 크롤링 시작%s", " (DRY RUN)" if dry_run else "")
    logger.info("=" * 60)

    total = {"products": 0, "downloaded": 0, "skipped": 0, "failed": 0}
    all_failed_items: list[dict] = []
    total_attempted = 0  # 실제 처리 시도 건수 (스킵 제외)

    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True) as client:
        # 세션 초기화: 메인 페이지 접속
        await client.get(f"{BASE_URL}/FWMAIV1534.do", timeout=120.0)

        for cat in TARGET_CATEGORIES:
            label = cat["label"]
            logger.info("[%s] 카테고리: %s", COMPANY_NAME, label)
            stats, failed_items = await crawl_category(client, cat, dry_run)
            all_failed_items.extend(failed_items)

            for k in total:
                total[k] += stats[k]

            total_attempted += stats["downloaded"] + stats["failed"]

            logger.info(
                "[%s] %s: %d상품, %d다운, %d스킵, %d실패",
                COMPANY_NAME, label, stats["products"], stats["downloaded"], stats["skipped"], stats["failed"],
            )

            # @MX:NOTE: fail-stop 로직: 최소 FAIL_MIN_SAMPLES 이후 실패율 > fail_threshold 시 중단
            if not dry_run and total_attempted >= FAIL_MIN_SAMPLES:
                fail_rate = total["failed"] / total_attempted
                if fail_rate > fail_threshold:
                    logger.error(
                        "실패율 %.1f%% > 임계값 %.1f%% (처리 %d건 중 %d건 실패) → 수집 중단",
                        fail_rate * 100, fail_threshold * 100,
                        total_attempted, total["failed"],
                    )
                    _save_report(total, all_failed_items, aborted=True)
                    sys.exit(1)

            await asyncio.sleep(1)

    logger.info("=" * 60)
    logger.info("DB손해보험 크롤링 완료: %d다운, %d스킵, %d실패 (총 %d상품)", total["downloaded"], total["skipped"], total["failed"], total["products"])
    logger.info("=" * 60)

    _save_report(total, all_failed_items, aborted=False, dry_run=dry_run)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DB손해보험 약관 크롤러")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--fail-threshold",
        type=float,
        default=DEFAULT_FAIL_THRESHOLD,
        help=f"실패율 임계값 (기본값: {DEFAULT_FAIL_THRESHOLD * 100:.0f}%%)",
    )
    args = parser.parse_args()
    asyncio.run(main(dry_run=args.dry_run, fail_threshold=args.fail_threshold))
