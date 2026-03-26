#!/usr/bin/env python3
"""NH농협손해보험 약관 PDF 크롤러

보험상품공시 페이지에서 약관 PDF를 수집한다.
Devon.js 기반 SPA: Playwright로 브라우저 제어.

3단계 드릴다운:
  1) 상품군(fnRetrievePdtDcd) → 장기보험(01) 대상
  2) 상품구분(fnRetrievePdtCd) → 운전자/상해(03), 건강/어린이(05), 단독실손(08) 등
  3) 상품명(fnRetrievePdtInfo) → 이력 테이블에서 약관 PDF 링크(seqn=1) 추출

판매상품(selectedTab=Y) + 판매중지상품(selectedTab=N) 모두 수집.
PDF 다운로드: fnFileDownload(fileId, seqn) form POST → /imageView/downloadFile.ajax

실행:
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_nh_fire
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_nh_fire --dry-run

# @MX:NOTE: NH농협손해보험 공시 URL: /announce/productAnnounce/retrieveInsuranceProductsAnnounce.nhfire
# @MX:NOTE: Ajax 함수 시그니처: fnRetrievePdtDcd('grpCd'), fnRetrievePdtCd('Y/N','grpCd','subCd')
# @MX:NOTE: fnRetrievePdtInfo("pdtCd", null) → tbody.pdtInfoList_Y / tr.pdtInfo_Y 테이블 렌더링
# @MX:NOTE: 약관 링크: fnFileDownload("fileId","1") — seqn=1이 약관 PDF (2=요약서, 4=사업방법서)
# @MX:NOTE: 다운로드: form POST /imageView/downloadFile.ajax?oFileId=X&oAfileSeqn=Y
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
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
COMPANY_ID = "nh_fire"
COMPANY_NAME = "NH농협손해보험"
BASE_URL = "https://www.nhfire.co.kr"

# 공시 페이지 URL
ANNOUNCE_URL = (
    f"{BASE_URL}/announce/productAnnounce/retrieveInsuranceProductsAnnounce.nhfire"
)

# 다운로드 엔드포인트
DOWNLOAD_AJAX = f"{BASE_URL}/imageView/downloadFile.ajax"

# 수집 대상 상품군 코드 (장기보험만 해당)
# @MX:NOTE: '01'=장기보험, '02'=일반보험, '03'=자동차보험, '04'=농작물재해보험
TARGET_GROUP_CODES: list[str] = ["01"]  # 장기보험

# 수집 대상 상품구분 코드 (장기보험 내)
# @MX:NOTE: '03'=운전자/상해, '05'=건강/어린이, '08'=단독실손의료보험
# @MX:NOTE: '01'=화재/재물, '02'=저축/연금, '12'=기타 — 제외
TARGET_SUB_CODES: set[str] = {"03", "05", "08"}

# 수집 대상 상품구분명 키워드 (subCode가 없거나 ''인 경우 이름으로 필터)
TARGET_SUB_KEYWORDS: list[str] = [
    "운전자", "상해", "건강", "어린이", "실손", "질병", "암", "의료", "간호", "치아",
]

# 전체(빈 subCode)는 별도 처리 — 필터 없이 모든 상품 수집
INCLUDE_EMPTY_SUB = False  # 전체 탭은 개별 탭에서 중복 수집되므로 제외

HEADERS: dict[str, str] = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
    "Referer": ANNOUNCE_URL,
}


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


def _is_target_sub(sub_code: str, sub_name: str) -> bool:
    """상품구분이 수집 대상인지 판별한다."""
    # 빈 코드(전체 탭) 처리
    if sub_code == "":
        return INCLUDE_EMPTY_SUB
    # 코드 기반 필터 우선
    if sub_code in TARGET_SUB_CODES:
        return True
    # 코드가 없으면 이름 기반 필터
    for kw in TARGET_SUB_KEYWORDS:
        if kw in sub_name:
            return True
    return False


def _infer_category(product_name: str, sub_name: str = "") -> str:
    """상품명/상품구분명에서 카테고리를 추론한다."""
    text = product_name + " " + sub_name
    if "암" in text:
        return "암보험"
    if "실손" in text or "의료비" in text:
        return "실손의료보험"
    if "치아" in text:
        return "치아보험"
    if "운전자" in text:
        return "운전자보험"
    if "어린이" in text or "자녀" in text:
        return "어린이보험"
    if "상해" in text:
        return "상해보험"
    if "질병" in text or "건강" in text or "의료" in text or "간호" in text:
        return "건강보험"
    if "종합" in text or "통합" in text:
        return "통합보험"
    return "장기보험"


async def get_sub_groups(page: Any, sel_yn: str, grp_code: str) -> list[dict[str, str]]:
    """상품군 클릭 후 상품구분 목록을 추출한다.

    fnRetrievePdtDcd(grpCode) 호출 → 상품구분 메뉴 렌더링 대기.
    """
    await page.evaluate(f"fnRetrievePdtDcd('{grp_code}')")
    await asyncio.sleep(2)

    subs: list[dict[str, str]] = await page.evaluate(
        """([selYn]) => {
            const results = [];
            const anchors = document.querySelectorAll("a[onclick*='fnRetrievePdtCd']");
            anchors.forEach(a => {
                const onclick = a.getAttribute("onclick") || "";
                // fnRetrievePdtCd('Y','01','03') 패턴
                const m = onclick.match(/fnRetrievePdtCd\\s*\\(\\s*['"]([^'"]+)['"]\\s*,\\s*['"]([^'"]+)['"]\\s*,\\s*['"]([^'"]*)['"]\\s*\\)/);
                if (m) {
                    results.push({
                        sel_yn: m[1],
                        grp_code: m[2],
                        sub_code: m[3],
                        name: (a.textContent || "").trim(),
                    });
                }
            });
            return results;
        }""",
        [sel_yn],
    )
    return subs


async def get_product_list(page: Any, sel_yn: str, grp_code: str, sub_code: str) -> list[dict[str, str]]:
    """상품구분 클릭 후 상품명 목록을 추출한다.

    fnRetrievePdtCd(selYn, grpCode, subCode) 호출 → 상품명 목록 렌더링 대기.
    """
    await page.evaluate(f"fnRetrievePdtCd('{sel_yn}', '{grp_code}', '{sub_code}')")
    await asyncio.sleep(2)

    products: list[dict[str, str]] = await page.evaluate("""() => {
        const results = [];
        const anchors = document.querySelectorAll("a[onclick*='fnRetrievePdtInfo']");
        anchors.forEach(a => {
            const onclick = a.getAttribute("onclick") || "";
            // fnRetrievePdtInfo("D411433",this) 또는 fnRetrievePdtInfo('D411433')
            const m = onclick.match(/fnRetrievePdtInfo\\s*\\(\\s*["']([^"']+)["']/);
            if (m) {
                results.push({
                    pdt_code: m[1],
                    name: (a.textContent || "").trim(),
                });
            }
        });
        return results;
    }""")
    return products


async def get_pdf_links(page: Any, pdt_code: str, sel_yn: str) -> list[dict[str, str]]:
    """상품 클릭 후 이력 테이블에서 약관 PDF 링크를 추출한다.

    fnRetrievePdtInfo(pdtCode, null) 호출 → tbody.pdtInfoList_Y 테이블 렌더링 대기.
    약관 컬럼(seqn=1)만 수집.
    """
    # @MX:ANCHOR: 약관 PDF 링크 추출 핵심 함수 — 이력 테이블 파싱
    # @MX:REASON: fnFileDownload("fileId","seqn") 패턴에서 seqn=1(약관)만 수집. fan_in: 1개 호출처이나 크롤링 핵심 로직.
    await page.evaluate(f'fnRetrievePdtInfo("{pdt_code}", null)')
    await asyncio.sleep(1.5)

    # NH 사이트는 판매중/판매중지 공통으로 _Y suffix 클래스를 렌더링함
    # sel_yn 값과 무관하게 항상 pdtInfoList_Y / pdtInfo_Y 사용
    tbody_class = "pdtInfoList_Y"
    row_class = "pdtInfo_Y"

    links: list[dict[str, str]] = await page.evaluate(
        """([tbodyClass, rowClass]) => {
            const results = [];
            // tbody 또는 tr 클래스로 이력 테이블 행 찾기
            const rows = document.querySelectorAll("." + rowClass + ", tbody." + tbodyClass + " tr");
            rows.forEach(tr => {
                const tds = Array.from(tr.querySelectorAll("td"));
                if (tds.length < 3) return;  // 헤더 행 스킵

                const startDt = (tds[0]?.textContent || "").trim();
                const endDt = (tds[1]?.textContent || "").trim();

                // 3번째 td(index 2) = 약관 컬럼
                const termsTd = tds[2];
                if (!termsTd) return;

                // fnFileDownload("fileId","seqn") 링크 추출
                const anchors = termsTd.querySelectorAll("a[onclick*='fnFileDownload']");
                anchors.forEach(a => {
                    const onclick = a.getAttribute("onclick") || "";
                    const title = a.getAttribute("title") || "";
                    const m = onclick.match(/fnFileDownload\\s*\\(\\s*["']([^"']+)["']\\s*,\\s*["']([^"']+)["']\\s*\\)/);
                    if (m) {
                        results.push({
                            file_id: m[1],
                            a_file_seqn: m[2],
                            title: title,
                            start_dt: startDt,
                            end_dt: endDt,
                        });
                    }
                });
            });
            return results;
        }""",
        [tbody_class, row_class],
    )
    return links


async def switch_tab(page: Any, sel_yn: str) -> None:
    """판매중(Y)/판매중지(N) 탭으로 전환하고 로딩을 기다린다.

    판매중지 탭 클릭 시 JavaScript fnChangeContents('N') 호출.
    """
    if sel_yn == "N":
        # @MX:WARN: 판매중지 탭 전환 — JS 직접 호출. UI 클릭과 동일하게 동작해야 함.
        # @MX:REASON: Devon.js SPA에서 탭 전환은 fnChangeContents JS 함수 호출로만 처리됨.
        switched = await page.evaluate("""() => {
            if (typeof fnChangeContents !== "undefined") {
                fnChangeContents("N");
                return true;
            }
            // 대체: 탭 링크 직접 클릭
            const tabs = document.querySelectorAll("a, li");
            for (const el of tabs) {
                const text = (el.textContent || "").trim();
                const onclick = (el.getAttribute("onclick") || "");
                if (text === "판매중지상품" || onclick.includes('"N"') || onclick.includes("'N'")) {
                    el.click();
                    return true;
                }
            }
            return false;
        }""")
        if not switched:
            logger.warning("  판매중지 탭 전환 실패 — JS 함수 미발견")
        await asyncio.sleep(3)
    else:
        await asyncio.sleep(1)


async def collect_all_products(
    page: Any,
    sel_yn: str,
    sale_status: str,
) -> list[dict[str, Any]]:
    """판매중/판매중지 탭에서 수집 대상 전체 상품의 PDF 다운로드 정보를 모은다."""
    products: list[dict[str, Any]] = []
    seen_keys: set[tuple[str, str]] = set()

    for grp_code in TARGET_GROUP_CODES:
        # 상품구분 목록 로딩
        subs = await get_sub_groups(page, sel_yn, grp_code)
        logger.info("  상품군 %s: 상품구분 %d개", grp_code, len(subs))

        for sub in subs:
            sub_code = sub["sub_code"]
            sub_name = sub["name"]

            if not _is_target_sub(sub_code, sub_name):
                logger.debug("  상품구분 제외: %s (%s)", sub_name, sub_code)
                continue

            logger.info("  상품구분 처리: %s (%s)", sub_name, sub_code)

            # 상품명 목록 로딩
            pdt_list = await get_product_list(page, sel_yn, grp_code, sub_code)
            logger.info("    → 상품 %d개", len(pdt_list))

            for pdt in pdt_list:
                pdt_code = pdt["pdt_code"]
                pdt_name = pdt["name"]

                # PDF 링크 추출
                pdf_links = await get_pdf_links(page, pdt_code, sel_yn)

                for lnk in pdf_links:
                    key = (lnk["file_id"], lnk["a_file_seqn"])
                    if key in seen_keys:
                        continue
                    seen_keys.add(key)

                    products.append({
                        "product_name": pdt_name,
                        "product_code": pdt_code,
                        "sub_name": sub_name,
                        "sub_code": sub_code,
                        "file_id": lnk["file_id"],
                        "a_file_seqn": lnk["a_file_seqn"],
                        "pdf_title": lnk["title"],
                        "start_dt": lnk["start_dt"],
                        "end_dt": lnk["end_dt"],
                        "sale_status": sale_status,
                    })

                await asyncio.sleep(0.3)

        await asyncio.sleep(0.5)

    return products


async def download_pdf_via_playwright(
    page: Any,
    file_id: str,
    a_file_seqn: str,
) -> bytes | None:
    """Playwright download 이벤트로 PDF를 수신한다.

    fnFileDownload form submit을 트리거 후 다운로드 파일을 읽는다.

    # @MX:WARN: form.target="_blank" 필수 — 미설정 시 현재 페이지(공시 목록)가 덮어써짐
    # @MX:REASON: form.submit() without target navigates the main frame away from ANNOUNCE_URL
    """
    try:
        async with page.expect_download(timeout=40000) as dl_info:
            await page.evaluate(
                """([fileId, seqn]) => {
                    // 항상 새 form 생성: 기존 form 재사용 시 target 오염 가능
                    // target="_blank"로 현재 페이지(공시 목록) 보존
                    const form = document.createElement("form");
                    form.method = "POST";
                    form.action = "/imageView/downloadFile.ajax";
                    form.target = "_blank";
                    const i1 = document.createElement("input");
                    i1.type = "hidden"; i1.name = "oFileId"; i1.value = fileId;
                    const i2 = document.createElement("input");
                    i2.type = "hidden"; i2.name = "oAfileSeqn"; i2.value = seqn;
                    form.appendChild(i1);
                    form.appendChild(i2);
                    document.body.appendChild(form);
                    form.submit();
                    document.body.removeChild(form);
                }""",
                [file_id, a_file_seqn],
            )
        dl = await dl_info.value
        path = await dl.path()
        if path:
            data = Path(path).read_bytes()
            if data[:4] == b"%PDF" and len(data) > 1000:
                return data
    except Exception as e:
        logger.debug("  Playwright 다운로드 실패 (fileId=%s, seqn=%s): %s", file_id, a_file_seqn, e)
    return None


async def download_pdf_via_httpx(
    client: httpx.AsyncClient,
    file_id: str,
    a_file_seqn: str,
) -> bytes | None:
    """httpx POST로 직접 PDF를 다운로드한다. Playwright 방식 실패 시 폴백."""
    for method in ("POST", "GET"):
        try:
            if method == "POST":
                resp = await client.post(
                    DOWNLOAD_AJAX,
                    data={"oFileId": file_id, "oAfileSeqn": a_file_seqn},
                    timeout=httpx.Timeout(30.0, connect=10.0),
                )
            else:
                resp = await client.get(
                    DOWNLOAD_AJAX,
                    params={"oFileId": file_id, "oAfileSeqn": a_file_seqn},
                    timeout=httpx.Timeout(30.0, connect=10.0),
                )
            if resp.status_code == 200:
                content = resp.content
                if content[:4] == b"%PDF" and len(content) > 1000:
                    return content
        except Exception as e:
            logger.debug("  httpx %s 실패 (fileId=%s): %s", method, file_id, e)
    return None


async def main(dry_run: bool = False) -> None:
    """메인 크롤링 로직."""
    from collections import Counter

    from playwright.async_api import async_playwright

    logger.info("=" * 60)
    logger.info("%s 약관 크롤링 시작%s", COMPANY_NAME, " (DRY RUN)" if dry_run else "")
    logger.info("공시 URL: %s", ANNOUNCE_URL)
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
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
        )
        page = await context.new_page()

        # 1단계: 공시 페이지 로딩
        logger.info("[1/3] 공시 페이지 로딩...")
        await page.goto(ANNOUNCE_URL, timeout=60000, wait_until="networkidle")
        await asyncio.sleep(3)
        logger.info("  페이지 로딩 완료")

        # 2단계: 판매중 + 판매중지 탭 순회
        tab_configs = [
            ("Y", "ON_SALE", "판매중"),
            ("N", "DISCONTINUED", "판매중지"),
        ]

        for sel_yn, sale_status, tab_label in tab_configs:
            logger.info("[2/3] %s 상품 목록 수집 (탭: %s)...", sale_status, tab_label)

            # 탭 전환
            await switch_tab(page, sel_yn)

            try:
                tab_products = await collect_all_products(page, sel_yn, sale_status)
            except Exception as e:
                logger.error("  %s 탭 수집 오류: %s", tab_label, e)
                tab_products = []

            logger.info(
                "  [%s] %s: %d개 약관 항목",
                COMPANY_NAME, tab_label, len(tab_products),
            )
            all_products.extend(tab_products)
            await asyncio.sleep(1)

        # 통계 출력
        status_dist = Counter(p["sale_status"] for p in all_products)
        sub_dist = Counter(p.get("sub_name", "") for p in all_products)

        logger.info("[%s] 전체 %d개 약관 항목 수집", COMPANY_NAME, len(all_products))
        logger.info("  판매상태: %s", dict(status_dist))
        logger.info("  상품구분: %s", dict(sub_dist))

        if dry_run:
            for p in all_products:
                logger.info(
                    "  [DRY] [%s] %s (%s, fileId=%s, seqn=%s)",
                    p["sale_status"],
                    p["product_name"][:55],
                    p["sub_name"],
                    p["file_id"],
                    p["a_file_seqn"],
                )
            logger.info("DRY RUN 완료. 실제 다운로드 없음.")
            await browser.close()
            return

        # 3단계: PDF 다운로드
        logger.info("[3/3] PDF 다운로드 시작 (총 %d개)...", len(all_products))

        # 브라우저 쿠키 추출 (jsessionid 포함)
        browser_cookies = await context.cookies()
        cookie_dict = {c["name"]: c["value"] for c in browser_cookies}

        async with httpx.AsyncClient(
            headers=HEADERS,
            cookies=cookie_dict,
            follow_redirects=True,
            timeout=httpx.Timeout(30.0),
        ) as client:
            total = len(all_products)
            for i, prod in enumerate(all_products):
                name = prod["product_name"]
                code = prod["product_code"]
                file_id = prod["file_id"]
                a_file_seqn = prod["a_file_seqn"]
                prod_status = prod["sale_status"]
                category = _infer_category(name, prod.get("sub_name", ""))
                source_url = f"{DOWNLOAD_AJAX}?oFileId={file_id}&oAfileSeqn={a_file_seqn}"

                try:
                    # Playwright form 방식 우선
                    data = await download_pdf_via_playwright(page, file_id, a_file_seqn)

                    # 실패 시 httpx 폴백
                    if data is None:
                        # 쿠키 갱신
                        fresh_cookies = await context.cookies()
                        client.cookies.update({c["name"]: c["value"] for c in fresh_cookies})
                        data = await download_pdf_via_httpx(client, file_id, a_file_seqn)

                    if data is not None:
                        result = save_pdf(data, name, code, category, source_url, prod_status)
                        if result.get("skipped"):
                            skipped += 1
                            if result.get("meta_updated"):
                                meta_updated += 1
                        else:
                            downloaded += 1
                    else:
                        logger.warning(
                            "  [FAIL] PDF 없음: %s (fileId=%s)", name[:40], file_id
                        )
                        failed += 1

                except Exception as e:
                    logger.error("  [ERROR] %s: %s", name[:40], e)
                    failed += 1

                # 서버 부하 방지
                await asyncio.sleep(0.5)

                if (i + 1) % 50 == 0:
                    logger.info(
                        "  진행: %d/%d 처리 (다운:%d, 스킵:%d, 실패:%d)",
                        i + 1, total, downloaded, skipped, failed,
                    )

        await browser.close()

    logger.info("=" * 60)
    logger.info(
        "%s 크롤링 완료: %d 다운로드, %d 스킵(%d 메타갱신), %d 실패 (총 %d)",
        COMPANY_NAME, downloaded, skipped, meta_updated, failed, len(all_products),
    )
    logger.info("=" * 60)

    report_path = BASE_DATA_DIR / "nh_fire_report.json"
    report: dict[str, Any] = {
        "company_id": COMPANY_ID,
        "company_name": COMPANY_NAME,
        "crawled_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "dry_run": dry_run,
        "total_target": len(all_products),
        "downloaded": downloaded,
        "skipped": skipped,
        "meta_updated": meta_updated,
        "failed": failed,
        "by_status": dict(Counter(p["sale_status"] for p in all_products)),
        "by_category": dict(
            Counter(
                _infer_category(p["product_name"], p.get("sub_name", ""))
                for p in all_products
            )
        ),
    }
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    logger.info("리포트: %s", report_path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="NH농협손해보험 약관 크롤러")
    parser.add_argument("--dry-run", action="store_true", help="PDF 다운로드 없이 목록만 출력")
    args = parser.parse_args()
    asyncio.run(main(dry_run=args.dry_run))
