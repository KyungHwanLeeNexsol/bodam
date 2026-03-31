#!/usr/bin/env python3
"""SPEC-INGEST-001: 다중 PC 로컬 PDF 인제스트 스크립트

로컬에 수집된 PDF 파일을 PostgreSQL에 인제스트.
3가지 디렉토리 형식 지원, SHA-256 중복 방지, 파일별 트랜잭션 격리.

Usage:
    python scripts/ingest_local_pdfs.py
    python scripts/ingest_local_pdfs.py --company meritz_fire
    python scripts/ingest_local_pdfs.py --dry-run
    python scripts/ingest_local_pdfs.py --embed
    python scripts/ingest_local_pdfs.py --data-dir /path/to/data
"""

from __future__ import annotations

import argparse
import asyncio
import gc
import hashlib
import json
import logging
import re
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

# 프로젝트 루트를 Python 경로에 추가 (parser 임포트 전에 먼저 수행)
_project_root = Path(__file__).parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

# 파서 클래스 임포트 (process_single_file에서 모킹 가능하도록 모듈 레벨 임포트)
# 실제 임포트는 런타임에 시도하고 실패 시 None으로 처리
try:
    from app.services.parser.pdf_parser import PDFParser
    from app.services.parser.text_cleaner import TextCleaner
    from app.services.parser.text_chunker import TextChunker
except ImportError:
    PDFParser = None  # type: ignore[assignment,misc]
    TextCleaner = None  # type: ignore[assignment,misc]
    TextChunker = None  # type: ignore[assignment,misc]

# 환경변수 로딩 (.env 파일 지원)
try:
    from dotenv import load_dotenv
    load_dotenv(_project_root / ".env")
except ImportError:
    pass

# PDF 파싱용 thread executor (fitz는 동기 C 라이브러리 — asyncio 이벤트 루프 blocking 방지)
_PDF_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="pdf-parse")
# 단일 PDF 파싱 타임아웃 (비표준 PDF가 fitz 내부 루프에 빠지는 것 방지)
_PDF_PARSE_TIMEOUT = 120  # seconds

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("ingest_local_pdfs")

# @MX:NOTE: [AUTO] policies.raw_text 최대 저장 길이
# 대용량 PDF(7MB+) 텍스트를 제한하여 DB 부하 최소화
# 청크(PolicyChunk)는 full text로 생성하므로 검색 품질에 영향 없음
_MAX_POLICY_RAW_TEXT = 500_000  # 약 500KB 텍스트

# ─────────────────────────────────────────────────────────────
# COMPANY_MAP: 크롤러 디렉터리명 → (code, name, category)
# ─────────────────────────────────────────────────────────────
# # @MX:ANCHOR: [AUTO] COMPANY_MAP - 크롤러 디렉터리와 DB 보험사 코드 매핑
# # @MX:REASON: 3개 이상의 함수(detect_format, extract_metadata, scan_data_directory)가 참조
# # @MX:SPEC: SPEC-INGEST-001 REQ-09
COMPANY_MAP: dict[str, tuple[str, str, str]] = {
    # 손보사
    "meritz_fire": ("meritz-fire", "메리츠화재", "NON_LIFE"),
    "hyundai_marine": ("hyundai-marine", "현대해상", "NON_LIFE"),
    "kb_insurance": ("kb-insurance", "KB손해보험", "NON_LIFE"),
    "kb-nonlife": ("kb-nonlife", "KB손해보험", "NON_LIFE"),  # KB손보 크롤러 저장 디렉터리명
    "samsung_fire": ("samsung-fire", "삼성화재", "NON_LIFE"),
    "samsung-fire": ("samsung-fire", "삼성화재", "NON_LIFE"),  # 삼성화재 크롤러 저장 디렉터리명
    "db_insurance": ("db-insurance", "DB손해보험", "NON_LIFE"),
    "db-nonlife": ("db-nonlife", "DB손해보험", "NON_LIFE"),  # DB손보 크롤러 저장 디렉터리명
    "heungkuk_fire": ("heungkuk-fire", "흥국화재", "NON_LIFE"),
    "axa_general": ("axa-general", "AXA손해보험", "NON_LIFE"),
    "mg_insurance": ("mg-insurance", "MG손해보험", "NON_LIFE"),
    "nh_fire": ("nh-fire", "NH농협손해보험", "NON_LIFE"),
    "lotte_insurance": ("lotte-insurance", "롯데손해보험", "NON_LIFE"),
    "hanwha_general": ("hanwha-general", "한화손해보험", "NON_LIFE"),
    # 생보사
    "abl": ("abl", "ABL생명", "LIFE"),
    "aia": ("aia", "AIA생명", "LIFE"),
    "bnp_life": ("bnp-life", "BNP파리바카디프생명", "LIFE"),
    "chubb_life": ("chubb-life", "처브라이프생명", "LIFE"),
    "db": ("db-life", "DB생명", "LIFE"),
    "dongyang_life": ("dongyang-life", "동양생명", "LIFE"),
    "fubon_hyundai_life": ("fubon-hyundai-life", "푸본현대생명", "LIFE"),
    "hana_life": ("hana-life", "하나생명", "LIFE"),
    "hanwha_life": ("hanwha-life", "한화생명", "LIFE"),
    "heungkuk_life": ("heungkuk-life", "흥국생명", "LIFE"),
    "im_life": ("im-life", "iM라이프", "LIFE"),
    "kb_life": ("kb-life", "KB라이프생명", "LIFE"),
    "kdb": ("kdb-life", "KDB생명", "LIFE"),
    "kyobo_life": ("kyobo-life", "교보생명", "LIFE"),
    "kyobo_lifeplanet": ("kyobo-lifeplanet", "교보라이프플래닛생명", "LIFE"),
    "lina_life": ("lina-life", "라이나생명", "LIFE"),
    "metlife": ("metlife", "메트라이프생명", "LIFE"),
    "mirae_life": ("mirae-life", "미래에셋생명", "LIFE"),
    "nh": ("nh-life", "NH농협생명", "LIFE"),
    "samsung_life": ("samsung-life", "삼성생명", "LIFE"),
    "shinhan_life": ("shinhan-life", "신한라이프생명", "LIFE"),
    "unknown_life": ("unknown-life", "기타생명", "LIFE"),
}

