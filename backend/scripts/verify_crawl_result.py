#!/usr/bin/env python3
"""크롤링 결과 검증 스크립트

크롤링 후 로컬 데이터 디렉터리의 JSON 메타데이터를 분석하여
판매중/판매중지 상품이 정확하게 수집됐는지 확인한다.

검증 기준:
  PASS  (exit 0): ON_SALE > 0, UNKNOWN == 0 (또는 허용 범위 이내)
  WARN  (exit 2): DISCONTINUED == 0 또는 UNKNOWN > 0 (수동 확인 권장, 파이프라인 계속)
  FAIL  (exit 1): 총 수집 0개 / 최솟값 미달 / ON_SALE == 0 / UNKNOWN 비율 초과

Usage:
    python scripts/verify_crawl_result.py --company lotte_insurance
    python scripts/verify_crawl_result.py --company axa_general --min-total 500
    python scripts/verify_crawl_result.py --company nh_fire --strict
    python scripts/verify_crawl_result.py --company mg_insurance --no-fail-on-no-discontinued
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
BASE_DATA_DIR = SCRIPT_DIR.parent / "data"

# 보험사별 최소 수집 기대치 (기준: 이전 수집량 대비 보수적 하한)
# 새 보험사 추가 시 여기에 등록
EXPECTED_MIN: dict[str, int] = {
    "lotte_insurance": 500,
    "axa_general": 500,
    "nh_fire": 50,
    "mg_insurance": 20,
    "heungkuk_fire": 10,
    "samsung_fire": 100,
    "hyundai_marine": 100,
    "db_insurance": 100,
    "meritz_fire": 50,
    "kb_insurance": 50,
    "hanwha_general": 30,
}

# UNKNOWN 허용 비율 (strict 모드 아닐 때)
UNKNOWN_WARN_THRESHOLD = 0.05   # 5% 이하: 경고만
UNKNOWN_FAIL_THRESHOLD = 0.20   # 20% 초과: 실패 처리

DEFAULT_MIN = 5


def _read_metadata_files(company_dir: Path) -> tuple[dict[str, int], int]:
    """JSON 메타데이터를 읽어 sale_status별 카운트를 반환한다.

    Returns:
        (counts, parse_errors)
        counts: {"ON_SALE": int, "DISCONTINUED": int, "UNKNOWN": int, "total": int}
    """
    counts: dict[str, int] = {"ON_SALE": 0, "DISCONTINUED": 0, "UNKNOWN": 0, "total": 0}
    parse_errors = 0

    for jf in company_dir.glob("*.json"):
        try:
            data = json.loads(jf.read_text(encoding="utf-8"))
            status = str(data.get("sale_status", "UNKNOWN")).strip().upper()
            if status == "ON_SALE":
                counts["ON_SALE"] += 1
            elif status == "DISCONTINUED":
                counts["DISCONTINUED"] += 1
            else:
                counts["UNKNOWN"] += 1
            counts["total"] += 1
        except Exception:
            parse_errors += 1

    return counts, parse_errors


def verify_company(
    company_id: str,
    min_total: int | None,
    strict: bool,
    no_fail_on_no_discontinued: bool,
) -> int:
    """보험사 크롤링 결과를 검증한다.

    # @MX:ANCHOR: 파이프라인 검증 게이트 - run_ingest_pipeline.sh에서 호출됨
    # @MX:REASON: 크롤링 후 인제스트 전에 반드시 실행되는 품질 체크포인트

    Returns:
        0: PASS — 파이프라인 계속 진행
        1: FAIL — 파이프라인 중단 (심각한 문제)
        2: WARN — 경고 있음, 파이프라인은 계속 진행
    """
    company_dir = BASE_DATA_DIR / company_id

    sep = "=" * 55
    print(sep)
    print(f"  수집 결과 검증: {company_id}")
    print(sep)

    # 디렉터리 존재 확인
    if not company_dir.exists():
        print(f"[FAIL] 디렉터리가 없습니다: {company_dir}")
        print("       크롤링이 실행되지 않았거나 경로가 잘못됐습니다.")
        print(sep)
        return 1

    # 메타데이터 읽기
    counts, parse_errors = _read_metadata_files(company_dir)
    total = counts["total"]
    on_sale = counts["ON_SALE"]
    discontinued = counts["DISCONTINUED"]
    unknown = counts["UNKNOWN"]

    # 결과 출력
    print(f"  총 수집:             {total:>6,}개")
    print(f"  ON_SALE (판매중):    {on_sale:>6,}개")
    print(f"  DISCONTINUED (중지): {discontinued:>6,}개")
    print(f"  UNKNOWN (미분류):    {unknown:>6,}개")
    if parse_errors:
        print(f"  JSON 파싱 오류:      {parse_errors:>6,}개")
    print(sep)

    # 검증 로직
    threshold = min_total if min_total is not None else EXPECTED_MIN.get(company_id, DEFAULT_MIN)
    unknown_pct = (unknown / total * 100) if total > 0 else 0.0
    exit_code = 0
    issues: list[str] = []
    warnings: list[str] = []

    # ── FAIL 조건 ──────────────────────────────────────────────
    if total == 0:
        issues.append("수집된 파일이 없습니다. 크롤러가 정상 실행됐는지 확인하세요.")

    elif total < threshold:
        issues.append(
            f"수집량이 너무 적습니다 ({total:,}개 < 최소 기대치 {threshold:,}개). "
            "크롤러 로그를 확인하세요."
        )

    if total > 0 and on_sale == 0:
        issues.append(
            "ON_SALE 상품이 없습니다. 판매중 탭이 수집되지 않았습니다. "
            "크롤러의 판매중 수집 로직을 점검하세요."
        )

    if strict and unknown > 0:
        issues.append(
            f"UNKNOWN 상품이 있습니다 ({unknown:,}개, {unknown_pct:.1f}%). "
            "--strict 모드에서는 UNKNOWN이 0이어야 합니다."
        )
    elif total > 0 and unknown / total > UNKNOWN_FAIL_THRESHOLD:
        issues.append(
            f"UNKNOWN 비율이 너무 높습니다 ({unknown:,}개, {unknown_pct:.1f}% > {int(UNKNOWN_FAIL_THRESHOLD*100)}%). "
            "크롤러의 sale_status 매핑 로직을 점검하세요."
        )

    # ── WARN 조건 ─────────────────────────────────────────────
    if total > 0 and 0 < unknown / total <= UNKNOWN_FAIL_THRESHOLD:
        if not strict:
            warnings.append(
                f"UNKNOWN 상품이 {unknown:,}개({unknown_pct:.1f}%) 있습니다. "
                "JSON 메타데이터의 sale_status 값을 확인하세요."
            )

    if total > 0 and discontinued == 0 and not no_fail_on_no_discontinued:
        warnings.append(
            "DISCONTINUED(판매중지) 상품이 없습니다. "
            "판매중지 탭 클릭이 성공했는지 크롤러 로그를 확인하세요."
        )

    # ── 결과 출력 ─────────────────────────────────────────────
    if issues:
        print("[FAIL] 검증 실패 — 파이프라인을 중단합니다.")
        for issue in issues:
            print(f"  ✗ {issue}")
        exit_code = 1
    elif warnings:
        print("[WARN] 경고 — 수동 확인 권장 (파이프라인은 계속 진행합니다).")
        for w in warnings:
            print(f"  ⚠  {w}")
        exit_code = 2
    else:
        print("[PASS] 검증 통과!")
        print(
            f"  ON_SALE {on_sale:,}개 + DISCONTINUED {discontinued:,}개"
            + (f" + UNKNOWN {unknown}개" if unknown else "")
            + f" = 총 {total:,}개"
        )

    print(sep)
    return exit_code


def main() -> None:
    """CLI 진입점."""
    parser = argparse.ArgumentParser(
        description="크롤링 결과 검증 — 판매중/판매중지 수집 완정성 확인",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
검증 결과 exit code:
  0: PASS  — 인제스트를 바로 진행해도 안전
  1: FAIL  — 수집에 문제 있음, 파이프라인 중단 권장
  2: WARN  — 경고 있음, 검토 후 진행 여부 결정

예시:
  python scripts/verify_crawl_result.py --company lotte_insurance
  python scripts/verify_crawl_result.py --company axa_general --min-total 500
  python scripts/verify_crawl_result.py --company nh_fire --strict
  python scripts/verify_crawl_result.py --company mg_insurance --no-fail-on-no-discontinued
        """,
    )
    parser.add_argument(
        "--company",
        required=True,
        help="검증할 보험사 company_id (예: lotte_insurance)",
    )
    parser.add_argument(
        "--min-total",
        type=int,
        default=None,
        help="최소 수집 파일 수 (기본값: EXPECTED_MIN 설정값 또는 5개)",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        default=False,
        help="UNKNOWN 상품이 1개라도 있으면 FAIL 처리",
    )
    parser.add_argument(
        "--no-fail-on-no-discontinued",
        action="store_true",
        default=False,
        help="DISCONTINUED 0개여도 WARN 생략 (판매중지 상품이 없는 사이트용)",
    )

    args = parser.parse_args()
    exit_code = verify_company(
        company_id=args.company,
        min_total=args.min_total,
        strict=args.strict,
        no_fail_on_no_discontinued=args.no_fail_on_no_discontinued,
    )
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
