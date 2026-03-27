#!/usr/bin/env python3
"""AXA손해보험 약관 PDF 크롤러

공시실 보험상품공시 페이지(정적 HTML)에서 약관 PDF를 수집한다.
페이지 전체가 서버사이드 렌더링(UTF-8 BOM)으로 제공되므로 httpx로 직접 파싱.
판매중 / 판매중지 상품을 모두 수집하며 sale_status로 구분한다.

실행:
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_axa_general
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_axa_general --dry-run

# @MX:NOTE: AXA손보 공시 페이지는 정적 HTML(UTF-8 BOM). Playwright 불필요.
# @MX:NOTE: 공시 URL: /AsianPlatformInternet/html/axacms/common/intro/disclosure/insurance/index.html
# @MX:NOTE: 페이지 구조 - "현재판매상품 목록" 섹션 + "판매중지상품 목록" 섹션이 한 파일에 존재
# @MX:NOTE: TR 구조: TD[0]=상품명(rowspan), TD[1]=판매시기, TD[2]=요약서, TD[3]=약관, TD[4]=사업방법서
# @MX:NOTE: 약관 PDF: TD[3] 위치 (4번째 td) — provision 포함 링크
# @MX:NOTE: 수집 대상: 장기보험(상해/건강/암/실손/운전자/치아) + 일반보험 일부
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
import re
import sys
import time
from collections import Counter
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
COMPANY_ID = "axa_general"
COMPANY_NAME = "AXA손해보험"
BASE_URL = "https://www.axa.co.kr"

# @MX:NOTE: 공시 페이지 — 판매중/판매중지 모두 포함된 단일 정적 HTML
DISCLOSURE_URL = (
    f"{BASE_URL}/AsianPlatformInternet/html/axacms/common/intro/disclosure/insurance/index.html"
)

# 수집 대상 카테고리 — URL 패턴 기반 (자동차보험/여행보험 제외)
# @MX:NOTE: URL에서 상품 유형을 추론. provision_이 포함된 링크 중 아래 포함 패턴만 수집.
INCLUDE_URL_PATTERNS: list[str] = [
    # 상해보험
    "accident",
    "acc_provision",
    "si_accident",
    # 건강보험
    "health",
    "ci_health",
    "ms_2ci",
    "si_health",
    "si_",
    # 암보험
    "cancer",
    "all-in-one",
    "allinone",
    "withyou",
    # 실손의료보험
    "meri",
    "medical",
    # 치아보험
    "dental",
    # 운전자보험 (장기)
    "driver_provision",
    "partnership_driver",
    "onlinesmartdriver",
    "smart_driver",
    # 어린이보험
    "the_better_kids",
    "withkids_",
    # 실버/어르신보험
    "silver_",
    # 운전자보험 (CM채널 오타 URL 포함)
    "cm_gi_drvier",
    # 무심사/간편심사보험
    "guaranteed_issuance",
    # 입원비보험
    "direct_hospitalization",
    # 종합보험 (언더스코어 버전)
    "all_in_one",
    # 기타 장기보험
    "senior",
    "ms_ci",
    "best_acc",
    "elite_acc",
    "direct_health",
    "direct_acc",
    "direct_driver",
    "direct_the_great",
    "direct_the_better",
    "direct_better",
    "diabetes",
    "longtail",
]

# 제외 URL 패턴 (자동차 전용, 여행보험, 이륜차, 방법서 등)
# @MX:WARN: 제외 패턴이 너무 넓으면 정상 약관도 제외될 수 있음
# @MX:REASON: 자동차보험/여행보험 약관은 인제스트 범위 외. 오탐을 막기 위해 명시적 제외 목록 유지.
EXCLUDE_URL_PATTERNS: list[str] = [
    "person_",          # 자동차보험 개인용
    "directperson",     # 다이렉트개인용 자동차
    "aip_person",       # 공동 개인용 자동차
    "motorcycle",       # 이륜자동차
    "businessmanual",   # 사업방법서
    "method_",          # 사업방법서 (method)
    "summary_",         # 상품요약서 (날짜형식 summary_YYMMDD)
    "trip",             # 여행보험 (trip_, trip1_ 등 모든 trip 계열)
    "otpa_",            # 해외여행보험
    "mileage_",         # 자동차 마일리지보험
    "_group",           # 단체보험 (여행단체 등)
    "grp_",             # 단체
    "inland",           # 국내여행
    "overseas",         # 해외여행
    "axa_dtpa",         # AXA국내여행보험(단체용)
]

HEADERS: dict[str, str] = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": BASE_URL,
}

# 정규식 패턴 (컴파일)
_TR_PAT = re.compile(r"<tr[^>]*>(.*?)</tr>", re.DOTALL | re.IGNORECASE)
_TD_PAT = re.compile(r"<td[^>]*>(.*?)</td>", re.DOTALL | re.IGNORECASE)
_TAG_STRIP = re.compile(r"<[^>]+>")
_HREF_PAT = re.compile(r'href=["\']([^"\']+\.pdf)', re.IGNORECASE)
_DATE_RANGE_PAT = re.compile(
    r"(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2}|현재)"
)


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
                if existing.get("sale_status") != sale_status:
                    existing["sale_status"] = sale_status
                    meta_path.write_text(
                        json.dumps(existing, ensure_ascii=False, indent=2),
                        encoding="utf-8",
                    )
                    return {"skipped": True, "meta_updated": True}
                return {"skipped": True}
        except Exception:
            pass
    pdf_path.write_bytes(data)
    meta: dict[str, Any] = {
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
    meta_path.write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return {"skipped": False}


def _to_absolute_url(href: str) -> str:
    """상대 URL을 절대 URL로 변환한다."""
    if href.startswith("http"):
        return href
    if href.startswith("/"):
        return f"{BASE_URL}{href}"
    return f"{BASE_URL}/{href}"


def _extract_product_code(pdf_url: str) -> str:
    """PDF URL에서 상품 코드(파일명)를 추출한다.

    예: .../SI_Accident_provision2601.pdf → SI_Accident_provision2601
    """
    filename = pdf_url.rsplit("/", 1)[-1]
    return filename.replace(".pdf", "")


def _infer_category(product_name: str, url: str) -> str:
    """상품명 또는 URL에서 카테고리를 추론한다."""
    text = (product_name + " " + url).lower()
    if "암" in product_name or "cancer" in text:
        return "암보험"
    if "실손" in product_name or "의료보험" in product_name or "meri" in text:
        return "실손의료보험"
    if "치아" in product_name or "dental" in text:
        return "치아보험"
    if "운전자" in product_name or "driver" in text:
        return "운전자보험"
    if "상해" in product_name or "accident" in text or "acc" in text:
        return "상해보험"
    if "건강" in product_name or "health" in text or "ci" in text:
        return "건강보험"
    if "종합" in product_name or "통합" in product_name or "all-in-one" in text or "all_in_one" in text:
        return "종합보험"
    if "어린이" in product_name or "자녀" in product_name or "the_better_kids" in text or "withkids" in text:
        return "어린이보험"
    if "실버" in product_name or "silver_" in text:
        return "암보험"
    if "무심사" in product_name or "간편심사" in product_name or "guaranteed_issuance" in text:
        return "건강보험"
    if "입원비" in product_name or "direct_hospitalization" in text:
        return "건강보험"
    if "drvier" in text or "cm_gi_drvier" in text:
        return "운전자보험"
    if "당뇨" in product_name or "diabetes" in text:
        return "건강보험"
    return "장기보험"


def _is_target_url(url: str) -> bool:
    """URL이 수집 대상 약관인지 판별한다.

    provision 키워드가 포함되고 제외 패턴이 없는 경우만 수집.
    """
    url_lower = url.lower()

    # provision 미포함 → 제외
    if "provision" not in url_lower:
        return False

    # 제외 패턴 확인 (우선 적용)
    for pat in EXCLUDE_URL_PATTERNS:
        if pat in url_lower:
            return False

    # 포함 패턴 확인
    for pat in INCLUDE_URL_PATTERNS:
        if pat in url_lower:
            return True

    # 기본: provision이 있으면 수집 (포함 패턴이 확장될 때를 위해)
    return False


def _parse_section(html: str, sale_status: str) -> list[dict[str, Any]]:
    """HTML 섹션(판매중 또는 판매중지)에서 약관 PDF 항목을 파싱한다.

    각 TR에서 상품명(rowspan TD), 판매시기, 약관 PDF 링크를 추출한다.
    """
    results: list[dict[str, Any]] = []
    seen_urls: set[str] = set()

    # 현재 처리 중인 상품명 (rowspan 지원)
    current_product_name: str = ""
    current_period: str = ""

    for tr_m in _TR_PAT.finditer(html):
        tr_inner = tr_m.group(1)
        tds = _TD_PAT.findall(tr_inner)
        if not tds:
            continue

        # 각 td의 텍스트와 PDF 링크 추출
        td_texts: list[str] = []
        td_links: list[list[str]] = []
        for td_content in tds:
            text = _TAG_STRIP.sub("", td_content).strip()
            pdfs = [
                _to_absolute_url(h)
                for h in _HREF_PAT.findall(td_content)
            ]
            td_texts.append(text)
            td_links.append(pdfs)

        # 테이블 헤더 행(th 포함) 스킵
        if "<th" in tr_inner.lower():
            continue

        # TD 개수 분석 — 5개 = 상품명+판매시기+요약서+약관+방법서 (정상 행)
        # 4개 = 판매시기+요약서+약관+방법서 (이전 TR의 rowspan 연속 행)
        # 상품명 업데이트 (첫 번째 td가 상품명 패턴이면)
        if len(tds) >= 5:
            # 첫 번째 td: 상품명 후보
            candidate = td_texts[0]
            if len(candidate) > 2 and not _DATE_RANGE_PAT.search(candidate):
                current_product_name = candidate
            # 두 번째 td: 판매시기
            period_candidate = td_texts[1]
            if _DATE_RANGE_PAT.search(period_candidate):
                current_period = period_candidate
            # 약관 링크: 4번째 td (index 3)
            provision_links = [
                url for url in td_links[3]
                if _is_target_url(url)
            ]
        elif len(tds) == 4:
            # rowspan 연속 행: 판매시기+요약서+약관+방법서
            period_candidate = td_texts[0]
            if _DATE_RANGE_PAT.search(period_candidate):
                current_period = period_candidate
            provision_links = [
                url for url in td_links[2]
                if _is_target_url(url)
            ]
        else:
            # 행 건너뜀 (구조가 맞지 않음)
            provision_links = []
            for links in td_links:
                for url in links:
                    if _is_target_url(url):
                        provision_links.append(url)

        # 수집 대상 약관 링크 처리
        for pdf_url in provision_links:
            if pdf_url in seen_urls:
                continue
            seen_urls.add(pdf_url)

            product_name = current_product_name or _extract_product_code(pdf_url)
            product_code = _extract_product_code(pdf_url)
            category = _infer_category(product_name, pdf_url)

            # 판매 상태 결정:
            # 섹션 기본값(sale_status)을 사용하되,
            # 판매중 섹션에서도 종료일이 있으면 DISCONTINUED로 보정
            determined_status = sale_status
            if sale_status == "ON_SALE" and current_period:
                m = _DATE_RANGE_PAT.search(current_period)
                if m:
                    end_part = m.group(2)
                    if end_part != "현재":
                        determined_status = "DISCONTINUED"

            results.append({
                "product_name": product_name,
                "product_code": product_code,
                "category": category,
                "source_url": pdf_url,
                "sale_status": determined_status,
                "period_text": current_period,
            })

    return results


async def fetch_disclosure_html(client: httpx.AsyncClient) -> str:
    """공시 페이지 HTML을 가져온다.

    페이지는 UTF-8 BOM으로 시작하며 실제 콘텐츠는 UTF-8이다.
    meta charset에 euc-kr이 명시되어 있지만 이는 오류로, UTF-8로 처리해야 한다.
    """
    # @MX:WARN: Content-Type은 euc-kr이라고 선언하지만 실제 인코딩은 UTF-8 BOM
    # @MX:REASON: AXA 구 플랫폼의 meta charset 오기입. raw bytes에서 UTF-8 BOM(\xef\xbb\xbf) 확인됨.
    resp = await client.get(DISCLOSURE_URL, timeout=30.0)
    resp.raise_for_status()
    raw = resp.content
    # UTF-8 BOM 확인 및 처리
    if raw.startswith(b"\xef\xbb\xbf"):
        return raw.decode("utf-8-sig", errors="replace")
    # BOM 없으면 UTF-8 시도, 실패 시 cp949
    try:
        return raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        return raw.decode("cp949", errors="replace")


def parse_all_items(html: str) -> list[dict[str, Any]]:
    """HTML 전체에서 판매중/판매중지 항목을 모두 파싱한다."""
    # 섹션 분리
    onsale_marker = "현재판매상품 목록"
    disc_marker = "판매중지상품 목록"

    onsale_start = html.find(onsale_marker)
    disc_start = html.find(disc_marker)

    if onsale_start < 0:
        logger.warning("현재판매상품 섹션을 찾지 못함 — 전체 HTML에서 파싱")
        onsale_html = html
        disc_html = ""
    else:
        onsale_html = html[onsale_start:disc_start] if disc_start > onsale_start else html[onsale_start:]
        disc_html = html[disc_start:] if disc_start > 0 else ""

    logger.info("  현재판매 섹션: %d자", len(onsale_html))
    logger.info("  판매중지 섹션: %d자", len(disc_html))

    onsale_items = _parse_section(onsale_html, "ON_SALE")
    disc_items = _parse_section(disc_html, "DISCONTINUED") if disc_html else []

    logger.info("  현재판매 파싱: %d개", len(onsale_items))
    logger.info("  판매중지 파싱: %d개", len(disc_items))

    # 중복 제거 (URL 기준)
    seen: set[str] = set()
    merged: list[dict[str, Any]] = []
    for item in onsale_items + disc_items:
        url = item["source_url"]
        if url not in seen:
            seen.add(url)
            merged.append(item)

    return merged


async def download_pdf(
    client: httpx.AsyncClient,
    item: dict[str, Any],
) -> str:
    """단일 PDF를 다운로드하고 저장한다. 결과 상태를 반환한다."""
    pdf_url = item["source_url"]
    try:
        resp = await client.get(
            pdf_url,
            timeout=httpx.Timeout(30.0, connect=10.0),
            follow_redirects=True,
        )
        if resp.status_code != 200:
            logger.warning("  [FAIL] HTTP %s: %s", resp.status_code, pdf_url[-60:])
            return "failed"
        content = resp.content
        if not content.startswith(b"%PDF") or len(content) < 1000:
            logger.warning("  [FAIL] 유효하지 않은 PDF: %s", pdf_url[-60:])
            return "failed"
        result = save_pdf(
            content,
            item["product_name"],
            item["product_code"],
            item["category"],
            pdf_url,
            item["sale_status"],
        )
        if result.get("skipped"):
            return "meta_updated" if result.get("meta_updated") else "skipped"
        return "downloaded"
    except httpx.TimeoutException:
        logger.warning("  [FAIL] 타임아웃: %s", pdf_url[-60:])
        return "failed"
    except Exception as e:
        logger.warning("  [FAIL] %s: %s", pdf_url[-60:], e)
        return "failed"


async def main(dry_run: bool = False) -> None:
    """메인 크롤링 로직."""
    logger.info("=" * 60)
    logger.info("AXA손해보험 약관 크롤링 시작%s", " (DRY RUN)" if dry_run else "")
    logger.info("공시 URL: %s", DISCLOSURE_URL)
    logger.info("=" * 60)

    async with httpx.AsyncClient(
        headers=HEADERS,
        follow_redirects=True,
        timeout=httpx.Timeout(30.0),
    ) as client:
        # 1단계: 공시 페이지 HTML 수집
        logger.info("[1/2] 공시 페이지 수집 중...")
        try:
            html = await fetch_disclosure_html(client)
            logger.info("  공시 페이지 수집 완료 (HTML 길이: %d자)", len(html))
        except Exception as e:
            logger.error("  공시 페이지 수집 실패: %s", e)
            return

        # 2단계: PDF 링크 파싱
        logger.info("[1.5/2] PDF 링크 파싱 중...")
        targets = parse_all_items(html)

        status_dist = Counter(t["sale_status"] for t in targets)
        cat_dist = Counter(t["category"] for t in targets)

        logger.info("  수집 대상: %d개", len(targets))
        logger.info("  판매상태: %s", dict(status_dist))
        logger.info("  카테고리: %s", dict(cat_dist))

        if dry_run:
            for t in targets:
                logger.info(
                    "  [DRY] [%s] %s (%s)",
                    t["sale_status"],
                    t["product_name"][:60],
                    t["product_code"],
                )
            logger.info("DRY RUN 완료. 실제 다운로드 없음.")
            return

        # 3단계: PDF 다운로드
        logger.info("[2/2] PDF 다운로드 시작 (총 %d개)...", len(targets))
        total = len(targets)
        downloaded = 0
        skipped = 0
        failed = 0
        meta_updated = 0

        for i, item in enumerate(targets):
            status = await download_pdf(client, item)
            if status == "downloaded":
                downloaded += 1
            elif status == "skipped":
                skipped += 1
            elif status == "meta_updated":
                skipped += 1
                meta_updated += 1
            else:
                failed += 1

            # 진행 상황 (50개마다)
            if (i + 1) % 50 == 0:
                logger.info(
                    "  진행: %d/%d 처리 (다운:%d, 스킵:%d, 실패:%d)",
                    i + 1, total, downloaded, skipped, failed,
                )

            # 서버 부하 방지
            await asyncio.sleep(0.5)

    logger.info("=" * 60)
    logger.info(
        "AXA손해보험 크롤링 완료: %d 다운로드, %d 스킵(%d 메타갱신), %d 실패 (총 %d)",
        downloaded, skipped, meta_updated, failed, total,
    )
    logger.info("=" * 60)

    # 리포트 저장
    report_path = BASE_DATA_DIR / "axa_general_report.json"
    report: dict[str, Any] = {
        "company_id": COMPANY_ID,
        "company_name": COMPANY_NAME,
        "crawled_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "dry_run": dry_run,
        "total_target": total,
        "downloaded": downloaded,
        "skipped": skipped,
        "meta_updated": meta_updated,
        "failed": failed,
        "by_status": dict(Counter(t["sale_status"] for t in targets)),
        "by_category": dict(Counter(t["category"] for t in targets)),
    }
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    logger.info("리포트: %s", report_path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AXA손해보험 약관 크롤러")
    parser.add_argument("--dry-run", action="store_true", help="PDF 다운로드 없이 목록만 출력")
    args = parser.parse_args()
    asyncio.run(main(dry_run=args.dry_run))
