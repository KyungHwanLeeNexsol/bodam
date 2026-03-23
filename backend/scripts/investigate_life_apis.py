#!/usr/bin/env python3
"""생명보험사 약관 API 탐지 스크립트

각 생명보험사 웹사이트에서 약관(판매중지 포함) API 엔드포인트를 탐지한다.
Playwright로 실제 브라우저 요청을 인터셉트하여 JSON API를 찾는다.

실행:
    cd backend && PYTHONPATH=. .venv/bin/python scripts/investigate_life_apis.py
    cd backend && PYTHONPATH=. .venv/bin/python scripts/investigate_life_apis.py --company samsung_life
"""
from __future__ import annotations

import asyncio
import json
import logging
import sys
from pathlib import Path

if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)

# 탐지 대상 회사 목록 (우선순위 순)
COMPANIES = [
    ("samsung_life", "삼성생명", "https://www.samsunglife.com"),
    ("kyobo_life", "교보생명", "https://www.kyobo.com"),
    ("hanwha_life", "한화생명", "https://www.hanwhalife.com"),
    ("shinhan_life", "신한라이프", "https://www.shinhanlife.co.kr"),
    ("heungkuk_life", "흥국생명", "https://www.heungkuklife.co.kr"),
    ("dongyang_life", "동양생명", "https://www.myangel.co.kr"),
    ("mirae_life", "미래에셋생명", "https://www.miraeassetlife.co.kr"),
    ("nh_life", "NH농협생명", "https://www.nhlife.co.kr"),
    ("db_life", "DB생명", "https://www.db-lifeinsurance.com"),
    ("kdb_life", "KDB생명", "https://www.kdblife.co.kr"),
    ("hana_life", "하나생명", "https://www.hanalife.co.kr"),
    ("aia_life", "AIA생명", "https://www.aia.co.kr"),
    ("metlife", "메트라이프", "https://www.metlife.co.kr"),
    ("lina_life", "라이나생명", "https://www.lina.co.kr"),
    ("abl_life", "ABL생명", "https://www.abllife.co.kr"),
    ("fubon_hyundai_life", "푸본현대생명", "https://www.fubonhyundai.com"),
    ("kb_life", "KB라이프", "https://www.kblifeinsurance.com"),
    ("im_life", "iM라이프", "https://www.imlife.co.kr"),
    ("ibk_life", "IBK연금보험", "https://www.ibkannuity.co.kr"),
    ("chubb_life", "처브라이프", "https://www.chubb.com/kr-ko"),
    ("bnp_life", "BNP파리바카디프", "https://www.cardif.co.kr"),
    ("kyobo_lifeplanet", "교보라이프플래닛", "https://www.lifeplanet.co.kr"),
]

# 약관 관련 키워드 - URL 필터링용
TERMS_KEYWORDS = [
    "term", "yakgwan", "약관", "disclosure", "공시",
    "clause", "policy", "약관공시", "약관목록", "termsList",
    "terms", "약관조회", "공시실", "약관안내",
    "insuranceTerm", "policyTerm", "contTerms",
]

# 약관 관련 키워드 - 메뉴 탐색용
NAV_KEYWORDS = [
    "약관", "공시", "보험약관", "약관공시", "공시실",
    "약관조회", "고객서비스", "약관안내", "보험안내",
    "clause", "terms",
]


def _is_terms_url(url: str) -> bool:
    """URL이 약관 관련인지 판단한다."""
    url_lower = url.lower()
    return any(kw.lower() in url_lower for kw in TERMS_KEYWORDS)


def _is_json_response(content_type: str) -> bool:
    """JSON 응답인지 판단한다."""
    return "json" in content_type or "javascript" in content_type


