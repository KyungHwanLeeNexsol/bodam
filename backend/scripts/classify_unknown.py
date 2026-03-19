#!/usr/bin/env python3
"""klia-unknown 디렉토리 PDF 분류 스크립트 (SPEC-CRAWL-001, TASK-009/010)

목적: backend/data/klia-unknown/에 있는 분류되지 않은 PDF를
      pdfplumber로 텍스트 추출 후 회사명을 찾아 올바른 company_id 디렉토리로 복사.

실행:
    python scripts/classify_unknown.py

# @MX:NOTE: 원본 파일을 이동하지 않고 복사(copy)함 - 검증 전 원본 보존 필요
# @MX:SPEC: SPEC-CRAWL-001
"""
from __future__ import annotations

import hashlib
import json
import logging
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pdfplumber

from scripts.crawl_constants import (
    COMPANY_NAME_MAP,
    normalize_company_name,
    save_pdf_with_metadata,
)

logger = logging.getLogger(__name__)

# 기본 경로 설정
BASE_DIR = Path(__file__).parent.parent / "data"
UNKNOWN_DIR = BASE_DIR / "klia-unknown"


def extract_company_from_pdf(pdf_path: Path) -> str | None:
    """PDF 파일의 첫 2페이지에서 회사명을 추출하여 company_id를 반환한다.

    # @MX:NOTE: 성능 최적화를 위해 첫 2페이지만 읽음 (전체 약관은 수백 페이지)
    # @MX:ANCHOR: classify_file에서 호출됨
    # @MX:REASON: 핵심 분류 로직 - 변경 시 전체 분류 결과에 영향

    Args:
        pdf_path: 분석할 PDF 파일 경로

    Returns:
        발견된 company_id 또는 None
    """
    if not pdf_path.exists():
        return None

    try:
        with pdfplumber.open(pdf_path) as pdf:
            # 첫 2페이지만 읽기
            pages_to_check = pdf.pages[:2]
            combined_text = ""

            for page in pages_to_check:
                text = page.extract_text()
                if text:
                    combined_text += text + "\n"

            if not combined_text.strip():
                return None

            # 회사명 매핑에서 긴 이름부터 매칭 (부분 일치 오류 방지)
            sorted_names = sorted(COMPANY_NAME_MAP.keys(), key=len, reverse=True)
            for company_name in sorted_names:
                if company_name in combined_text:
                    return COMPANY_NAME_MAP[company_name]

            return None

    except Exception as e:
        logger.warning("PDF 파싱 실패 %s: %s", pdf_path, e)
        return None


def classify_file(src_path: Path, base_dir: Path) -> dict[str, Any] | None:
    """단일 PDF 파일을 분류하여 올바른 회사 디렉토리로 복사한다.

    원본 파일은 삭제하지 않고 복사(copy)만 수행한다.

    Args:
        src_path: 분류할 원본 PDF 파일 경로
        base_dir: 회사별 디렉토리가 있는 기본 경로 (예: backend/data/)

    Returns:
        분류 성공 시 결과 dict, 실패 시 None
    """
    company_id = extract_company_from_pdf(src_path)
    if company_id is None:
        logger.info("분류 실패 (회사명 없음): %s", src_path.name)
        return None

    # 회사명 찾기 (company_id → 대표 회사명)
    company_name = _get_company_name(company_id)

    # 대상 디렉토리 생성
    dest_dir = base_dir / company_id
    dest_dir.mkdir(parents=True, exist_ok=True)

    dest_path = dest_dir / src_path.name

    # 이미 존재하면 해시 추가
    if dest_path.exists():
        h = hashlib.md5(src_path.read_bytes()).hexdigest()[:8]
        dest_path = dest_dir / f"{src_path.stem}_{h}{src_path.suffix}"

    # 파일 복사 (원본 보존)
    shutil.copy2(src_path, dest_path)

    # 메타데이터 JSON 생성
    file_data = dest_path.read_bytes()
    file_hash = hashlib.sha256(file_data).hexdigest()
    crawled_at = datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+09:00")

    metadata: dict[str, Any] = {
        "company_id": company_id,
        "company_name": company_name,
        "product_name": src_path.stem,
        "product_type": "미분류",
        "source_url": "",
        "file_path": str(dest_path.relative_to(base_dir)),
        "file_hash": f"sha256:{file_hash}",
        "crawled_at": crawled_at,
        "file_size_bytes": len(file_data),
        "classified_from": str(src_path),
    }

    meta_path = dest_path.with_suffix(".json")
    meta_path.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    logger.info("분류 완료: %s → %s", src_path.name, company_id)

    return {
        "company_id": company_id,
        "company_name": company_name,
        "src_file": str(src_path),
        "dest_file": str(dest_path),
    }


def _get_company_name(company_id: str) -> str:
    """company_id에서 한국어 회사명을 반환한다 (첫 번째 매핑 기준)."""
    for name, cid in COMPANY_NAME_MAP.items():
        if cid == company_id:
            return name
    return company_id


def generate_classification_report(
    classified: list[dict[str, Any]],
    unclassified: list[str],
    output_path: Path,
) -> None:
    """분류 결과 리포트를 JSON 파일로 저장한다.

    Args:
        classified: 분류 성공한 파일 목록
        unclassified: 분류 실패한 파일명 목록
        output_path: 리포트 저장 경로
    """
    # 회사별 카운트 집계
    by_company: dict[str, int] = {}
    for item in classified:
        cid = item["company_id"]
        by_company[cid] = by_company.get(cid, 0) + 1

    report: dict[str, Any] = {
        "generated_at": datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+09:00"),
        "total_files": len(classified) + len(unclassified),
        "classified_count": len(classified),
        "unclassified_count": len(unclassified),
        "by_company": by_company,
        "unclassified_files": unclassified,
    }

    output_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    logger.info("분류 리포트 저장: %s", output_path)


def main() -> None:
    """klia-unknown 디렉토리의 모든 PDF를 분류한다."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    if not UNKNOWN_DIR.exists():
        logger.error("klia-unknown 디렉토리 없음: %s", UNKNOWN_DIR)
        return

    pdf_files = list(UNKNOWN_DIR.glob("*.pdf"))
    logger.info("분류 대상 PDF: %d개", len(pdf_files))

    classified: list[dict[str, Any]] = []
    unclassified: list[str] = []

    for i, pdf_path in enumerate(pdf_files, 1):
        logger.info("[%d/%d] %s 처리 중...", i, len(pdf_files), pdf_path.name)
        result = classify_file(pdf_path, BASE_DIR)

        if result is not None:
            classified.append(result)
        else:
            unclassified.append(pdf_path.name)

    # 리포트 생성
    report_path = UNKNOWN_DIR / "classification_report.json"
    generate_classification_report(classified, unclassified, report_path)

    print(f"\n{'='*60}")
    print(f"분류 완료: {len(pdf_files)}개 처리")
    print(f"  성공: {len(classified)}개")
    print(f"  실패: {len(unclassified)}개")
    print(f"  리포트: {report_path}")
    print('='*60)

    if classified:
        from collections import Counter
        counts = Counter(item["company_id"] for item in classified)
        print("\n회사별 분류 결과:")
        for cid, count in sorted(counts.items()):
            print(f"  {cid}: {count}개")


if __name__ == "__main__":
    main()
