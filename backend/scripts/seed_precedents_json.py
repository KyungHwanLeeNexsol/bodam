#!/usr/bin/env python3
"""판례 데이터 JSON 저장 스크립트 (DB 불필요 독립 실행)

seed_precedents.py의 SEED_PRECEDENTS를 JSON으로 저장.
이후 DB 준비 시 별도 import 스크립트로 적재 가능.

Usage:
  python scripts/seed_precedents_json.py
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

# 프로젝트 루트 기준 출력 경로
OUT_DIR = Path(__file__).parent.parent / "data" / "precedents"
OUT_DIR.mkdir(parents=True, exist_ok=True)
OUT_FILE = OUT_DIR / "precedents_seed.json"

# seed_precedents.py의 데이터 import
sys.path.insert(0, str(Path(__file__).parent))
from seed_precedents import SEED_PRECEDENTS  # noqa: E402


def date_serializer(obj: object) -> str:
    """date 객체를 ISO 형식 문자열로 직렬화"""
    if isinstance(obj, date):
        return obj.isoformat()
    raise TypeError(f"직렬화 불가: {type(obj)}")


def main() -> None:
    print("=" * 50)
    print("판례 데이터 JSON 저장")
    print("=" * 50)
    print(f"판례 수: {len(SEED_PRECEDENTS)}개")

    # 출력용 데이터 정제
    output = []
    for p in SEED_PRECEDENTS:
        item = {
            "case_number": p["case_number"],
            "court_name": p["court_name"],
            "decision_date": p["decision_date"].isoformat(),
            "case_type": p["case_type"],
            "insurance_type": p.get("insurance_type", ""),
            "summary": p["summary"],
            "ruling": p["ruling"],
            "key_clauses": p.get("key_clauses", {}),
            "source_url": p.get("source_url", ""),
        }
        output.append(item)

    # JSON 저장
    OUT_FILE.write_text(
        json.dumps(
            {"total": len(output), "precedents": output},
            ensure_ascii=False,
            indent=2,
            default=date_serializer,
        ),
        encoding="utf-8",
    )

    print(f"\n저장 완료: {OUT_FILE}")
    print(f"파일 크기: {OUT_FILE.stat().st_size:,} bytes")

    # 요약
    by_type: dict[str, int] = {}
    for p in output:
        t = p.get("insurance_type", "기타")
        by_type[t] = by_type.get(t, 0) + 1

    print("\n보험 유형별 분포:")
    for t, cnt in sorted(by_type.items(), key=lambda x: -x[1]):
        print(f"  {t:20}: {cnt}건")

    print("\n[완료] DB 준비 후 아래 명령으로 적재:")
    print("  python scripts/seed_precedents.py seed")


if __name__ == "__main__":
    main()
