#!/usr/bin/env python3
"""크롤링 공통 상수 및 유틸리티 모듈 (SPEC-CRAWL-001, TASK-001/002)

# @MX:ANCHOR: 회사명 정규화 및 PDF 저장의 핵심 모듈 - 모든 크롤러가 의존
# @MX:REASON: COMPANY_NAME_MAP, normalize_company_name, save_pdf_with_metadata 함수가
#             crawl_klia.py, crawl_real.py, classify_unknown.py, validate_crawl.py에서 사용됨
# @MX:SPEC: SPEC-CRAWL-001
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


# =============================================================================
# 회사명 → company_id 매핑
# =============================================================================

# @MX:NOTE: 동일 회사의 다양한 표기법을 모두 포함 (검색 용이성)
COMPANY_NAME_MAP: dict[str, str] = {
    # 생명보험사
    "삼성생명": "samsung_life", "삼성생명보험": "samsung_life",
    "한화생명": "hanwha_life", "한화생명보험": "hanwha_life",
    "교보생명": "kyobo_life", "교보생명보험": "kyobo_life",
    "신한라이프": "shinhan_life", "신한라이프생명": "shinhan_life", "신한생명": "shinhan_life",
    "흥국생명": "heungkuk_life",
    "동양생명": "dongyang_life",
    "미래에셋생명": "mirae_life", "미래에셋대우생명": "mirae_life",
    "NH농협생명": "nh_life", "농협생명": "nh_life",
    "DB생명": "db_life",
    "KDB생명": "kdb_life", "KDB산업은행생명": "kdb_life",
    "DGB생명": "dgb_life", "DGB다솜생명": "dgb_life",
    "하나생명": "hana_life",
    "AIA생명": "aia_life",
    "메트라이프": "metlife", "메트라이프생명": "metlife",
    "라이나생명": "lina_life", "라이나생명보험": "lina_life",
    "iM라이프": "im_life",
    "교보라이프플래닛": "kyobo_lifeplanet",
    "푸본현대생명": "fubon_hyundai_life", "현대라이프": "fubon_hyundai_life",
    "ABL생명": "abl_life",
    "BNP파리바카디프": "bnp_life", "BNP파리바카디프생명": "bnp_life",
    "IBK연금보험": "ibk_life",
    "KB라이프": "kb_life", "KB생명": "kb_life",
    # 손해보험사
    "삼성화재": "samsung_fire", "삼성화재해상": "samsung_fire",
    "현대해상": "hyundai_marine", "현대해상화재": "hyundai_marine",
    "DB손해보험": "db_insurance", "DB손보": "db_insurance",
    "KB손해보험": "kb_insurance", "KB손보": "kb_insurance",
    "메리츠화재": "meritz_fire", "메리츠화재해상": "meritz_fire",
    "한화손해보험": "hanwha_general", "한화손보": "hanwha_general",
    "흥국화재": "heungkuk_fire", "흥국화재해상": "heungkuk_fire",
    "AXA손해보험": "axa_general", "AXA손보": "axa_general",
    "하나손해보험": "hana_insurance", "하나손보": "hana_insurance",
    "MG손해보험": "mg_insurance", "MG손보": "mg_insurance",
    "NH농협손해보험": "nh_insurance", "농협손보": "nh_insurance",
    "롯데손해보험": "lotte_insurance", "롯데손보": "lotte_insurance",
}

# 생명보험사 ID 목록 (18개 공식 + 4개 레거시 = 22개)
LIFE_COMPANY_IDS: list[str] = [
    "samsung_life", "hanwha_life", "kyobo_life", "shinhan_life",
    "heungkuk_life", "dongyang_life", "mirae_life", "nh_life",
    "db_life", "kdb_life", "dgb_life", "hana_life", "aia_life",
    "metlife", "lina_life", "im_life", "kyobo_lifeplanet", "fubon_hyundai_life",
    # 레거시 ID (기존 데이터 디렉토리)
    "abl_life", "bnp_life", "ibk_life", "kb_life",
]

# 손해보험사 ID 목록 (12개)
NONLIFE_COMPANY_IDS: list[str] = [
    "samsung_fire", "hyundai_marine", "db_insurance", "kb_insurance",
    "meritz_fire", "hanwha_general", "heungkuk_fire", "axa_general",
    "hana_insurance", "mg_insurance", "nh_insurance", "lotte_insurance",
]

# 질병/상해 포함 키워드
DISEASE_INJURY_INCLUDE: list[str] = [
    "질병", "상해", "건강", "암", "치아", "치매", "간병", "실손", "의료", "CI", "GI",
]

# 제외 키워드 (이 키워드가 있으면 질병/상해 상품이 아님)
# 주의: "해상" 대신 "해상보험"을 사용하여 회사명(현대해상)과 구분
DISEASE_INJURY_EXCLUDE: list[str] = [
    "자동차", "화재", "보증", "책임", "배상", "운전자", "해상보험", "항공",
]


# =============================================================================
# 유틸리티 함수
# =============================================================================

def normalize_sale_status(raw: str | None) -> str:
    """판매 상태 문자열을 ON_SALE / DISCONTINUED / UNKNOWN 중 하나로 정규화한다.

    Args:
        raw: 크롤러에서 수집한 원본 판매 상태 문자열

    Returns:
        "ON_SALE", "DISCONTINUED", "UNKNOWN" 중 하나
    """
    if raw is None:
        return "UNKNOWN"
    v = str(raw).strip().upper()
    _on_sale = {"Y", "01", "ON_SALE", "판매중", "현재판매", "SALE", "ACTIVE", "TRUE", "1"}
    _discontinued = {"N", "02", "DISCONTINUED", "판매중지", "판매종료", "STOP", "ENDED", "FALSE", "0"}
    if v in _on_sale:
        return "ON_SALE"
    if v in _discontinued:
        return "DISCONTINUED"
    return "UNKNOWN"


def normalize_company_name(name: str) -> str | None:
    """회사명을 정규화된 company_id로 변환한다.

    Args:
        name: 보험사 이름 (예: "삼성생명", "삼성생명보험")

    Returns:
        company_id 문자열 또는 매핑이 없으면 None
    """
    stripped = name.strip()
    return COMPANY_NAME_MAP.get(stripped)


def is_disease_injury_product(product_name: str) -> bool:
    """상품명이 질병/상해 보험 상품인지 판별한다.

    제외 키워드가 포함 키워드보다 우선 적용된다.

    Args:
        product_name: 보험 상품명

    Returns:
        질병/상해 상품이면 True, 아니면 False
    """
    if not product_name:
        return False

    # 제외 키워드가 있으면 False (우선 처리)
    for keyword in DISEASE_INJURY_EXCLUDE:
        if keyword in product_name:
            return False

    # 포함 키워드 중 하나라도 있으면 True
    for keyword in DISEASE_INJURY_INCLUDE:
        if keyword in product_name:
            return True

    return False


def _slugify(text: str) -> str:
    """텍스트를 파일시스템 안전 문자열로 변환한다."""
    text = text.strip()
    safe = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", text)
    safe = safe.strip(".").strip()
    return safe[:80] or "unknown"


def save_pdf_with_metadata(
    data: bytes,
    company_id: str,
    company_name: str,
    product_name: str,
    product_type: str,
    source_url: str,
    base_dir: Path,
    sale_status: str = "ON_SALE",
) -> dict[str, Any]:
    """PDF 파일을 저장하고 메타데이터 JSON 파일을 생성한다.

    # @MX:ANCHOR: 모든 크롤러가 사용하는 PDF 저장 핵심 함수
    # @MX:REASON: crawl_klia.py, crawl_real.py, classify_unknown.py에서 호출됨

    Args:
        data: PDF 바이트 데이터
        company_id: 회사 식별자 (예: "samsung_life")
        company_name: 회사 한국어 이름 (예: "삼성생명")
        product_name: 상품명
        product_type: 상품 유형 (예: "질병보험", "상해보험")
        source_url: PDF 출처 URL
        base_dir: 기본 저장 디렉토리
        sale_status: 판매 상태 (정규화 전 원본값도 허용 - 내부에서 normalize_sale_status 적용)

    Returns:
        저장 결과 dict (file_path, file_hash, file_size_bytes 등 포함)
    """
    # 판매 상태 정규화
    sale_status = normalize_sale_status(sale_status)

    # 회사 디렉토리 생성
    company_dir = base_dir / company_id
    company_dir.mkdir(parents=True, exist_ok=True)

    # 파일명 생성 (상품명 기반)
    safe_product = _slugify(product_name)
    file_hash = hashlib.sha256(data).hexdigest()
    file_name = f"{safe_product}.pdf"
    file_path = company_dir / file_name

    # 중복 파일 처리: 같은 이름이 있으면 해시 추가
    if file_path.exists():
        file_name = f"{safe_product}_{file_hash[:8]}.pdf"
        file_path = company_dir / file_name

    # PDF 저장
    file_path.write_bytes(data)

    # 메타데이터 구성
    now_kst = datetime.now(tz=timezone.utc).astimezone(
        timezone(datetime.now(timezone.utc).utcoffset() or __import__("datetime").timedelta(hours=9))
    )
    # KST(+09:00) 시간으로 기록
    crawled_at = datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+09:00")

    metadata: dict[str, Any] = {
        "company_id": company_id,
        "company_name": company_name,
        "product_name": product_name,
        "product_type": product_type,
        "source_url": source_url,
        "file_path": str(file_path.relative_to(base_dir)) if base_dir in file_path.parents else str(file_path),
        "file_hash": f"sha256:{file_hash}",
        "sale_status": sale_status,
        "crawled_at": crawled_at,
        "file_size_bytes": len(data),
    }

    # 메타데이터 JSON 저장
    meta_path = file_path.with_suffix(".json")
    meta_path.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    return {
        "file_path": str(file_path),
        "file_hash": f"sha256:{file_hash}",
        "file_size_bytes": len(data),
        "company_id": company_id,
        "metadata_path": str(meta_path),
    }
