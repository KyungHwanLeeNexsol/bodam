#!/usr/bin/env python3
"""크롤링 완료 검증 스크립트 (SPEC-CRAWL-001, TASK-011/012)

목적: backend/data/ 디렉토리를 스캔하여 각 보험사별 PDF 수집 현황을 보고.

실행:
    python scripts/validate_crawl.py

# @MX:NOTE: LIFE_COMPANY_IDS + NONLIFE_COMPANY_IDS 기준으로 완료 여부 판정
# @MX:SPEC: SPEC-CRAWL-001
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from scripts.crawl_constants import LIFE_COMPANY_IDS, NONLIFE_COMPANY_IDS

logger = logging.getLogger(__name__)

# 검증 대상 전체 회사 목록
EXPECTED_COMPANY_IDS: list[str] = LIFE_COMPANY_IDS + NONLIFE_COMPANY_IDS

# 기본 경로
BASE_DIR = Path(__file__).parent.parent / "data"
REPORT_PATH = BASE_DIR / "crawl_validation_report.json"


def get_company_stats(base_dir: Path) -> dict[str, int]:
    """base_dir 하위 회사 디렉토리별 PDF 파일 수를 반환한다.

    # @MX:ANCHOR: validate_crawl의 핵심 집계 함수
    # @MX:REASON: check_completion, generate_report에서 호출됨

    Args:
        base_dir: 회사별 디렉토리가 있는 기본 경로 (예: backend/data/)

    Returns:
        {company_id: pdf_count} 형태의 dict
    """
    stats: dict[str, int] = {}

    if not base_dir.exists():
        return stats

    for entry in base_dir.iterdir():
        # 디렉토리만 처리
        if not entry.is_dir():
            continue
        # PDF 파일만 카운트
        pdf_count = len(list(entry.glob("*.pdf")))
        stats[entry.name] = pdf_count

    return stats


def check_completion(stats: dict[str, int]) -> list[str]:
    """EXPECTED_COMPANY_IDS 기준으로 PDF가 없는 회사 목록을 반환한다.

    Args:
        stats: get_company_stats() 반환값

    Returns:
        PDF가 0개이거나 stats에 없는 company_id 목록
    """
    missing: list[str] = []

    for company_id in EXPECTED_COMPANY_IDS:
        count = stats.get(company_id, 0)
        if count == 0:
            missing.append(company_id)

    return missing


def generate_report(stats: dict[str, int], output_path: Path) -> dict[str, Any]:
    """크롤링 완료 검증 리포트를 생성하고 JSON 파일로 저장한다.

    Args:
        stats: get_company_stats() 반환값
        output_path: 리포트 저장 경로

    Returns:
        생성된 리포트 dict
    """
    missing = check_completion(stats)
    total_expected = len(EXPECTED_COMPANY_IDS)
    companies_with_data = sum(
        1 for cid in EXPECTED_COMPANY_IDS if stats.get(cid, 0) > 0
    )

    # 회사별 상세 정보
    company_details: dict[str, Any] = {}
    for company_id in EXPECTED_COMPANY_IDS:
        pdf_count = stats.get(company_id, 0)
        company_details[company_id] = {
            "pdf_count": pdf_count,
            "status": "OK" if pdf_count > 0 else "MISSING",
        }

    verdict = "PASS" if len(missing) == 0 else "FAIL"

    report: dict[str, Any] = {
        "generated_at": datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+09:00"),
        "verdict": verdict,
        "total_companies_expected": total_expected,
        "total_companies_with_data": companies_with_data,
        "missing_companies": missing,
        "missing_count": len(missing),
        "company_stats": company_details,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    logger.info("검증 리포트 저장: %s", output_path)

    return report


def print_report_table(report: dict[str, Any]) -> None:
    """콘솔에 테이블 형식으로 리포트를 출력한다."""
    verdict = report["verdict"]
    print(f"\n{'='*60}")
    print(f"크롤링 완료 검증 리포트 [{verdict}]")
    print(f"생성 시각: {report['generated_at']}")
    print(f"{'='*60}")
    print(f"전체 대상 보험사: {report['total_companies_expected']}개")
    print(f"데이터 있는 보험사: {report['total_companies_with_data']}개")
    print(f"누락 보험사: {report['missing_count']}개")
    print(f"{'='*60}")

    print("\n[생명보험사]")
    for cid in LIFE_COMPANY_IDS:
        info = report["company_stats"].get(cid, {"pdf_count": 0, "status": "MISSING"})
        status_mark = "OK" if info["status"] == "OK" else "MISS"
        print(f"  [{status_mark}] {cid:<30} {info['pdf_count']:>4}개")

    print("\n[손해보험사]")
    for cid in NONLIFE_COMPANY_IDS:
        info = report["company_stats"].get(cid, {"pdf_count": 0, "status": "MISSING"})
        status_mark = "OK" if info["status"] == "OK" else "MISS"
        print(f"  [{status_mark}] {cid:<30} {info['pdf_count']:>4}개")

    if report["missing_companies"]:
        print(f"\n누락 보험사 목록:")
        for cid in report["missing_companies"]:
            print(f"  - {cid}")

    print(f"\n최종 판정: {verdict}")
    print('='*60)


def main() -> None:
    """backend/data/ 디렉토리를 스캔하여 검증 리포트를 생성한다."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    if not BASE_DIR.exists():
        logger.error("데이터 디렉토리 없음: %s", BASE_DIR)
        return

    logger.info("데이터 디렉토리 스캔: %s", BASE_DIR)
    stats = get_company_stats(BASE_DIR)

    logger.info("총 %d개 디렉토리 발견", len(stats))

    report = generate_report(stats, REPORT_PATH)
    print_report_table(report)

    print(f"\n리포트 저장: {REPORT_PATH}")


if __name__ == "__main__":
    main()
