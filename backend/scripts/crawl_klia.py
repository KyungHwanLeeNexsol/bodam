#!/usr/bin/env python3
"""생명보험협회(KLIA) + 생명보험공시실 약관 PDF 크롤러 (독립 실행)

수집 대상:
  - https://www.klia.or.kr (한국생명보험협회)
  - https://pub.insure.or.kr (생명보험 공시실 - 금감원)

KNIA 크롤러(crawl_real.py)와 동일한 방식으로 DB 없이 로컬 저장.
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

BASE_DIR = Path(__file__).parent.parent / "data" / "crawled_pdfs_life"
BASE_DIR.mkdir(parents=True, exist_ok=True)
METADATA_FILE = BASE_DIR / "metadata.json"
INSPECT_DIR = Path(__file__).parent.parent / "data" / "klia_inspection"
INSPECT_DIR.mkdir(parents=True, exist_ok=True)

KLIA_BASE = "https://www.klia.or.kr"
INSURE_PUB_BASE = "https://pub.insure.or.kr"

RATE_LIMIT = 1.5

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    "Referer": "https://www.klia.or.kr/",
}


def slugify(text: str) -> str:
    """텍스트를 파일시스템 안전 문자열로 변환"""
    text = text.strip()
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
    """파일 저장 (중복 방지 포함)"""
    company_dir = BASE_DIR / slugify(company)
    company_dir.mkdir(parents=True, exist_ok=True)
    safe_name = slugify(filename)
    out_path = company_dir / f"{safe_name}.{ext}"

    if out_path.exists():
        h = hashlib.md5(data).hexdigest()[:6]
        out_path = company_dir / f"{safe_name}_{h}.{ext}"

    out_path.write_bytes(data)
    return str(out_path)


# =============================================================================
# KLIA (한국생명보험협회) 크롤러
# =============================================================================

# 분석 결과: KLIA 사이트 구조
# - 메인 페이지(www.klia.or.kr): 정상 접근 가능 (465KB)
# - 하위 페이지: SPA 라우팅 (1595B 쉘 HTML만 반환)
# - 파일 다운로드 패턴: /FilePathDown.do?fileSe=XXXX&file=YYYY
# - 이미지 패턴: /getImage.do?fileNo=XXXX&seq=Y
# - 약관 자문 페이지: /member/insurProduct/advio/list.do (자문 문서)
# - 행위규범 페이지: /consumer/kliaGongsi/comm/commAct.do (fn_down 파일 31종)

# KLIA 약관 공시 관련 URL 후보
KLIA_URLS = [
    f"{KLIA_BASE}/consumer/terms/list.do",
    f"{KLIA_BASE}/consumer/terms",
    f"{KLIA_BASE}/disclosure/terms/list.do",
    f"{KLIA_BASE}/disclosure/policy/list.do",
    f"{KLIA_BASE}/consumer/policy",
    f"{KLIA_BASE}/info/terms",
]

# KLIA FilePathDown.do 파일 목록 (commAct 페이지에서 발견)
KLIA_FILEPATHDOWN_FILES = [
    ("policy", "CCTV_gain(2026).hwp"),
    ("policy", "attorney_gain(2020).hwp"),
    ("policy", "policy_gain(2020).hwp"),
    ("policy", "CCTV_gain(2025).hwp"),
    ("policy", "CCTV_gain(2023).hwp"),
    ("policy", "CCTV_gain(2021).hwp"),
    ("policy", "CCTV_gain(2020).hwp"),
    ("policy", "CCTV_gain(2018).hwp"),
    ("policy", "attorney_gain(2018).hwp"),
    ("policy", "policy_gain(2018).hwp"),
    ("policy", "CCTV_gain(2017_2).hwp"),
    ("policy", "attorney_gain(2017_2).hwp"),
    ("policy", "policy_gain(2017_2).hwp"),
    ("policy", "CCTV_gain(2017).hwp"),
    ("policy", "attorney_gain(2017).hwp"),
    ("policy", "policy_gain(2017).hwp"),
]


def inspect_klia_main() -> None:
    """KLIA 메인 사이트 구조 파악"""
    from playwright.sync_api import sync_playwright

    urls_to_inspect = [
        (KLIA_BASE, "klia_main"),
        (f"{KLIA_BASE}/consumer", "klia_consumer"),
        (f"{KLIA_BASE}/disclosure", "klia_disclosure"),
        (f"{KLIA_BASE}/consumer/terms", "klia_terms"),
    ]

    print("\n[KLIA 사이트 구조 분석]")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        for url, label in urls_to_inspect:
            page = browser.new_page()
            try:
                print(f"\n  [{label}] {url}")
                resp = page.goto(url, timeout=20000, wait_until="networkidle")
                if resp and resp.status >= 400:
                    print(f"    HTTP {resp.status} - 접근 실패")
                    continue

                time.sleep(2)
                html = page.content()
                print(f"    크기: {len(html)} bytes")

                # 약관/PDF 관련 링크 추출
                links = page.query_selector_all("a")
                found_links = []
                for link in links:
                    try:
                        href = link.get_attribute("href") or ""
                        text = link.inner_text().strip()[:40]
                        if any(k in (text + href).lower() for k in
                               ["약관", "term", "clause", "pdf", "download", "공시", "상품", "보험"]):
                            found_links.append((text, href))
                    except Exception:
                        pass

                print(f"    관련 링크 {len(found_links)}개:")
                for t, h in found_links[:15]:
                    print(f"      {t:35} -> {h[:80]}")

                # 다운로드 링크 패턴 탐색
                dl_patterns = re.findall(
                    r'(?:href=["\'])?(/(?:file/download|download|terms/file)[A-Za-z0-9+=/._?&-]+)',
                    html
                )
                if dl_patterns:
                    print(f"    다운로드 패턴: {len(set(dl_patterns))}개")
                    for p_url in list(set(dl_patterns))[:5]:
                        print(f"      {p_url[:80]}")

                # HTML 저장
                (INSPECT_DIR / f"{label}.html").write_text(html, encoding="utf-8")

            except Exception as e:
                print(f"    오류: {e}")
            finally:
                page.close()

        browser.close()


def crawl_klia_terms() -> list[dict[str, Any]]:
    """KLIA 약관 목록 페이지 크롤링"""
    from playwright.sync_api import sync_playwright

    print("\n[KLIA 약관 수집 시작]")
    results = []

    # 시도할 URL 패턴들
    crawl_targets = [
        (f"{KLIA_BASE}/consumer/terms", "KLIA_약관"),
        (f"{KLIA_BASE}/consumer/terms/list.do", "KLIA_약관목록"),
        (f"{KLIA_BASE}/disclosure/terms", "KLIA_공시약관"),
        (f"{KLIA_BASE}/info/terms", "KLIA_정보약관"),
    ]

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        for url, label in crawl_targets:
            page = browser.new_page()
            try:
                print(f"\n  [{label}] {url}")
                resp = page.goto(url, timeout=20000, wait_until="networkidle")
                if not resp or resp.status >= 400:
                    print(f"    접근 실패 (HTTP {resp.status if resp else 'N/A'})")
                    page.close()
                    continue

                time.sleep(2)
                html = page.content()
                print(f"    HTML: {len(html)} bytes")

                # 저장
                (INSPECT_DIR / f"crawl_{slugify(label)}.html").write_text(html, encoding="utf-8")

                # 다운로드 링크 수집
                page_results = _extract_klia_downloads(html, url, label, browser)
                results.extend(page_results)

                if page_results:
                    print(f"    발견: {len(page_results)}개")
                    break  # 성공한 URL 발견 시 중단

            except Exception as e:
                print(f"    오류: {e}")
            finally:
                page.close()

        browser.close()

    return results


def _extract_klia_downloads(
    html: str, base_url: str, source: str, browser: Any
) -> list[dict[str, Any]]:
    """HTML에서 KLIA 다운로드 링크 추출"""
    results = []

    # 다양한 다운로드 URL 패턴
    patterns = [
        r'/file/download/[A-Za-z0-9+=/]+',
        r'/download/[A-Za-z0-9+=/._?&=-]+\.(?:pdf|hwp)',
        r'href=["\']([^"\']+\.pdf)',
        r'href=["\']([^"\']+\.hwp)',
        r'fileDown\(["\']([^"\']+)["\']',
        r"fn_fileDown\('([^']+)'\)",
    ]

    found_urls = set()
    for pattern in patterns:
        matches = re.findall(pattern, html, re.IGNORECASE)
        for match in matches:
            url = match if match.startswith("http") else f"{KLIA_BASE}{match}"
            found_urls.add(url)

    # 테이블 기반 파싱 시도
    rows = re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.DOTALL)
    for row in rows:
        cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
        if not cells:
            continue

        cell_texts = [re.sub(r'<[^>]+>', ' ', c).strip() for c in cells]
        cell_texts = [' '.join(t.split()) for t in cell_texts]

        # 다운로드 링크
        row_downloads = set()
        for pattern in patterns:
            matches = re.findall(pattern, row, re.IGNORECASE)
            for match in matches:
                url = match if match.startswith("http") else f"{KLIA_BASE}{match}"
                row_downloads.add(url)

        if not row_downloads:
            continue

        product_name = next((t for t in cell_texts if t and len(t) > 2), "알수없음")
        company = _extract_life_company(product_name)

        for dl_url in row_downloads:
            if dl_url not in found_urls:
                found_urls.add(dl_url)

            results.append({
                "company": company,
                "product_name": product_name,
                "download_url": dl_url,
                "source": source,
                "status": "PENDING",
            })

    # 단순 링크 기반 (테이블 파싱 실패 시)
    if not results and found_urls:
        for url in found_urls:
            results.append({
                "company": "생명보험사",
                "product_name": Path(url).stem[:40],
                "download_url": url,
                "source": source,
                "status": "PENDING",
            })

    return results


def _extract_life_company(text: str) -> str:
    """상품명에서 생명보험사명 추출"""
    patterns = [
        (r'삼성생명', '삼성생명'),
        (r'한화생명', '한화생명'),
        (r'교보생명', '교보생명'),
        (r'신한라이프|신한생명', '신한라이프'),
        (r'흥국생명', '흥국생명'),
        (r'동양생명', '동양생명'),
        (r'ABL생명|ABL', 'ABL생명'),
        (r'KDB생명|KDB', 'KDB생명'),
        (r'푸본현대|푸본', '푸본현대생명'),
        (r'처브라이프|처브', '처브라이프'),
        (r'AIA생명|AIA', 'AIA생명'),
        (r'메트라이프', '메트라이프생명'),
        (r'미래에셋생명|미래에셋', '미래에셋생명'),
        (r'NH농협생명|농협생명', 'NH농협생명'),
        (r'DGB생명|DGB', 'DGB생명'),
        (r'하나생명', '하나생명'),
        (r'IBK연금보험|IBK', 'IBK연금보험'),
    ]

    for pattern, name in patterns:
        if re.search(pattern, text):
            return name

    return "생명보험사"


# =============================================================================
# 생명보험 공시실 (pub.insure.or.kr) 크롤러
# =============================================================================

INSURE_PUB_TARGETS = [
    f"{INSURE_PUB_BASE}/summary/term/disclosureTerm.do",
    f"{INSURE_PUB_BASE}/rps/RPSAA0001M.aspx",
    f"{INSURE_PUB_BASE}/summary/disRegal/list.do",
]


def crawl_insure_pub() -> list[dict[str, Any]]:
    """생명보험 공시실 크롤링"""
    from playwright.sync_api import sync_playwright

    print("\n[생명보험 공시실 (pub.insure.or.kr) 크롤링]")
    results = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        for url in INSURE_PUB_TARGETS:
            page = browser.new_page()
            try:
                print(f"\n  {url}")
                resp = page.goto(url, timeout=25000, wait_until="networkidle")
                if not resp or resp.status >= 400:
                    print(f"    접근 실패")
                    page.close()
                    continue

                time.sleep(3)
                html = page.content()
                print(f"    HTML: {len(html)} bytes")

                # HTML 저장
                label = re.sub(r'[^\w]', '_', url.split('/')[-1])
                (INSPECT_DIR / f"insure_{label}.html").write_text(html, encoding="utf-8")

                # 다운로드 링크 탐색
                pdf_links = re.findall(
                    r'href=["\']([^"\']*(?:download|fileDown|\.pdf|\.hwp)[^"\']*)["\']',
                    html, re.IGNORECASE
                )

                for link in set(pdf_links):
                    full_url = link if link.startswith("http") else f"{INSURE_PUB_BASE}{link}"
                    results.append({
                        "company": "생명보험공시실",
                        "product_name": Path(link).stem[:40],
                        "download_url": full_url,
                        "source": "INSURE_PUB",
                        "status": "PENDING",
                    })

                print(f"    발견: {len(pdf_links)}개 링크")

            except Exception as e:
                print(f"    오류: {e}")
            finally:
                page.close()

        browser.close()

    return results


# =============================================================================
# 생명보험사별 직접 크롤링 (주요 보험사 약관 공시 페이지)
# =============================================================================

# 주요 생명보험사 약관 공시 URL
LIFE_COMPANY_URLS = [
    # (회사명, 약관공시 URL, URL패턴힌트)
    ("삼성생명", "https://www.samsunglife.com/individual/support/provision/terms.do", ""),
    ("한화생명", "https://www.hanwhalifeinsurance.co.kr/cportal/comm/terms/termsList.do", ""),
    ("교보생명", "https://www.kyobo.co.kr/consumer/term/termView.jsp", ""),
    ("신한라이프", "https://www.shinhanlife.co.kr/hpe/service/contract/termsInfo.do", ""),
    ("흥국생명", "https://www.heungkuklife.co.kr/consumer/support/terms/termsList.do", ""),
    ("동양생명", "https://www.myangel.co.kr/consumer/contract/terms/termSearch.do", ""),
    ("미래에셋생명", "https://www.miraeassetlife.co.kr/term/listTermInfo.do", ""),
    ("NH농협생명", "https://www.nhlife.co.kr/customer/ctmInfm/ctmContract/terms.do", ""),
]


def crawl_life_companies() -> list[dict[str, Any]]:
    """주요 생명보험사별 약관 공시 페이지 크롤링"""
    from playwright.sync_api import sync_playwright

    print("\n[주요 생명보험사 직접 크롤링]")
    all_results = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        for company_name, url, _ in LIFE_COMPANY_URLS:
            page = browser.new_page()
            try:
                print(f"\n  [{company_name}] {url}")
                resp = page.goto(url, timeout=20000, wait_until="networkidle")
                if not resp or resp.status >= 400:
                    print(f"    접근 실패 (HTTP {resp.status if resp else 'N/A'})")
                    page.close()
                    continue

                time.sleep(2)
                html = page.content()
                print(f"    HTML: {len(html)} bytes")

                # HTML 저장
                safe_name = slugify(company_name)
                (INSPECT_DIR / f"company_{safe_name}.html").write_text(html, encoding="utf-8")

                # PDF/다운로드 링크 탐색
                base = f"https://{url.split('/')[2]}"
                pdf_links = re.findall(
                    r'href=["\']([^"\']*(?:\.pdf|\.hwp|download|fileDown)[^"\']*)["\']',
                    html, re.IGNORECASE
                )

                for link in set(pdf_links):
                    full_url = link if link.startswith("http") else f"{base}{link}"
                    all_results.append({
                        "company": company_name,
                        "product_name": Path(link).stem[:40] or "약관",
                        "download_url": full_url,
                        "source": f"DIRECT_{safe_name}",
                        "status": "PENDING",
                    })

                print(f"    발견: {len(pdf_links)}개 링크")

            except Exception as e:
                print(f"    오류: {e}")
            finally:
                page.close()

        browser.close()

    return all_results


# =============================================================================
# 파일 다운로드
# =============================================================================

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

        print(f"  [{i:3d}/{len(listings)}] {company} | {product[:35]}...")
        time.sleep(RATE_LIMIT)

        data = download_file(url)
        if data is None:
            item["status"] = "FAILED"
            fail_count += 1
            results.append(item)
            continue

        # 파일 확장자 감지
        ext = "bin"
        if data[:4] == b'%PDF':
            ext = "pdf"
        elif data[:2] in (b'PK', b'\xd0\xcf'):
            ext = "hwp"

        url_part = url.split("/")[-1][:20]
        filename = f"{product[:25]}_{url_part}"

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
            print(f"    FAIL: {e}")

        results.append(item)

    print(f"\n{'='*60}")
    print(f"완료: 성공 {success_count}개 / 실패 {fail_count}개")
    print('='*60)
    return results


def crawl_klia_filepathdown() -> list[dict[str, Any]]:
    """KLIA FilePathDown.do 방식으로 알려진 파일 다운로드"""
    results = []
    print("\n[KLIA FilePathDown.do 파일 다운로드]")

    for filese, filename in KLIA_FILEPATHDOWN_FILES:
        import urllib.parse
        enc_file = urllib.parse.quote(filename, safe='.()')
        dl_url = f"{KLIA_BASE}/FilePathDown.do?fileSe={filese}&file={enc_file}"
        results.append({
            "company": "KLIA",
            "product_name": filename.split('.')[0],
            "download_url": dl_url,
            "source": "KLIA_FILEPATHDOWN",
            "status": "PENDING",
        })

    print(f"  다운로드 후보: {len(results)}개")
    return results


def main() -> None:
    print("=" * 60)
    print("보담(Bodam) 생명보험 약관 수집기")
    print("=" * 60)

    all_listings: list[dict[str, Any]] = []

    # Phase 1: KLIA 메인 사이트 구조 분석
    print("\n--- Phase 1: 사이트 구조 분석 ---")
    inspect_klia_main()

    # Phase 1.5: KLIA FilePathDown.do 알려진 파일 다운로드
    print("\n--- Phase 1.5: KLIA 공개 파일 다운로드 ---")
    klia_fp_results = crawl_klia_filepathdown()
    all_listings.extend(klia_fp_results)

    # Phase 2: KLIA 약관 목록 페이지 크롤링
    print("\n--- Phase 2: KLIA 약관 크롤링 ---")
    klia_results = crawl_klia_terms()
    all_listings.extend(klia_results)
    print(f"  KLIA: {len(klia_results)}개 발견")

    # Phase 3: 생명보험 공시실 크롤링
    print("\n--- Phase 3: 생명보험 공시실 크롤링 ---")
    insure_results = crawl_insure_pub()
    all_listings.extend(insure_results)
    print(f"  공시실: {len(insure_results)}개 발견")

    # Phase 4: 주요 보험사 직접 크롤링
    print("\n--- Phase 4: 보험사 직접 크롤링 ---")
    company_results = crawl_life_companies()
    all_listings.extend(company_results)
    print(f"  직접: {len(company_results)}개 발견")

    print(f"\n{'='*60}")
    print(f"수집 합계: {len(all_listings)}개")
    print('='*60)

    if not all_listings:
        print("\n수집된 항목 없음. 사이트 구조 분석 결과를 확인하세요:")
        print(f"  {INSPECT_DIR}")
        print("\n생명보험 약관 공시 HTML 파일들이 저장되었습니다.")
        print("inspect_*.html 파일을 확인하여 실제 URL 구조를 파악하세요.")
        return

    # 중복 제거
    seen = set()
    unique = []
    for item in all_listings:
        if item["download_url"] not in seen:
            seen.add(item["download_url"])
            unique.append(item)

    print(f"고유 항목: {len(unique)}개 (중복 {len(all_listings) - len(unique)}개 제거)")

    # 다운로드
    results = download_all(unique)

    # 메타데이터 저장
    metadata = {
        "total": len(results),
        "success": sum(1 for r in results if r.get("status") == "SUCCESS"),
        "failed": sum(1 for r in results if r.get("status") == "FAILED"),
        "pdf_count": sum(1 for r in results if r.get("file_ext") == "pdf"),
        "output_dir": str(BASE_DIR),
        "inspect_dir": str(INSPECT_DIR),
        "listings": results,
    }

    METADATA_FILE.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    print(f"\n메타데이터: {METADATA_FILE}")
    print(f"저장 위치: {BASE_DIR}")
    print(f"분석 파일: {INSPECT_DIR}")
    print("\n[완료] 생명보험 약관 수집 완료")


if __name__ == "__main__":
    main()
