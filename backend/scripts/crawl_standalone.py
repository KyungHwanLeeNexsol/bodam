#!/usr/bin/env python3
"""
독립형 보험사 약관 크롤러 (DB 불필요)
KLIA(생명보험협회), KNIA(손해보험협회) 전체 약관 PDF 수집

결과물:
  backend/data/crawled_pdfs/<company_code>/<product_code>.pdf
  backend/data/crawled_pdfs/metadata.json (전체 수집 결과)

사용법:
  python scripts/crawl_standalone.py
"""

from __future__ import annotations

import hashlib
import json
import re
import time
import urllib.request
from pathlib import Path
from typing import Any

# 출력 디렉토리
BASE_DIR = Path(__file__).parent.parent / "data" / "crawled_pdfs"
BASE_DIR.mkdir(parents=True, exist_ok=True)
METADATA_FILE = BASE_DIR / "metadata.json"

KLIA_BASE_URL = "https://www.klia.or.kr"
KNIA_BASE_URL = "https://www.knia.or.kr"

# 요청 간격 (초)
RATE_LIMIT = 2.0


def slugify(text: str) -> str:
    """보험사명 → 파일시스템 안전 코드"""
    text = re.sub(r"[^\w가-힣]", "-", text.lower()).strip("-")
    return text or "unknown"


def save_pdf(pdf_bytes: bytes, company_code: str, product_code: str) -> str:
    """PDF 저장 후 파일 경로 반환"""
    safe_code = re.sub(r"[^\w\-]", "_", product_code)
    out_dir = BASE_DIR / company_code
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{safe_code}.pdf"
    out_path.write_bytes(pdf_bytes)
    return str(out_path)


def download_pdf(url: str) -> bytes:
    """PDF URL에서 바이너리 다운로드"""
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
        )
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def crawl_klia() -> list[dict[str, Any]]:
    """생명보험협회(KLIA) 전체 약관 목록 크롤링"""
    print("\n[KLIA] 생명보험협회 크롤링 시작...")
    from playwright.sync_api import sync_playwright

    results = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # 목록 페이지 접속
        target_urls = [
            f"{KLIA_BASE_URL}/consumer/policy/list",
            f"{KLIA_BASE_URL}/pub/consumer/prd/list.do",
            f"{KLIA_BASE_URL}/consumer/prd/list",
        ]

        html = ""
        for url in target_urls:
            try:
                print(f"  시도: {url}")
                page.goto(url, timeout=30000, wait_until="networkidle")
                time.sleep(2)
                html = page.content()
                if len(html) > 5000:
                    print(f"  성공: {url} ({len(html)} bytes)")
                    break
            except Exception as e:
                print(f"  실패: {url} - {e}")
                continue

        if not html:
            print("  [KLIA] 목록 페이지 접근 실패")
            browser.close()
            return []

        # 페이지네이션 처리하며 전체 목록 수집
        all_html_pages = [html]
        page_num = 2
        max_pages = 50

        while page_num <= max_pages:
            # 다음 페이지 버튼 탐지
            next_selectors = [
                "a:has-text('다음')",
                ".btn-next",
                ".paging-next",
                f"a[href*='page={page_num}']",
                f"a[href*='pageNo={page_num}']",
                f"a:has-text('{page_num}')",
            ]

            clicked = False
            for sel in next_selectors:
                try:
                    el = page.query_selector(sel)
                    if el and el.is_visible():
                        el.click()
                        time.sleep(2)
                        new_html = page.content()
                        if new_html != all_html_pages[-1]:
                            all_html_pages.append(new_html)
                            page_num += 1
                            clicked = True
                            break
                except Exception:
                    continue

            if not clicked:
                break

        browser.close()

        # HTML에서 약관 정보 파싱
        for page_html in all_html_pages:
            parsed = _parse_klia_html(page_html)
            results.extend(parsed)

    print(f"  [KLIA] 총 {len(results)}개 상품 발견")
    return results


