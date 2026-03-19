#!/usr/bin/env python3
"""kpub.knia.or.kr 사이트 구조 탐색 스크립트 (SPEC-CRAWL-001, TASK-007)

목적: 손해보험 공시 포털(kpub.knia.or.kr) HTML 구조를 저장하여
      crawl_real.py 개발 시 참고할 수 있도록 한다.

실행:
    python scripts/explore_kpub.py

# @MX:NOTE: 이 스크립트는 분석/탐색용 one-shot 스크립트임 - 프로덕션 크롤러 아님
# @MX:SPEC: SPEC-CRAWL-001
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path

INSPECT_DIR = Path(__file__).parent.parent / "data" / "kpub_inspection"
INSPECT_DIR.mkdir(parents=True, exist_ok=True)

KPUB_BASE = "https://kpub.knia.or.kr"
CONSUMER_BASE = "https://consumer.knia.or.kr"

# 탐색 대상 URL 목록
EXPLORE_TARGETS = [
    (KPUB_BASE, "kpub_main"),
    (f"{KPUB_BASE}/productDisc/nonlife/nonlifeDisclosure.do", "kpub_nonlife_disc"),
    (f"{KPUB_BASE}/productDisc/nonlife/healthList.do", "kpub_health_list"),
    (f"{CONSUMER_BASE}/disclosure/company/All/01.do", "consumer_company_all"),
    (f"{CONSUMER_BASE}/disclosure/company/All/02.do", "consumer_company_health"),
]


def explore_site() -> dict:
    """Playwright로 kpub.knia.or.kr 구조를 분석하고 결과를 저장한다."""
    from playwright.sync_api import sync_playwright

    results = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        for url, label in EXPLORE_TARGETS:
            page = browser.new_page()
            try:
                print(f"\n[{label}] {url}")
                resp = page.goto(url, timeout=30000, wait_until="networkidle")

                if not resp or resp.status >= 400:
                    print(f"  HTTP {resp.status if resp else 'N/A'} - 접근 실패")
                    results[label] = {"url": url, "status": "FAILED", "http_status": resp.status if resp else None}
                    page.close()
                    continue

                time.sleep(2)
                html = page.content()
                print(f"  HTML 크기: {len(html)} bytes")

                # HTML 저장
                html_path = INSPECT_DIR / f"{label}.html"
                html_path.write_text(html, encoding="utf-8")
                print(f"  저장: {html_path}")

                # 다운로드/PDF 링크 추출
                pdf_links = re.findall(
                    r'href=["\']([^"\']*(?:download|fileDown|\.pdf|\.hwp)[^"\']*)["\']',
                    html, re.IGNORECASE
                )
                api_endpoints = re.findall(
                    r'(?:fetch|ajax|url)["\s:]+["\']([^"\']+(?:\.do|\.json|list|api)[^"\']*)["\']',
                    html, re.IGNORECASE
                )
                form_actions = re.findall(r'<form[^>]*action=["\']([^"\']+)["\']', html, re.IGNORECASE)

                result_info = {
                    "url": url,
                    "status": "OK",
                    "html_size": len(html),
                    "pdf_links_count": len(set(pdf_links)),
                    "pdf_links_sample": list(set(pdf_links))[:5],
                    "api_endpoints": list(set(api_endpoints))[:10],
                    "form_actions": list(set(form_actions))[:5],
                }
                results[label] = result_info

                print(f"  PDF 링크: {len(set(pdf_links))}개")
                print(f"  API 엔드포인트: {len(set(api_endpoints))}개")
                for link in list(set(pdf_links))[:3]:
                    print(f"    - {link[:80]}")

            except Exception as e:
                print(f"  오류: {e}")
                results[label] = {"url": url, "status": "ERROR", "error": str(e)}
            finally:
                page.close()

        browser.close()

    # 결과 요약 저장
    summary_path = INSPECT_DIR / "exploration_summary.json"
    summary_path.write_text(
        json.dumps(results, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n탐색 요약 저장: {summary_path}")

    return results


def main() -> None:
    print("=" * 60)
    print("kpub.knia.or.kr 사이트 구조 탐색")
    print("=" * 60)
    print(f"저장 위치: {INSPECT_DIR}")

    results = explore_site()

    print(f"\n{'='*60}")
    print("탐색 완료")
    print(f"{'='*60}")
    for label, info in results.items():
        status = info.get("status", "UNKNOWN")
        pdf_count = info.get("pdf_links_count", 0)
        print(f"  {label}: {status} | PDF링크 {pdf_count}개")

    print(f"\nHTML 파일들: {INSPECT_DIR}")
    print("crawl_real.py 개발 시 위 파일들을 참조하세요.")


if __name__ == "__main__":
    main()
