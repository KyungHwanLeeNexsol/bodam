#!/usr/bin/env python3
"""SPEC-PIPELINE-002 REQ-03: 파이프라인 현황 문서 자동 업데이트 스크립트

CockroachDB에서 보험사별 정책 수, 청크 수, 임베딩 유무를 조회하고
docs/insurance-pipeline-status.md의 해당 행을 업데이트한다.

Usage:
    python scripts/update_pipeline_status.py --company samsung_fire
    python scripts/update_pipeline_status.py --all
    python scripts/update_pipeline_status.py --summary
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import re
import sys
from datetime import datetime
from pathlib import Path

_project_root = Path(__file__).parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

try:
    from dotenv import load_dotenv
    load_dotenv(_project_root / ".env")
except ImportError:
    pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("update_pipeline_status")

# docs/insurance-pipeline-status.md 경로
_DOCS_DIR = _project_root.parent / "docs"
STATUS_DOC = _DOCS_DIR / "insurance-pipeline-status.md"

# COMPANY_MAP: dir_key → (code, name)  (ingest_local_pdfs.py와 동일)
COMPANY_MAP: dict[str, tuple[str, str]] = {
    # 손보사
    "meritz_fire": ("meritz-fire", "메리츠화재"),
    "hyundai_marine": ("hyundai-marine", "현대해상"),
    "kb_insurance": ("kb-insurance", "KB손해보험"),
    "samsung_fire": ("samsung-fire", "삼성화재"),
    "db_insurance": ("db-insurance", "DB손해보험"),
    "heungkuk_fire": ("heungkuk-fire", "흥국화재"),
    "axa_general": ("axa-general", "AXA손해보험"),
    "mg_insurance": ("mg-insurance", "MG손해보험"),
    "nh_fire": ("nh-fire", "NH농협손해보험"),
    "lotte_insurance": ("lotte-insurance", "롯데손해보험"),
    "hanwha_general": ("hanwha-general", "한화손해보험"),
    # 생보사
    "abl": ("abl", "ABL생명"),
    "aia": ("aia", "AIA생명"),
    "bnp_life": ("bnp-life", "BNP파리바카디프생명"),
    "chubb_life": ("chubb-life", "처브라이프생명"),
    "db": ("db-life", "DB생명"),
    "dongyang_life": ("dongyang-life", "동양생명"),
    "fubon_hyundai_life": ("fubon-hyundai-life", "푸본현대생명"),
    "hana_life": ("hana-life", "하나생명"),
    "hanwha_life": ("hanwha-life", "한화생명"),
    "heungkuk_life": ("heungkuk-life", "흥국생명"),
    "im_life": ("im-life", "iM라이프"),
    "kb_life": ("kb-life", "KB라이프생명"),
    "kdb": ("kdb-life", "KDB생명"),
    "kyobo_life": ("kyobo-life", "교보생명"),
    "kyobo_lifeplanet": ("kyobo-lifeplanet", "교보라이프플래닛생명"),
    "lina_life": ("lina-life", "라이나생명"),
    "metlife": ("metlife", "메트라이프생명"),
    "mirae_life": ("mirae-life", "미래에셋생명"),
    "nh": ("nh-life", "NH농협생명"),
    "samsung_life": ("samsung-life", "삼성생명"),
    "shinhan_life": ("shinhan-life", "신한라이프생명"),
    "unknown_life": ("unknown-life", "기타생명"),
}


async def query_company_stats(company_code: str) -> dict:
    """CockroachDB에서 보험사별 통계를 조회한다.

    Returns:
        {
            "policy_count": int,
            "chunk_count": int,
            "embedded_count": int,
            "on_sale": int,
            "discontinued": int,
            "unknown": int,
        }
    """
    import os
    import ssl

    import asyncpg

    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        raise RuntimeError("DATABASE_URL 환경변수가 설정되지 않았습니다.")

    # asyncpg DSN 형식으로 변환
    dsn = db_url
    for prefix in ("cockroachdb+asyncpg://", "postgresql+asyncpg://"):
        if dsn.startswith(prefix):
            dsn = "postgresql://" + dsn[len(prefix):]
            break

    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE

    conn = await asyncpg.connect(dsn, ssl=ssl_ctx)
    try:
        row = await conn.fetchrow(
            """
            SELECT
                COUNT(DISTINCT p.id)                                      AS policy_count,
                COUNT(pc.id)                                              AS chunk_count,
                COUNT(CASE WHEN pc.embedding IS NOT NULL THEN 1 END)      AS embedded_count,
                COUNT(CASE WHEN p.sale_status = 'ON_SALE' THEN 1 END)     AS on_sale,
                COUNT(CASE WHEN p.sale_status = 'DISCONTINUED' THEN 1 END) AS discontinued,
                COUNT(CASE WHEN p.sale_status = 'UNKNOWN' OR p.sale_status IS NULL THEN 1 END) AS unknown
            FROM insurance_companies ic
            LEFT JOIN policies p ON p.company_id = ic.id
            LEFT JOIN policy_chunks pc ON pc.policy_id = p.id
            WHERE ic.code = $1
            """,
            company_code,
        )
        if row is None:
            return {"policy_count": 0, "chunk_count": 0, "embedded_count": 0,
                    "on_sale": 0, "discontinued": 0, "unknown": 0}
        return dict(row)
    finally:
        await conn.close()


def _build_ingest_cell(stats: dict) -> str:
    """인제스트 셀 문자열을 생성한다."""
    pc = stats["policy_count"]
    if pc == 0:
        return "❌"
    return "✅"


def _build_embed_cell(stats: dict) -> str:
    """임베딩 셀 문자열을 생성한다."""
    emb = stats["embedded_count"]
    total = stats["chunk_count"]
    if emb == 0:
        return "❌"
    if emb < total:
        return f"⚠️ {emb}/{total}"
    return "✅"


def _build_sale_status_cell(stats: dict) -> str:
    """sale_status 분포 셀 문자열을 생성한다 (손보사는 UNKNOWN)."""
    on_sale = stats["on_sale"]
    discontinued = stats["discontinued"]
    unknown = stats["unknown"]
    total = stats["policy_count"]
    if total == 0:
        return "❌ UNKNOWN"
    if on_sale == 0 and discontinued == 0:
        return "⚠️ UNKNOWN"
    parts = []
    if on_sale:
        parts.append(f"ON_SALE:{on_sale}")
    if discontinued:
        parts.append(f"DISC:{discontinued}")
    if unknown:
        parts.append(f"UNK:{unknown}")
    return "✅ " + ", ".join(parts)


def update_table_row(content: str, company_code: str, stats: dict) -> str:
    """마크다운 테이블에서 company_code가 포함된 행을 업데이트한다.

    테이블 행 형식:
    | 보험사명 | code | 로컬PDF | 크롤러 | sale_status | 인제스트 | DB정책수 | 청크수 | 임베딩 | 최종실행일 |
    인덱스:   0      1       2         3       4            5         6          7        8        9
    """
    today = datetime.now().strftime("%Y-%m-%d")
    pc = stats["policy_count"]
    cc = stats["chunk_count"]

    ingest_cell = _build_ingest_cell(stats)
    embed_cell = _build_embed_cell(stats)
    sale_cell = _build_sale_status_cell(stats)

    lines = content.split("\n")
    updated = False
    for i, line in enumerate(lines):
        # 보험사 코드가 해당 행에 포함되는지 확인 (| code | 형식)
        if f"| {company_code} |" not in line and f"| {company_code} |" not in line:
            # 파이프로 구분된 셀에서 코드 확인
            cells = [c.strip() for c in line.split("|")]
            if len(cells) < 4 or cells[2] != company_code:
                continue

        cells = [c.strip() for c in line.split("|")]
        if len(cells) < 11:
            continue

        # 인덱스 5=인제스트, 6=DB정책수, 7=청크수, 8=임베딩, 9=최종실행일
        cells[5] = f" {ingest_cell} "
        cells[6] = f" {pc:,} "
        cells[7] = f" {cc:,} "
        cells[8] = f" {embed_cell} "
        cells[9] = f" {today} "

        # sale_status도 업데이트 (인덱스 4)
        if pc > 0:
            cells[4] = f" {sale_cell} "

        lines[i] = "|".join(cells)
        updated = True
        logger.info("행 업데이트: %s → 정책:%d, 청크:%d", company_code, pc, cc)
        break

    if not updated:
        logger.warning("행을 찾을 수 없음: %s", company_code)

    # 마지막 업데이트 날짜 갱신
    for i, line in enumerate(lines):
        if line.startswith("> 마지막 업데이트:"):
            lines[i] = f"> 마지막 업데이트: {today}"
            break

    return "\n".join(lines)


def update_summary_section(content: str, all_stats: dict[str, dict]) -> str:
    """전체 요약 섹션을 업데이트한다."""
    nonlife_policies = sum(
        v["policy_count"] for k, v in all_stats.items()
        if k in {"meritz_fire", "hyundai_marine", "kb_insurance", "samsung_fire",
                 "db_insurance", "heungkuk_fire", "axa_general", "mg_insurance",
                 "nh_fire", "lotte_insurance", "hanwha_general"}
    )
    life_policies = sum(
        v["policy_count"] for k, v in all_stats.items()
        if k not in {"meritz_fire", "hyundai_marine", "kb_insurance", "samsung_fire",
                     "db_insurance", "heungkuk_fire", "axa_general", "mg_insurance",
                     "nh_fire", "lotte_insurance", "hanwha_general"}
    )
    nonlife_embedded = sum(
        v["embedded_count"] for k, v in all_stats.items()
        if k in {"meritz_fire", "hyundai_marine", "kb_insurance", "samsung_fire",
                 "db_insurance", "heungkuk_fire", "axa_general", "mg_insurance",
                 "nh_fire", "lotte_insurance", "hanwha_general"}
    )
    life_embedded = sum(
        v["embedded_count"] for k, v in all_stats.items()
        if k not in {"meritz_fire", "hyundai_marine", "kb_insurance", "samsung_fire",
                     "db_insurance", "heungkuk_fire", "axa_general", "mg_insurance",
                     "nh_fire", "lotte_insurance", "hanwha_general"}
    )
    nonlife_chunks = sum(
        v["chunk_count"] for k, v in all_stats.items()
        if k in {"meritz_fire", "hyundai_marine", "kb_insurance", "samsung_fire",
                 "db_insurance", "heungkuk_fire", "axa_general", "mg_insurance",
                 "nh_fire", "lotte_insurance", "hanwha_general"}
    )
    life_chunks = sum(
        v["chunk_count"] for k, v in all_stats.items()
        if k not in {"meritz_fire", "hyundai_marine", "kb_insurance", "samsung_fire",
                     "db_insurance", "heungkuk_fire", "axa_general", "mg_insurance",
                     "nh_fire", "lotte_insurance", "hanwha_general"}
    )
    total_policies = nonlife_policies + life_policies
    total_chunks = nonlife_chunks + life_chunks
    total_embedded = nonlife_embedded + life_embedded

    lines = content.split("\n")
    in_summary = False
    for i, line in enumerate(lines):
        if "## 전체 요약" in line:
            in_summary = True
            continue
        if in_summary and line.startswith("## "):
            in_summary = False
            continue
        if not in_summary:
            continue

        cells = [c.strip() for c in line.split("|")]
        if len(cells) < 6:
            continue

        first = cells[1].strip()
        if "손해보험" in first and "합계" not in first and "기타" not in first:
            cells[4] = f" {nonlife_policies:,} "
            cells[5] = f" {nonlife_embedded:,} "
            lines[i] = "|".join(cells)
        elif "생명보험" in first and "합계" not in first:
            cells[4] = f" {life_policies:,} "
            cells[5] = f" {life_embedded:,} "
            lines[i] = "|".join(cells)
        elif "합계" in first or "**합계**" in first:
            cells[4] = f" **{total_policies:,}** "
            cells[5] = f" **{total_embedded:,}** "
            lines[i] = "|".join(cells)

    return "\n".join(lines)


async def run_update(company_keys: list[str], update_all: bool = False) -> None:
    """지정된 보험사 목록의 상태를 DB에서 조회해 문서를 업데이트한다."""
    if not STATUS_DOC.exists():
        logger.error("상태 문서를 찾을 수 없음: %s", STATUS_DOC)
        sys.exit(1)

    keys_to_update = list(COMPANY_MAP.keys()) if update_all else company_keys
    if not keys_to_update:
        logger.error("업데이트할 보험사 코드가 없습니다.")
        sys.exit(1)

    # 유효성 검증
    invalid = [k for k in keys_to_update if k not in COMPANY_MAP]
    if invalid:
        logger.error("알 수 없는 보험사 코드: %s", ", ".join(invalid))
        logger.info("사용 가능한 코드: %s", ", ".join(COMPANY_MAP.keys()))
        sys.exit(1)

    content = STATUS_DOC.read_text(encoding="utf-8")
    all_stats: dict[str, dict] = {}

    for key in keys_to_update:
        code, name = COMPANY_MAP[key]
        logger.info("조회 중: %s (%s)", name, code)
        try:
            stats = await query_company_stats(code)
            all_stats[key] = stats
            content = update_table_row(content, code, stats)
            logger.info(
                "  → 정책:%d, 청크:%d, 임베딩:%d, ON_SALE:%d, DISC:%d, UNK:%d",
                stats["policy_count"], stats["chunk_count"], stats["embedded_count"],
                stats["on_sale"], stats["discontinued"], stats["unknown"],
            )
        except Exception as e:
            logger.error("조회 실패 [%s]: %s", code, e)

    if update_all and all_stats:
        content = update_summary_section(content, all_stats)

    STATUS_DOC.write_text(content, encoding="utf-8")
    logger.info("문서 업데이트 완료: %s", STATUS_DOC)


async def print_summary() -> None:
    """전체 보험사 현황을 터미널에 출력한다 (문서 미수정)."""
    sep = "=" * 70
    print(f"\n{sep}")
    print("보험 데이터 파이프라인 현황")
    print(sep)
    print(f"{'보험사':<20} {'코드':<22} {'정책수':>7} {'청크수':>8} {'임베딩':>7} {'ON_SALE':>8}")
    print("-" * 70)

    for key, (code, name) in COMPANY_MAP.items():
        try:
            stats = await query_company_stats(code)
            print(
                f"{name:<20} {code:<22} {stats['policy_count']:>7,} "
                f"{stats['chunk_count']:>8,} {stats['embedded_count']:>7,} "
                f"{stats['on_sale']:>8,}"
            )
        except Exception as e:
            print(f"{name:<20} {code:<22} {'ERROR':>7} -- {e}")

    print(sep + "\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="파이프라인 현황 문서 자동 업데이트",
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--company",
        metavar="KEY",
        nargs="+",
        help="업데이트할 보험사 dir_key (예: samsung_fire kb_insurance)",
    )
    group.add_argument(
        "--all",
        action="store_true",
        default=False,
        help="전체 보험사 일괄 업데이트",
    )
    group.add_argument(
        "--summary",
        action="store_true",
        default=False,
        help="현황 요약만 출력 (문서 미수정)",
    )
    return parser.parse_args()


async def main() -> None:
    args = parse_args()

    if args.summary:
        await print_summary()
        return

    if args.all:
        await run_update([], update_all=True)
    else:
        await run_update(args.company)


if __name__ == "__main__":
    asyncio.run(main())
