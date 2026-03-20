#!/usr/bin/env python3
"""생명보험사 Playwright 기반 약관 PDF 크롤러 (판매중지 상품 포함)

22개 생명보험사 웹사이트에서 현재 판매 중인 상품과 판매중지 상품의
보험약관 PDF를 모두 수집한다.

실행:
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_life_insurance
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_life_insurance --company samsung_life
    cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_life_insurance --dry-run

# @MX:NOTE: 각 생명보험사는 자체 약관공시 시스템을 운영하며, API 구조가 각기 다름
# @MX:NOTE: 판매중지 상품은 saleYn=N, saleStat=N, prodStatus=02, endYn=Y 등 다양한 파라미터로 구분
# @MX:WARN: 일부 보험사는 JS 렌더링 필요, 일부는 REST API 직접 호출 가능
# @MX:REASON: SPA 기반 보험사 사이트는 Playwright 없이 약관 목록 수집 불가
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse, urlencode

if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)

# 현재 스크립트 기준으로 경로 설정
SCRIPT_DIR = Path(__file__).parent
BASE_DATA_DIR = SCRIPT_DIR.parent / "data"

# 페이지 로딩 대기 시간 (ms)
PAGE_TIMEOUT = 30_000
NETWORK_IDLE_TIMEOUT = 15_000

# 크롤링 대상 생명보험사 설정
# @MX:NOTE: folder 키는 BASE_DATA_DIR 하위 저장 디렉토리명
COMPANY_CONFIG: dict[str, dict[str, Any]] = {
    "samsung_life": {
        "name": "삼성생명",
        "url": "https://www.samsunglife.com",
        "folder": "samsung_life",
    },
    "kyobo_life": {
        "name": "교보생명",
        "url": "https://www.kyobo.com",
        "folder": "kyobo_life",
    },
    "hanwha_life": {
        "name": "한화생명",
        "url": "https://www.hanwhalife.com",  # hanwha-life.co.kr은 DNS 실패, 올바른 도메인
        "folder": "hanwha_life",
    },
    "shinhan_life": {
        "name": "신한라이프",
        "url": "https://www.shinhanlife.co.kr",
        "folder": "shinhan_life",
    },
    "heungkuk_life": {
        "name": "흥국생명",
        "url": "https://www.heungkuklife.co.kr",
        "folder": "heungkuk_life",
    },
    "dongyang_life": {
        "name": "동양생명",
        "url": "https://www.myangel.co.kr",
        "folder": "dongyang_life",
    },
    "mirae_life": {
        "name": "미래에셋생명",
        "url": "https://www.miraeassetlife.co.kr",
        "folder": "mirae_life",
    },
    "nh_life": {
        "name": "NH농협생명",
        "url": "https://www.nhlife.co.kr",
        "folder": "nh",
    },
    "db_life": {
        "name": "DB생명",
        "url": "https://www.db-lifeinsurance.com",
        "folder": "db",
    },
    "kdb_life": {
        "name": "KDB생명",
        "url": "https://www.kdblife.co.kr",
        "folder": "kdb",
    },
    "hana_life": {
        "name": "하나생명",
        "url": "https://www.hanainsure.co.kr/life",  # hanalife.co.kr은 hanainsure.co.kr/life로 리다이렉트됨
        "folder": "hana_life",
    },
    "aia_life": {
        "name": "AIA생명",
        "url": "https://www.aia.co.kr",
        "folder": "aia",
    },
    "metlife": {
        "name": "메트라이프생명",
        "url": "https://www.metlife.co.kr",
        "folder": "metlife",
    },
    "lina_life": {
        "name": "라이나생명",
        "url": "https://www.lina.co.kr",
        "folder": "lina_life",
    },
    "abl_life": {
        "name": "ABL생명",
        "url": "https://www.abllife.co.kr",
        "folder": "abl",
    },
    "fubon_hyundai_life": {
        "name": "푸본현대생명",
        "url": "https://www.fubonhyundai.com",
        "folder": "fubon_hyundai_life",
    },
    "kb_life": {
        "name": "KB라이프",
        "url": "https://www.kblife.co.kr",  # kblifeinsurance.com은 DNS 실패
        "folder": "kb_life",
    },
    "im_life": {
        "name": "iM라이프",
        "url": "https://www.imlife.co.kr",
        "folder": "im_life",
    },
    "ibk_life": {
        "name": "IBK연금보험",
        "url": "https://www.ibkannuity.co.kr",
        "folder": "ibk",
    },
    "chubb_life": {
        "name": "처브라이프",
        "url": "https://www.chubblife.co.kr",  # chubb.com/kr-ko는 404, 한국 법인 도메인
        "folder": "chubb_life",
    },
    "bnp_life": {
        "name": "BNP파리바카디프",
        "url": "https://www.cardif.co.kr",
        "folder": "bnp_life",
    },
    "kyobo_lifeplanet": {
        "name": "교보라이프플래닛",
        "url": "https://www.lifeplanet.co.kr",
        "folder": "kyobo_lifeplanet",
    },
}


# =============================================================================
# 공통 유틸리티
# =============================================================================

def _slugify(text: str) -> str:
    """텍스트를 파일시스템 안전 문자열로 변환한다."""
    text = text.strip()
    safe = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", text)
    safe = safe.strip(".").strip()
    return safe[:80] or "unknown"


def save_pdf(
    data: bytes,
    company_id: str,
    company_name: str,
    product_name: str,
    product_type: str,
    source_url: str,
    sale_status: str = "판매중지",
    dry_run: bool = False,
) -> dict[str, Any]:
    """PDF 파일을 저장하고 메타데이터 JSON 파일을 생성한다.

    # @MX:ANCHOR: 모든 생명보험사 크롤러가 사용하는 PDF 저장 핵심 함수
    # @MX:REASON: 각 회사별 크롤러 함수에서 직접 호출됨 (fan_in >= 5)
    """
    import hashlib
    from datetime import datetime, timezone

    folder = COMPANY_CONFIG.get(company_id, {}).get("folder", company_id)
    company_dir = BASE_DATA_DIR / folder
    company_dir.mkdir(parents=True, exist_ok=True)

    safe_name = _slugify(product_name)
    file_hash = hashlib.sha256(data).hexdigest()
    file_name = f"{safe_name}.pdf"
    file_path = company_dir / file_name

    # 기존 파일 동일성 확인
    if file_path.exists():
        existing_hash = hashlib.sha256(file_path.read_bytes()).hexdigest()
        if existing_hash == file_hash:
            logger.info("  [중복 스킵] %s (동일 파일 존재)", file_name)
            return {"skipped": True, "file_path": str(file_path)}
        file_name = f"{safe_name}_{file_hash[:8]}.pdf"
        file_path = company_dir / file_name

    if dry_run:
        logger.info("  [DRY-RUN] 저장 예정: %s", file_name)
        return {"dry_run": True, "file_path": str(file_path)}

    file_path.write_bytes(data)

    metadata = {
        "company_id": company_id,
        "company_name": company_name,
        "product_name": product_name,
        "product_type": product_type,
        "sale_status": sale_status,
        "source_url": source_url,
        "file_path": f"{folder}/{file_name}",
        "file_hash": f"sha256:{file_hash}",
        "crawled_at": datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+09:00"),
        "file_size_bytes": len(data),
    }

    meta_path = file_path.with_suffix(".json")
    meta_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")

    logger.info("  [저장완료] %s (%d bytes, %s)", file_name, len(data), sale_status)
    return {"file_path": str(file_path), "metadata": metadata}


def file_already_exists(company_id: str, product_name: str) -> bool:
    """해당 상품의 PDF가 이미 저장되어 있는지 확인한다 (크롤 재시작 지원)."""
    folder = COMPANY_CONFIG.get(company_id, {}).get("folder", company_id)
    company_dir = BASE_DATA_DIR / folder
    safe_name = _slugify(product_name)
    # 기본 파일명 또는 해시 suffix 파일이 있으면 True
    return any(company_dir.glob(f"{safe_name}*.pdf"))


async def download_pdf_bytes(url: str, context: Any) -> bytes | None:
    """Playwright context를 통해 PDF를 다운로드한다."""
    try:
        page = await context.new_page()
        try:
            response = await page.request.get(url, timeout=30_000)
            if response.ok:
                return await response.body()
            logger.warning("  PDF 다운로드 실패 (status=%d): %s", response.status, url)
            return None
        finally:
            await page.close()
    except Exception as exc:
        logger.warning("  PDF 다운로드 오류: %s -> %s", url, exc)
        return None


# =============================================================================
# 삼성생명 크롤러
# @MX:NOTE: API POST /gw/api/product/disclosure/product/prdt/salesAllPrdtList
# @MX:NOTE: 직접 POST 불가 - $http 인터셉터가 파라미터를 AES 암호화(g, b 필드)하기 때문
# @MX:NOTE: Vue 컴포넌트 apiInsuPrdtSalesAllList 메서드를 직접 호출하여 응답 인터셉트
# @MX:NOTE: lCode 필드: "판매중지" / "판매중" 구분 (전체 6481개)
# @MX:NOTE: PDF: https://pcms.samsunglife.com/uploadDir/doc/{year}/{mmdd}/{goodsCode}/301/{filename3}.pdf
# =============================================================================

def _samsung_pdf_url(goods_code: str, filename: str, doc_type: str = "301") -> str:
    """삼성생명 PDF 직접 다운로드 URL을 구성한다.

    # @MX:NOTE: filename은 Unix timestamp(ms) 형식 - 날짜 경로로 변환
    # @MX:NOTE: doc_type: "301"=보험약관, "401"=사업방법서, "101"=상품요약서
    """
    import datetime
    try:
        ts_sec = int(filename) / 1000.0
        dt = datetime.datetime.fromtimestamp(ts_sec, tz=datetime.timezone.utc)
        year = dt.strftime("%Y")
        mmdd = dt.strftime("%m%d")
        return (
            f"https://pcms.samsunglife.com/uploadDir/doc"
            f"/{year}/{mmdd}/{goods_code}/{doc_type}/{filename}.pdf"
        )
    except (ValueError, OSError):
        return ""


async def crawl_samsung_life(context: Any, dry_run: bool = False) -> int:
    """삼성생명 약관 PDF를 수집한다.

    # @MX:NOTE: API POST /gw/api/product/disclosure/product/prdt/salesAllPrdtList
    # @MX:NOTE: 직접 POST 불가 - AES 암호화 파라미터(g, b) 필요
    # @MX:ANCHOR: Vue 컴포넌트 apiInsuPrdtSalesAllList 메서드를 직접 호출하여 응답 인터셉트
    # @MX:REASON: 삼성생명 API는 $http 인터셉터로 요청 파라미터를 AES 암호화하므로
    #             직접 POST 호출 불가 - 브라우저 내 Vue 메서드를 통해 우회
    # @MX:NOTE: 전체 6481개 판매중지 포함, 보험약관(filename3/docType=301) 수집
    """
    company_id = "samsung_life"
    company_name = "삼성생명"
    downloaded = 0

    target_page_url = (
        "https://www.samsunglife.com"
        "/individual/products/disclosure/sales/PDO-PRPRI010110M"
    )

    page = await context.new_page()

    # API 응답 인터셉트 버퍼
    response_buffer: list[dict] = []

    async def _capture_response(response: Any) -> None:
        """salesAllPrdtList 응답을 버퍼에 적재한다."""
        if "salesAllPrdtList" not in response.url or response.status != 200:
            return
        try:
            body = await response.body()
            data = json.loads(body.decode("utf-8", errors="ignore"))
            if data.get("code") == "200" and data.get("response"):
                response_buffer.append(data)
        except Exception:
            pass

    page.on("response", _capture_response)

    try:
        logger.info("[삼성생명] 약관공시 페이지 로딩 (Vue 초기화)...")
        try:
            await page.goto(target_page_url, timeout=60_000, wait_until="networkidle")
            await asyncio.sleep(8)
        except Exception as exc:
            logger.warning("[삼성생명] 초기 페이지 로드 실패: %s", exc)

        # 초기 응답으로 totalRows 파악
        total_rows: int | None = None
        if response_buffer:
            first_items = response_buffer[0].get("response", [])
            if first_items:
                total_rows = int(first_items[0].get("totalRows", 0))
                logger.info("[삼성생명] 전체 상품 수: %d개", total_rows)

        if total_rows is None:
            logger.warning("[삼성생명] 초기 응답 없음 - 페이지 로드 실패")
            return 0

        # Vue 메서드 호출용 JS 헬퍼
        find_vue_js = """
            function findVueByMethod(el, methodName, depth) {
                if (depth > 20) return null;
                if (el.__vue__ && el.__vue__.$options.methods &&
                    el.__vue__.$options.methods[methodName]) {
                    return el.__vue__;
                }
                for (const c of el.children || []) {
                    const v = findVueByMethod(c, methodName, depth + 1);
                    if (v) return v;
                }
                return null;
            }
        """

        page_size = 100
        page_no = 1  # 1페이지는 이미 버퍼에 존재

        # 1페이지 데이터 처리 (초기 로드 시 응답 캡처됨)
        # pageLength=100으로 변경하여 재수집 시작
        response_buffer.clear()
        try:
            await page.evaluate(f"""
                async () => {{
                    {find_vue_js}
                    const vue = findVueByMethod(document.body, 'apiInsuPrdtSalesAllList', 0);
                    if (!vue) return false;
                    vue.$data.pageLength = {page_size};
                    vue.$data.tab1CurrentPage = 0;
                    vue.apiInsuPrdtSalesAllList();
                    return true;
                }}
            """)
            await asyncio.sleep(3)
        except Exception as exc:
            logger.warning("[삼성생명] Vue 초기 호출 실패: %s", exc)

        while True:
            # 현재 페이지 응답 대기
            waited = 0
            while not response_buffer and waited < 10:
                await asyncio.sleep(1)
                waited += 1

            if not response_buffer:
                logger.warning("[삼성생명] 페이지 %d 응답 없음 - 중단", page_no)
                break

            current_data = response_buffer.pop(0)
            items: list[dict] = current_data.get("response") or []

            if not items:
                break

            logger.info("[삼성생명] 페이지 %d 처리 중 (%d개)...", page_no, len(items))

            for item in items:
                goods_code: str = item.get("goodsCode") or ""
                goods_name: str = item.get("goodsName") or ""
                filename3: str = item.get("filename3") or ""
                from_date: str = item.get("fromdate") or ""
                l_code: str = item.get("lCode") or ""
                # 판매중지 포함 전체 수집 (lCode: "판매중지" / "판매중")
                sale_status = "판매중지" if l_code == "판매중지" else "판매중"

                if not goods_code or not goods_name or not filename3:
                    continue

                # 상품명에 날짜 suffix 추가 (중복 방지)
                unique_name = f"{goods_name}_{from_date}" if from_date else goods_name

                if file_already_exists(company_id, unique_name):
                    continue

                pdf_url = _samsung_pdf_url(goods_code, filename3, "301")
                if not pdf_url:
                    continue

                pdf_data = await download_pdf_bytes(pdf_url, context)
                if pdf_data:
                    result = save_pdf(
                        pdf_data, company_id, company_name,
                        unique_name, "생명보험", pdf_url, sale_status, dry_run,
                    )
                    if not result.get("skipped") and not result.get("dry_run"):
                        downloaded += 1
                    await asyncio.sleep(0.5)

            # 다음 페이지 여부 확인
            if page_no * page_size >= total_rows:
                break

            page_no += 1

            # 다음 페이지 Vue 메서드 호출
            try:
                await page.evaluate(f"""
                    async () => {{
                        {find_vue_js}
                        const vue = findVueByMethod(document.body, 'apiInsuPrdtSalesAllList', 0);
                        if (!vue) return false;
                        vue.$data.pageLength = {page_size};
                        vue.$data.tab1CurrentPage = {page_no - 1};
                        vue.apiInsuPrdtSalesAllList();
                        return true;
                    }}
                """)
                await asyncio.sleep(2)
            except Exception as exc:
                logger.warning("[삼성생명] 페이지 %d Vue 호출 실패: %s", page_no, exc)
                break

    finally:
        await page.close()

    logger.info("[삼성생명] 총 %d개 수집", downloaded)
    return downloaded


# =============================================================================
# 교보생명 크롤러
# @MX:NOTE: 전체상품조회 API: POST /dtc/product-official/find-allProductSearch
# @MX:NOTE: saleYn 파라미터: Y (판매중), N (판매중지), pageNo/pageSize 페이지네이션
# @MX:NOTE: PDF 다운로드: GET /file/ajax/download?fName=/dtc/pdf/mm/{a2_filename}
# @MX:NOTE: Referer: https://www.kyobo.com/dgt/web/product-official/all-product/search 필요
# =============================================================================

def _kyobo_pdf_url(a2_filename: str) -> str:
    """교보생명 PDF 다운로드 URL을 구성한다.

    # @MX:NOTE: a2 필드 = temp02 필드 = 저장된 파일명 (타임스탬프 prefix 포함)
    # @MX:NOTE: URL 패턴: /file/ajax/download?fName=/dtc/pdf/mm/{filename}
    """
    from urllib.parse import quote
    encoded = quote(a2_filename, safe="")
    return f"https://www.kyobo.com/file/ajax/download?fName=/dtc/pdf/mm/{encoded}"


async def crawl_kyobo_life(context: Any, dry_run: bool = False) -> int:
    """교보생명 약관 PDF를 수집한다.

    # @MX:NOTE: 전체상품조회 페이지 방문 후 세션 쿠키 확보 필요
    # @MX:NOTE: API는 POST 방식, pageSize=100으로 페이지네이션
    """
    company_id = "kyobo_life"
    company_name = "교보생명"
    downloaded = 0

    list_api_url = "https://www.kyobo.com/dtc/product-official/find-allProductSearch"
    referer_url = "https://www.kyobo.com/dgt/web/product-official/all-product/search"
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "Referer": referer_url,
        "Origin": "https://www.kyobo.com",
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        ),
    }

    page = await context.new_page()

    try:
        # 세션 쿠키 확보를 위해 전체상품조회 페이지 먼저 방문
        logger.info("[교보생명] 전체상품조회 페이지 로딩 (세션 초기화)...")
        try:
            await page.goto(referer_url, timeout=60_000, wait_until="networkidle")
            await asyncio.sleep(5)
        except Exception as exc:
            logger.warning("[교보생명] 초기 페이지 로드 실패: %s", exc)

        # 전체 목록 페이지네이션 수집 (saleYn 미지정 = 전체, 판매중+판매중지 모두)
        page_no = 1
        page_size = 100
        total_rows: int | None = None

        while True:
            try:
                req_body = json.dumps({
                    "pageNo": page_no,
                    "pageSize": page_size,
                })
                resp = await page.request.post(
                    list_api_url,
                    data=req_body,
                    headers=headers,
                    timeout=30_000,
                )
                if not resp.ok:
                    logger.warning("[교보생명] 목록 API 응답 오류 (status=%d)", resp.status)
                    break

                body = await resp.body()
                data = json.loads(body.decode("utf-8", errors="ignore"))

                if data.get("header", {}).get("code") != "SUCCESS":
                    logger.warning(
                        "[교보생명] API 실패 응답: %s",
                        data.get("header", {}).get("message"),
                    )
                    break

                body_data = data.get("body", {})
                items: list[dict] = body_data.get("list") or []
                if not items:
                    break

                if total_rows is None:
                    total_rows = int(body_data.get("listCnt", 0))
                    logger.info("[교보생명] 전체 상품 수: %d개", total_rows)

                logger.info(
                    "[교보생명] 페이지 %d 처리 중 (%d개)...", page_no, len(items)
                )

                for item in items:
                    seq_id: str = str(item.get("dgtPdtAtrSeqtId") or "")
                    product_name: str = item.get("dgtPdtAtrNm") or ""
                    a2: str = item.get("a2") or ""
                    sale_yn: str = item.get("saleYn") or "N"

                    if not seq_id or not product_name or not a2:
                        continue

                    sale_status = "판매중" if sale_yn == "Y" else "판매중지"

                    # 상품명 + seq_id 로 중복 방지 (동일 상품명 다른 버전 존재 가능)
                    unique_name = f"{product_name}_{seq_id}"

                    if file_already_exists(company_id, unique_name):
                        continue

                    pdf_url = _kyobo_pdf_url(a2)
                    pdf_data = await download_pdf_bytes(pdf_url, context)
                    if pdf_data:
                        result = save_pdf(
                            pdf_data, company_id, company_name,
                            unique_name, "생명보험", pdf_url, sale_status, dry_run,
                        )
                        if not result.get("skipped") and not result.get("dry_run"):
                            downloaded += 1
                        await asyncio.sleep(0.3)

                # 다음 페이지 여부 확인
                page_info = body_data.get("pageInfo", {})
                tot_cnt = int(page_info.get("totLstCnt", total_rows or 0))
                if page_no * page_size >= tot_cnt:
                    break
                page_no += 1

            except Exception as exc:
                logger.warning("[교보생명] 페이지 %d 처리 오류: %s", page_no, exc)
                break

    finally:
        await page.close()

    logger.info("[교보생명] 총 %d개 수집", downloaded)
    return downloaded


# =============================================================================
# 한화생명 크롤러
# @MX:NOTE: 한화생명은 REST API 방식으로 약관 목록 제공
# @MX:NOTE: 엔드포인트: /api/v1/terms/list, saleStat 파라미터로 판매중지 구분
# =============================================================================

async def crawl_hanwha_life(context: Any, dry_run: bool = False) -> int:
    """한화생명 약관 PDF를 수집한다.

    # @MX:ANCHOR: 한화생명 약관 수집 진입점
    # @MX:REASON: XHR 인터셉트 방식으로 CSRF 우회 - fetch() 직접 호출 시 빈 목록 반환
    # @MX:NOTE: 도메인: hanwhalife.com (hanwhalifeinsurance.co.kr, hanwha-life.co.kr 모두 DNS 실패)
    # @MX:NOTE: SSL legacy renegotiation으로 page.request 직접 호출 불가
    # @MX:NOTE: 1단계) 페이지 로드 시 on_response로 getList.do XHR 캡처 → list2: [{IDX, GOODS_NAME}]
    # @MX:NOTE: 2단계) ck-search2 클릭으로 getList3.do XHR 유발
    #           → list3: [{GOODS_NAME, FILE_NAME1..FILE_NAME4, SELL_END_DT}]
    # @MX:NOTE: 3단계) ck-fileDownload 클릭으로 download_chk.asp XHR 유발 →  실제 PDF 바이트
    # @MX:NOTE: 판매중지 상품은 ck-search1 (.SELL_TYPE=SB 필터) 클릭 후 추가 수집
    """
    company_id = "hanwha_life"
    company_name = "한화생명"
    downloaded = 0

    # XHR 캡처용 딕셔너리
    xhr_cache: dict[str, bytes] = {}

    async def on_response(response: Any) -> None:
        url = response.url
        ct = response.headers.get("content-type", "")
        if "json" in ct and "goodslist" in url:
            try:
                body = await response.body()
                xhr_cache[url] = body
            except Exception:
                pass

    page = await context.new_page()
    page.on("response", on_response)

    async def _get_list3_for_idx(idx: int) -> list[dict]:
        """IDX에 해당하는 약관 파일 목록을 DOM 클릭으로 가져온다.

        # @MX:NOTE: fetch() 직접 호출 시 서버가 CSRF 검증으로 빈 목록 반환.
        # @MX:NOTE: .ck-search2[data-idx] DOM 클릭 방식만 정상 작동.
        # @MX:NOTE: 페이지에 보이지 않는 항목(다른 탭/페이지)은 클릭 불가 → 탭 전환 후 수집.
        """
        list3_full_url = "https://www.hanwhalife.com/main/disclosure/goods/goodslist/getList3.do"
        xhr_cache.pop(list3_full_url, None)
        try:
            link = await page.query_selector(f'.ck-search2[data-idx="{idx}"]')
            if link:
                await link.click()
                for _ in range(20):
                    await asyncio.sleep(0.3)
                    if list3_full_url in xhr_cache:
                        break
        except Exception:
            pass
        raw = xhr_cache.get(list3_full_url, b"")
        if not raw:
            return []
        try:
            data = json.loads(raw.decode("utf-8", errors="ignore"))
            return data.get("list3", [])
        except Exception:
            return []

    try:
        base_url = "https://www.hanwhalife.com"
        file_base = "https://file.hanwhalife.com"
        terms_page = (
            f"{base_url}/main/disclosure/goods/disclosurenotice/"
            "DF_GDDN000_P10000.do?MENU_ID1=DF_GDGL000"
        )

        logger.info("[한화생명] 약관공시 페이지 로딩...")
        await page.goto(terms_page, timeout=PAGE_TIMEOUT, wait_until="networkidle")
        await asyncio.sleep(5)

        # 1단계: 페이지 로드 시 자동 발생하는 getList.do XHR에서 상품 목록 캡처
        getlist_url = f"{base_url}/main/disclosure/goods/goodslist/getList.do"
        raw_list = xhr_cache.get(getlist_url, b"")
        goods_items: list[dict] = []
        sell_type_items: list[dict] = []

        if raw_list:
            try:
                list_data = json.loads(raw_list.decode("utf-8", errors="ignore"))
                goods_items = list_data.get("list2", [])
                sell_type_items = list_data.get("list1", [])  # 판매유형 목록
            except Exception:
                pass

        logger.info("[한화생명] 초기 상품 목록 %d개, 판매유형 %d개", len(goods_items), len(sell_type_items))

        # 판매유형별로 상품 목록을 수집하고, 각 탭이 활성화된 상태에서 바로 list3를 수집한다.
        # @MX:NOTE: ck-search2[data-idx] 클릭은 현재 DOM에 보이는 상품만 작동한다.
        # @MX:NOTE: 판매유형 탭 전환 시 DOM이 교체되므로 탭별로 즉시 list3를 수집해야 한다.

        # 수집된 모든 (goods_item, file_entries) 쌍
        all_entries: list[tuple[dict, list[dict]]] = []

        async def _collect_entries_for_current_tab(items: list[dict]) -> None:
            """현재 DOM에 표시된 상품 목록에서 list3를 수집한다."""
            for item in items:
                idx = item.get("IDX")
                if not idx:
                    continue
                file_entries = await _get_list3_for_idx(idx)
                if file_entries:
                    all_entries.append((item, file_entries))
                else:
                    logger.debug("[한화생명] IDX=%s list3 없음", idx)

        # SA(판매중) 상품 - 초기 로드 상태에서 수집
        if goods_items:
            logger.info("[한화생명] SA(판매중) 상품 %d개 list3 수집 중...", len(goods_items))
            await _collect_entries_for_current_tab(goods_items)

        # 다른 판매유형 클릭 → DOM 교체 후 즉시 수집
        seen_idx: set = {item.get("IDX") for item in goods_items if item.get("IDX")}

        for sell_type_item in sell_type_items:
            sell_type = sell_type_item.get("SELL_TYPE", "")
            goods_type = sell_type_item.get("GOODS_TYPE", "")
            if sell_type == "SA":
                continue

            xhr_cache.pop(getlist_url, None)
            try:
                link = await page.query_selector(
                    f'.ck-search1[data-sellType="{sell_type}"][data-goodsType="{goods_type}"]'
                )
                if not link:
                    continue
                await link.click()
                for _ in range(20):
                    await asyncio.sleep(0.3)
                    if getlist_url in xhr_cache:
                        break
                raw = xhr_cache.get(getlist_url, b"")
                if not raw:
                    continue
                tab_data = json.loads(raw.decode("utf-8", errors="ignore"))
                tab_items = [
                    item for item in tab_data.get("list2", [])
                    if item.get("IDX") and item.get("IDX") not in seen_idx
                ]
                if tab_items:
                    logger.info("[한화생명] %s/%s 상품 %d개 list3 수집 중...", sell_type, goods_type, len(tab_items))
                    seen_idx.update(item.get("IDX") for item in tab_items)
                    await _collect_entries_for_current_tab(tab_items)
            except Exception as exc:
                logger.debug("[한화생명] sellType=%s 클릭 오류: %s", sell_type, exc)

        logger.info("[한화생명] 전체 약관 버전 그룹 %d개 수집", len(all_entries))

        # 2단계~3단계: 각 상품의 약관 파일 다운로드
        for goods_item, file_entries in all_entries:
            goods_name_raw = goods_item.get("GOODS_NAME", "")
            if not file_entries:
                continue

            for entry in file_entries:
                goods_name = entry.get("GOODS_NAME") or goods_name_raw
                sell_end = (entry.get("SELL_END_DT") or "").strip()
                sale_status = "판매중지" if sell_end else "판매중"

                # FILE_NAME1~4: 약관, 사업방법서, 상품설명서, 주요내용서
                for fn_key in ("FILE_NAME1", "FILE_NAME2", "FILE_NAME3", "FILE_NAME4"):
                    file_name = (entry.get(fn_key) or "").strip()
                    if not file_name:
                        continue

                    # 파일명 패턴: "{상품명}_{문서유형}_{날짜}.pdf"
                    stem = file_name
                    while stem.endswith(".pdf"):
                        stem = stem[:-4]
                    parts = stem.rsplit("_", 2)
                    doc_type = parts[-2] if len(parts) >= 3 else fn_key
                    product_name = f"{goods_name}_{doc_type}"

                    if file_already_exists(company_id, product_name):
                        continue

                    # ck-fileDownload 버튼 클릭으로 다운로드
                    # @MX:NOTE: download_chk.asp를 POST로 호출하며 XHR response body가 PDF 바이트
                    try:
                        dl_url = f"{file_base}/www/announce/goods/download_chk.asp"
                        xhr_cache.pop(dl_url, None)

                        # 버튼 렌더링 시 data-file 속성이 파일명임
                        pdf_btn = await page.query_selector(f'.ck-fileDownload[data-file="{file_name}"]')
                        if pdf_btn:
                            await pdf_btn.click()
                            await asyncio.sleep(2)

                        # download_chk.asp는 JSON이 아니라 바이너리 응답 → page.evaluate fetch로 직접 취득
                        pdf_data_arr = await page.evaluate("""async ([fileName, fileBase]) => {
                            const formData = new URLSearchParams();
                            formData.append('file_name', fileName);
                            try {
                                const resp = await fetch(
                                    fileBase + '/www/announce/goods/download_chk.asp',
                                    {
                                        method: 'POST',
                                        headers: {
                                            'Content-Type': 'application/x-www-form-urlencoded',
                                            'Referer': 'https://www.hanwhalife.com/'
                                        },
                                        body: formData.toString()
                                    }
                                );
                                if (!resp.ok) return null;
                                const buf = await resp.arrayBuffer();
                                const uint8 = new Uint8Array(buf);
                                if (uint8[0] !== 37 || uint8[1] !== 80) return null;
                                return Array.from(uint8);
                            } catch(e) { return null; }
                        }""", [file_name, file_base])

                        if pdf_data_arr:
                            pdf_bytes = bytes(pdf_data_arr)
                            pdf_url = f"{dl_url}?file_name={file_name}"
                            result = save_pdf(
                                pdf_bytes, company_id, company_name,
                                product_name, "생명보험", pdf_url, sale_status, dry_run
                            )
                            if not result.get("skipped") and not result.get("dry_run"):
                                downloaded += 1
                            await asyncio.sleep(0.5)
                        else:
                            logger.debug("[한화생명] PDF 없음: %s", file_name)

                    except Exception as exc:
                        logger.warning("[한화생명] PDF 오류 (%s): %s", file_name, exc)

            await asyncio.sleep(0.3)

    finally:
        await page.close()

    logger.info("[한화생명] 총 %d개 수집", downloaded)
    return downloaded


# =============================================================================
# 신한라이프 크롤러
# @MX:NOTE: 신한라이프는 Ajax 기반 API 사용
# @MX:NOTE: 약관공시: /api/public-info/terms/list, endYn=Y 파라미터
# =============================================================================

async def crawl_shinhan_life(context: Any, dry_run: bool = False) -> int:
    """신한라이프 약관 PDF를 수집한다."""
    company_id = "shinhan_life"
    company_name = "신한라이프"
    downloaded = 0
    api_calls: list[dict] = []

    async def on_response(response: Any) -> None:
        url = response.url
        if any(kw in url for kw in ["terms", "약관", "clause", "disclosure", "public", "공시"]):
            ct = response.headers.get("content-type", "")
            if "json" in ct or "javascript" in ct:
                try:
                    body = await response.body()
                    text = body.decode("utf-8", errors="ignore")
                    if len(text) > 200:
                        try:
                            data = json.loads(text)
                            api_calls.append({"url": url, "data": data})
                            logger.info("[신한라이프] API 탐지: %s", url)
                        except Exception:
                            pass
                except Exception:
                    pass

    page = await context.new_page()
    page.on("response", on_response)

    try:
        logger.info("[신한라이프] 약관공시 페이지 로딩...")
        terms_urls = [
            "https://www.shinhanlife.co.kr/hp/cdha1000.do",
            "https://www.shinhanlife.co.kr/hp/cmha1000.do",
            "https://www.shinhanlife.co.kr/customer/publicnotice/terms",
        ]

        for url in terms_urls:
            try:
                await page.goto(url, timeout=PAGE_TIMEOUT, wait_until="domcontentloaded")
                await asyncio.sleep(4)
                content = await page.content()
                if any(kw in content for kw in ["약관", "보험약관"]):
                    logger.info("[신한라이프] 약관 페이지 발견: %s", url)
                    break
            except Exception:
                continue

        await asyncio.sleep(5)

        # 신한라이프 알려진 API 엔드포인트
        direct_apis = [
            "https://www.shinhanlife.co.kr/api/public-info/terms/list?endYn=Y",
            "https://www.shinhanlife.co.kr/api/public-info/terms/list",
            "https://www.shinhanlife.co.kr/hp/api/terms/list",
        ]

        for api_url in direct_apis:
            try:
                resp = await page.request.get(
                    api_url,
                    headers={"Accept": "application/json", "Referer": "https://www.shinhanlife.co.kr"},
                    timeout=20_000,
                )
                if resp.ok:
                    body = await resp.body()
                    try:
                        data = json.loads(body.decode("utf-8", errors="ignore"))
                        api_calls.append({"url": api_url, "data": data})
                        logger.info("[신한라이프] 직접 API 성공: %s", api_url)
                        break
                    except Exception:
                        pass
            except Exception:
                pass

        for call in api_calls:
            try:
                data = call.get("data", {})
                items = _extract_list(data)
                logger.info("[신한라이프] 약관 목록 %d개 발견", len(items))

                for item in items:
                    product_name = _get_product_name(item)
                    pdf_url = _get_pdf_url(item, "https://www.shinhanlife.co.kr")
                    if not pdf_url or not product_name:
                        continue
                    sale_status = _detect_sale_status(item)

                    if file_already_exists(company_id, product_name):
                        continue

                    pdf_data = await download_pdf_bytes(pdf_url, context)
                    if pdf_data:
                        result = save_pdf(
                            pdf_data, company_id, company_name,
                            product_name, "생명보험", pdf_url, sale_status, dry_run
                        )
                        if not result.get("skipped") and not result.get("dry_run"):
                            downloaded += 1
                        await asyncio.sleep(1.0)

            except Exception as exc:
                logger.warning("[신한라이프] 처리 오류: %s", exc)

        if downloaded == 0 and not api_calls:
            logger.info("[신한라이프] API 미탐지, DOM 파싱 시도...")
            downloaded = await _crawl_by_dom_links(
                page, context, company_id, company_name,
                "https://www.shinhanlife.co.kr", dry_run
            )

    finally:
        await page.close()

    logger.info("[신한라이프] 총 %d개 수집", downloaded)
    return downloaded


# =============================================================================
# 흥국생명 크롤러
# @MX:NOTE: 흥국생명은 /consumer/terms/list.do 패턴 사용
# @MX:NOTE: 손보 흥국화재와 유사 구조 예상
# =============================================================================

async def crawl_heungkuk_life(context: Any, dry_run: bool = False) -> int:
    """흥국생명 약관 PDF를 수집한다."""
    company_id = "heungkuk_life"
    company_name = "흥국생명"
    downloaded = 0
    api_calls: list[dict] = []

    async def on_response(response: Any) -> None:
        url = response.url
        if any(kw in url for kw in ["terms", "약관", "clause", "disclosure", "공시"]):
            ct = response.headers.get("content-type", "")
            if "json" in ct or "javascript" in ct:
                try:
                    body = await response.body()
                    text = body.decode("utf-8", errors="ignore")
                    if len(text) > 200:
                        try:
                            data = json.loads(text)
                            api_calls.append({"url": url, "data": data})
                            logger.info("[흥국생명] API 탐지: %s", url)
                        except Exception:
                            pass
                except Exception:
                    pass

    page = await context.new_page()
    page.on("response", on_response)

    try:
        logger.info("[흥국생명] 약관공시 페이지 로딩...")
        terms_urls = [
            "https://www.heungkuklife.co.kr/consumer/terms/list.do",
            "https://www.heungkuklife.co.kr/customer/public/terms",
            "https://www.heungkuklife.co.kr/consumer/publicnotice/terms",
        ]

        for url in terms_urls:
            try:
                await page.goto(url, timeout=PAGE_TIMEOUT, wait_until="domcontentloaded")
                await asyncio.sleep(4)
                content = await page.content()
                if any(kw in content for kw in ["약관", "보험약관"]):
                    logger.info("[흥국생명] 약관 페이지 발견: %s", url)
                    break
            except Exception:
                continue

        await asyncio.sleep(5)

        # 판매중지 탭 클릭 시도
        for kw in ["판매중지", "과거약관", "판매종료"]:
            try:
                await page.evaluate(f"""
                    () => {{
                        const els = Array.from(document.querySelectorAll('a, button, li'));
                        for (const el of els) {{
                            if (el.textContent.trim().includes('{kw}')) {{
                                el.click();
                                return true;
                            }}
                        }}
                        return false;
                    }}
                """)
                await asyncio.sleep(3)
            except Exception:
                pass

        for call in api_calls:
            try:
                data = call.get("data", {})
                items = _extract_list(data)
                logger.info("[흥국생명] 약관 목록 %d개 발견", len(items))

                for item in items:
                    product_name = _get_product_name(item)
                    pdf_url = _get_pdf_url(item, "https://www.heungkuklife.co.kr")
                    if not pdf_url or not product_name:
                        continue
                    sale_status = _detect_sale_status(item)

                    if file_already_exists(company_id, product_name):
                        continue

                    pdf_data = await download_pdf_bytes(pdf_url, context)
                    if pdf_data:
                        result = save_pdf(
                            pdf_data, company_id, company_name,
                            product_name, "생명보험", pdf_url, sale_status, dry_run
                        )
                        if not result.get("skipped") and not result.get("dry_run"):
                            downloaded += 1
                        await asyncio.sleep(1.0)

            except Exception as exc:
                logger.warning("[흥국생명] 처리 오류: %s", exc)

        if downloaded == 0 and not api_calls:
            logger.info("[흥국생명] API 미탐지, DOM 파싱 시도...")
            downloaded = await _crawl_by_dom_links(
                page, context, company_id, company_name,
                "https://www.heungkuklife.co.kr", dry_run
            )

    finally:
        await page.close()

    logger.info("[흥국생명] 총 %d개 수집", downloaded)
    return downloaded


# =============================================================================
# 동양생명 크롤러 (myangel.co.kr)
# =============================================================================

async def crawl_dongyang_life(context: Any, dry_run: bool = False) -> int:
    """동양생명 약관 PDF를 수집한다."""
    company_id = "dongyang_life"
    company_name = "동양생명"
    downloaded = 0
    api_calls: list[dict] = []

    async def on_response(response: Any) -> None:
        url = response.url
        if any(kw in url for kw in ["terms", "약관", "clause", "공시"]):
            ct = response.headers.get("content-type", "")
            if "json" in ct or "javascript" in ct:
                try:
                    body = await response.body()
                    text = body.decode("utf-8", errors="ignore")
                    if len(text) > 200:
                        try:
                            data = json.loads(text)
                            api_calls.append({"url": url, "data": data})
                            logger.info("[동양생명] API 탐지: %s", url)
                        except Exception:
                            pass
                except Exception:
                    pass

    page = await context.new_page()
    page.on("response", on_response)

    try:
        logger.info("[동양생명] 약관공시 페이지 로딩...")
        terms_urls = [
            "https://www.myangel.co.kr/customer/termsConditions.do",
            "https://www.myangel.co.kr/consumer/publicnotice/terms",
            "https://www.myangel.co.kr/web/customer/publicinfo/terms",
        ]

        for url in terms_urls:
            try:
                await page.goto(url, timeout=PAGE_TIMEOUT, wait_until="domcontentloaded")
                await asyncio.sleep(4)
                content = await page.content()
                if any(kw in content for kw in ["약관", "보험약관"]):
                    logger.info("[동양생명] 약관 페이지 발견: %s", url)
                    break
            except Exception:
                continue

        await asyncio.sleep(5)

        for call in api_calls:
            try:
                data = call.get("data", {})
                items = _extract_list(data)
                for item in items:
                    product_name = _get_product_name(item)
                    pdf_url = _get_pdf_url(item, "https://www.myangel.co.kr")
                    if not pdf_url or not product_name:
                        continue
                    if file_already_exists(company_id, product_name):
                        continue
                    pdf_data = await download_pdf_bytes(pdf_url, context)
                    if pdf_data:
                        result = save_pdf(
                            pdf_data, company_id, company_name,
                            product_name, "생명보험", pdf_url, _detect_sale_status(item), dry_run
                        )
                        if not result.get("skipped") and not result.get("dry_run"):
                            downloaded += 1
                        await asyncio.sleep(1.0)
            except Exception as exc:
                logger.warning("[동양생명] 처리 오류: %s", exc)

        if downloaded == 0 and not api_calls:
            downloaded = await _crawl_by_dom_links(
                page, context, company_id, company_name,
                "https://www.myangel.co.kr", dry_run
            )

    finally:
        await page.close()

    logger.info("[동양생명] 총 %d개 수집", downloaded)
    return downloaded


# =============================================================================
# 미래에셋생명 크롤러
# =============================================================================

async def crawl_mirae_life(context: Any, dry_run: bool = False) -> int:
    """미래에셋생명 약관 PDF를 수집한다."""
    company_id = "mirae_life"
    company_name = "미래에셋생명"
    downloaded = 0
    api_calls: list[dict] = []

    async def on_response(response: Any) -> None:
        url = response.url
        if any(kw in url for kw in ["terms", "약관", "clause", "공시", "disclosure"]):
            ct = response.headers.get("content-type", "")
            if "json" in ct or "javascript" in ct:
                try:
                    body = await response.body()
                    text = body.decode("utf-8", errors="ignore")
                    if len(text) > 200:
                        try:
                            data = json.loads(text)
                            api_calls.append({"url": url, "data": data})
                            logger.info("[미래에셋생명] API 탐지: %s", url)
                        except Exception:
                            pass
                except Exception:
                    pass

    page = await context.new_page()
    page.on("response", on_response)

    try:
        logger.info("[미래에셋생명] 약관공시 페이지 로딩...")
        await page.goto(
            "https://www.miraeassetlife.co.kr/app/cstm/terms/selectTermsList.do",
            timeout=PAGE_TIMEOUT, wait_until="domcontentloaded"
        )
        await asyncio.sleep(5)

        for call in api_calls:
            try:
                data = call.get("data", {})
                items = _extract_list(data)
                for item in items:
                    product_name = _get_product_name(item)
                    pdf_url = _get_pdf_url(item, "https://www.miraeassetlife.co.kr")
                    if not pdf_url or not product_name:
                        continue
                    if file_already_exists(company_id, product_name):
                        continue
                    pdf_data = await download_pdf_bytes(pdf_url, context)
                    if pdf_data:
                        result = save_pdf(
                            pdf_data, company_id, company_name,
                            product_name, "생명보험", pdf_url, _detect_sale_status(item), dry_run
                        )
                        if not result.get("skipped") and not result.get("dry_run"):
                            downloaded += 1
                        await asyncio.sleep(1.0)
            except Exception as exc:
                logger.warning("[미래에셋생명] 처리 오류: %s", exc)

        if downloaded == 0 and not api_calls:
            downloaded = await _crawl_by_dom_links(
                page, context, company_id, company_name,
                "https://www.miraeassetlife.co.kr", dry_run
            )

    finally:
        await page.close()

    logger.info("[미래에셋생명] 총 %d개 수집", downloaded)
    return downloaded


# =============================================================================
# NH농협생명 크롤러
# =============================================================================

async def crawl_nh_life(context: Any, dry_run: bool = False) -> int:
    """NH농협생명 약관 PDF를 수집한다."""
    company_id = "nh_life"
    company_name = "NH농협생명"
    downloaded = 0
    api_calls: list[dict] = []

    async def on_response(response: Any) -> None:
        url = response.url
        if any(kw in url for kw in ["terms", "약관", "clause", "공시"]):
            ct = response.headers.get("content-type", "")
            if "json" in ct or "javascript" in ct:
                try:
                    body = await response.body()
                    text = body.decode("utf-8", errors="ignore")
                    if len(text) > 200:
                        try:
                            data = json.loads(text)
                            api_calls.append({"url": url, "data": data})
                            logger.info("[NH농협생명] API 탐지: %s", url)
                        except Exception:
                            pass
                except Exception:
                    pass

    page = await context.new_page()
    page.on("response", on_response)

    try:
        logger.info("[NH농협생명] 약관공시 페이지 로딩...")
        terms_urls = [
            "https://www.nhlife.co.kr/cs/publicinformation/terms",
            "https://www.nhlife.co.kr/terms/list.do",
            "https://www.nhlife.co.kr/consumer/publicnotice/terms",
        ]

        for url in terms_urls:
            try:
                await page.goto(url, timeout=PAGE_TIMEOUT, wait_until="domcontentloaded")
                await asyncio.sleep(4)
                content = await page.content()
                if any(kw in content for kw in ["약관", "보험약관"]):
                    logger.info("[NH농협생명] 약관 페이지 발견: %s", url)
                    break
            except Exception:
                continue

        await asyncio.sleep(5)

        for call in api_calls:
            try:
                data = call.get("data", {})
                items = _extract_list(data)
                for item in items:
                    product_name = _get_product_name(item)
                    pdf_url = _get_pdf_url(item, "https://www.nhlife.co.kr")
                    if not pdf_url or not product_name:
                        continue
                    if file_already_exists(company_id, product_name):
                        continue
                    pdf_data = await download_pdf_bytes(pdf_url, context)
                    if pdf_data:
                        result = save_pdf(
                            pdf_data, company_id, company_name,
                            product_name, "생명보험", pdf_url, _detect_sale_status(item), dry_run
                        )
                        if not result.get("skipped") and not result.get("dry_run"):
                            downloaded += 1
                        await asyncio.sleep(1.0)
            except Exception as exc:
                logger.warning("[NH농협생명] 처리 오류: %s", exc)

        if downloaded == 0 and not api_calls:
            downloaded = await _crawl_by_dom_links(
                page, context, company_id, company_name,
                "https://www.nhlife.co.kr", dry_run
            )

    finally:
        await page.close()

    logger.info("[NH농협생명] 총 %d개 수집", downloaded)
    return downloaded


# =============================================================================
# DB생명 크롤러
# =============================================================================

async def crawl_db_life(context: Any, dry_run: bool = False) -> int:
    """DB생명 약관 PDF를 수집한다."""
    company_id = "db_life"
    company_name = "DB생명"
    downloaded = 0
    api_calls: list[dict] = []

    async def on_response(response: Any) -> None:
        url = response.url
        if any(kw in url for kw in ["terms", "약관", "clause", "공시"]):
            ct = response.headers.get("content-type", "")
            if "json" in ct or "javascript" in ct:
                try:
                    body = await response.body()
                    text = body.decode("utf-8", errors="ignore")
                    if len(text) > 200:
                        try:
                            data = json.loads(text)
                            api_calls.append({"url": url, "data": data})
                            logger.info("[DB생명] API 탐지: %s", url)
                        except Exception:
                            pass
                except Exception:
                    pass

    page = await context.new_page()
    page.on("response", on_response)

    try:
        logger.info("[DB생명] 약관공시 페이지 로딩...")
        await page.goto(
            "https://www.db-lifeinsurance.com/consumer/publicInfo/terms/list",
            timeout=PAGE_TIMEOUT, wait_until="domcontentloaded"
        )
        await asyncio.sleep(5)

        for call in api_calls:
            try:
                data = call.get("data", {})
                items = _extract_list(data)
                for item in items:
                    product_name = _get_product_name(item)
                    pdf_url = _get_pdf_url(item, "https://www.db-lifeinsurance.com")
                    if not pdf_url or not product_name:
                        continue
                    if file_already_exists(company_id, product_name):
                        continue
                    pdf_data = await download_pdf_bytes(pdf_url, context)
                    if pdf_data:
                        result = save_pdf(
                            pdf_data, company_id, company_name,
                            product_name, "생명보험", pdf_url, _detect_sale_status(item), dry_run
                        )
                        if not result.get("skipped") and not result.get("dry_run"):
                            downloaded += 1
                        await asyncio.sleep(1.0)
            except Exception as exc:
                logger.warning("[DB생명] 처리 오류: %s", exc)

        if downloaded == 0 and not api_calls:
            downloaded = await _crawl_by_dom_links(
                page, context, company_id, company_name,
                "https://www.db-lifeinsurance.com", dry_run
            )

    finally:
        await page.close()

    logger.info("[DB생명] 총 %d개 수집", downloaded)
    return downloaded


# =============================================================================
# KDB생명 크롤러
# =============================================================================

async def crawl_kdb_life(context: Any, dry_run: bool = False) -> int:
    """KDB생명 약관 PDF를 수집한다."""
    company_id = "kdb_life"
    company_name = "KDB생명"
    downloaded = 0
    api_calls: list[dict] = []

    async def on_response(response: Any) -> None:
        url = response.url
        if any(kw in url for kw in ["terms", "약관", "clause", "공시"]):
            ct = response.headers.get("content-type", "")
            if "json" in ct or "javascript" in ct:
                try:
                    body = await response.body()
                    text = body.decode("utf-8", errors="ignore")
                    if len(text) > 200:
                        try:
                            data = json.loads(text)
                            api_calls.append({"url": url, "data": data})
                            logger.info("[KDB생명] API 탐지: %s", url)
                        except Exception:
                            pass
                except Exception:
                    pass

    page = await context.new_page()
    page.on("response", on_response)

    try:
        logger.info("[KDB생명] 약관공시 페이지 로딩...")
        await page.goto(
            "https://www.kdblife.co.kr/consumer/publicnotice/terms.do",
            timeout=PAGE_TIMEOUT, wait_until="domcontentloaded"
        )
        await asyncio.sleep(5)

        for call in api_calls:
            try:
                data = call.get("data", {})
                items = _extract_list(data)
                for item in items:
                    product_name = _get_product_name(item)
                    pdf_url = _get_pdf_url(item, "https://www.kdblife.co.kr")
                    if not pdf_url or not product_name:
                        continue
                    if file_already_exists(company_id, product_name):
                        continue
                    pdf_data = await download_pdf_bytes(pdf_url, context)
                    if pdf_data:
                        result = save_pdf(
                            pdf_data, company_id, company_name,
                            product_name, "생명보험", pdf_url, _detect_sale_status(item), dry_run
                        )
                        if not result.get("skipped") and not result.get("dry_run"):
                            downloaded += 1
                        await asyncio.sleep(1.0)
            except Exception as exc:
                logger.warning("[KDB생명] 처리 오류: %s", exc)

        if downloaded == 0 and not api_calls:
            downloaded = await _crawl_by_dom_links(
                page, context, company_id, company_name,
                "https://www.kdblife.co.kr", dry_run
            )

    finally:
        await page.close()

    logger.info("[KDB생명] 총 %d개 수집", downloaded)
    return downloaded


# =============================================================================
# 하나생명 크롤러
# =============================================================================

async def crawl_hana_life(context: Any, dry_run: bool = False) -> int:
    """하나생명 약관 PDF를 수집한다."""
    company_id = "hana_life"
    company_name = "하나생명"
    downloaded = 0
    api_calls: list[dict] = []

    async def on_response(response: Any) -> None:
        url = response.url
        if any(kw in url for kw in ["terms", "약관", "clause", "공시"]):
            ct = response.headers.get("content-type", "")
            if "json" in ct or "javascript" in ct:
                try:
                    body = await response.body()
                    text = body.decode("utf-8", errors="ignore")
                    if len(text) > 200:
                        try:
                            data = json.loads(text)
                            api_calls.append({"url": url, "data": data})
                            logger.info("[하나생명] API 탐지: %s", url)
                        except Exception:
                            pass
                except Exception:
                    pass

    page = await context.new_page()
    page.on("response", on_response)

    try:
        # @MX:NOTE: 하나생명은 hanalife.co.kr → hanainsure.co.kr/life 로 리다이렉트됨
        # @MX:NOTE: 하나손보와 동일 도메인을 공유하므로 /life 경로 필수
        logger.info("[하나생명] 약관공시 페이지 로딩...")
        base_url = "https://www.hanainsure.co.kr"
        terms_urls = [
            f"{base_url}/life/consumer/publicnotice/terms",
            f"{base_url}/life",
            "https://www.hanalife.co.kr/consumer/publicnotice/terms",
        ]
        for url in terms_urls:
            try:
                await page.goto(url, timeout=PAGE_TIMEOUT, wait_until="domcontentloaded")
                await asyncio.sleep(5)
                content = await page.content()
                if any(kw in content for kw in ["약관", "보험약관"]):
                    logger.info("[하나생명] 약관 페이지 발견: %s", url)
                    base_url = "https://www.hanainsure.co.kr"
                    break
            except Exception:
                continue

        for call in api_calls:
            try:
                data = call.get("data", {})
                items = _extract_list(data)
                for item in items:
                    product_name = _get_product_name(item)
                    pdf_url = _get_pdf_url(item, base_url)
                    if not pdf_url or not product_name:
                        continue
                    if file_already_exists(company_id, product_name):
                        continue
                    pdf_data = await download_pdf_bytes(pdf_url, context)
                    if pdf_data:
                        result = save_pdf(
                            pdf_data, company_id, company_name,
                            product_name, "생명보험", pdf_url, _detect_sale_status(item), dry_run
                        )
                        if not result.get("skipped") and not result.get("dry_run"):
                            downloaded += 1
                        await asyncio.sleep(1.0)
            except Exception as exc:
                logger.warning("[하나생명] 처리 오류: %s", exc)

        if downloaded == 0 and not api_calls:
            downloaded = await _crawl_by_dom_links(
                page, context, company_id, company_name,
                base_url, dry_run
            )

    finally:
        await page.close()

    logger.info("[하나생명] 총 %d개 수집", downloaded)
    return downloaded


# =============================================================================
# AIA생명 크롤러
# =============================================================================

async def crawl_aia_life(context: Any, dry_run: bool = False) -> int:
    """AIA생명 약관 PDF를 수집한다."""
    company_id = "aia_life"
    company_name = "AIA생명"
    downloaded = 0
    api_calls: list[dict] = []

    async def on_response(response: Any) -> None:
        url = response.url
        if any(kw in url for kw in ["terms", "약관", "clause", "공시", "disclosure"]):
            ct = response.headers.get("content-type", "")
            if "json" in ct or "javascript" in ct:
                try:
                    body = await response.body()
                    text = body.decode("utf-8", errors="ignore")
                    if len(text) > 200:
                        try:
                            data = json.loads(text)
                            api_calls.append({"url": url, "data": data})
                            logger.info("[AIA생명] API 탐지: %s", url)
                        except Exception:
                            pass
                except Exception:
                    pass

    page = await context.new_page()
    page.on("response", on_response)

    try:
        logger.info("[AIA생명] 약관공시 페이지 로딩...")
        await page.goto(
            "https://www.aia.co.kr/ko/help-support/forms/policy-terms.html",
            timeout=PAGE_TIMEOUT, wait_until="domcontentloaded"
        )
        await asyncio.sleep(5)

        for call in api_calls:
            try:
                data = call.get("data", {})
                items = _extract_list(data)
                for item in items:
                    product_name = _get_product_name(item)
                    pdf_url = _get_pdf_url(item, "https://www.aia.co.kr")
                    if not pdf_url or not product_name:
                        continue
                    if file_already_exists(company_id, product_name):
                        continue
                    pdf_data = await download_pdf_bytes(pdf_url, context)
                    if pdf_data:
                        result = save_pdf(
                            pdf_data, company_id, company_name,
                            product_name, "생명보험", pdf_url, _detect_sale_status(item), dry_run
                        )
                        if not result.get("skipped") and not result.get("dry_run"):
                            downloaded += 1
                        await asyncio.sleep(1.0)
            except Exception as exc:
                logger.warning("[AIA생명] 처리 오류: %s", exc)

        if downloaded == 0 and not api_calls:
            downloaded = await _crawl_by_dom_links(
                page, context, company_id, company_name,
                "https://www.aia.co.kr", dry_run
            )

    finally:
        await page.close()

    logger.info("[AIA생명] 총 %d개 수집", downloaded)
    return downloaded


# =============================================================================
# 메트라이프생명 크롤러
# =============================================================================

async def crawl_metlife(context: Any, dry_run: bool = False) -> int:
    """메트라이프생명 약관 PDF를 수집한다."""
    company_id = "metlife"
    company_name = "메트라이프생명"
    downloaded = 0
    api_calls: list[dict] = []

    async def on_response(response: Any) -> None:
        url = response.url
        if any(kw in url for kw in ["terms", "약관", "clause", "공시"]):
            ct = response.headers.get("content-type", "")
            if "json" in ct or "javascript" in ct:
                try:
                    body = await response.body()
                    text = body.decode("utf-8", errors="ignore")
                    if len(text) > 200:
                        try:
                            data = json.loads(text)
                            api_calls.append({"url": url, "data": data})
                            logger.info("[메트라이프] API 탐지: %s", url)
                        except Exception:
                            pass
                except Exception:
                    pass

    page = await context.new_page()
    page.on("response", on_response)

    try:
        logger.info("[메트라이프] 약관공시 페이지 로딩...")
        await page.goto(
            "https://www.metlife.co.kr/content/metlife/kr/ko/consumer/public-information/terms.html",
            timeout=PAGE_TIMEOUT, wait_until="domcontentloaded"
        )
        await asyncio.sleep(5)

        for call in api_calls:
            try:
                data = call.get("data", {})
                items = _extract_list(data)
                for item in items:
                    product_name = _get_product_name(item)
                    pdf_url = _get_pdf_url(item, "https://www.metlife.co.kr")
                    if not pdf_url or not product_name:
                        continue
                    if file_already_exists(company_id, product_name):
                        continue
                    pdf_data = await download_pdf_bytes(pdf_url, context)
                    if pdf_data:
                        result = save_pdf(
                            pdf_data, company_id, company_name,
                            product_name, "생명보험", pdf_url, _detect_sale_status(item), dry_run
                        )
                        if not result.get("skipped") and not result.get("dry_run"):
                            downloaded += 1
                        await asyncio.sleep(1.0)
            except Exception as exc:
                logger.warning("[메트라이프] 처리 오류: %s", exc)

        if downloaded == 0 and not api_calls:
            downloaded = await _crawl_by_dom_links(
                page, context, company_id, company_name,
                "https://www.metlife.co.kr", dry_run
            )

    finally:
        await page.close()

    logger.info("[메트라이프] 총 %d개 수집", downloaded)
    return downloaded


# =============================================================================
# 라이나생명 크롤러
# =============================================================================

async def crawl_lina_life(context: Any, dry_run: bool = False) -> int:
    """라이나생명 약관 PDF를 수집한다."""
    company_id = "lina_life"
    company_name = "라이나생명"
    downloaded = 0
    api_calls: list[dict] = []

    async def on_response(response: Any) -> None:
        url = response.url
        if any(kw in url for kw in ["terms", "약관", "clause", "공시"]):
            ct = response.headers.get("content-type", "")
            if "json" in ct or "javascript" in ct:
                try:
                    body = await response.body()
                    text = body.decode("utf-8", errors="ignore")
                    if len(text) > 200:
                        try:
                            data = json.loads(text)
                            api_calls.append({"url": url, "data": data})
                            logger.info("[라이나생명] API 탐지: %s", url)
                        except Exception:
                            pass
                except Exception:
                    pass

    page = await context.new_page()
    page.on("response", on_response)

    try:
        logger.info("[라이나생명] 약관공시 페이지 로딩...")
        await page.goto(
            "https://www.lina.co.kr/web/customer/publicinfo/terms/termsList.do",
            timeout=PAGE_TIMEOUT, wait_until="domcontentloaded"
        )
        await asyncio.sleep(5)

        for call in api_calls:
            try:
                data = call.get("data", {})
                items = _extract_list(data)
                for item in items:
                    product_name = _get_product_name(item)
                    pdf_url = _get_pdf_url(item, "https://www.lina.co.kr")
                    if not pdf_url or not product_name:
                        continue
                    if file_already_exists(company_id, product_name):
                        continue
                    pdf_data = await download_pdf_bytes(pdf_url, context)
                    if pdf_data:
                        result = save_pdf(
                            pdf_data, company_id, company_name,
                            product_name, "생명보험", pdf_url, _detect_sale_status(item), dry_run
                        )
                        if not result.get("skipped") and not result.get("dry_run"):
                            downloaded += 1
                        await asyncio.sleep(1.0)
            except Exception as exc:
                logger.warning("[라이나생명] 처리 오류: %s", exc)

        if downloaded == 0 and not api_calls:
            downloaded = await _crawl_by_dom_links(
                page, context, company_id, company_name,
                "https://www.lina.co.kr", dry_run
            )

    finally:
        await page.close()

    logger.info("[라이나생명] 총 %d개 수집", downloaded)
    return downloaded


# =============================================================================
# ABL생명 크롤러
# =============================================================================

async def crawl_abl_life(context: Any, dry_run: bool = False) -> int:
    """ABL생명 약관 PDF를 수집한다."""
    company_id = "abl_life"
    company_name = "ABL생명"
    downloaded = 0
    api_calls: list[dict] = []

    async def on_response(response: Any) -> None:
        url = response.url
        if any(kw in url for kw in ["terms", "약관", "clause", "공시"]):
            ct = response.headers.get("content-type", "")
            if "json" in ct or "javascript" in ct:
                try:
                    body = await response.body()
                    text = body.decode("utf-8", errors="ignore")
                    if len(text) > 200:
                        try:
                            data = json.loads(text)
                            api_calls.append({"url": url, "data": data})
                            logger.info("[ABL생명] API 탐지: %s", url)
                        except Exception:
                            pass
                except Exception:
                    pass

    page = await context.new_page()
    page.on("response", on_response)

    try:
        # @MX:NOTE: ABL생명 약관 목록 API: POST /hp/pban/prdtPban/vainsInsPbanPrdt/prdtCodeNameList
        # @MX:NOTE: 응답 구조: serviceBody.data.list[].prdtNm (상품명), prcd (상품코드)
        # @MX:NOTE: 약관 상세 페이지: /st/pban/prdtPban/vainsInsPbanPrdt/vainsInsPbanPrdt1/vainsinspbanprdt11
        logger.info("[ABL생명] 약관 목록 API 직접 호출...")
        base_url = "https://www.abllife.co.kr"
        terms_page = f"{base_url}/st/pban/prdtPban/vainsInsPbanPrdt/vainsInsPbanPrdt1/vainsinspbanprdt11"

        await page.goto(terms_page, timeout=PAGE_TIMEOUT, wait_until="networkidle")
        await asyncio.sleep(5)

        # ABL생명 약관 목록 API 직접 호출
        try:
            resp = await page.request.post(
                f"{base_url}/hp/pban/prdtPban/vainsInsPbanPrdt/prdtCodeNameList",
                data={"pageNo": "1", "pageSize": "500"},
                headers={
                    "Accept": "application/json",
                    "Referer": terms_page,
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "X-Requested-With": "XMLHttpRequest",
                },
                timeout=20_000,
            )
            if resp.ok:
                body = await resp.body()
                try:
                    data = json.loads(body.decode("utf-8", errors="ignore"))
                    api_calls.append({"url": f"{base_url}/hp/pban/prdtPban/vainsInsPbanPrdt/prdtCodeNameList", "data": data})
                    logger.info("[ABL생명] 약관 목록 API 성공")
                except Exception as exc:
                    logger.warning("[ABL생명] JSON 파싱 오류: %s", exc)
        except Exception as exc:
            logger.warning("[ABL생명] 약관 API 호출 오류: %s", exc)

        for call in api_calls:
            try:
                data = call.get("data", {})
                # ABL생명 응답 구조: {"serviceBody": {"data": {"list": [{"prdtNm": "...", "prcd": "..."}]}}}
                svc_body = data.get("serviceBody", {})
                svc_data = svc_body.get("data", {})
                items = svc_data.get("list", []) if isinstance(svc_data, dict) else _extract_list(data)
                logger.info("[ABL생명] 상품 목록 %d개 발견", len(items))

                for item in items:
                    product_name = item.get("prdtNm") or _get_product_name(item)
                    prod_code = item.get("prcd", "")
                    if not product_name:
                        continue
                    # ABL생명 약관 PDF는 상품 상세 페이지에서 별도 조회 필요
                    pdf_url = _get_pdf_url(item, base_url)
                    if not pdf_url:
                        continue
                    if file_already_exists(company_id, product_name):
                        continue
                    pdf_data = await download_pdf_bytes(pdf_url, context)
                    if pdf_data:
                        result = save_pdf(
                            pdf_data, company_id, company_name,
                            product_name, "생명보험", pdf_url, _detect_sale_status(item), dry_run
                        )
                        if not result.get("skipped") and not result.get("dry_run"):
                            downloaded += 1
                        await asyncio.sleep(1.0)
            except Exception as exc:
                logger.warning("[ABL생명] 처리 오류: %s", exc)

        if downloaded == 0 and not api_calls:
            downloaded = await _crawl_by_dom_links(
                page, context, company_id, company_name,
                base_url, dry_run
            )

    finally:
        await page.close()

    logger.info("[ABL생명] 총 %d개 수집", downloaded)
    return downloaded


# =============================================================================
# 푸본현대생명 크롤러
# =============================================================================

async def crawl_fubon_hyundai_life(context: Any, dry_run: bool = False) -> int:
    """푸본현대생명 약관 PDF를 수집한다."""
    company_id = "fubon_hyundai_life"
    company_name = "푸본현대생명"
    downloaded = 0
    api_calls: list[dict] = []

    async def on_response(response: Any) -> None:
        url = response.url
        if any(kw in url for kw in ["terms", "약관", "clause", "공시"]):
            ct = response.headers.get("content-type", "")
            if "json" in ct or "javascript" in ct:
                try:
                    body = await response.body()
                    text = body.decode("utf-8", errors="ignore")
                    if len(text) > 200:
                        try:
                            data = json.loads(text)
                            api_calls.append({"url": url, "data": data})
                            logger.info("[푸본현대생명] API 탐지: %s", url)
                        except Exception:
                            pass
                except Exception:
                    pass

    page = await context.new_page()
    page.on("response", on_response)

    try:
        logger.info("[푸본현대생명] 약관공시 페이지 로딩...")
        await page.goto(
            "https://www.fubonhyundai.com/consumer/publicnotice/terms",
            timeout=PAGE_TIMEOUT, wait_until="domcontentloaded"
        )
        await asyncio.sleep(5)

        for call in api_calls:
            try:
                data = call.get("data", {})
                items = _extract_list(data)
                for item in items:
                    product_name = _get_product_name(item)
                    pdf_url = _get_pdf_url(item, "https://www.fubonhyundai.com")
                    if not pdf_url or not product_name:
                        continue
                    if file_already_exists(company_id, product_name):
                        continue
                    pdf_data = await download_pdf_bytes(pdf_url, context)
                    if pdf_data:
                        result = save_pdf(
                            pdf_data, company_id, company_name,
                            product_name, "생명보험", pdf_url, _detect_sale_status(item), dry_run
                        )
                        if not result.get("skipped") and not result.get("dry_run"):
                            downloaded += 1
                        await asyncio.sleep(1.0)
            except Exception as exc:
                logger.warning("[푸본현대생명] 처리 오류: %s", exc)

        if downloaded == 0 and not api_calls:
            downloaded = await _crawl_by_dom_links(
                page, context, company_id, company_name,
                "https://www.fubonhyundai.com", dry_run
            )

    finally:
        await page.close()

    logger.info("[푸본현대생명] 총 %d개 수집", downloaded)
    return downloaded


# =============================================================================
# KB라이프 크롤러
# =============================================================================

async def crawl_kb_life(context: Any, dry_run: bool = False) -> int:
    """KB라이프 약관 PDF를 수집한다."""
    company_id = "kb_life"
    company_name = "KB라이프"
    downloaded = 0
    api_calls: list[dict] = []

    async def on_response(response: Any) -> None:
        url = response.url
        if any(kw in url for kw in ["terms", "약관", "clause", "공시"]):
            ct = response.headers.get("content-type", "")
            if "json" in ct or "javascript" in ct:
                try:
                    body = await response.body()
                    text = body.decode("utf-8", errors="ignore")
                    if len(text) > 200:
                        try:
                            data = json.loads(text)
                            api_calls.append({"url": url, "data": data})
                            logger.info("[KB라이프] API 탐지: %s", url)
                        except Exception:
                            pass
                except Exception:
                    pass

    page = await context.new_page()
    page.on("response", on_response)

    try:
        # @MX:NOTE: KB라이프는 kblife.co.kr이 올바른 도메인 (kblifeinsurance.com은 DNS 실패)
        # @MX:NOTE: 약관 페이지: /customer-common/guideToProductPublicNoticeOfficeProductPublicNotice.do
        # @MX:NOTE: 상품 검색 API: POST /m/insurance-product/searchProduct.do
        logger.info("[KB라이프] 약관공시 페이지 로딩...")
        base_url = "https://www.kblife.co.kr"
        terms_urls = [
            f"{base_url}/customer-common/guideToProductPublicNoticeOfficeProductPublicNotice.do",
            f"{base_url}/consumer/publicnotice/terms",
        ]
        for url in terms_urls:
            try:
                await page.goto(url, timeout=PAGE_TIMEOUT, wait_until="networkidle")
                await asyncio.sleep(5)
                content = await page.content()
                if any(kw in content for kw in ["약관", "보험약관", "ProductPublicNotice"]):
                    logger.info("[KB라이프] 약관 페이지 발견: %s", url)
                    break
            except Exception:
                continue

        for call in api_calls:
            try:
                data = call.get("data", {})
                items = _extract_list(data)
                for item in items:
                    product_name = _get_product_name(item)
                    pdf_url = _get_pdf_url(item, base_url)
                    if not pdf_url or not product_name:
                        continue
                    if file_already_exists(company_id, product_name):
                        continue
                    pdf_data = await download_pdf_bytes(pdf_url, context)
                    if pdf_data:
                        result = save_pdf(
                            pdf_data, company_id, company_name,
                            product_name, "생명보험", pdf_url, _detect_sale_status(item), dry_run
                        )
                        if not result.get("skipped") and not result.get("dry_run"):
                            downloaded += 1
                        await asyncio.sleep(1.0)
            except Exception as exc:
                logger.warning("[KB라이프] 처리 오류: %s", exc)

        if downloaded == 0 and not api_calls:
            downloaded = await _crawl_by_dom_links(
                page, context, company_id, company_name,
                base_url, dry_run
            )

    finally:
        await page.close()

    logger.info("[KB라이프] 총 %d개 수집", downloaded)
    return downloaded


# =============================================================================
# iM라이프 크롤러
# =============================================================================

async def crawl_im_life(context: Any, dry_run: bool = False) -> int:
    """iM라이프 약관 PDF를 수집한다."""
    company_id = "im_life"
    company_name = "iM라이프"
    downloaded = 0
    api_calls: list[dict] = []

    async def on_response(response: Any) -> None:
        url = response.url
        if any(kw in url for kw in ["terms", "약관", "clause", "공시"]):
            ct = response.headers.get("content-type", "")
            if "json" in ct or "javascript" in ct:
                try:
                    body = await response.body()
                    text = body.decode("utf-8", errors="ignore")
                    if len(text) > 200:
                        try:
                            data = json.loads(text)
                            api_calls.append({"url": url, "data": data})
                            logger.info("[iM라이프] API 탐지: %s", url)
                        except Exception:
                            pass
                except Exception:
                    pass

    page = await context.new_page()
    page.on("response", on_response)

    try:
        logger.info("[iM라이프] 약관공시 페이지 로딩...")
        await page.goto(
            "https://www.imlife.co.kr/consumer/publicnotice/terms",
            timeout=PAGE_TIMEOUT, wait_until="domcontentloaded"
        )
        await asyncio.sleep(5)

        for call in api_calls:
            try:
                data = call.get("data", {})
                items = _extract_list(data)
                for item in items:
                    product_name = _get_product_name(item)
                    pdf_url = _get_pdf_url(item, "https://www.imlife.co.kr")
                    if not pdf_url or not product_name:
                        continue
                    if file_already_exists(company_id, product_name):
                        continue
                    pdf_data = await download_pdf_bytes(pdf_url, context)
                    if pdf_data:
                        result = save_pdf(
                            pdf_data, company_id, company_name,
                            product_name, "생명보험", pdf_url, _detect_sale_status(item), dry_run
                        )
                        if not result.get("skipped") and not result.get("dry_run"):
                            downloaded += 1
                        await asyncio.sleep(1.0)
            except Exception as exc:
                logger.warning("[iM라이프] 처리 오류: %s", exc)

        if downloaded == 0 and not api_calls:
            downloaded = await _crawl_by_dom_links(
                page, context, company_id, company_name,
                "https://www.imlife.co.kr", dry_run
            )

    finally:
        await page.close()

    logger.info("[iM라이프] 총 %d개 수집", downloaded)
    return downloaded


# =============================================================================
# IBK연금보험 크롤러
# =============================================================================

async def crawl_ibk_life(context: Any, dry_run: bool = False) -> int:
    """IBK연금보험 약관 PDF를 수집한다."""
    company_id = "ibk_life"
    company_name = "IBK연금보험"
    downloaded = 0
    api_calls: list[dict] = []

    async def on_response(response: Any) -> None:
        url = response.url
        if any(kw in url for kw in ["terms", "약관", "clause", "공시"]):
            ct = response.headers.get("content-type", "")
            if "json" in ct or "javascript" in ct:
                try:
                    body = await response.body()
                    text = body.decode("utf-8", errors="ignore")
                    if len(text) > 200:
                        try:
                            data = json.loads(text)
                            api_calls.append({"url": url, "data": data})
                            logger.info("[IBK연금보험] API 탐지: %s", url)
                        except Exception:
                            pass
                except Exception:
                    pass

    page = await context.new_page()
    page.on("response", on_response)

    try:
        logger.info("[IBK연금보험] 약관공시 페이지 로딩...")
        await page.goto(
            "https://www.ibkannuity.co.kr/consumer/publicnotice/terms",
            timeout=PAGE_TIMEOUT, wait_until="domcontentloaded"
        )
        await asyncio.sleep(5)

        for call in api_calls:
            try:
                data = call.get("data", {})
                items = _extract_list(data)
                for item in items:
                    product_name = _get_product_name(item)
                    pdf_url = _get_pdf_url(item, "https://www.ibkannuity.co.kr")
                    if not pdf_url or not product_name:
                        continue
                    if file_already_exists(company_id, product_name):
                        continue
                    pdf_data = await download_pdf_bytes(pdf_url, context)
                    if pdf_data:
                        result = save_pdf(
                            pdf_data, company_id, company_name,
                            product_name, "생명보험", pdf_url, _detect_sale_status(item), dry_run
                        )
                        if not result.get("skipped") and not result.get("dry_run"):
                            downloaded += 1
                        await asyncio.sleep(1.0)
            except Exception as exc:
                logger.warning("[IBK연금보험] 처리 오류: %s", exc)

        if downloaded == 0 and not api_calls:
            downloaded = await _crawl_by_dom_links(
                page, context, company_id, company_name,
                "https://www.ibkannuity.co.kr", dry_run
            )

    finally:
        await page.close()

    logger.info("[IBK연금보험] 총 %d개 수집", downloaded)
    return downloaded


# =============================================================================
# 처브라이프 크롤러
# =============================================================================

async def crawl_chubb_life(context: Any, dry_run: bool = False) -> int:
    """처브라이프 약관 PDF를 수집한다."""
    company_id = "chubb_life"
    company_name = "처브라이프"
    downloaded = 0
    api_calls: list[dict] = []

    async def on_response(response: Any) -> None:
        url = response.url
        if any(kw in url for kw in ["terms", "약관", "clause", "공시"]):
            ct = response.headers.get("content-type", "")
            if "json" in ct or "javascript" in ct:
                try:
                    body = await response.body()
                    text = body.decode("utf-8", errors="ignore")
                    if len(text) > 200:
                        try:
                            data = json.loads(text)
                            api_calls.append({"url": url, "data": data})
                            logger.info("[처브라이프] API 탐지: %s", url)
                        except Exception:
                            pass
                except Exception:
                    pass

    page = await context.new_page()
    page.on("response", on_response)

    try:
        # @MX:NOTE: 처브라이프는 chubblife.co.kr이 올바른 도메인 (chubb.com/kr-ko는 404)
        # @MX:NOTE: 처브라이프생명보험 한국법인 전용 도메인
        logger.info("[처브라이프] 약관공시 페이지 로딩...")
        base_url = "https://www.chubblife.co.kr"
        terms_urls = [
            f"{base_url}/consumer/publicnotice/terms",
            f"{base_url}/index.do",
        ]
        for url in terms_urls:
            try:
                await page.goto(url, timeout=PAGE_TIMEOUT, wait_until="domcontentloaded")
                await asyncio.sleep(5)
                content = await page.content()
                if any(kw in content for kw in ["약관", "보험약관", "처브"]):
                    logger.info("[처브라이프] 페이지 로딩 성공: %s", url)
                    break
            except Exception:
                continue

        for call in api_calls:
            try:
                data = call.get("data", {})
                items = _extract_list(data)
                for item in items:
                    product_name = _get_product_name(item)
                    pdf_url = _get_pdf_url(item, base_url)
                    if not pdf_url or not product_name:
                        continue
                    if file_already_exists(company_id, product_name):
                        continue
                    pdf_data = await download_pdf_bytes(pdf_url, context)
                    if pdf_data:
                        result = save_pdf(
                            pdf_data, company_id, company_name,
                            product_name, "생명보험", pdf_url, _detect_sale_status(item), dry_run
                        )
                        if not result.get("skipped") and not result.get("dry_run"):
                            downloaded += 1
                        await asyncio.sleep(1.0)
            except Exception as exc:
                logger.warning("[처브라이프] 처리 오류: %s", exc)

        if downloaded == 0 and not api_calls:
            downloaded = await _crawl_by_dom_links(
                page, context, company_id, company_name,
                base_url, dry_run
            )

    finally:
        await page.close()

    logger.info("[처브라이프] 총 %d개 수집", downloaded)
    return downloaded


# =============================================================================
# BNP파리바카디프 크롤러
# =============================================================================

async def crawl_bnp_life(context: Any, dry_run: bool = False) -> int:
    """BNP파리바카디프 약관 PDF를 수집한다."""
    company_id = "bnp_life"
    company_name = "BNP파리바카디프"
    downloaded = 0
    api_calls: list[dict] = []

    async def on_response(response: Any) -> None:
        url = response.url
        if any(kw in url for kw in ["terms", "약관", "clause", "공시"]):
            ct = response.headers.get("content-type", "")
            if "json" in ct or "javascript" in ct:
                try:
                    body = await response.body()
                    text = body.decode("utf-8", errors="ignore")
                    if len(text) > 200:
                        try:
                            data = json.loads(text)
                            api_calls.append({"url": url, "data": data})
                            logger.info("[BNP파리바카디프] API 탐지: %s", url)
                        except Exception:
                            pass
                except Exception:
                    pass

    page = await context.new_page()
    page.on("response", on_response)

    try:
        logger.info("[BNP파리바카디프] 약관공시 페이지 로딩...")
        await page.goto(
            "https://www.cardif.co.kr/consumer/publicnotice/terms",
            timeout=PAGE_TIMEOUT, wait_until="domcontentloaded"
        )
        await asyncio.sleep(5)

        for call in api_calls:
            try:
                data = call.get("data", {})
                items = _extract_list(data)
                for item in items:
                    product_name = _get_product_name(item)
                    pdf_url = _get_pdf_url(item, "https://www.cardif.co.kr")
                    if not pdf_url or not product_name:
                        continue
                    if file_already_exists(company_id, product_name):
                        continue
                    pdf_data = await download_pdf_bytes(pdf_url, context)
                    if pdf_data:
                        result = save_pdf(
                            pdf_data, company_id, company_name,
                            product_name, "생명보험", pdf_url, _detect_sale_status(item), dry_run
                        )
                        if not result.get("skipped") and not result.get("dry_run"):
                            downloaded += 1
                        await asyncio.sleep(1.0)
            except Exception as exc:
                logger.warning("[BNP파리바카디프] 처리 오류: %s", exc)

        if downloaded == 0 and not api_calls:
            downloaded = await _crawl_by_dom_links(
                page, context, company_id, company_name,
                "https://www.cardif.co.kr", dry_run
            )

    finally:
        await page.close()

    logger.info("[BNP파리바카디프] 총 %d개 수집", downloaded)
    return downloaded


# =============================================================================
# 교보라이프플래닛 크롤러
# =============================================================================

async def crawl_kyobo_lifeplanet(context: Any, dry_run: bool = False) -> int:
    """교보라이프플래닛 약관 PDF를 수집한다."""
    company_id = "kyobo_lifeplanet"
    company_name = "교보라이프플래닛"
    downloaded = 0
    api_calls: list[dict] = []

    async def on_response(response: Any) -> None:
        url = response.url
        if any(kw in url for kw in ["terms", "약관", "clause", "공시"]):
            ct = response.headers.get("content-type", "")
            if "json" in ct or "javascript" in ct:
                try:
                    body = await response.body()
                    text = body.decode("utf-8", errors="ignore")
                    if len(text) > 200:
                        try:
                            data = json.loads(text)
                            api_calls.append({"url": url, "data": data})
                            logger.info("[교보라이프플래닛] API 탐지: %s", url)
                        except Exception:
                            pass
                except Exception:
                    pass

    page = await context.new_page()
    page.on("response", on_response)

    try:
        logger.info("[교보라이프플래닛] 약관공시 페이지 로딩...")
        await page.goto(
            "https://www.lifeplanet.co.kr/consumer/publicnotice/terms",
            timeout=PAGE_TIMEOUT, wait_until="domcontentloaded"
        )
        await asyncio.sleep(5)

        for call in api_calls:
            try:
                data = call.get("data", {})
                items = _extract_list(data)
                for item in items:
                    product_name = _get_product_name(item)
                    pdf_url = _get_pdf_url(item, "https://www.lifeplanet.co.kr")
                    if not pdf_url or not product_name:
                        continue
                    if file_already_exists(company_id, product_name):
                        continue
                    pdf_data = await download_pdf_bytes(pdf_url, context)
                    if pdf_data:
                        result = save_pdf(
                            pdf_data, company_id, company_name,
                            product_name, "생명보험", pdf_url, _detect_sale_status(item), dry_run
                        )
                        if not result.get("skipped") and not result.get("dry_run"):
                            downloaded += 1
                        await asyncio.sleep(1.0)
            except Exception as exc:
                logger.warning("[교보라이프플래닛] 처리 오류: %s", exc)

        if downloaded == 0 and not api_calls:
            downloaded = await _crawl_by_dom_links(
                page, context, company_id, company_name,
                "https://www.lifeplanet.co.kr", dry_run
            )

    finally:
        await page.close()

    logger.info("[교보라이프플래닛] 총 %d개 수집", downloaded)
    return downloaded


# =============================================================================
# 공통 헬퍼 함수
# =============================================================================

def _extract_list(data: Any) -> list[dict]:
    """API 응답에서 상품 목록을 추출한다.

    # @MX:ANCHOR: 모든 회사 크롤러에서 사용하는 JSON 파싱 핵심 함수
    # @MX:REASON: 22개 회사 크롤러 함수에서 호출됨 (fan_in >= 3)
    """
    if isinstance(data, list):
        return data
    if not isinstance(data, dict):
        return []

    # 재귀적으로 list를 탐색
    for key in ["list", "data", "result", "items", "termsList", "productList",
                "content", "rows", "records", "body", "response"]:
        val = data.get(key)
        if isinstance(val, list) and len(val) > 0:
            return val
        if isinstance(val, dict):
            nested = _extract_list(val)
            if nested:
                return nested

    return []


def _get_product_name(item: dict[str, Any]) -> str:
    """약관 항목에서 상품명을 추출한다."""
    for key in ["prdNm", "termsNm", "prodNm", "productNm", "name", "title",
                "prdName", "termName", "insNm", "goodsNm", "prodName",
                "productName", "termTitle", "yakgwanNm"]:
        val = item.get(key)
        if val and isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def _get_pdf_url(item: dict[str, Any], base_url: str) -> str:
    """약관 항목에서 PDF URL을 추출한다."""
    for key in ["fileUrl", "pdfUrl", "filePath", "fileNm", "url", "pdfPath",
                "attachUrl", "downloadUrl", "termsPdfUrl", "fileLink",
                "prdFileUrl", "downUrl", "yakgwanUrl", "termUrl"]:
        val = item.get(key)
        if val and isinstance(val, str) and val.strip():
            url = val.strip()
            if url.endswith(".pdf") or "pdf" in url.lower():
                if not url.startswith("http"):
                    url = urljoin(base_url, url)
                return url
    return ""


def _detect_sale_status(item: dict[str, Any]) -> str:
    """판매 상태를 감지한다.

    다양한 보험사별 판매 상태 필드명을 처리한다:
    - saleYn: Y(판매중), N(판매중지)
    - saleStat: 01(판매중), 02(판매중지)
    - prdStatusCd: 01(판매중), 02(판매중지)
    - endYn: Y(판매중지), N(판매중)
    - saleStatus: active/inactive
    """
    # saleYn 패턴
    sale_yn = item.get("saleYn", "")
    if sale_yn == "Y":
        return "판매중"
    if sale_yn == "N":
        return "판매중지"

    # saleStat / prdStatusCd 패턴
    for key in ["saleStat", "prdStatusCd", "saleStatCd", "prodStatusCd"]:
        val = item.get(key, "")
        if val in ("01", "1", "Y", "active", "on"):
            return "판매중"
        if val in ("02", "2", "N", "inactive", "off", "end"):
            return "판매중지"

    # endYn 패턴 (Y=종료, N=판매중)
    end_yn = item.get("endYn", "")
    if end_yn == "Y":
        return "판매중지"
    if end_yn == "N":
        return "판매중"

    # 기본값: 판매중지로 처리 (이 크롤러는 판매중지 상품 수집이 목적)
    return "판매중지"


async def _crawl_by_dom_links(
    page: Any,
    context: Any,
    company_id: str,
    company_name: str,
    base_url: str,
    dry_run: bool = False,
) -> int:
    """DOM에서 PDF 링크를 직접 찾아 다운로드하는 폴백 크롤러.

    # @MX:NOTE: API 탐지 실패 시 사용하는 범용 폴백 메서드
    # @MX:NOTE: PDF href 링크를 DOM에서 직접 파싱
    """
    downloaded = 0

    try:
        # PDF 링크 수집
        pdf_links = await page.evaluate(f"""
            () => {{
                const links = [];
                const els = document.querySelectorAll('a[href]');
                for (const el of els) {{
                    const href = el.getAttribute('href') || '';
                    if (href.toLowerCase().endsWith('.pdf') || href.includes('/pdf/') || href.includes('download')) {{
                        const text = el.textContent.trim() || href.split('/').pop() || '약관';
                        links.push({{ url: href, name: text }});
                    }}
                }}
                return links;
            }}
        """)

        logger.info("[%s] DOM에서 PDF 링크 %d개 발견", company_name, len(pdf_links))

        for link in pdf_links[:100]:  # 최대 100개 처리
            pdf_url = link.get("url", "")
            product_name = link.get("name", "약관")

            if not pdf_url:
                continue

            if not pdf_url.startswith("http"):
                pdf_url = urljoin(base_url, pdf_url)

            if file_already_exists(company_id, product_name):
                continue

            pdf_data = await download_pdf_bytes(pdf_url, context)
            if pdf_data and len(pdf_data) > 1000:  # 최소 1KB 이상
                result = save_pdf(
                    pdf_data, company_id, company_name,
                    product_name, "생명보험", pdf_url, "판매중지", dry_run
                )
                if not result.get("skipped") and not result.get("dry_run"):
                    downloaded += 1
                await asyncio.sleep(1.0)

    except Exception as exc:
        logger.warning("[%s] DOM 파싱 오류: %s", company_name, exc)

    return downloaded


# =============================================================================
# 크롤러 매핑
# =============================================================================

# @MX:NOTE: 회사 ID → 크롤러 함수 매핑
CRAWLER_MAP: dict[str, Any] = {
    "samsung_life": crawl_samsung_life,
    "kyobo_life": crawl_kyobo_life,
    "hanwha_life": crawl_hanwha_life,
    "shinhan_life": crawl_shinhan_life,
    "heungkuk_life": crawl_heungkuk_life,
    "dongyang_life": crawl_dongyang_life,
    "mirae_life": crawl_mirae_life,
    "nh_life": crawl_nh_life,
    "db_life": crawl_db_life,
    "kdb_life": crawl_kdb_life,
    "hana_life": crawl_hana_life,
    "aia_life": crawl_aia_life,
    "metlife": crawl_metlife,
    "lina_life": crawl_lina_life,
    "abl_life": crawl_abl_life,
    "fubon_hyundai_life": crawl_fubon_hyundai_life,
    "kb_life": crawl_kb_life,
    "im_life": crawl_im_life,
    "ibk_life": crawl_ibk_life,
    "chubb_life": crawl_chubb_life,
    "bnp_life": crawl_bnp_life,
    "kyobo_lifeplanet": crawl_kyobo_lifeplanet,
}


# =============================================================================
# 실행 엔진
# =============================================================================

async def run_company(company_id: str, dry_run: bool = False) -> dict[str, Any]:
    """단일 보험사 크롤링을 실행한다."""
    from playwright.async_api import async_playwright

    config = COMPANY_CONFIG.get(company_id)
    if not config:
        logger.error("알 수 없는 회사 ID: %s", company_id)
        return {"company_id": company_id, "downloaded": 0, "error": "unknown company"}

    crawler_fn = CRAWLER_MAP.get(company_id)
    if not crawler_fn:
        logger.error("크롤러 함수를 찾을 수 없습니다: %s", company_id)
        return {"company_id": company_id, "downloaded": 0, "error": "no crawler function"}

    for attempt in range(1, 3):
        try:
            async with async_playwright() as pw:
                browser = await pw.chromium.launch(
                    headless=True,
                    args=[
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-dev-shm-usage",
                        "--disable-blink-features=AutomationControlled",
                    ],
                )
                browser_context = await browser.new_context(
                    user_agent=(
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/120.0.0.0 Safari/537.36"
                    ),
                    locale="ko-KR",
                    timezone_id="Asia/Seoul",
                    extra_http_headers={
                        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
                    },
                )
                try:
                    downloaded = await crawler_fn(browser_context, dry_run)
                    await browser.close()
                    return {
                        "company_id": company_id,
                        "company_name": config["name"],
                        "downloaded": downloaded,
                        "success": True,
                    }
                except Exception as exc:
                    await browser.close()
                    if attempt < 2:
                        logger.warning(
                            "[%s] 시도 %d 실패, 재시도: %s",
                            config["name"], attempt, exc,
                        )
                        await asyncio.sleep(3)
                    else:
                        raise
        except Exception as exc:
            logger.error("[%s] 크롤링 실패 (시도 %d/2): %s", config["name"], attempt, exc)
            if attempt >= 2:
                return {
                    "company_id": company_id,
                    "company_name": config["name"],
                    "downloaded": 0,
                    "success": False,
                    "error": str(exc),
                }

    return {"company_id": company_id, "downloaded": 0, "success": False}


async def main(companies: list[str] | None = None, dry_run: bool = False) -> None:
    """메인 실행 함수.

    # @MX:ANCHOR: CLI 진입점 - 전체 또는 선택적 생명보험사 크롤링 실행
    # @MX:REASON: if __name__ == '__main__' 블록과 argparse에서 호출됨
    """
    if companies is None:
        companies = list(CRAWLER_MAP.keys())

    if dry_run:
        logger.info("[DRY-RUN 모드] 실제 파일 저장 없이 탐색만 수행합니다.")

    results = []
    total_downloaded = 0

    for company_id in companies:
        logger.info("\n%s", "=" * 60)
        logger.info("크롤링 시작: %s", COMPANY_CONFIG.get(company_id, {}).get("name", company_id))
        logger.info("=" * 60)
        result = await run_company(company_id, dry_run)
        results.append(result)
        total_downloaded += result.get("downloaded", 0)
        if len(companies) > 1:
            await asyncio.sleep(2)

    # 결과 요약
    logger.info("\n%s", "=" * 60)
    logger.info("생명보험 크롤링 완료 요약")
    logger.info("=" * 60)
    for r in results:
        status = "성공" if r.get("success") else "실패"
        logger.info(
            "  %-25s: %s (%d개 수집)",
            r.get("company_name", r.get("company_id", "")),
            status,
            r.get("downloaded", 0),
        )
        if r.get("error"):
            logger.info("    오류: %s", r["error"])
    logger.info("총 수집: %d개 PDF", total_downloaded)

    # 결과 JSON 저장
    report_path = BASE_DATA_DIR / "life_insurance_report.json"
    report_path.write_text(
        json.dumps(results, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    logger.info("결과 저장: %s", report_path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="생명보험사 약관 PDF Playwright 크롤러 (판매중지 상품 포함)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
사용 예시:
  # 전체 생명보험사 크롤링
  cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_life_insurance

  # 특정 회사만 크롤링
  cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_life_insurance --company samsung_life
  cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_life_insurance --company kyobo_life

  # 여러 회사
  cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_life_insurance --company samsung_life --company kyobo_life

  # dry-run (파일 저장 없이 탐색만)
  cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_life_insurance --dry-run --company samsung_life

지원 회사:
""" + "\n".join(f"  {cid}: {cfg['name']}" for cid, cfg in COMPANY_CONFIG.items()),
    )
    parser.add_argument(
        "--company",
        action="append",
        dest="companies",
        choices=list(COMPANY_CONFIG.keys()),
        metavar="COMPANY_ID",
        help="크롤링할 회사 ID (여러 개 지정 가능)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="실제 다운로드 없이 탐색만 수행",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="지원하는 회사 목록 출력",
    )

    args = parser.parse_args()

    if args.list:
        print("\n지원 생명보험사 목록:")
        for cid, cfg in COMPANY_CONFIG.items():
            print(f"  {cid:30s}: {cfg['name']}")
        sys.exit(0)

    asyncio.run(main(args.companies, args.dry_run))
