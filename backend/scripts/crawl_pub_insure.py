#!/usr/bin/env python3
"""pub.insure.or.kr 생명보험 공시실 약관 PDF 크롤러 (스탠드얼론)

DB 의존성 없이 로컬 파일로 저장.
pubinsure_life_crawler.py의 API 방식을 재사용.

실행:
    cd backend && PYTHONPATH=. python scripts/crawl_pub_insure.py

# @MX:NOTE: SSR 사이트 - Playwright 불필요, httpx POST로 목록 수집
# @MX:SPEC: SPEC-CRAWL-001
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

from scripts.crawl_constants import COMPANY_NAME_MAP, save_pdf_with_metadata

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent.parent / "data"
BASE_DIR.mkdir(parents=True, exist_ok=True)

LISTING_URL = "https://pub.insure.or.kr/compareDis/prodCompare/assurance/listNew.do"
SAVING_URL = "https://pub.insure.or.kr/compareDis/prodCompare/saving/list.do"
FILE_DOWN_URL = "https://pub.insure.or.kr/FileDown.do"

# fn_fileDown('fileNo', 'seq') 패턴
FILE_DOWN_PATTERN = re.compile(r"fn_fileDown\('(\d+)',\s*'(\d+)'\)")

# 레이블 패턴: rowspan 구조에서 회사명/상품명 추출 (td 기반 추출 불가능하므로)
# @MX:NOTE: pub.insure.or.kr은 rowspan 구조로 <tr> 파싱이 불가능. 각 제품의
#           숨겨진 label(id="l_memberNm_{key}") 태그로만 정확한 회사명 추출 가능.
MEMBER_NM_PATTERN = re.compile(r'id="l_memberNm_([^"]+)"[^>]*>([^<]+)<')
PROD_NM_PATTERN = re.compile(r'id="l_prodNm_([^"]+)"[^>]*>([^<]+)<')

# 회사 코드 -> 회사명 매핑 (pub.insure.or.kr 공식 코드)
COMPANY_CODES: dict[str, str] = {
    "L01": "한화생명",
    "L02": "ABL생명",
    "L03": "삼성생명",
    "L04": "교보생명",
    "L05": "동양생명",
    "L17": "푸본현대생명",
    "L31": "iM라이프",
    "L33": "KDB생명",
    "L34": "미래에셋생명",
    "L41": "IBK연금보험",
    "L42": "NH농협생명",
    "L51": "라이나생명",
    "L52": "AIA생명",
    "L61": "KB라이프생명보험",
    "L63": "하나생명",
    "L71": "DB생명",
    "L72": "메트라이프생명",
    "L74": "신한라이프",
    "L77": "처브라이프생명",
    "L78": "BNP파리바카디프생명보험",
}

# 회사명 -> company_id 추가 매핑 (crawl_constants.py와 호환)
EXTRA_NAME_MAP: dict[str, str] = {
    "한화생명": "hanwha_life",
    "ABL생명": "abl",
    "삼성생명": "samsung_life",
    "교보생명": "kyobo_life",
    "동양생명": "dongyang_life",
    "푸본현대생명": "fubon_hyundai_life",
    "iM라이프": "im_life",
    "KDB생명": "kdb",
    "미래에셋생명": "mirae_life",
    "IBK연금보험": "ibk",
    "NH농협생명": "nh",
    "라이나생명": "lina_life",
    "AIA생명": "aia",
    "KB라이프생명보험": "kb",
    "하나생명": "hana_life",
    "DB생명": "db",
    "메트라이프생명": "metlife",
    "신한라이프": "shinhan_life",
    "처브라이프생명": "chubb_life",
    "BNP파리바카디프생명보험": "bnp",
}

# 질병/상해 관련 카테고리 코드
DISEASE_INJURY_CATEGORIES: dict[str, str] = {
    "024400010004": "일반보험",  # CI, 질병, 상해 포함
    "024400010001": "종신보험",  # 사망+질병 포함
    "024400010005": "CI보험",
}

# 전체 카테고리 (모두 수집) - assurance/listNew.do 엔드포인트 사용
ALL_CATEGORIES: dict[str, str] = {
    "024400010001": "종신보험",
    "024400010002": "정기보험",
    "024400010003": "연금보험",
    "024400010004": "일반보험",
    "024400010005": "CI보험",
    "024400010006": "저축보험",
    "024400010007": "유니버셜보험",
    "024400010008": "실손의료비보장보험",
    "024400010009": "치아보험",
    "024400010010": "실손/치아보험",
    "024400010011": "기타",
}

# 저축성 카테고리 (saving/list.do 엔드포인트 사용)
SAVING_CATEGORIES: dict[str, str] = {
    "024400020001": "연금저축보험",
    "024400020002": "연금보험(저축성)",
    "024400020003": "저축보험(저축성)",
}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
    ),
    "Referer": "https://pub.insure.or.kr",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
}

RATE_LIMIT = 1.0  # 초


def fetch_category_page(category_code: str, page_index: int = 1, use_saving_url: bool = False) -> str:
    """특정 카테고리의 페이지 HTML을 POST로 가져온다."""
    url = SAVING_URL if use_saving_url else LISTING_URL
    params = {
        "pageIndex": str(page_index),
        "pageUnit": "100",
        "search_columnArea": "simple",
        "all_search_memberCd": "all",
        "search_prodGroup": category_code,
    }
    try:
        resp = httpx.post(url, data=params, headers=HEADERS, timeout=30, follow_redirects=True)
        if resp.status_code >= 400:
            logger.warning("목록 조회 HTTP %d: cat=%s page=%d", resp.status_code, category_code, page_index)
            return ""
        return resp.text
    except Exception as e:
        logger.error("목록 조회 오류: %s", e)
        return ""


def extract_file_infos(html: str) -> list[tuple[str, str]]:
    """HTML에서 fn_fileDown(fileNo, seq) 패턴을 추출한다."""
    return FILE_DOWN_PATTERN.findall(html)


def extract_product_info(html: str, file_no: str, seq: str) -> tuple[str, str]:
    """fn_fileDown에 해당하는 회사명과 상품명을 l_memberNm_ 레이블로 추출한다.

    rowspan 구조로 인해 <tr> 기반 추출은 HTML 첫 번째 <tr>부터 매칭되어
    모든 제품이 첫 번째 회사로 귀속되는 버그가 있음. 대신 각 제품 행에
    삽입된 숨겨진 label 태그(id="l_memberNm_{key}")를 활용한다.

    Returns:
        (company_name, product_name) 튜플
    """
    # fn_fileDown 위치 찾기
    fn_pattern = rf"fn_fileDown\('{re.escape(file_no)}',\s*'{re.escape(seq)}'\)"
    fn_match = re.search(fn_pattern, html)
    if not fn_match:
        return "", ""

    pos = fn_match.start()
    # fn_fileDown 직전 8000자에서 가장 가까운 l_memberNm_ 레이블 찾기
    # pub.insure.or.kr HTML에서 레이블과 fn_fileDown 사이 거리 약 6500자
    segment = html[max(0, pos - 8000):pos]

    member_matches = list(MEMBER_NM_PATTERN.finditer(segment))
    if not member_matches:
        return "", ""

    last_match = member_matches[-1]
    company_name = last_match.group(2).strip()
    product_key = last_match.group(1)

    # 같은 product_key의 상품명 추출
    prod_match = re.search(
        rf'id="l_prodNm_{re.escape(product_key)}"[^>]*>([^<]+)<', html
    )
    product_name = prod_match.group(1).strip() if prod_match else ""

    return company_name, product_name


def download_pdf(file_no: str, seq: str) -> bytes:
    """PDF 바이너리를 다운로드한다."""
    url = f"{FILE_DOWN_URL}?fileNo={file_no}&seq={seq}"
    try:
        resp = httpx.get(url, headers=HEADERS, timeout=60, follow_redirects=True)
        if resp.status_code >= 400:
            return b""
        data = resp.content
        if data[:4] != b"%PDF":
            return b""
        return data
    except Exception as e:
        logger.warning("PDF 다운로드 실패 fileNo=%s seq=%s: %s", file_no, seq, e)
        return b""


def get_company_id(company_name: str) -> str:
    """회사명에서 company_id를 반환한다."""
    # EXTRA_NAME_MAP 우선 확인
    for name, cid in EXTRA_NAME_MAP.items():
        if name in company_name:
            return cid
    # crawl_constants COMPANY_NAME_MAP 확인
    for name, cid in COMPANY_NAME_MAP.items():
        if name in company_name:
            return cid
    # fallback: 알 수 없는 회사
    return "unknown_life"


def crawl_all_categories(target_categories: dict[str, str] | None = None) -> dict:
    """전체 카테고리를 순회하며 PDF를 수집한다. (보장성 + 저축성 포함)"""
    # ALL_CATEGORIES (보장성) + SAVING_CATEGORIES (저축성) 합산
    if target_categories is not None:
        categories_assurance = {k: v for k, v in target_categories.items() if k.startswith("02440001")}
        categories_saving = {k: v for k, v in target_categories.items() if k.startswith("02440002")}
    else:
        categories_assurance = ALL_CATEGORIES
        categories_saving = SAVING_CATEGORIES

    # (카테고리코드, 카테고리명, 저축성여부) 튜플 목록
    all_cats = [(k, v, False) for k, v in categories_assurance.items()] + \
               [(k, v, True) for k, v in categories_saving.items()]

    results: list[dict] = []
    failed: list[dict] = []
    seen_files: set[str] = set()  # 중복 방지

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    print(f"\n{'='*60}")
    print("pub.insure.or.kr 생명보험 약관 PDF 크롤링")
    print(f"대상 카테고리: {len(all_cats)}개 (보장성 {len(categories_assurance)}개 + 저축성 {len(categories_saving)}개)")
    print(f"저장 경로: {BASE_DIR}")
    print("="*60)

    for cat_code, cat_name, use_saving in all_cats:
        print(f"\n[카테고리] {cat_name} ({cat_code})")
        page_index = 1
        cat_count = 0

        while True:
            html = fetch_category_page(cat_code, page_index, use_saving_url=use_saving)
            if not html:
                break

            file_infos = extract_file_infos(html)
            if not file_infos:
                break

            logger.info("  페이지 %d: %d개 파일 발견", page_index, len(file_infos))

            for file_no, seq in file_infos:
                file_key = f"{file_no}-{seq}"
                if file_key in seen_files:
                    continue
                seen_files.add(file_key)

                # 회사명/상품명 추출
                company_name, product_name = extract_product_info(html, file_no, seq)
                company_id = get_company_id(company_name) if company_name else "unknown_life"
                product_code = f"{cat_code}_{file_no}_{seq}"

                # 이미 있는 파일이면 스킵
                dest_dir = BASE_DIR / company_id
                dest_dir.mkdir(parents=True, exist_ok=True)
                dest_path = dest_dir / f"{product_code}.pdf"
                if dest_path.exists():
                    logger.debug("  스킵(기존): %s", dest_path.name)
                    continue

                time.sleep(RATE_LIMIT)
                pdf_bytes = download_pdf(file_no, seq)

                if not pdf_bytes:
                    failed.append({"file_no": file_no, "seq": seq, "company": company_name})
                    logger.warning("  PDF 실패: fileNo=%s seq=%s", file_no, seq)
                    continue

                # 저장
                dest_path.write_bytes(pdf_bytes)

                # 메타데이터 저장
                meta = {
                    "company_id": company_id,
                    "company_name": company_name or company_id,
                    "product_name": product_name or f"상품_{file_no}_{seq}",
                    "product_type": cat_name,
                    "source_url": f"{FILE_DOWN_URL}?fileNo={file_no}&seq={seq}",
                    "file_path": str(dest_path.relative_to(BASE_DIR)),
                    "file_hash": f"sha256:{hashlib.sha256(pdf_bytes).hexdigest()}",
                    # pub.insure.or.kr은 판매중 상품만 공시
                    "sale_status": "ON_SALE",
                    "crawled_at": datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+09:00"),
                    "file_size_bytes": len(pdf_bytes),
                    "category_code": cat_code,
                    "file_no": file_no,
                    "seq": seq,
                }
                meta_path = dest_path.with_suffix(".json")
                meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

                results.append({
                    "company_id": company_id,
                    "company_name": company_name,
                    "product_name": product_name,
                    "file": str(dest_path),
                })
                cat_count += 1
                logger.info("  저장: %s/%s [%s]", company_id, dest_path.name, company_name or "?")

            page_index += 1
            time.sleep(RATE_LIMIT)

        print(f"  → {cat_name}: {cat_count}개 신규 저장")

    # 보고서 저장
    report = {
        "generated_at": datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+09:00"),
        "total_saved": len(results),
        "total_failed": len(failed),
        "by_company": {},
    }
    for r in results:
        cid = r["company_id"]
        report["by_company"][cid] = report["by_company"].get(cid, 0) + 1

    report_path = BASE_DIR / "pub_insure_crawl_report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n{'='*60}")
    print(f"완료: {len(results)}개 저장 / {len(failed)}개 실패")
    print(f"회사별 분류:")
    for cid, cnt in sorted(report["by_company"].items()):
        print(f"  {cid}: {cnt}개")
    print(f"리포트: {report_path}")
    print("="*60)

    return report


if __name__ == "__main__":
    crawl_all_categories()