# 숫자형 디렉터리 패턴 (Format A): 예) 10000-0001, 12345_6789
_NUMERIC_DIR_PATTERN = re.compile(r"^\d+[-_]\d+$")


# ─────────────────────────────────────────────────────────────
# TASK-001: detect_format()
# ─────────────────────────────────────────────────────────────


def detect_format(dir_path: Path) -> str:
    """디렉터리 경로로부터 PDF 디렉터리 형식을 감지한다.

    Args:
        dir_path: 감지할 디렉터리 경로

    Returns:
        "A": 숫자형 디렉터리 (공시보험/생보 형식)
        "B": COMPANY_MAP에 등록된 보험사 디렉터리
        "C": 기타 (폴백)
    """
    dir_name = dir_path.name
    if _NUMERIC_DIR_PATTERN.match(dir_name):
        return "A"
    if dir_name in COMPANY_MAP:
        return "B"
    return "C"


# ─────────────────────────────────────────────────────────────
# TASK-004: compute_file_hash() + check_duplicate()
# ─────────────────────────────────────────────────────────────


def compute_file_hash(file_path: str) -> str:
    """파일의 SHA-256 해시를 16진수 문자열로 반환한다.

    대용량 파일도 처리할 수 있도록 청크 방식으로 읽는다.

    Args:
        file_path: 해시를 계산할 파일 경로

    Returns:
        SHA-256 16진수 해시 문자열 (64자)
    """
    sha256 = hashlib.sha256()
    chunk_size = 65536  # 64KB 청크
    with open(file_path, "rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            sha256.update(chunk)
    return sha256.hexdigest()


async def check_duplicate(
    session: "AsyncSession",
    content_hash: str,
    sale_status: str | None = None,
) -> bool:
    """content_hash가 이미 Policy.metadata_에 존재하는지 확인한다.

    # @MX:NOTE: [AUTO] sale_status 지정 시 (content_hash, sale_status) 조합으로 체크
    # @MX:NOTE: [AUTO] 동일 PDF라도 ON_SALE/DISCONTINUED는 별개 레코드 허용

    Args:
        session: SQLAlchemy 비동기 세션
        content_hash: 확인할 SHA-256 해시 문자열
        sale_status: 판매상태 ("ON_SALE", "DISCONTINUED" 등). None이면 content_hash만 체크.

    Returns:
        True: 중복 존재, False: 신규
    """
    from sqlalchemy import select
    from sqlalchemy.orm import noload

    from app.models.insurance import Policy

    # sale_status가 주어지면 (content_hash, sale_status) 조합으로 체크
    # → 동일 PDF가 판매/판매중지 탭 양쪽에 노출되는 경우 각각 별도 레코드 허용
    if sale_status is not None:
        stmt = (
            select(Policy)
            .where(
                Policy.metadata_["content_hash"].astext == content_hash,
                Policy.sale_status == sale_status,
            )
            # noload: chunks/coverages selectin 자동 로딩 차단 - 중복 여부만 확인하면 됨
            .options(noload(Policy.chunks), noload(Policy.coverages))
        )
    else:
        stmt = (
            select(Policy)
            .where(Policy.metadata_["content_hash"].astext == content_hash)
            .options(noload(Policy.chunks), noload(Policy.coverages))
        )
    result = await session.execute(stmt)
    existing = result.scalars().first()
    return existing is not None


# @MX:ANCHOR: [AUTO] DB에 저장된 source_url 조회 - 크롤러 재시작 시 중복 다운로드 방지
# @MX:REASON: Samsung/DB/KB/현대해상 크롤러에서 호출되는 공유 유틸리티
async def load_processed_urls(
    session: "AsyncSession",
    company_code: str | None = None,
) -> set[str]:
    """DB에 저장된 Policy의 source_url을 set으로 반환한다.

    크롤러 시작 시 한 번 호출해 in-memory set을 만들면,
    각 PDF 다운로드 전 이미 처리된 URL인지 O(1)로 확인할 수 있다.

    Args:
        session: SQLAlchemy 비동기 세션
        company_code: 보험사 코드로 필터링 (예: "samsung-fire").
                      None이면 전체 보험사의 URL을 반환한다.

    Returns:
        이미 DB에 저장된 source_url 값들의 집합
    """
    from sqlalchemy import select

    from app.models.insurance import InsuranceCompany, Policy

    stmt = select(
        Policy.metadata_["source_url"].astext
    ).where(
        Policy.metadata_["source_url"].astext.isnot(None)
    )

    if company_code is not None:
        stmt = stmt.join(InsuranceCompany, Policy.company_id == InsuranceCompany.id).where(
            InsuranceCompany.code == company_code
        )

    result = await session.execute(stmt)
    rows = result.scalars().all()
    return set(rows)


# ─────────────────────────────────────────────────────────────
# TASK-008: parse_args()
# ─────────────────────────────────────────────────────────────


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """CLI 인자를 파싱한다.

    Args:
        argv: 인자 목록 (None이면 sys.argv[1:] 사용)

    Returns:
        파싱된 argparse.Namespace 객체
    """
    parser = argparse.ArgumentParser(
        description="로컬 PDF 파일을 PostgreSQL에 인제스트",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
사용 예시:
  python scripts/ingest_local_pdfs.py
  python scripts/ingest_local_pdfs.py --company meritz_fire
  python scripts/ingest_local_pdfs.py --dry-run
  python scripts/ingest_local_pdfs.py --embed
  python scripts/ingest_local_pdfs.py --data-dir /path/to/data
        """,
    )

    parser.add_argument(
        "--company",
        default=None,
        help="처리할 보험사 필터 (예: meritz_fire). 미지정 시 전체 처리.",
    )
    parser.add_argument(
        "--dry-run",
        dest="dry_run",
        action="store_true",
        default=False,
        help="DB에 실제로 쓰지 않고 처리 결과만 출력",
    )
    parser.add_argument(
        "--embed",
        action="store_true",
        default=False,
        help="청크 생성 후 임베딩 벡터도 생성",
    )
    parser.add_argument(
        "--data-dir",
        dest="data_dir",
        default=str(_project_root / "data"),
        help="PDF 데이터 디렉터리 경로 (기본값: backend/data)",
    )

    return parser.parse_args(argv)


# ─────────────────────────────────────────────────────────────
# TASK-010: generate_report()
# ─────────────────────────────────────────────────────────────


def generate_report(stats: dict[str, int]) -> str:
    """처리 통계를 포맷된 문자열 리포트로 반환한다.

    Args:
        stats: {"total", "success", "skipped", "failed", "on_sale", "discontinued", "unknown"} 통계 딕셔너리

    Returns:
        포맷된 요약 리포트 문자열
    """
    separator = "=" * 50
    lines = [
        "",
        separator,
        "로컬 PDF 인제스트 결과",
        separator,
        f"전체 파일:   {stats.get('total', 0):>8,}개",
        f"성공:        {stats.get('success', 0):>8,}개",
        f"스킵(중복):  {stats.get('skipped', 0):>8,}개",
        f"실패:        {stats.get('failed', 0):>8,}개",
        f"dry-run:     {stats.get('dry_run', 0):>8,}개",
        separator,
        "판매 상태 분포 (성공 처리 기준)",
        f"  ON_SALE:      {stats.get('on_sale', 0):>6,}개",
        f"  DISCONTINUED: {stats.get('discontinued', 0):>6,}개",
        f"  UNKNOWN:      {stats.get('unknown', 0):>6,}개",
        separator,
        "",
    ]
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────
# TASK-011: save_failure_log()
# ─────────────────────────────────────────────────────────────


def save_failure_log(failures: list[dict[str, Any]], output_dir: Path) -> Path | None:
    """실패한 파일 목록을 JSON 파일로 저장한다.

    Args:
        failures: 실패 정보 딕셔너리 목록 ({"file": ..., "error": ...})
        output_dir: JSON 파일을 저장할 디렉터리

    Returns:
        저장된 파일 경로, 실패 목록이 비어 있으면 None
    """
    if not failures:
        return None

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_file = output_dir / f"ingest_failures_{timestamp}.json"

    with open(log_file, "w", encoding="utf-8") as f:
        json.dump(failures, f, ensure_ascii=False, indent=2)

    logger.info("실패 로그 저장: %s (%d건)", log_file, len(failures))
    return log_file


# ─────────────────────────────────────────────────────────────
# TASK-002: scan_data_directory()
# ─────────────────────────────────────────────────────────────


def scan_data_directory(
    data_dir: Path,
    company_filter: str | None = None,
) -> list[tuple[Path, str]]:
    """data 디렉터리를 스캔하여 (pdf_path, format_type) 목록을 반환한다.

    Args:
        data_dir: 스캔할 루트 데이터 디렉터리
        company_filter: 특정 보험사 디렉터리만 스캔 (None이면 전체)

    Returns:
        (pdf_path, format_type) 튜플 목록
    """
    results: list[tuple[Path, str]] = []

    if not data_dir.exists():
        logger.warning("data 디렉터리가 없습니다: %s", data_dir)
        return results

    for sub_dir in data_dir.iterdir():
        if not sub_dir.is_dir():
            continue

        # company_filter 적용
        if company_filter is not None and sub_dir.name != company_filter:
            continue

        fmt = detect_format(sub_dir)

        # Format C는 지원하지 않음 (스킵)
        if fmt == "C":
            logger.debug("Format C 디렉터리 건너뜀: %s", sub_dir)
            continue

        # PDF 파일 검색 (중첩 디렉터리 포함 재귀 탐색)
        for pdf_file in sub_dir.rglob("*.pdf"):
            results.append((pdf_file, fmt))

    logger.info("스캔 완료: %d개 PDF 발견 (data_dir=%s)", len(results), data_dir)
    return results


# ─────────────────────────────────────────────────────────────
# TASK-003: extract_metadata()
# ─────────────────────────────────────────────────────────────


def _normalize_sale_status(raw: str | None) -> str:
    """판매 상태 문자열을 정규화한다.

    ON_SALE(판매중) / DISCONTINUED(판매중지) / UNKNOWN(미확인) 중 하나를 반환.
    """
    if raw is None:
        return "UNKNOWN"
    v = str(raw).strip().upper()
    on_sale = {"Y", "01", "ON_SALE", "판매중", "현재판매", "SALE", "ACTIVE", "TRUE"}
    discontinued = {"N", "02", "DISCONTINUED", "판매중지", "판매종료", "STOP", "ENDED", "FALSE"}
    if v in on_sale:
        return "ON_SALE"
    if v in discontinued:
        return "DISCONTINUED"
    return "UNKNOWN"


def extract_metadata(pdf_path: Path, data_dir: Path) -> dict[str, Any]:
    """PDF 경로로부터 메타데이터를 추출한다.

    Format A: 디렉터리명에서 product_code 추출, company는 pub-insure
    Format B: 동일 위치 JSON 파일 또는 COMPANY_MAP에서 추출
    Format C: 최소한의 폴백 메타데이터 반환

    Args:
        pdf_path: PDF 파일 경로
        data_dir: 루트 data 디렉터리 (format 감지용)

    Returns:
        메타데이터 딕셔너리 (company_code, company_name, product_code, sale_status, ...)
    """
    # 중첩 디렉터리 지원: 직접 부모에서 회사 디렉터리까지 올라가며 format 감지
    # 예) samsung-fire/장기-건강/file.pdf → 장기-건강(C) → samsung-fire(B)
    parent_dir = pdf_path.parent
    fmt = detect_format(parent_dir)
    while fmt == "C" and parent_dir != data_dir and parent_dir.parent != parent_dir:
        parent_dir = parent_dir.parent
        fmt = detect_format(parent_dir)

    if fmt == "A":
        # Format A: 숫자형 디렉터리 = 공시보험 (LIFE)
        product_code = parent_dir.name
        return {
            "format_type": "A",
            "company_code": "pub-insure",
            "company_name": "공시보험",
            "product_code": product_code,
            "product_name": product_code,
            "category": "LIFE",
            "source_url": None,
            "sale_status": "UNKNOWN",
        }

    if fmt == "B":
        company_key = parent_dir.name
        code, name, category = COMPANY_MAP[company_key]

        # JSON 파일 탐색 (같은 디렉터리, 같은 스템)
        json_file = pdf_path.with_suffix(".json")
        if json_file.exists():
            try:
                with open(json_file, encoding="utf-8") as f:
                    json_data = json.load(f)
                # JSON에서 제공된 product_name 우선 사용
                product_name = json_data.get("product_name", pdf_path.stem)
                return {
                    "format_type": "B",
                    "company_code": code,
                    "company_name": name,
                    "product_code": pdf_path.stem,
                    "product_name": product_name,
                    "category": json_data.get("category", category),
                    "source_url": json_data.get("source_url"),
                    "json_content_hash": json_data.get("content_hash"),
                    "sale_status": _normalize_sale_status(json_data.get("sale_status")),
                }
            except (json.JSONDecodeError, OSError) as e:
                logger.warning("JSON 파일 파싱 실패: %s (%s)", json_file, e)

        # JSON 없으면 COMPANY_MAP에서 폴백
        return {
            "format_type": "B",
            "company_code": code,
            "company_name": name,
            "product_code": pdf_path.stem,
            "product_name": pdf_path.stem,
            "category": category,
            "source_url": None,
            "sale_status": "UNKNOWN",
        }

    # Format C: 폴백
    return {
        "format_type": "C",
        "company_code": "unknown",
        "company_name": "알 수 없음",
        "product_code": pdf_path.stem,
        "product_name": pdf_path.stem,
        "category": "LIFE",
        "source_url": None,
        "sale_status": "UNKNOWN",
    }


# ─────────────────────────────────────────────────────────────
# TASK-005: ensure_company()
# ─────────────────────────────────────────────────────────────


async def ensure_company(
    session: "AsyncSession",
    company_code: str,
    company_name: str,
    category: str,  # noqa: ARG001 (미래 확장용)
) -> Any:
    """보험사 레코드를 조회하거나 없으면 생성한다.

    Args:
        session: SQLAlchemy 비동기 세션
        company_code: 보험사 고유 코드 (예: meritz-fire)
        company_name: 보험사 명칭
        category: 보험 카테고리 (현재 미사용, 미래 확장용)

    Returns:
        InsuranceCompany 인스턴스
    """
    from sqlalchemy import select
    from sqlalchemy.orm import noload

    from app.models.insurance import InsuranceCompany

    # noload: policies selectin 자동 로딩 차단 - ensure_company는 id/code만 필요
    stmt = (
        select(InsuranceCompany)
        .where(InsuranceCompany.code == company_code)
        .options(noload(InsuranceCompany.policies))
    )
    result = await session.execute(stmt)
    company = result.scalar_one_or_none()

    if company is None:
        company = InsuranceCompany(
            id=uuid.uuid4(),
            code=company_code,
            name=company_name,
            is_active=True,
        )
        session.add(company)
        await session.flush()
        logger.info("보험사 생성: %s (%s)", company_code, company_name)

    return company


# ─────────────────────────────────────────────────────────────
# TASK-006: upsert_policy() + create_chunks()
# ─────────────────────────────────────────────────────────────


async def upsert_policy(
    session: "AsyncSession",
    company: Any,
    metadata: dict[str, Any],
    content_hash: str,
    raw_text: str,
) -> Any:
    """Policy 레코드를 upsert한다 (company_id + product_code 기준).

    INSERT ... ON CONFLICT DO UPDATE 단일 원자적 구문으로 처리.

    Args:
        session: SQLAlchemy 비동기 세션
        company: InsuranceCompany 인스턴스
        metadata: 메타데이터 딕셔너리 (product_code, product_name, category 포함)
        content_hash: SHA-256 해시 (Policy.metadata_ JSONB에 저장)
        raw_text: 추출 및 정제된 약관 텍스트

    Returns:
        policy.id를 담은 SimpleNamespace (id 속성)
    """
    from types import SimpleNamespace

    from sqlalchemy import func
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    from app.models.insurance import InsuranceCategory, Policy

    product_code = metadata["product_code"]
    product_name = metadata.get("product_name", product_code)
    category_str = metadata.get("category", "LIFE")

    # InsuranceCategory enum 변환
    try:
        category = InsuranceCategory(category_str)
    except ValueError:
        category = InsuranceCategory.LIFE

    policy_metadata = {"content_hash": content_hash}
    if metadata.get("source_url"):
        policy_metadata["source_url"] = metadata["source_url"]

    sale_status = metadata.get("sale_status", "UNKNOWN")

    # 대용량 텍스트 트런케이션: DB 부하 최소화
    # PolicyChunk는 트런케이션 전 full text로 생성되므로 검색 품질에 영향 없음
    if len(raw_text) > _MAX_POLICY_RAW_TEXT:
        logger.warning(
            "raw_text 트런케이션: %s/%s (%d자 → %d자)",
            company.code, product_code, len(raw_text), _MAX_POLICY_RAW_TEXT,
        )
        raw_text = raw_text[:_MAX_POLICY_RAW_TEXT]

    # @MX:NOTE: [AUTO] INSERT ... ON CONFLICT DO UPDATE: 동시 삽입 안전한 원자적 UPSERT 패턴
    new_id = uuid.uuid4()
    insert_stmt = pg_insert(Policy).values(
        id=new_id,
        company_id=company.id,
        name=product_name,
        product_code=product_code,
        category=category,
        raw_text=raw_text,
        metadata_=policy_metadata,
        sale_status=sale_status,
    )
    upsert_stmt = insert_stmt.on_conflict_do_update(
        constraint="uq_policy_company_product",
        set_={
            "name": insert_stmt.excluded.name,
            "raw_text": insert_stmt.excluded.raw_text,
            "metadata_": insert_stmt.excluded.metadata_,
            "sale_status": insert_stmt.excluded.sale_status,
            "updated_at": func.now(),
        },
    ).returning(Policy.id)

    result = await session.execute(upsert_stmt)
    policy_id = result.scalar_one()

    if policy_id == new_id:
        logger.debug("Policy 생성: %s / %s (sale_status=%s)", company.code, product_code, sale_status)
    else:
        logger.debug("Policy 업데이트: %s / %s (sale_status=%s)", company.code, product_code, sale_status)

    return SimpleNamespace(id=policy_id)


async def create_chunks(
    session: "AsyncSession",
    policy_id: uuid.UUID,
    chunks: list[str],
    embeddings: list[list[float] | None] | None = None,
) -> None:
    """PolicyChunk 레코드를 생성한다.

    Args:
        session: SQLAlchemy 비동기 세션
        policy_id: 소속 Policy UUID
        chunks: 청크 텍스트 목록
        embeddings: 청크별 임베딩 벡터 목록 (None이면 embedding=NULL)
    """
    # @MX:NOTE: [AUTO] bulk insert로 N개 개별 INSERT → 단일 배치 INSERT로 최적화
    from sqlalchemy import insert

    from app.models.insurance import PolicyChunk

    rows = [
        {
            "id": uuid.uuid4(),
            "policy_id": policy_id,
            "chunk_text": chunk_text,
            "chunk_index": idx,
            "embedding": (embeddings[idx] if embeddings is not None and idx < len(embeddings) else None),
        }
        for idx, chunk_text in enumerate(chunks)
    ]
    if rows:
        await session.execute(
            insert(PolicyChunk),
            rows,
        )


# ─────────────────────────────────────────────────────────────
# TASK-007: process_single_file()
# ─────────────────────────────────────────────────────────────


# @MX:ANCHOR: [AUTO] process_single_file - 파일별 인제스트 핵심 함수
# @MX:REASON: crawl_and_ingest_samsung/db/kb 등 3개 파이프라인에서 호출됨
async def process_single_file(
    session_factory: Any,
    pdf_path: Path,
    metadata: dict[str, Any],
    dry_run: bool = False,
    embedding_service: Any | None = None,
) -> dict[str, Any]:
    """단일 PDF 파일을 처리하고 결과 딕셔너리를 반환한다.

    파일별 독립적인 트랜잭션으로 처리 (REQ-05).
    중복 파일(content_hash 기준)은 스킵 (REQ-06).

    Args:
        session_factory: SQLAlchemy async_sessionmaker
        pdf_path: 처리할 PDF 파일 경로
        metadata: extract_metadata()로 추출한 메타데이터
        dry_run: True이면 DB에 실제로 쓰지 않음
        embedding_service: 임베딩 서비스 인스턴스 (None이면 임베딩 생략)

    Returns:
        {"status": "success"|"skipped"|"dry_run"|"failed",
         "chunk_count": int, "error": str|None}
    """
    # 파일 해시 계산
    content_hash = compute_file_hash(str(pdf_path))

    # dry-run 모드: DB 없이 전처리만 수행
    if dry_run:
        parser = PDFParser()
        cleaner = TextCleaner()
        chunker = TextChunker()

        loop = asyncio.get_event_loop()
        try:
            raw_text = await asyncio.wait_for(
                loop.run_in_executor(_PDF_EXECUTOR, parser.extract_text, str(pdf_path)),
                timeout=_PDF_PARSE_TIMEOUT,
            )
        except asyncio.TimeoutError:
            return {"status": "failed", "chunk_count": 0, "error": f"PDF 파싱 타임아웃 ({_PDF_PARSE_TIMEOUT}s): {pdf_path.name}"}
        clean_text = cleaner.clean(raw_text)
        chunks = chunker.chunk_text(clean_text)

        logger.info(
            "[dry-run] %s: %d청크 (hash=%s)",
            pdf_path.name,
            len(chunks),
            content_hash[:8],
        )
        return {"status": "dry_run", "chunk_count": len(chunks), "error": None}

    # 1단계: 트랜잭션 밖에서 전처리 (멱등성 보장 - 재시도 시 재실행 불필요)
    # PDF 파싱 및 텍스트 처리 (CPU 집약적, 수 분 소요 가능)
    parser = PDFParser()
    cleaner = TextCleaner()
    chunker = TextChunker()

    try:
        loop = asyncio.get_event_loop()
        raw_text = await asyncio.wait_for(
            loop.run_in_executor(_PDF_EXECUTOR, parser.extract_text, str(pdf_path)),
            timeout=_PDF_PARSE_TIMEOUT,
        )
    except asyncio.TimeoutError:
        logger.error(
            "PDF 파싱 타임아웃 (%ds 초과): %s — 비표준 PDF 구조로 fitz 내부 루프 추정, 건너뜀",
            _PDF_PARSE_TIMEOUT,
            pdf_path.name,
        )
        return {"status": "failed", "chunk_count": 0, "error": f"PDF 파싱 타임아웃 ({_PDF_PARSE_TIMEOUT}s): {pdf_path.name}"}
    except Exception as e:
        return {"status": "failed", "chunk_count": 0, "error": f"PDF 파싱 실패: {e}"}
    clean_text = cleaner.clean(raw_text)
    chunks = chunker.chunk_text(clean_text)

    # 임베딩 생성 (네트워크 I/O, 수십 초 소요 가능)
    embeddings: list[list[float] | None] | None = None
    if embedding_service is not None and chunks:
        try:
            raw_embeddings = await embedding_service.embed_batch(chunks)
            embeddings = raw_embeddings
        except Exception as e:
            logger.warning("임베딩 생성 실패 (건너뜀): %s", e)

    # DB 트랜잭션: 전처리 결과를 저장 (DBAPIError 시 최대 5회 재시도)
    # Fly.io 프록시 재시작에 최대 2분 소요 → 10s→20s→40s→80s→160s 지수 백오프
    import sqlalchemy.exc

    for db_attempt in range(1, 6):
        try:
            async with session_factory() as session:
                # 중복 확인 (REQ-04, REQ-06)
                # sale_status 전달: 동일 PDF라도 ON_SALE/DISCONTINUED는 별개 레코드
                is_dup = await check_duplicate(session, content_hash, metadata.get("sale_status"))
                if is_dup:
                    logger.debug("중복 스킵: %s (hash=%s)", pdf_path.name, content_hash[:8])
                    return {"status": "skipped", "chunk_count": 0, "error": None}

                # 보험사 확보
                company = await ensure_company(
                    session,
                    metadata["company_code"],
                    metadata["company_name"],
                    metadata.get("category", "LIFE"),
                )

                # Policy upsert
                # raw_text 크기 제한: DB 부하 최소화 (전체 텍스트는 PolicyChunks에 저장됨)
                _MAX_RAW_TEXT = 100_000
                if len(clean_text) > _MAX_RAW_TEXT:
                    logger.debug("raw_text 절단: %d → %d 문자 (%s)", len(clean_text), _MAX_RAW_TEXT, pdf_path.name)
                    clean_text_for_db = clean_text[:_MAX_RAW_TEXT]
                else:
                    clean_text_for_db = clean_text
                policy = await upsert_policy(
                    session, company, metadata, content_hash, clean_text_for_db
                )

                # PolicyChunk 생성
                await create_chunks(session, policy.id, chunks, embeddings)

                await session.commit()

                logger.info(
                    "처리 완료: %s (%d청크, hash=%s)",
                    pdf_path.name,
                    len(chunks),
                    content_hash[:8],
                )
                return {
                    "status": "success",
                    "chunk_count": len(chunks),
                    "sale_status": metadata.get("sale_status", "UNKNOWN"),
                    "error": None,
                }

        except sqlalchemy.exc.DBAPIError as e:
            # DB 연결 오류 (ConnectionDoesNotExistError 등) → 새 세션으로 재시도
            if db_attempt >= 5:
                logger.error("처리 실패 (DB 재시도 5회 소진): %s (%s)", pdf_path.name, e, exc_info=True)
                return {"status": "failed", "chunk_count": 0, "sale_status": "UNKNOWN", "error": str(e)}
            wait_sec = 10 * (2 ** (db_attempt - 1))  # 10s, 20s, 40s, 80s
            # ReadOnlySQLTransactionError: Fly.io 프록시가 레플리카로 라우팅 중
            # pool_pre_ping은 살아있는 read-only 연결을 감지하지 못함 → 엔진 풀 전체 폐기하여
            # 다음 재시도에서 새 primary 연결 강제
            if "read-only transaction" in str(e).lower():
                import app.core.database as _db
                if _db.engine is not None:
                    await _db.engine.dispose()
                    logger.warning(
                        "DB 풀 초기화 (read-only 연결 폐기) → %ds 후 primary 재연결 시도", wait_sec
                    )
            logger.warning(
                "DB 연결 일시 실패 (시도 %d/5), %ds 후 새 세션으로 재시도: %s",
                db_attempt, wait_sec, e,
            )
            await asyncio.sleep(wait_sec)

        except Exception as e:
            logger.error("처리 실패: %s (%s)", pdf_path.name, e, exc_info=True)
            return {"status": "failed", "chunk_count": 0, "sale_status": "UNKNOWN", "error": str(e)}

    # 도달 불가 (루프 내에서 항상 return 또는 재시도)
    return {"status": "failed", "chunk_count": 0, "sale_status": "UNKNOWN", "error": "DB 재시도 5회 초과"}


async def process_text_content(
    session_factory: Any,
    raw_text: str,
    metadata: dict[str, Any],
    dry_run: bool = False,
    embedding_service: Any | None = None,
    source_name: str = "unknown",
) -> dict[str, Any]:
    """추출된 텍스트를 직접 인제스트한다 (HWPX 등 비-PDF 포맷 지원).

    PDF 파싱 단계를 건너뛰고 raw_text에서 바로 청킹·저장한다.
    process_single_file과 동일한 DB 트랜잭션 패턴 사용.

    Args:
        session_factory: SQLAlchemy async_sessionmaker
        raw_text: 이미 추출된 원본 텍스트
        metadata: extract_metadata()로 추출한 메타데이터
        dry_run: True이면 DB에 실제로 쓰지 않음
        embedding_service: 임베딩 서비스 인스턴스 (None이면 임베딩 생략)
        source_name: 로그용 파일/상품명

    Returns:
        {"status": "success"|"skipped"|"dry_run"|"failed",
         "chunk_count": int, "error": str|None}
    """
    import hashlib

    content_hash = hashlib.sha256(raw_text.encode()).hexdigest()

    cleaner = TextCleaner()
    chunker = TextChunker()

    if dry_run:
        clean_text = cleaner.clean(raw_text)
        chunks = chunker.chunk_text(clean_text)
        logger.info("[dry-run] %s: %d청크 (hash=%s)", source_name, len(chunks), content_hash[:8])
        return {"status": "dry_run", "chunk_count": len(chunks), "error": None}

    clean_text = cleaner.clean(raw_text)
    chunks = chunker.chunk_text(clean_text)

    if not chunks:
        return {"status": "failed", "chunk_count": 0, "error": "텍스트 추출 결과가 비어 있음"}

    # 임베딩 생성 (네트워크 I/O)
    embeddings: list[list[float] | None] | None = None
    if embedding_service is not None:
        try:
            raw_embeddings = await embedding_service.embed_batch(chunks)
            embeddings = raw_embeddings
        except Exception as e:
            logger.warning("임베딩 생성 실패 (건너뜀): %s", e)

    try:
        async with session_factory() as session:
            is_dup = await check_duplicate(session, content_hash, metadata.get("sale_status"))
            if is_dup:
                logger.debug("중복 스킵: %s (hash=%s)", source_name, content_hash[:8])
                return {"status": "skipped", "chunk_count": 0, "error": None}

            company = await ensure_company(
                session,
                metadata["company_code"],
                metadata["company_name"],
                metadata.get("category", "LIFE"),
            )

            _MAX_RAW_TEXT = 100_000
            clean_text_for_db = clean_text[:_MAX_RAW_TEXT] if len(clean_text) > _MAX_RAW_TEXT else clean_text
            policy = await upsert_policy(session, company, metadata, content_hash, clean_text_for_db)
            await create_chunks(session, policy.id, chunks, embeddings)
            await session.commit()

            logger.info("처리 완료: %s (%d청크, hash=%s)", source_name, len(chunks), content_hash[:8])
            return {
                "status": "success",
                "chunk_count": len(chunks),
                "sale_status": metadata.get("sale_status", "UNKNOWN"),
                "error": None,
            }

    except Exception as e:
        logger.error("처리 실패: %s (%s)", source_name, e, exc_info=True)
        return {"status": "failed", "chunk_count": 0, "sale_status": "UNKNOWN", "error": str(e)}


# ─────────────────────────────────────────────────────────────
# TASK-012: main() + TASK-009: dry-run + TASK-013: --embed
# ─────────────────────────────────────────────────────────────


async def init_database(settings: Any) -> None:
    """DB 모듈을 임포트하여 초기화한다 (모킹 가능하도록 분리)."""
    import app.core.database as _db_module

    await _db_module.init_database(settings)


# # @MX:NOTE: [AUTO] main()은 argv 파라미터를 받아 테스트 가능하도록 설계됨
async def main(argv: list[str] | None = None) -> None:
    """메인 진입점 - PDF 인제스트 파이프라인 실행.

    Args:
        argv: CLI 인자 목록 (None이면 sys.argv[1:] 사용)
    """
    import app.core.database as db_module  # noqa: F401 (type checking용)

    args = parse_args(argv)
    data_dir = Path(args.data_dir)

    # DB 초기화
    try:
        from app.core.config import Settings
        settings = Settings()  # type: ignore[call-arg]
        await init_database(settings)
    except Exception as e:
        logger.error("DB 초기화 실패: %s", e)
        return

    import app.core.database as _db
    if _db.session_factory is None:
        logger.error("DB 세션 팩토리 초기화 실패")
        return

    # data 디렉터리 확인
    if not data_dir.exists():
        logger.error("data 디렉터리가 없습니다: %s", data_dir)
        return

    # PDF 파일 스캔
    pdf_list = scan_data_directory(data_dir, company_filter=args.company)
    if not pdf_list:
        logger.info("처리할 PDF 파일이 없습니다.")
        print(generate_report({"total": 0, "success": 0, "skipped": 0, "failed": 0, "dry_run": 0}))
        return

    # 임베딩 서비스 초기화 (--embed 옵션)
    embedding_service = None
    if args.embed:
        try:
            import os
            from app.core.config import Settings
            from app.services.rag.embeddings import EmbeddingService

            settings = Settings()  # type: ignore[call-arg]
            api_key = getattr(settings, "gemini_api_key", None) or os.environ.get("GOOGLE_API_KEY", "")
            if api_key:
                embedding_service = EmbeddingService(
                    api_key=api_key,
                    model=getattr(settings, "embedding_model", "models/embedding-001"),
                    dimensions=getattr(settings, "embedding_dimensions", 768),
                )
                logger.info("임베딩 서비스 초기화 완료")
            else:
                logger.warning("GEMINI_API_KEY가 없어 임베딩 건너뜀")
        except Exception as e:
            logger.warning("임베딩 서비스 초기화 실패 (건너뜀): %s", e)

    # 통계 초기화
    stats: dict[str, int] = {
        "total": len(pdf_list),
        "success": 0,
        "skipped": 0,
        "failed": 0,
        "dry_run": 0,
        "on_sale": 0,
        "discontinued": 0,
        "unknown": 0,
    }
    failures: list[dict[str, Any]] = []

    # @MX:WARN: [AUTO] 순차 처리 필수 - asyncio.gather 사용 금지
    # @MX:REASON: pdfplumber + PDFMiner 내부 캐시가 asyncio gather 환경에서 GC 타이밍이 지연됨
    # @MX:REASON: 8,000개 이상 파일 처리 시 메모리 점진적 포화로 PC 멈춤 재현됨
    # @MX:SPEC: SPEC-INGEST-001
    # 순차 처리: 파일 1개씩 처리 후 즉시 GC → 메모리 일정 수준 유지
    all_pairs = list(pdf_list)

    for idx, (pdf_path, _fmt) in enumerate(all_pairs, 1):
        if idx % 100 == 0 or idx == 1:
            logger.info("처리 중: %d / %d", idx, len(all_pairs))

        try:
            metadata = extract_metadata(pdf_path, data_dir)
            result = await process_single_file(
                _db.session_factory,
                pdf_path,
                metadata,
                dry_run=args.dry_run,
                embedding_service=embedding_service,
            )
        except Exception as e:
            result = {"status": "failed", "chunk_count": 0, "sale_status": "UNKNOWN", "error": str(e)}

        # 즉시 통계 반영
        status = result["status"]
        if status == "success":
            stats["success"] += 1
            ss = result.get("sale_status", "UNKNOWN")
            if ss == "ON_SALE":
                stats["on_sale"] += 1
            elif ss == "DISCONTINUED":
                stats["discontinued"] += 1
            else:
                stats["unknown"] += 1
        elif status == "skipped":
            stats["skipped"] += 1
        elif status == "dry_run":
            stats["dry_run"] += 1
        else:  # failed
            stats["failed"] += 1
            failures.append({
                "file": str(pdf_path),
                "error": result.get("error", "알 수 없는 오류"),
            })

        # 파일마다 GC 강제 실행 (pdfplumber/PDFMiner 캐시 해제)
        gc.collect()

    # 요약 리포트 출력
    print(generate_report(stats))

    # 실패 로그 저장 (REQ-13)
    if failures:
        log_path = save_failure_log(failures, data_dir)
        if log_path:
            print(f"실패 로그: {log_path}")


if __name__ == "__main__":
    asyncio.run(main())