async def investigate_company(
    browser: object,
    company_id: str,
    company_name: str,
    base_url: str,
) -> dict:
    """단일 회사의 약관 API를 탐지한다."""
    from playwright.async_api import Browser  # type: ignore

    context = await browser.new_context(  # type: ignore
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        viewport={"width": 1280, "height": 800},
        locale="ko-KR",
        extra_http_headers={
            "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        },
    )
    page = await context.new_page()

    api_calls: list[dict] = []
    all_requests: list[dict] = []

    async def on_response(response: object) -> None:  # type: ignore
        url = response.url  # type: ignore
        ct = response.headers.get("content-type", "")  # type: ignore
        status = response.status  # type: ignore

        # 모든 JSON 응답 기록
        if _is_json_response(ct) and status < 400:
            try:
                body = await response.body()  # type: ignore
                text = body.decode("utf-8", errors="ignore")
                if len(text) > 100:
                    try:
                        data = json.loads(text)
                        entry = {
                            "url": url,
                            "status": status,
                            "method": "GET",
                            "data_keys": _extract_keys(data),
                            "data_preview": str(data)[:500],
                            "is_terms_related": _is_terms_url(url),
                        }
                        all_requests.append(entry)
                        if _is_terms_url(url):
                            api_calls.append(entry)
                            logger.info("  [약관 API 탐지] %s", url)
                    except json.JSONDecodeError:
                        pass
            except Exception:
                pass

    page.on("response", on_response)

    result = {
        "company_id": company_id,
        "company_name": company_name,
        "base_url": base_url,
        "nav_links": [],
        "terms_api_calls": [],
        "all_api_calls": [],
        "direct_api_results": [],
        "error": None,
    }

    try:
        logger.info("\n=== %s (%s) 탐지 시작 ===", company_name, base_url)

        # 1단계: 메인 페이지 로딩 및 약관 링크 탐색
        try:
            await page.goto(base_url, timeout=30000, wait_until="domcontentloaded")
            await asyncio.sleep(3)
        except Exception as e:
            logger.warning("  메인 페이지 로딩 실패: %s", e)
            result["error"] = str(e)
            await context.close()
            return result

        # 2단계: 약관 관련 네비게이션 링크 수집
        nav_links = await page.evaluate("""
            (keywords) => {
                const links = Array.from(document.querySelectorAll('a, button, li[onclick], span[onclick]'));
                return links
                    .filter(el => {
                        const text = el.textContent.trim();
                        return keywords.some(kw => text.includes(kw));
                    })
                    .map(el => ({
                        text: el.textContent.trim().substring(0, 50),
                        href: el.href || el.getAttribute('href') || '',
                        onclick: el.getAttribute('onclick') || '',
                        tag: el.tagName,
                    }))
                    .filter(l => l.text.length > 0)
                    .slice(0, 30);
            }
        """, NAV_KEYWORDS)

        result["nav_links"] = nav_links
        logger.info("  약관 관련 링크 %d개 발견", len(nav_links))
        for lnk in nav_links[:10]:
            logger.info("    - [%s] %s: %s", lnk["tag"], lnk["text"], lnk["href"])

        # 3단계: 약관 페이지 탐색 시도
        terms_page_visited = False
        for lnk in nav_links:
            href = lnk.get("href", "")
            if not href or href == "#" or href.startswith("javascript"):
                continue
            if not href.startswith("http"):
                from urllib.parse import urljoin
                href = urljoin(base_url, href)

            # 약관 키워드가 있는 링크만 시도
            text = lnk.get("text", "")
            if not any(kw in text for kw in ["약관", "공시", "clause", "terms"]):
                continue

            try:
                logger.info("  약관 페이지 이동 시도: %s", href)
                await page.goto(href, timeout=25000, wait_until="domcontentloaded")
                await asyncio.sleep(4)
                terms_page_visited = True

                # 판매중지 탭 클릭 시도
                clicked = await page.evaluate("""
                    () => {
                        const keywords = ['판매중지', '판매중지상품', '과거약관', '단종'];
                        const els = Array.from(document.querySelectorAll(
                            'a, button, li, span, div.tab, div.btn, ul.tab li, .tabmenu li'
                        ));
                        for (const el of els) {
                            const text = el.textContent.trim();
                            if (keywords.some(kw => text.includes(kw))) {
                                el.click();
                                return '클릭: ' + text;
                            }
                        }
                        return null;
                    }
                """)
                if clicked:
                    logger.info("  판매중지 탭 클릭: %s", clicked)
                    await asyncio.sleep(3)

                break
            except Exception as e:
                logger.warning("  페이지 이동 실패 (%s): %s", href, e)
                continue

        # 4단계: 직접 API URL 시도 (회사별 알려진 패턴)
        direct_api_urls = _get_direct_api_urls(company_id, base_url)
        for api_url in direct_api_urls:
            try:
                resp = await page.request.get(
                    api_url,
                    headers={
                        "Accept": "application/json, text/javascript, */*",
                        "Referer": base_url,
                        "X-Requested-With": "XMLHttpRequest",
                    },
                    timeout=20000,
                )
                if resp.ok:
                    body = await resp.body()
                    text = body.decode("utf-8", errors="ignore")
                    try:
                        data = json.loads(text)
                        entry = {
                            "url": api_url,
                            "status": resp.status,
                            "data_keys": _extract_keys(data),
                            "data_preview": str(data)[:800],
                            "success": True,
                        }
                        result["direct_api_results"].append(entry)
                        logger.info("  [직접 API 성공] %s -> keys: %s", api_url, _extract_keys(data))
                    except json.JSONDecodeError:
                        pass
                else:
                    logger.debug("  직접 API 실패 (status=%d): %s", resp.status, api_url)
            except Exception as e:
                logger.debug("  직접 API 오류 (%s): %s", api_url, e)

        # 5단계: 결과 정리
        await asyncio.sleep(2)
        result["terms_api_calls"] = api_calls
        result["all_api_calls"] = all_requests[:50]  # 최대 50개

        logger.info(
            "  [완료] 약관 API: %d개, 전체 JSON API: %d개, 직접 API: %d개",
            len(api_calls),
            len(all_requests),
            len([r for r in result["direct_api_results"] if r.get("success")]),
        )

    except Exception as e:
        logger.error("[%s] 탐지 중 오류: %s", company_name, e)
        result["error"] = str(e)
    finally:
        await context.close()

    return result


def _extract_keys(data: object, depth: int = 2) -> list[str]:
    """JSON 데이터의 키 구조를 추출한다."""
    keys: list[str] = []
    if isinstance(data, dict):
        for k, v in list(data.items())[:20]:
            keys.append(str(k))
            if depth > 1 and isinstance(v, (dict, list)):
                sub = _extract_keys(v, depth - 1)
                keys.extend(f"{k}.{s}" for s in sub[:5])
    elif isinstance(data, list) and data:
        keys.append(f"[list len={len(data)}]")
        if isinstance(data[0], dict):
            keys.extend(_extract_keys(data[0], depth))
    return keys[:30]


def _get_direct_api_urls(company_id: str, base_url: str) -> list[str]:
    """회사별 직접 시도할 API URL 목록을 반환한다."""
    # 공통 약관 API 패턴
    common_patterns = [
        "/api/terms/list",
        "/api/v1/terms/list",
        "/gw/api/terms/list",
        "/front/api/terms/list",
        "/api/public/terms",
        "/api/disclosure/terms",
        "/api/yakgwan/list",
        "/rest/terms/list",
        "/json/terms/list",
        "/terms/list.json",
        "/termsList.json",
        "/api/termsInfo",
    ]

    # 회사별 특화 패턴
    company_patterns: dict[str, list[str]] = {
        "samsung_life": [
            "/gw/api/display/board/content/list",
            "/front/api/publicDisclosure/termsList.json",
            "/gw/api/product/terms/list",
            "/gw/api/terms/termsList",
            "/gw/api/disclosure/terms/list",
            "/individual/customer/publicnotice/terms",
        ],
        "kyobo_life": [
            "/dgt/web/disclosure/insurance-terms/personal",
            "/dgt/web/notice-management/insurance-clause/list",
            "/api/terms/list",
            "/api/v1/terms/list",
            "/dgt/api/terms/list",
        ],
        "hanwha_life": [
            "/main/terms/CS_TRMS000_P10000.do",
            "/main/customer/CS_CUSC010_P10000.do",
            "/api/terms/list",
            "/front/api/terms/list",
            "/main/disclosure/terms/list.do",
        ],
        "shinhan_life": [
            "/api/terms/list",
            "/customer/terms/list",
            "/api/v1/terms",
        ],
        "heungkuk_life": [
            "/api/terms/list",
            "/customer/terms",
        ],
        "dongyang_life": [
            "/api/terms/list",
            "/terms/list.do",
        ],
        "mirae_life": [
            "/api/terms/list",
            "/customer/terms/list",
        ],
        "nh_life": [
            "/api/terms/list",
            "/terms/list.json",
            "/nhlife/customer/terms/list",
        ],
        "db_life": [
            "/api/terms/list",
            "/customer/terms/list",
        ],
        "kdb_life": [
            "/api/terms/list",
            "/terms/list",
        ],
        "hana_life": [
            "/api/terms/list",
            "/customer/service/terms/list",
        ],
        "aia_life": [
            "/api/terms/list",
            "/api/public/termsList",
        ],
        "kb_life": [
            "/api/terms/list",
            "/customer/terms/list",
        ],
        "im_life": [
            "/api/terms/list",
        ],
        "abl_life": [
            "/api/terms/list",
        ],
    }

    urls: list[str] = []

    # 회사 특화 패턴 먼저
    for path in company_patterns.get(company_id, []):
        from urllib.parse import urljoin
        urls.append(urljoin(base_url, path))

    # 공통 패턴
    for path in common_patterns:
        from urllib.parse import urljoin
        url = urljoin(base_url, path)
        if url not in urls:
            urls.append(url)

    return urls[:20]  # 최대 20개


def print_summary(results: list[dict]) -> None:
    """탐지 결과 요약을 출력한다."""
    print("\n" + "=" * 80)
    print("탐지 결과 요약")
    print("=" * 80)

    success_count = 0
    for r in results:
        company = r["company_name"]
        terms_apis = r.get("terms_api_calls", [])
        direct_apis = [x for x in r.get("direct_api_results", []) if x.get("success")]
        error = r.get("error")

        status = "오류" if error else ("성공" if terms_apis or direct_apis else "미탐지")
        if status == "성공":
            success_count += 1

        print(f"\n[{company}] 상태: {status}")
        if error:
            print(f"  오류: {error}")
        if terms_apis:
            print(f"  인터셉트된 약관 API ({len(terms_apis)}개):")
            for api in terms_apis[:3]:
                print(f"    - {api['url']}")
                print(f"      keys: {api.get('data_keys', [])[:10]}")
        if direct_apis:
            print(f"  직접 호출 성공 API ({len(direct_apis)}개):")
            for api in direct_apis[:3]:
                print(f"    - {api['url']}")
                print(f"      keys: {api.get('data_keys', [])[:10]}")

    print(f"\n총 {len(results)}개 회사 중 {success_count}개 API 탐지 성공")
    print("=" * 80)


async def main(companies: list[tuple] | None = None) -> None:
    """메인 탐지 프로세스."""
    from playwright.async_api import async_playwright  # type: ignore

    target_companies = companies or COMPANIES

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        )

        results: list[dict] = []
        for company_id, company_name, url in target_companies:
            try:
                result = await investigate_company(browser, company_id, company_name, url)
                results.append(result)
            except Exception as e:
                logger.error("[%s] 처리 중 오류: %s", company_name, e)
                results.append({
                    "company_id": company_id,
                    "company_name": company_name,
                    "base_url": url,
                    "error": str(e),
                    "terms_api_calls": [],
                    "all_api_calls": [],
                    "direct_api_results": [],
                })
            await asyncio.sleep(2)

        await browser.close()

        # 결과 저장
        output_path = Path(__file__).parent / "api_investigation_results.json"
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)

        logger.info("\n결과 저장: %s", output_path)
        print_summary(results)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="생명보험사 약관 API 탐지")
    parser.add_argument("--company", help="특정 회사만 탐지 (company_id)")
    parser.add_argument(
        "--companies",
        nargs="+",
        help="여러 회사 탐지 (공백으로 구분)",
    )
    args = parser.parse_args()

    if args.company:
        target = [c for c in COMPANIES if c[0] == args.company]
        if not target:
            print(f"회사를 찾을 수 없음: {args.company}")
            sys.exit(1)
        asyncio.run(main(target))
    elif args.companies:
        target = [c for c in COMPANIES if c[0] in args.companies]
        asyncio.run(main(target))
    else:
        asyncio.run(main())
