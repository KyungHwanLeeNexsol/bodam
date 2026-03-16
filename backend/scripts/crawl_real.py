#!/usr/bin/env python3
"""
실제 보험 약관 PDF 크롤러
KNIA(손해보험협회) 신상품 검토 페이지 + 비교공시 페이지

수집 대상:
  - https://www.knia.or.kr/report/new-review/new-review01 (약관 신상품 검토)
  - https://www.knia.or.kr/report/new-review/new-review02 (자동차보험 등)
  - https://www.knia.or.kr/report/new-review/new-review04 (기타)
  - https://kpub.knia.or.kr/productDisc/nonlife/nonlifeDisclosure.do (비교공시)
  - https://consumer.knia.or.kr/disclosure/company/All/01.do (회사별 공시)
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

BASE_DIR = Path(__file__).parent.parent / "data" / "crawled_pdfs"
BASE_DIR.mkdir(parents=True, exist_ok=True)
METADATA_FILE = BASE_DIR / "metadata.json"

KNIA_BASE = "https://www.knia.or.kr"
KNIA_PUB_BASE = "https://kpub.knia.or.kr"
KNIA_CONSUMER_BASE = "https://consumer.knia.or.kr"

RATE_LIMIT = 1.5  # 요청 간격 (초)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
}


def slugify(text: str) -> str:
    """텍스트 → 파일시스템 안전 코드"""
    text = text.strip()
    # 한국어를 최대한 보존
    safe = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', text)
    safe = safe.strip('.').strip()
    return safe[:50] or "unknown"


def download_file(url: str) -> bytes | None:
    """URL에서 파일 다운로드"""
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            content = resp.read()
            if len(content) < 100:
                return None
            return content
    except Exception as e:
        print(f"    다운로드 실패 {url}: {e}")
        return None


def save_file(data: bytes, company: str, filename: str, ext: str = "pdf") -> str:
    """파일 저장"""
    company_dir = BASE_DIR / slugify(company)
    company_dir.mkdir(parents=True, exist_ok=True)
    safe_name = slugify(filename)
    out_path = company_dir / f"{safe_name}.{ext}"

    # 중복 방지: 같은 이름 있으면 해시 추가
    if out_path.exists():
        h = hashlib.md5(data).hexdigest()[:6]
        out_path = company_dir / f"{safe_name}_{h}.{ext}"

    out_path.write_bytes(data)
    return str(out_path)


def crawl_knia_review_page(url: str, page_label: str) -> list[dict[str, Any]]:
    """KNIA 신상품 검토 페이지에서 파일 다운로드"""
    from playwright.sync_api import sync_playwright

    print(f"\n[{page_label}] {url}")
    results = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        try:
            page.goto(url, timeout=30000, wait_until="networkidle")
            time.sleep(3)
            html = page.content()
            print(f"  HTML: {len(html)} bytes")

            # 테이블 행별로 파싱
            rows = re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.DOTALL)
            print(f"  테이블 행: {len(rows)}개")

            for row in rows:
                # 셀 텍스트 추출
                cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
                if not cells:
                    continue

                cell_texts = [re.sub(r'<[^>]+>', ' ', c).strip() for c in cells]
                cell_texts = [' '.join(t.split()) for t in cell_texts]

                # 다운로드 링크 찾기
                downloads = re.findall(r'/file/download/[A-Za-z0-9+=/]+', row)
                if not downloads:
                    continue

                # 상품명: 첫 번째 비어있지 않은 셀
                product_name = next((t for t in cell_texts if t and len(t) > 2), "알수없음")

                # 기간 정보 추출 (인수기간)
                period = ""
                for t in cell_texts:
                    if "기간" in t or "~" in t:
                        period = t[:50]
                        break

                # 회사명 추출 (상품명에서)
                company = "손해보험사"
                company_patterns = [
                    r'(메리츠|DB|현대|KB|삼성|한화|롯데|흥국|MG|AXA|악사|AIG|농협|우리|동부|전국|대한)',
                ]
                for pat in company_patterns:
                    m = re.search(pat, product_name)
                    if m:
                        company = m.group(1)
                        break

                for dl_url in downloads:
                    full_url = f"{KNIA_BASE}{dl_url}"
                    result = {
                        "company": company,
                        "product_name": product_name,
                        "period": period,
                        "download_url": full_url,
                        "source": page_label,
                        "status": "PENDING",
                    }
                    results.append(result)

        except Exception as e:
            print(f"  오류: {e}")
        finally:
            browser.close()

    # 중복 URL 제거
    seen_urls = set()
    unique_results = []
    for r in results:
        if r["download_url"] not in seen_urls:
            seen_urls.add(r["download_url"])
            unique_results.append(r)

    print(f"  발견: {len(unique_results)}개 다운로드 (고유)")
    return unique_results


def crawl_knia_public_disclosure() -> list[dict[str, Any]]:
    """KNIA 상품 비교공시 페이지 크롤링"""
    from playwright.sync_api import sync_playwright

    url = f"{KNIA_PUB_BASE}/productDisc/nonlife/nonlifeDisclosure.do"
    print(f"\n[KNIA공시] {url}")
    results = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        try:
            page.goto(url, timeout=30000, wait_until="networkidle")
            time.sleep(3)
            html = page.content()

            # 다운로드 링크
            downloads = set(re.findall(r'href=["\']([^"\']*(?:download|fileDown|pdf|hwp)[^"\']*)["\']', html, re.IGNORECASE))
            print(f"  다운로드: {len(downloads)}개")

            for dl in downloads:
                if not dl.startswith("http"):
                    dl = f"{KNIA_PUB_BASE}{dl}"
                results.append({
                    "company": "손해보험협회",
                    "product_name": "상품비교공시",
                    "download_url": dl,
                    "source": "KNIA_PUB",
                    "status": "PENDING",
                })

        except Exception as e:
            print(f"  오류: {e}")
        finally:
            browser.close()

    return results


def download_all(listings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """모든 파일 다운로드"""
    print(f"\n{'='*60}")
    print(f"다운로드 시작: 총 {len(listings)}개")
    print('='*60)

    results = []
    success_count = 0
    fail_count = 0

    for i, item in enumerate(listings, 1):
        url = item["download_url"]
        company = item.get("company", "unknown")
        product = item.get("product_name", "unknown")

        print(f"  [{i:3d}/{len(listings)}] {company} | {product[:40]}...")

        time.sleep(RATE_LIMIT)

        data = download_file(url)
        if data is None:
            item["status"] = "FAILED"
            fail_count += 1
            results.append(item)
            continue

        # 파일 확장자 감지
        ext = "pdf"
        if data[:4] == b'%PDF':
            ext = "pdf"
        elif data[:2] in (b'PK', b'\xd0\xcf'):
            ext = "hwp"  # HWP 또는 XLSX

        # 파일명 생성
        url_part = url.split("/")[-1]
        filename = f"{product[:30]}_{url_part}"

        try:
            file_path = save_file(data, company, filename, ext)
            item["status"] = "SUCCESS"
            item["file_path"] = file_path
            item["file_size"] = len(data)
            item["content_hash"] = hashlib.sha256(data).hexdigest()
            item["file_ext"] = ext
            success_count += 1
            print(f"    OK {ext.upper()} {len(data):,} bytes -> {Path(file_path).name}")
        except Exception as e:
            item["status"] = "FAILED"
            item["error"] = str(e)
            fail_count += 1
            print(f"    FAIL 저장 실패: {e}")

        results.append(item)

    print(f"\n{'='*60}")
    print(f"완료: 성공 {success_count}개 / 실패 {fail_count}개")
    print('='*60)
    return results


def main() -> None:
    print("=" * 60)
    print("보담(Bodam) 보험 약관 수집기 v2")
    print("=" * 60)

    all_listings: list[dict[str, Any]] = []

    # KNIA 신상품 검토 페이지 (3개 카테고리)
    review01 = crawl_knia_review_page(
        f"{KNIA_BASE}/report/new-review/new-review01",
        "KNIA_일반보험"
    )
    review02 = crawl_knia_review_page(
        f"{KNIA_BASE}/report/new-review/new-review02",
        "KNIA_자동차보험"
    )
    review04 = crawl_knia_review_page(
        f"{KNIA_BASE}/report/new-review/new-review04",
        "KNIA_기타"
    )

    all_listings.extend(review01)
    all_listings.extend(review02)
    all_listings.extend(review04)

    # KNIA 상품 비교공시
    pub_disc = crawl_knia_public_disclosure()
    all_listings.extend(pub_disc)

    print(f"\n{'='*60}")
    print(f"수집 합계: {len(all_listings)}개")
    print(f"  일반보험: {len(review01)}개")
    print(f"  자동차보험: {len(review02)}개")
    print(f"  기타: {len(review04)}개")
    print(f"  비교공시: {len(pub_disc)}개")
    print('='*60)

    if not all_listings:
        print("\n수집된 항목 없음. 사이트 구조가 변경되었을 수 있습니다.")
        return

    # PDF/파일 다운로드
    results = download_all(all_listings)

    # 성공한 PDF만
    pdf_results = [r for r in results if r.get("status") == "SUCCESS" and r.get("file_ext") == "pdf"]
    print(f"\nPDF 파일: {len(pdf_results)}개")

    # 메타데이터 저장
    metadata = {
        "total": len(results),
        "success": sum(1 for r in results if r.get("status") == "SUCCESS"),
        "pdf_count": len(pdf_results),
        "failed": sum(1 for r in results if r.get("status") == "FAILED"),
        "output_dir": str(BASE_DIR),
        "listings": results,
    }

    METADATA_FILE.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    print(f"\n메타데이터: {METADATA_FILE}")
    print(f"저장 위치: {BASE_DIR}")
    print("\n[완료] Phase 1 데이터 수집 완료")


if __name__ == "__main__":
    main()