def _parse_klia_html(html: str) -> list[dict[str, Any]]:
    """KLIA HTML에서 보험 상품 목록 파싱"""
    items = []

    # PDF 링크와 주변 컨텍스트 추출
    pdf_pattern = re.compile(
        r'<tr[^>]*>(.*?)</tr>',
        re.DOTALL | re.IGNORECASE,
    )

    for row_match in pdf_pattern.finditer(html):
        row = row_match.group(1)

        # PDF URL 찾기
        pdf_url_match = re.search(
            r'href=["\']([^"\']*(?:\.pdf|download[^"\']*|fileDown[^"\']*|pdfDown[^"\']*)[^"\']*)["\']',
            row,
            re.IGNORECASE,
        )
        if not pdf_url_match:
            continue

        pdf_url = pdf_url_match.group(1)
        if not pdf_url.startswith("http"):
            pdf_url = f"{KLIA_BASE_URL}{pdf_url}"

        # 셀에서 텍스트 추출
        cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
        clean_cells = [re.sub(r'<[^>]+>', '', c).strip() for c in cells]
        clean_cells = [c for c in clean_cells if c]

        if len(clean_cells) < 2:
            continue

        company_name = clean_cells[0] if clean_cells else "알수없음"
        product_name = clean_cells[1] if len(clean_cells) > 1 else "알수없음"
        product_code = clean_cells[2] if len(clean_cells) > 2 else hashlib.md5(pdf_url.encode()).hexdigest()[:8]

        items.append({
            "company_name": company_name,
            "product_name": product_name,
            "product_code": product_code,
            "category": "LIFE",
            "pdf_url": pdf_url,
            "company_code": slugify(company_name),
            "source": "KLIA",
        })

    return items


def crawl_knia() -> list[dict[str, Any]]:
    """손해보험협회(KNIA) 전체 약관 목록 크롤링"""
    print("\n[KNIA] 손해보험협회 크롤링 시작...")
    from playwright.sync_api import sync_playwright

    results = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        target_urls = [
            f"{KNIA_BASE_URL}/consumer/policy/list",
            f"{KNIA_BASE_URL}/pub/consumer/prd/list.do",
            f"{KNIA_BASE_URL}/consumer/prd/list",
            f"{KNIA_BASE_URL}",
        ]

        html = ""
        for url in target_urls:
            try:
                print(f"  시도: {url}")
                page.goto(url, timeout=30000, wait_until="networkidle")
                time.sleep(2)
                html = page.content()
                if len(html) > 5000:
                    print(f"  성공: {url} ({len(html)} bytes)")
                    break
            except Exception as e:
                print(f"  실패: {url} - {e}")
                continue

        if not html:
            print("  [KNIA] 목록 페이지 접근 실패")
            browser.close()
            return []

        # 페이지네이션
        all_html_pages = [html]
        page_num = 2
        max_pages = 50

        while page_num <= max_pages:
            next_selectors = [
                "a:has-text('다음')",
                ".btn-next",
                ".paging-next",
                f"a[href*='page={page_num}']",
                f"a[href*='pageNo={page_num}']",
                f"a:has-text('{page_num}')",
            ]

            clicked = False
            for sel in next_selectors:
                try:
                    el = page.query_selector(sel)
                    if el and el.is_visible():
                        el.click()
                        time.sleep(2)
                        new_html = page.content()
                        if new_html != all_html_pages[-1]:
                            all_html_pages.append(new_html)
                            page_num += 1
                            clicked = True
                            break
                except Exception:
                    continue

            if not clicked:
                break

        browser.close()

        for page_html in all_html_pages:
            parsed = _parse_knia_html(page_html)
            results.extend(parsed)

    print(f"  [KNIA] 총 {len(results)}개 상품 발견")
    return results


