#!/usr/bin/env python3
"""
현대해상 크롤러 DOM 구조 디버그 스크립트

실행:
    cd backend
    uv run python scripts/debug_hyundai_marine.py

출력된 내용을 공유하면 크롤러 선택자를 정확히 수정할 수 있습니다.
"""

import asyncio
import json
import sys

CANDIDATE_URLS = [
    # 기존 크롤러 URL (404 가능성)
    "https://www.hi.co.kr/consumer/disclosure/terms/termsList.do",
    # 검색으로 발견한 실제 CION 페이지들
    "https://www.hi.co.kr/bin/CI/ON/CION3200G.jsp",  # 화재보험 약관
    "https://www.hi.co.kr/bin/CI/ON/CION3430G.jsp",  # 보장성Ⅰ
    "https://www.hi.co.kr/bin/CI/ON/CION3432G.jsp",  # 보장성Ⅲ
    "https://www.hi.co.kr/bin/CI/ON/CION3700G.jsp",  # 기타 약관
]

# JavaScript: 페이지 DOM 분석 코드
DOM_ANALYZE_JS = r"""() => {
    const result = {
        url: location.href,
        title: document.title,
        bodyClass: document.body.className,
        tables: [],
        pdfLinks: [],
        tabsOrFilters: [],
        pagination: [],
        allLinks: [],
        networkRequests: [],
    };

    // ── 테이블 분석 ──────────────────────────────────────
    const tables = document.querySelectorAll('table');
    tables.forEach((tbl, idx) => {
        const rows = tbl.querySelectorAll('tr');
        result.tables.push({
            idx,
            className: tbl.className,
            id: tbl.id,
            rowCount: rows.length,
            firstRowHtml: rows[0]?.outerHTML?.substring(0, 300) || '',
            secondRowHtml: rows[1]?.outerHTML?.substring(0, 500) || '',
        });
    });

    // ── PDF 링크 수집 ──────────────────────────────────────
    const linkEls = document.querySelectorAll('a');
    linkEls.forEach(a => {
        const href = a.getAttribute('href') || '';
        const onclick = a.getAttribute('onclick') || '';
        const text = a.textContent.trim().substring(0, 80);
        const isPdf = href.includes('.pdf') || href.includes('FileAction') ||
                      href.includes('download') || onclick.toLowerCase().includes('pdf');
        if (isPdf) {
            result.pdfLinks.push({ text, href: href.substring(0, 300), onclick: onclick.substring(0, 300) });
        }
        if (result.allLinks.length < 30) {
            result.allLinks.push({ text, href: href.substring(0, 200), onclick: onclick.substring(0, 200) });
        }
    });

    // ── 판매중/판매중지 탭, 라디오, 셀렉트 ────────────────
    const filterKeywords = ['판매', '중지', '판매중', '상품', '약관', '보통', '기간', '현재'];
    document.querySelectorAll('a, button, input, select, label, li, span[role], div[role="tab"]').forEach(el => {
        const text = (el.textContent || el.value || el.getAttribute('data-value') || '').trim();
        const cls = el.className || '';
        const tag = el.tagName;
        if (filterKeywords.some(k => text.includes(k)) || cls.includes('tab') || cls.includes('filter')) {
            result.tabsOrFilters.push({
                tag,
                class: cls.substring(0, 100),
                text: text.substring(0, 100),
                href: el.getAttribute('href') || '',
                value: el.getAttribute('value') || '',
                type: el.getAttribute('type') || '',
                onclick: (el.getAttribute('onclick') || '').substring(0, 200),
            });
        }
    });

    // ── 페이지네이션 ──────────────────────────────────────
    document.querySelectorAll('[class*=pag], [class*=Pag], [class*=page], [id*=pag]').forEach(el => {
        result.pagination.push({
            tag: el.tagName,
            class: el.className.substring(0, 100),
            html: el.outerHTML.substring(0, 400),
        });
    });

    return result;
}"""


async def debug_url(url: str, pw_module) -> dict:
    """단일 URL의 DOM 구조를 분석합니다."""
    browser = await pw_module.chromium.launch(headless=True)
    try:
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            accept_downloads=True,
        )
        page = await context.new_page()

        # 네트워크 요청 인터셉트 (API 호출 탐지)
        api_calls: list[dict] = []

        async def on_request(req):
            url_r = req.url
            if any(k in url_r for k in ['ajax', 'api', 'json', 'termsList', 'terms', 'CION', '.do', 'list']):
                api_calls.append({'url': url_r[:200], 'method': req.method})

        page.on('request', on_request)

        print(f"\n{'='*70}")
        print(f"URL: {url}")
        print(f"{'='*70}")

        try:
            resp = await page.goto(url, timeout=30_000, wait_until='networkidle')
            status = resp.status if resp else '?'
            print(f"HTTP 상태: {status}")
        except Exception as e:
            print(f"페이지 로드 오류: {e}")
            return {}

        # 추가 대기 (AJAX 완료)
        await asyncio.sleep(3)

        info = await page.evaluate(DOM_ANALYZE_JS)
        info['status'] = status
        info['api_calls'] = api_calls[:20]

        # ── 출력 ──────────────────────────────────────────
        print(f"최종 URL: {info.get('url', '?')}")
        print(f"페이지 제목: {info.get('title', '?')}")

        tables = info.get('tables', [])
        print(f"\n[테이블] {len(tables)}개 발견")
        for t in tables:
            print(f"  테이블#{t['idx']}: class='{t['className']}' id='{t['id']}' 행={t['rowCount']}")
            if t['secondRowHtml']:
                print(f"    2번째 행 HTML:\n    {t['secondRowHtml'][:400]}")

        pdf_links = info.get('pdfLinks', [])
        print(f"\n[PDF 링크] {len(pdf_links)}개 발견")
        for lnk in pdf_links[:10]:
            print(f"  텍스트: {lnk['text']}")
            print(f"  href: {lnk['href']}")
            print(f"  onclick: {lnk['onclick']}")
            print()

        tabs = info.get('tabsOrFilters', [])
        print(f"[탭/필터] {len(tabs)}개 발견")
        for tab in tabs[:15]:
            print(f"  {tab['tag']} class='{tab['class']}' text='{tab['text']}' href='{tab['href']}' value='{tab['value']}'")

        paging = info.get('pagination', [])
        print(f"\n[페이지네이션] {len(paging)}개 발견")
        for pg in paging[:3]:
            print(f"  {pg['tag']} class='{pg['class']}'")
            print(f"  HTML: {pg['html'][:300]}")

        api = info.get('api_calls', [])
        print(f"\n[API 호출] {len(api)}개 감지")
        for call in api[:10]:
            print(f"  [{call['method']}] {call['url']}")

        print(f"\n[전체 링크 (처음 30개)]")
        for lnk in info.get('allLinks', [])[:30]:
            print(f"  '{lnk['text']}' -> {lnk['href'] or lnk['onclick'][:60]}")

        return info

    finally:
        await browser.close()


async def main():
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        print("playwright가 설치되어 있지 않습니다.")
        print("설치: uv pip install playwright && playwright install chromium")
        sys.exit(1)

    print("현대해상 DOM 구조 디버그 시작")
    print("각 후보 URL을 순서대로 분석합니다...\n")

    async with async_playwright() as pw:
        for url in CANDIDATE_URLS:
            try:
                await debug_url(url, pw)
            except Exception as e:
                print(f"오류 [{url}]: {e}")

    print("\n\n디버그 완료.")
    print("위 출력 내용을 공유해주세요 → 크롤러 선택자를 정확히 수정하겠습니다.")


if __name__ == "__main__":
    asyncio.run(main())
