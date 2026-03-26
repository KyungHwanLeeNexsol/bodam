#!/usr/bin/env python3
"""롯데손해보험 약관 PDF 크롤러

상품목록(cdh190.jsp) 페이지에서 약관 PDF를 수집한다.
4단계 선택 UI (판매상태 → 대분류 → 세부분류 → 다운로드) 기반 동적 SPA.
Playwright로 JS 렌더링 후 httpx로 PDF 다운로드.

실행:
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_lotte_insurance
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_lotte_insurance --dry-run

# @MX:NOTE: 롯데손보 상품목록은 4단계 SPA. procTask(Y/N) → step2(lcode,mcode) → step3 → step4 → PDF
# @MX:NOTE: /CChannelSvl POST, ops_tc=dfi.c.d.g.cmd.Cdg079Cmd, 결과는 iframe "common" 에 렌더
# @MX:NOTE: PDF URL 패턴: /upload/C/... 또는 onclick="fn_pdf(...)" 형태
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
COMPANY_ID = "lotte_insurance"
COMPANY_NAME = "롯데손해보험"
BASE_URL = "https://www.lotteins.co.kr"
PRODUCT_LIST_URL = f"{BASE_URL}/web/C/D/H/cdh190.jsp"

# @MX:NOTE: 수집 대상 카테고리 키워드 (상해/질병/건강 관련)
# step2에서 반환되는 카테고리 텍스트와 매칭
TARGET_KEYWORDS: list[str] = [
    "상해", "질병", "건강", "의료", "실손", "암", "간병", "치아", "CI", "GI",
    "운전자", "어린이", "종합", "통합",
]

# 제외 키워드
EXCLUDE_KEYWORDS: list[str] = [
    "자동차", "화재", "해상보험", "배상", "책임", "적립", "연금",
]

# 판매상태 매핑
SALE_STATUS_MAP: dict[str, str] = {
    "Y": "ON_SALE",
    "N": "DISCONTINUED",
}


def _is_target_category(name: str) -> bool:
    """카테고리 또는 상품명이 수집 대상인지 판단한다."""
    for kw in EXCLUDE_KEYWORDS:
        if kw in name:
            return False
    for kw in TARGET_KEYWORDS:
        if kw in name:
            return True
    return False


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

    # 중복 검사: 동일 해시이면 스킵 (sale_status 다르면 메타만 갱신)
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
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"skipped": False}


async def _wait_for_iframe_load(page: Any, timeout_ms: int = 10000) -> None:
    """iframe 'common' 에 콘텐츠가 로드될 때까지 대기한다.

    # @MX:WARN: iframe 접근은 cross-origin 정책에 의해 차단될 수 있음
    # @MX:REASON: 롯데손보 cdh190_result.jsp가 iframe "common" 안에 렌더됨
    # @MX:NOTE: Playwright frame API 우선, JS DOM 접근은 same-origin 한정
    """
    deadline = asyncio.get_event_loop().time() + timeout_ms / 1000
    while asyncio.get_event_loop().time() < deadline:
        # 방법 1: Playwright 네이티브 frame API
        try:
            frame = page.frame(name="common")
            if frame:
                html = await frame.evaluate(
                    "() => document.body ? document.body.innerHTML : ''"
                )
                if html and len(html) > 100:
                    return
        except Exception:
            pass

        # 방법 2: JS DOM 접근 (same-origin 전용)
        try:
            result = await page.evaluate("""() => {
                const iframe = document.querySelector('iframe[name="common"]');
                if (!iframe) return 0;
                try {
                    const doc = iframe.contentDocument || iframe.contentWindow.document;
                    return doc && doc.body ? doc.body.innerHTML.length : 0;
                } catch (e) { return 0; }
            }""")
            if result and result > 100:
                return
        except Exception:
            pass

        await asyncio.sleep(0.5)

    # 타임아웃 시 단순 대기
    await asyncio.sleep(1)


async def _get_iframe_content(page: Any) -> str:
    """iframe "common" 내부 HTML을 추출한다.

    # @MX:NOTE: Playwright frame API → JS DOM 접근 순서로 시도
    """
    # 방법 1: Playwright 네이티브 frame API (cross-origin도 접근 가능)
    try:
        frame = page.frame(name="common")
        if frame:
            html = await frame.evaluate(
                "() => document.body ? document.body.innerHTML : ''"
            )
            if html and len(html) > 50:
                logger.debug("  [iframe] Playwright frame API로 %d자 추출", len(html))
                return html
    except Exception as e:
        logger.debug("  [iframe] frame API 실패: %s", e)

    # 방법 2: JS DOM 접근 (same-origin 전용)
    try:
        result = await page.evaluate("""() => {
            const iframe = document.querySelector('iframe[name="common"]');
            if (!iframe) return '';
            try {
                const doc = iframe.contentDocument || iframe.contentWindow.document;
                return doc ? doc.body.innerHTML : '';
            } catch (e) {
                return '';
            }
        }""")
        if result and len(result) > 50:
            logger.debug("  [iframe] JS DOM 접근으로 %d자 추출", len(result))
            return result
    except Exception as e:
        logger.debug("  [iframe] JS DOM 접근 실패: %s", e)

    # 방법 3: 모든 child frame 탐색 (name="common" 외 다른 이름일 경우 대비)
    try:
        frames = page.frames
        frame_names = [f.name for f in frames]
        logger.info("  [iframe] 사용 가능한 frame 목록: %s", frame_names)
        for frame in frames:
            if frame == page.main_frame:
                continue
            try:
                html = await frame.evaluate(
                    "() => document.body ? document.body.innerHTML : ''"
                )
                if html and len(html) > 100 and ("step3" in html or "fn_pdf" in html or "/upload/" in html):
                    logger.info("  [iframe] frame '%s'에서 유효한 HTML %d자 발견", frame.name, len(html))
                    return html
            except Exception:
                pass
    except Exception as e:
        logger.debug("  [iframe] 전체 frame 탐색 실패: %s", e)

    logger.warning("  [iframe] 모든 접근 방법 실패 (frame 없음 또는 step3/PDF 패턴 없음)")
    return ""


async def _collect_step2_categories(page: Any, issale: str) -> list[dict[str, str]]:
    """procTask(Y/N) 클릭 후 step2 카테고리 목록을 수집한다.

    # @MX:NOTE: step2는 onclick="step2(lcode, mcode, val, gubun)" 형태의 링크로 구현됨
    """
    await page.goto(PRODUCT_LIST_URL, timeout=30000, wait_until="networkidle")
    await asyncio.sleep(2)

    # procTask 호출로 판매 상태 설정
    await page.evaluate(f"procTask('{issale}')")
    await asyncio.sleep(2)

    # step2 링크 추출
    # @MX:NOTE: onclick="step2('01','01', 0, 1)" 형태 파싱
    # @MX:NOTE: 4번째 인자(gubun)는 따옴표 없는 숫자일 수 있음 (예: step2('01','01', 0, 1))
    categories: list[dict[str, str]] = await page.evaluate("""() => {
        const cats = [];
        // 4번째 인자가 따옴표 있는 문자열('1') 또는 따옴표 없는 숫자(1) 모두 허용
        const step2Pattern = /step2\\s*\\(\\s*'([^']+)'\\s*,\\s*'([^']+)'\\s*,\\s*(\\d+)\\s*,\\s*'?([^'\\s,)]+)/;
        document.querySelectorAll('[onclick*="step2"]').forEach(el => {
            const onclick = el.getAttribute('onclick') || '';
            const m = onclick.match(step2Pattern);
            if (m) {
                cats.push({
                    lcode: m[1],
                    mcode: m[2],
                    val: m[3],
                    gubun: m[4],
                    name: el.textContent.trim(),
                });
            }
        });
        return cats;
    }""")

    return categories


async def _click_step2_and_get_products(
    page: Any,
    lcode: str,
    mcode: str,
    val: str,
    gubun: str,
    issale: str,
) -> list[dict[str, Any]]:
    """step2 카테고리 클릭 후 step3/step4를 통해 약관 PDF 링크를 수집한다.

    # @MX:WARN: 각 step은 폼 POST를 iframe에 렌더하므로 타이밍이 중요
    # @MX:REASON: 네트워크 지연 시 빈 결과 반환 가능 → asyncio.sleep으로 보완
    """
    products: list[dict[str, Any]] = []

    try:
        # issale 값 설정 및 step2 실행
        await page.evaluate(f"""() => {{
            const frm = document.myform;
            if (!frm) return;
            frm.issale.value = '{issale}';
        }}""")
        # gubun이 순수 숫자이면 따옴표 없이 전달 (strict equality 대응)
        gubun_js = gubun if gubun.isdigit() else f"'{gubun}'"
        await page.evaluate(f"step2('{lcode}', '{mcode}', {val}, {gubun_js})")
        await asyncio.sleep(3)
        await _wait_for_iframe_load(page, 8000)

        # iframe에서 step3 링크 추출
        iframe_html = await _get_iframe_content(page)
        logger.info(
            "  [step2] lcode=%s mcode=%s → iframe HTML %d자",
            lcode, mcode, len(iframe_html),
        )
        if not iframe_html:
            logger.warning(
                "  [step2] iframe HTML 비어있음 (lcode=%s, mcode=%s) — iframe 이름 또는 구조 확인 필요",
                lcode, mcode,
            )
            return products

        # step3 onclick 패턴
        step3_matches = re.findall(
            r"step3\s*\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*",
            iframe_html,
        )
        logger.info("  [step2] step3 패턴 %d개 발견", len(step3_matches))

        if not step3_matches:
            # iframe 내용 진단 로그 (한 번만 출력)
            snippet = iframe_html[:600].replace("\n", " ").replace("\r", "")
            logger.info("  [step2] iframe 내용 스니펫 (600자): %s", snippet)

            # step3 없으면 바로 step4 직접 링크 탐색
            pdf_links = _extract_pdf_links_from_html(iframe_html)
            for link_info in pdf_links:
                link_info["lcode"] = lcode
                link_info["mcode"] = mcode
                products.append(link_info)
            return products

        # step3 각 항목 처리
        for s3_lcode, s3_mcode, s3_scode, s3_val in step3_matches[:20]:
            await page.evaluate(
                f"step3('{s3_lcode}', '{s3_mcode}', '{s3_scode}', '{s3_val}', 0)"
            )
            await asyncio.sleep(2)
            await _wait_for_iframe_load(page, 6000)

            iframe_html = await _get_iframe_content(page)

            # step4 onclick 패턴
            step4_matches = re.findall(
                r"step4\s*\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'?([^'\")\s]+)",
                iframe_html,
            )

            if step4_matches:
                for s4_lcode, s4_mcode, s4_scode, s4_startdate, _val in step4_matches[:50]:
                    await page.evaluate(
                        f"step4('{s4_lcode}', '{s4_mcode}', '{s4_scode}', '{s4_startdate}', 0, 0)"
                    )
                    await asyncio.sleep(2)
                    await _wait_for_iframe_load(page, 6000)

                    final_html = await _get_iframe_content(page)
                    pdf_links = _extract_pdf_links_from_html(final_html)

                    # 상품명/상품코드 추출 시도
                    prod_name = _extract_product_name(final_html) or f"{s4_lcode}_{s4_mcode}_{s4_scode}"
                    for link_info in pdf_links:
                        link_info.setdefault("product_name", prod_name)
                        link_info.setdefault("product_code", f"{s4_lcode}{s4_mcode}{s4_scode}")
                        products.append(link_info)
            else:
                # step4 없으면 직접 PDF 링크 탐색
                pdf_links = _extract_pdf_links_from_html(iframe_html)
                for link_info in pdf_links:
                    link_info.setdefault("product_code", f"{s3_lcode}{s3_mcode}{s3_scode}")
                    products.append(link_info)

    except Exception as e:
        logger.warning("  [WARN] step2 처리 오류 (lcode=%s, mcode=%s): %s", lcode, mcode, e)

    return products


def _extract_pdf_links_from_html(html: str) -> list[dict[str, Any]]:
    """HTML에서 약관 PDF 링크를 추출한다.

    # @MX:NOTE: 롯데손보 PDF 패턴:
    #   1) href="/upload/C/..."  (직접 링크)
    #   2) onclick="fn_pdf('/upload/C/...', '상품명')"
    #   3) onclick="fn_yakwan('filename', 'displayname')"
    #   4) location.href='/upload/C/...'
    """
    links: list[dict[str, Any]] = []

    # 패턴 1: href에 /upload/ 경로
    for m in re.finditer(r'href=["\']([^"\']*?/upload/[^"\']+\.pdf)["\']', html, re.IGNORECASE):
        url = m.group(1)
        if not url.startswith("http"):
            url = BASE_URL + url
        name = _extract_product_name_near(html, m.start())
        links.append({"url": url, "product_name": name or "", "product_code": ""})

    # 패턴 2: onclick에 fn_pdf
    for m in re.finditer(
        r"fn_pdf\s*\(\s*['\"]([^'\"]+)['\"](?:\s*,\s*['\"]([^'\"]*)['\"])?\s*\)",
        html,
        re.IGNORECASE,
    ):
        path = m.group(1)
        display = m.group(2) or ""
        if not path.startswith("http"):
            path = BASE_URL + path
        links.append({
            "url": path,
            "product_name": display or "",
            "product_code": "",
        })

    # 패턴 3: location.href = '/upload/...'
    for m in re.finditer(r"location\.href\s*=\s*['\"]([^'\"]*?/upload/[^'\"]+\.pdf)['\"]", html, re.IGNORECASE):
        url = m.group(1)
        if not url.startswith("http"):
            url = BASE_URL + url
        links.append({"url": url, "product_name": "", "product_code": ""})

    # 패턴 4: CChannelSvl?task=download 형태
    for m in re.finditer(
        r"href=['\"]([^'\"]*CChannelSvl[^'\"]*task=download[^'\"]*)['\"]",
        html,
        re.IGNORECASE,
    ):
        url = m.group(1)
        if not url.startswith("http"):
            url = BASE_URL + url
        links.append({"url": url, "product_name": "", "product_code": ""})

    # 중복 제거
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for link in links:
        if link["url"] not in seen:
            seen.add(link["url"])
            unique.append(link)

    return unique


def _extract_product_name(html: str) -> str:
    """HTML에서 상품명을 추출한다."""
    # <dt>상품명</dt><dd>...</dd> 패턴
    m = re.search(r"<dt[^>]*>상품명</dt>\s*<dd[^>]*>([^<]+)</dd>", html)
    if m:
        return m.group(1).strip()
    # <span class="prod_name">...</span> 패턴
    m = re.search(r'class=["\'][^"\']*prod[_-]?name[^"\']*["\'][^>]*>([^<]+)<', html, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return ""


def _extract_product_name_near(html: str, pos: int) -> str:
    """HTML의 특정 위치 근처에서 상품명을 추출한다."""
    # 앞 500자 범위 탐색
    snippet = html[max(0, pos - 500):pos]
    m = re.search(r">([^<>]{5,60}보험[^<>]{0,30})<", snippet)
    if m:
        return m.group(1).strip()
    return ""


async def _collect_products_via_network_intercept(
    page: Any,
    issale: str,
    sale_status: str,
    dry_run: bool = False,
) -> list[dict[str, Any]]:
    """네트워크 인터셉트 방식으로 PDF URL을 수집한다.

    # @MX:NOTE: iframe 방식이 실패할 경우 대안: 응답 인터셉트로 PDF URL 캡처
    # @MX:WARN: 페이지 이벤트 리스너는 context 종료 시 정리 필요
    # @MX:REASON: 롯데손보 iframe이 same-origin이 아닐 경우 JS 접근 불가
    """
    captured_pdfs: list[dict[str, Any]] = []
    pdf_urls_seen: set[str] = set()

    def on_response(response: Any) -> None:
        url = response.url
        if "/upload/" in url and url.endswith(".pdf") and url not in pdf_urls_seen:
            pdf_urls_seen.add(url)
            captured_pdfs.append({
                "url": url,
                "product_name": "",
                "product_code": "",
                "sale_status": sale_status,
            })

    page.on("response", on_response)

    try:
        await page.goto(PRODUCT_LIST_URL, timeout=30000, wait_until="networkidle")
        await asyncio.sleep(2)

        await page.evaluate(f"procTask('{issale}')")
        await asyncio.sleep(2)

        # step2 카테고리 목록 수집
        # @MX:NOTE: 4번째 인자(gubun)는 따옴표 없는 숫자일 수 있음 (예: step2('01','01', 0, 1))
        categories: list[dict[str, str]] = await page.evaluate("""() => {
            const cats = [];
            // 4번째 인자가 따옴표 있는 문자열('1') 또는 따옴표 없는 숫자(1) 모두 허용
            const pat = /step2\\s*\\(\\s*'([^']+)'\\s*,\\s*'([^']+)'\\s*,\\s*(\\d+)\\s*,\\s*'?([^'\\s,)]+)/;
            document.querySelectorAll('[onclick*="step2"]').forEach(el => {
                const m = el.getAttribute('onclick').match(pat);
                if (m) cats.push({
                    lcode: m[1], mcode: m[2], val: m[3], gubun: m[4],
                    name: el.textContent.trim()
                });
            });
            return cats;
        }""")

        logger.info("  [%s] 카테고리 %d개 발견", sale_status, len(categories))

        for cat in categories:
            cat_name = cat.get("name", "")
            if not _is_target_category(cat_name) and cat_name:
                logger.debug("  [SKIP] 카테고리: %s", cat_name)
                continue

            logger.info("  [%s] 카테고리 처리: %s", sale_status, cat_name or f"lcode={cat['lcode']}")

            products = await _click_step2_and_get_products(
                page,
                cat["lcode"],
                cat["mcode"],
                cat["val"],
                cat["gubun"],
                issale,
            )

            for p in products:
                p["category"] = cat_name
                p["sale_status"] = sale_status

            captured_pdfs.extend([p for p in products if p.get("url")])

            await asyncio.sleep(1)

    finally:
        page.remove_listener("response", on_response)

    return captured_pdfs


async def _download_pdf(client: Any, url: str, referer: str) -> bytes | None:
    """PDF를 다운로드하고 유효한 PDF 바이트를 반환한다."""
    try:
        resp = await client.get(
            url,
            headers={"Referer": referer},
            timeout=60.0,
        )
        if resp.status_code == 200 and len(resp.content) > 1000:
            # PDF 시그니처 검사
            if resp.content[:4] == b"%PDF":
                return resp.content
        return None
    except Exception as e:
        logger.warning("  [WARN] PDF 다운로드 실패 %s: %s", url[:80], e)
        return None


async def main(dry_run: bool = False) -> None:
    from playwright.async_api import async_playwright

    logger.info("=" * 60)
    logger.info("%s 약관 크롤링 시작%s", COMPANY_NAME, " (DRY RUN)" if dry_run else "")
    logger.info("대상: 상해/질병/건강/의료 관련 상품 약관")
    logger.info("=" * 60)

    all_products: list[dict[str, Any]] = []
    downloaded = 0
    skipped = 0
    failed = 0
    meta_updated = 0

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            accept_downloads=True,
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        )
        page = await context.new_page()

        # 판매중 / 판매중지 각각 수집
        for issale, sale_status in SALE_STATUS_MAP.items():
            logger.info("[%s] %s 상품 수집 시작...", COMPANY_NAME, sale_status)

            products = await _collect_products_via_network_intercept(
                page, issale, sale_status, dry_run=dry_run,
            )

            # 중복 제거 (URL 기준)
            seen_urls: set[str] = {p["url"] for p in all_products if p.get("url")}
            new_count = 0
            for p in products:
                if p.get("url") and p["url"] not in seen_urls:
                    all_products.append(p)
                    seen_urls.add(p["url"])
                    new_count += 1

            logger.info(
                "  → %s: %d개 발견 (%d개 신규)",
                sale_status, len(products), new_count,
            )

        await browser.close()

    logger.info("[%s] 전체 %d개 약관 수집 완료", COMPANY_NAME, len(all_products))

    if dry_run:
        for p in all_products:
            logger.info(
                "  [DRY] [%s] %s | %s | %s",
                p.get("sale_status", "?"),
                p.get("category", "?")[:20],
                p.get("product_name", "?")[:40],
                p.get("url", "?")[:80],
            )
        return

    if not all_products:
        logger.warning("[%s] 수집된 PDF가 없습니다. 사이트 구조 변경 가능성 확인 필요.", COMPANY_NAME)
        return

    # PDF 다운로드
    async with httpx.AsyncClient(
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        follow_redirects=True,
        timeout=60.0,
    ) as client:
        total = len(all_products)
        for i, prod in enumerate(all_products):
            url = prod.get("url", "")
            name = prod.get("product_name", "") or f"상품_{i+1}"
            code = prod.get("product_code", "") or f"lotte_{i+1:04d}"
            cat = prod.get("category", "")
            status = prod.get("sale_status", "ON_SALE")

            if not url:
                failed += 1
                continue

            try:
                pdf_data = await _download_pdf(client, url, PRODUCT_LIST_URL)
                if pdf_data:
                    result = save_pdf(pdf_data, name, code, cat, url, sale_status=status)
                    if result.get("skipped"):
                        skipped += 1
                        if result.get("meta_updated"):
                            meta_updated += 1
                    else:
                        downloaded += 1
                        logger.info(
                            "  [OK] [%s] %s (%d bytes)",
                            status, name[:50], len(pdf_data),
                        )
                else:
                    failed += 1
                    logger.warning("  [FAIL] %s", url[:80])

            except Exception as e:
                logger.error("  [ERROR] %s: %s", name[:40], e)
                failed += 1

            await asyncio.sleep(0.5)

            if (i + 1) % 50 == 0:
                logger.info(
                    "  진행: %d/%d (다운:%d, 스킵:%d, 실패:%d)",
                    i + 1, total, downloaded, skipped, failed,
                )

    logger.info("=" * 60)
    logger.info(
        "%s 크롤링 완료: %d 다운로드, %d 스킵(%d 메타갱신), %d 실패 (총 %d)",
        COMPANY_NAME, downloaded, skipped, meta_updated, failed, len(all_products),
    )
    logger.info("=" * 60)

    report_path = BASE_DATA_DIR / "lotte_insurance_report.json"
    report = {
        "company_id": COMPANY_ID,
        "company_name": COMPANY_NAME,
        "crawled_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "downloaded": downloaded,
        "skipped": skipped,
        "failed": failed,
        "total": len(all_products),
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=f"{COMPANY_NAME} 약관 PDF 크롤러")
    parser.add_argument("--dry-run", action="store_true", help="PDF 다운로드 없이 상품 목록만 출력")
    args = parser.parse_args()
    asyncio.run(main(dry_run=args.dry_run))