def _parse_knia_html(html: str) -> list[dict[str, Any]]:
    """KNIA HTML에서 보험 상품 목록 파싱"""
    items = []

    pdf_pattern = re.compile(r'<tr[^>]*>(.*?)</tr>', re.DOTALL | re.IGNORECASE)

    for row_match in pdf_pattern.finditer(html):
        row = row_match.group(1)

        pdf_url_match = re.search(
            r'href=["\']([^"\']*(?:\.pdf|download[^"\']*|fileDown[^"\']*|pdfDown[^"\']*)[^"\']*)["\']',
            row,
            re.IGNORECASE,
        )
        if not pdf_url_match:
            continue

        pdf_url = pdf_url_match.group(1)
        if not pdf_url.startswith("http"):
            pdf_url = f"{KNIA_BASE_URL}{pdf_url}"

        cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
        clean_cells = [re.sub(r'<[^>]+>', '', c).strip() for c in cells]
        clean_cells = [c for c in clean_cells if c]

        if len(clean_cells) < 2:
            continue

        company_name = clean_cells[0] if clean_cells else "알수없음"
        product_name = clean_cells[1] if len(clean_cells) > 1 else "알수없음"
        product_code = clean_cells[2] if len(clean_cells) > 2 else hashlib.md5(pdf_url.encode()).hexdigest()[:8]

        items.append({
            "company_name": company_name,
            "product_name": product_name,
            "product_code": product_code,
            "category": "NON_LIFE",
            "pdf_url": pdf_url,
            "company_code": slugify(company_name),
            "source": "KNIA",
        })

    return items


def download_all_pdfs(listings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """발견된 모든 약관 PDF 다운로드"""
    print(f"\n[다운로드] 총 {len(listings)}개 PDF 다운로드 시작...")
    results = []

    for i, item in enumerate(listings, 1):
        print(f"  [{i}/{len(listings)}] {item['company_name']} - {item['product_name'][:30]}...")
        try:
            time.sleep(RATE_LIMIT)
            pdf_bytes = download_pdf(item["pdf_url"])

            if len(pdf_bytes) < 100:
                print(f"    경고: PDF가 너무 작음 ({len(pdf_bytes)} bytes), 건너뜀")
                item["status"] = "SKIPPED"
                item["error"] = "PDF too small"
                results.append(item)
                continue

            file_path = save_pdf(pdf_bytes, item["company_code"], item["product_code"])
            item["file_path"] = file_path
            item["file_size"] = len(pdf_bytes)
            item["content_hash"] = hashlib.sha256(pdf_bytes).hexdigest()
            item["status"] = "SUCCESS"
            print(f"    저장됨: {file_path} ({len(pdf_bytes):,} bytes)")
        except Exception as e:
            print(f"    실패: {e}")
            item["status"] = "FAILED"
            item["error"] = str(e)

        results.append(item)

    success = sum(1 for r in results if r["status"] == "SUCCESS")
    print(f"\n[다운로드 완료] 성공: {success}/{len(listings)}")
    return results


def main() -> None:
    """메인 실행"""
    print("=" * 60)
    print("보담(Bodam) 보험 약관 수집기")
    print("대상: KLIA(생명보험협회), KNIA(손해보험협회)")
    print("=" * 60)

    all_listings: list[dict[str, Any]] = []

    # KLIA 크롤링
    klia_results = crawl_klia()
    all_listings.extend(klia_results)

    # KNIA 크롤링
    knia_results = crawl_knia()
    all_listings.extend(knia_results)

    print(f"\n[합계] 총 {len(all_listings)}개 상품 발견")
    print(f"  - 생명보험: {len(klia_results)}개")
    print(f"  - 손해보험: {len(knia_results)}개")

    if not all_listings:
        print("\n경고: 수집된 상품이 없습니다. 협회 사이트 구조가 변경되었을 수 있습니다.")
        print("메타데이터만 저장합니다.")
        METADATA_FILE.write_text(
            json.dumps({"total": 0, "listings": []}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return

    # PDF 다운로드
    results = download_all_pdfs(all_listings)

    # 메타데이터 저장
    metadata = {
        "total": len(results),
        "success": sum(1 for r in results if r.get("status") == "SUCCESS"),
        "failed": sum(1 for r in results if r.get("status") == "FAILED"),
        "skipped": sum(1 for r in results if r.get("status") == "SKIPPED"),
        "by_source": {
            "KLIA": len(klia_results),
            "KNIA": len(knia_results),
        },
        "listings": results,
    }

    METADATA_FILE.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"\n메타데이터 저장: {METADATA_FILE}")
    print("\n[완료]")
    print(f"  성공: {metadata['success']}개")
    print(f"  실패: {metadata['failed']}개")
    print(f"  저장위치: {BASE_DIR}")


if __name__ == "__main__":
    main()
