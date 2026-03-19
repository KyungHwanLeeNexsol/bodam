#!/usr/bin/env python3
"""손해보험 약관 PDF 크롤러 - kpub.knia.or.kr (SPEC-CRAWL-001, TASK-007)

수집 대상:
  - https://kpub.knia.or.kr (손해보험 공시 포털 - 12개 손해보험사)

폴백:
  - https://consumer.knia.or.kr (kpub 구조 불명확 시)

# @MX:NOTE: SPEC-CRAWL-001 - 12개 손해보험사 대상 크롤러
#           crawl_constants.py의 COMPANY_NAME_MAP, save_pdf_with_metadata 사용
# @MX:SPEC: SPEC-CRAWL-001
"""
from __future__ import annotations

import hashlib
import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from scripts.crawl_constants import (
    COMPANY_NAME_MAP,
    NONLIFE_COMPANY_IDS,
    is_disease_injury_product,
    normalize_company_name,
    save_pdf_with_metadata,
)

# 저장 기본 경로 (company_id별 구조)
BASE_DIR = Path(__file__).parent.parent / "data"
BASE_DIR.mkdir(parents=True, exist_ok=True)

INSPECT_DIR = Path(__file__).parent.parent / "data" / "kpub_inspection"
INSPECT_DIR.mkdir(parents=True, exist_ok=True)

KPUB_BASE = "https://kpub.knia.or.kr"
CONSUMER_BASE = "https://consumer.knia.or.kr"
KNIA_BASE = "https://www.knia.or.kr"

# 요청 간격 (초) - rate limiting
RATE_LIMIT = 1.5

# 재시도 횟수
MAX_RETRIES = 3

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    "Referer": f"{KPUB_BASE}/",
}


def download_file_with_retry(url: str) -> bytes | None:
    """URL에서 파일을 다운로드한다. 실패 시 지수 백오프로 재시도한다.

    # @MX:NOTE: 최대 3회 재시도, 재시도 간격 지수 증가 (1.5, 3.0, 6.0초)
    """
    for attempt in range(MAX_RETRIES):
        req = urllib.request.Request(url, headers=HEADERS)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                content = resp.read()
                if len(content) < 100:
                    return None
                return content
        except urllib.error.HTTPError as e:
            print(f"    HTTP 오류 {e.code} {url} (시도 {attempt + 1}/{MAX_RETRIES})")
            if e.code in (403, 404):
                return None  # 재시도 불필요
        except Exception as e:
            print(f"    다운로드 오류 {url}: {e} (시도 {attempt + 1}/{MAX_RETRIES})")

        if attempt < MAX_RETRIES - 1:
            wait = RATE_LIMIT * (2 ** attempt)
            time.sleep(wait)

    return None


def _slugify(text: str) -> str:
    """텍스트를 파일시스템 안전 문자열로 변환한다."""
    text = text.strip()
    safe = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", text)
    safe = safe.strip(".").strip()
    return safe[:80] or "unknown"


def crawl_kpub_nonlife() -> list[dict[str, Any]]:
    """kpub.knia.or.kr에서 손해보험 약관 PDF 목록을 수집한다."""
    from playwright.sync_api import sync_playwright

    print(f"\n[kpub.knia.or.kr 손해보험 공시 크롤링]")
    results: list[dict[str, Any]] = []

    # kpub 탐색 대상 URL들
    targets = [
        (f"{KPUB_BASE}/productDisc/nonlife/nonlifeDisclosure.do", "KPUB_비교공시"),
        (f"{KPUB_BASE}/productDisc/nonlife/healthList.do", "KPUB_건강보험"),
        (f"{CONSUMER_BASE}/disclosure/company/All/01.do", "CONSUMER_질병보험"),
        (f"{CONSUMER_BASE}/disclosure/company/All/02.do", "CONSUMER_상해보험"),
    ]

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        for url, label in targets:
            page = browser.new_page()
            try:
                print(f"\n  [{label}] {url}")
                resp = page.goto(url, timeout=30000, wait_until="networkidle")
                if not resp or resp.status >= 400:
                    print(f"    접근 실패 (HTTP {resp.status if resp else 'N/A'})")
                    page.close()
                    continue

                time.sleep(2)
                html = page.content()
                print(f"    HTML: {len(html)} bytes")

                # HTML 저장 (분석용)
                html_path = INSPECT_DIR / f"crawl_{_slugify(label)}.html"
                html_path.write_text(html, encoding="utf-8")

                # 다운로드 링크 추출
                page_results = _extract_download_links(html, url, label)
                results.extend(page_results)
                print(f"    발견: {len(page_results)}개")

            except Exception as e:
                print(f"    오류: {e}")
            finally:
                page.close()

        browser.close()

    return results


def crawl_knia_review_nonlife() -> list[dict[str, Any]]:
    """knia.or.kr 신상품 검토 페이지에서 손해보험 약관 PDF를 수집한다.

    (kpub 접근이 어려울 때 폴백)
    """
    from playwright.sync_api import sync_playwright

    print(f"\n[knia.or.kr 신상품 검토 폴백 크롤링]")
    results: list[dict[str, Any]] = []

    # 일반 보험(건강/상해 포함) 카테고리만 수집
    targets = [
        (f"{KNIA_BASE}/report/new-review/new-review01", "KNIA_일반보험"),
    ]

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        for url, label in targets:
            page = browser.new_page()
            try:
                print(f"\n  [{label}] {url}")
                resp = page.goto(url, timeout=30000, wait_until="networkidle")
                if not resp or resp.status >= 400:
                    print(f"    접근 실패")
                    page.close()
                    continue

                time.sleep(3)
                html = page.content()
                print(f"    HTML: {len(html)} bytes")

                rows = re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.DOTALL)
                for row in rows:
                    cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
                    if not cells:
                        continue

                    cell_texts = [re.sub(r'<[^>]+>', ' ', c).strip() for c in cells]
                    cell_texts = [' '.join(t.split()) for t in cell_texts]

                    downloads = re.findall(r'/file/download/[A-Za-z0-9+=/]+', row)
                    if not downloads:
                        continue

                    product_name = next((t for t in cell_texts if t and len(t) > 2), "알수없음")

                    # 질병/상해 필터링
                    if not is_disease_injury_product(product_name):
                        continue

                    # 회사명 추출
                    company_name = _extract_company_from_text(product_name) or "손해보험사"
                    company_id = normalize_company_name(company_name) or "unknown"

                    for dl_url_path in downloads:
                        full_url = f"{KNIA_BASE}{dl_url_path}"
                        results.append({
                            "company_id": company_id,
                            "company_name": company_name,
                            "product_name": product_name,
                            "download_url": full_url,
                            "source": label,
                            "status": "PENDING",
                        })

            except Exception as e:
                print(f"    오류: {e}")
            finally:
                page.close()

        browser.close()

    # 중복 URL 제거
    seen: set[str] = set()
    unique = []
    for r in results:
        if r["download_url"] not in seen:
            seen.add(r["download_url"])
            unique.append(r)

    print(f"  발견: {len(unique)}개 (고유)")
    return unique


def _extract_download_links(
    html: str, base_url: str, source: str
) -> list[dict[str, Any]]:
    """HTML에서 다운로드 링크를 추출하고 메타데이터를 구성한다."""
    results = []

    base_domain = "/".join(base_url.split("/")[:3])

    # 다운로드 패턴들
    patterns = [
        r'href=["\']([^"\']*(?:download|fileDown|pdfView)[^"\']*)["\']',
        r'href=["\']([^"\']+\.pdf)["\']',
    ]

    found_urls: set[str] = set()
    for pattern in patterns:
        for match in re.findall(pattern, html, re.IGNORECASE):
            full_url = match if match.startswith("http") else f"{base_domain}{match}"
            found_urls.add(full_url)

    # 테이블 기반 파싱
    rows = re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.DOTALL)
    for row in rows:
        cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
        if not cells:
            continue

        cell_texts = [' '.join(re.sub(r'<[^>]+>', ' ', c).split()) for c in cells]

        row_downloads: set[str] = set()
        for pattern in patterns:
            for match in re.findall(pattern, row, re.IGNORECASE):
                url = match if match.startswith("http") else f"{base_domain}{match}"
                row_downloads.add(url)

        if not row_downloads:
            continue

        product_name = next((t for t in cell_texts if t and len(t) > 2), "알수없음")

        # 질병/상해 필터
        if not is_disease_injury_product(product_name):
            continue

        company_name = _extract_company_from_text(product_name) or "손해보험사"
        company_id = normalize_company_name(company_name) or "unknown"

        for dl_url in row_downloads:
            results.append({
                "company_id": company_id,
                "company_name": company_name,
                "product_name": product_name,
                "download_url": dl_url,
                "source": source,
                "status": "PENDING",
            })

    # 테이블 파싱 결과 없을 때 단순 링크 사용
    if not results and found_urls:
        for url in found_urls:
            results.append({
                "company_id": "unknown",
                "company_name": "손해보험사",
                "product_name": Path(url.split("?")[0]).stem[:40] or "약관",
                "download_url": url,
                "source": source,
                "status": "PENDING",
            })

    return results


def _extract_company_from_text(text: str) -> str | None:
    """텍스트에서 COMPANY_NAME_MAP 기반으로 회사명을 추출한다."""
    sorted_names = sorted(COMPANY_NAME_MAP.keys(), key=len, reverse=True)
    for name in sorted_names:
        if name in text:
            return name
    return None


def download_all(listings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """수집된 목록의 모든 파일을 다운로드하고 저장한다."""
    print(f"\n{'='*60}")
    print(f"다운로드 시작: 총 {len(listings)}개")
    print('='*60)

    results = []
    success_count = 0
    fail_count = 0
    skip_count = 0

    for i, item in enumerate(listings, 1):
        url = item["download_url"]
        company_id = item.get("company_id", "unknown")
        company_name = item.get("company_name", "손해보험사")
        product = item.get("product_name", "unknown")

        print(f"  [{i:3d}/{len(listings)}] {company_id} | {product[:35]}...")
        time.sleep(RATE_LIMIT)

        data = download_file_with_retry(url)
        if data is None:
            item["status"] = "FAILED"
            fail_count += 1
            results.append(item)
            continue

        # PDF 확인
        if data[:4] != b'%PDF':
            item["status"] = "SKIPPED"
            item["reason"] = "non-pdf"
            skip_count += 1
            results.append(item)
            continue

        try:
            result_meta = save_pdf_with_metadata(
                data=data,
                company_id=company_id,
                company_name=company_name,
                product_name=product,
                product_type="미분류",
                source_url=url,
                base_dir=BASE_DIR,
            )
            item["status"] = "SUCCESS"
            item["file_path"] = result_meta["file_path"]
            item["file_size"] = len(data)
            item["file_hash"] = result_meta["file_hash"]
            success_count += 1
            print(f"    OK PDF {len(data):,} bytes → {company_id}/")
        except Exception as e:
            item["status"] = "FAILED"
            item["error"] = str(e)
            fail_count += 1
            print(f"    FAIL: {e}")

        results.append(item)

    print(f"\n{'='*60}")
    print(f"완료: 성공 {success_count}개 / 실패 {fail_count}개 / 건너뜀 {skip_count}개")
    print('='*60)
    return results


def main() -> None:
    print("=" * 60)
    print("보담(Bodam) 손해보험 약관 수집기 v3 (SPEC-CRAWL-001)")
    print("=" * 60)

    all_listings: list[dict[str, Any]] = []

    # Phase 1: kpub.knia.or.kr 크롤링
    print("\n--- Phase 1: kpub.knia.or.kr 손해보험 공시 ---")
    kpub_results = crawl_kpub_nonlife()
    all_listings.extend(kpub_results)
    print(f"  kpub: {len(kpub_results)}개")

    # Phase 2: knia.or.kr 신상품 검토 (kpub 결과 부족 시 폴백)
    if len(kpub_results) < 5:
        print("\n--- Phase 2: knia.or.kr 폴백 크롤링 ---")
        knia_results = crawl_knia_review_nonlife()
        all_listings.extend(knia_results)
        print(f"  knia: {len(knia_results)}개")

    print(f"\n{'='*60}")
    print(f"수집 합계: {len(all_listings)}개")
    print('='*60)

    if not all_listings:
        print("\n수집된 항목 없음.")
        print(f"  탐색 결과: {INSPECT_DIR}")
        return

    # 중복 제거
    seen: set[str] = set()
    unique = []
    for item in all_listings:
        if item["download_url"] not in seen:
            seen.add(item["download_url"])
            unique.append(item)

    print(f"고유 항목: {len(unique)}개 (중복 {len(all_listings) - len(unique)}개 제거)")

    # 다운로드
    results = download_all(unique)

    # 결과 요약 저장
    summary_path = INSPECT_DIR / "crawl_summary.json"
    summary = {
        "total": len(results),
        "success": sum(1 for r in results if r.get("status") == "SUCCESS"),
        "failed": sum(1 for r in results if r.get("status") == "FAILED"),
        "skipped": sum(1 for r in results if r.get("status") == "SKIPPED"),
        "listings": results,
    }
    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"\n요약: {summary_path}")
    print(f"저장 위치: {BASE_DIR}")
    print("\n[완료] 손해보험 약관 수집 완료")


if __name__ == "__main__":
    main()
