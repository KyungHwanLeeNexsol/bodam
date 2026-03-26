#!/usr/bin/env python3
"""흥국화재보험 크롤링 + 즉시 인제스트 통합 파이프라인

GitHub Actions 환경에서 실행하기 위한 스크립트.
1단계: Playwright로 약관 목록 수집 (판매 + 판매중지 탭)
2단계: httpx GET으로 PDF 다운로드 → 즉시 인제스트 → 메모리 해제

실행:
    cd backend && PYTHONPATH=. uv run python -m scripts.crawl_and_ingest_heungkuk
    cd backend && PYTHONPATH=. uv run python -m scripts.crawl_and_ingest_heungkuk --dry-run
    cd backend && PYTHONPATH=. uv run python -m scripts.crawl_and_ingest_heungkuk --resume-state failure_state_heungkuk.json

# @MX:NOTE: [AUTO] 흥국화재 fn_filedownX(path, displayName, serverFileName) → GET /common/download.do
# @MX:NOTE: [AUTO] Playwright는 목록 수집에만 사용, 실제 다운로드는 httpx GET
# @MX:NOTE: [AUTO] 판매 탭 + 판매중지 탭 순차 처리
# @MX:SPEC: SPEC-INGEST-001
"""
from __future__ import annotations

import argparse
import asyncio
import gc
import json
import logging
import sys
import tempfile
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

_project_root = Path(__file__).parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

try:
    from dotenv import load_dotenv
    load_dotenv(_project_root / ".env")
except ImportError:
    pass

if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)

COMPANY_CODE = "heungkuk-fire"
COMPANY_NAME = "흥국화재보험"
BASE_URL = "https://www.heungkukfire.co.kr"
PAGE_URL = f"{BASE_URL}/FRW/announce/insGoodsGongsiSale.do"
DOWNLOAD_URL = f"{BASE_URL}/common/download.do"

# 수집 대상 카테고리 (비의료비 제외)
TARGET_CATEGORIES: set[str] = {"의료/건강", "운전자/상해", "자녀/실버"}

RATE_LIMIT = 0.5  # 초
DEFAULT_FAIL_THRESHOLD = 0.05


@dataclass
class FailureRecord:
    """다운로드/인제스트 실패 건."""
    product_name: str
    category: str
    source_url: str
    sale_status: str
    error: str
    timestamp: str = field(default_factory=lambda: datetime.now(tz=timezone.utc).isoformat())


@dataclass
class HeungkukIngestState:
    """흥국화재 실패 상태 (재처리용 JSON 직렬화 가능)."""
    failures: list[FailureRecord] = field(default_factory=list)
    stop_reason: str = ""
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def save(self, path: Path) -> None:
        data = asdict(self)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info("실패 상태 저장: %s (%d건)", path, len(self.failures))

    @classmethod
    def load(cls, path: Path) -> "HeungkukIngestState":
        data = json.loads(path.read_text(encoding="utf-8"))
        failures = [FailureRecord(**f) for f in data.get("failures", [])]
        return cls(
            failures=failures,
            stop_reason=data.get("stop_reason", ""),
            created_at=data.get("created_at", ""),
        )


def _extract_items_js() -> str:
    """현재 페이지에서 fn_filedownX 링크를 추출하는 JS 코드."""
    return """() => {
        const results = [];
        document.querySelectorAll('a[onclick*="fn_filedownX"]').forEach(a => {
            const onclick = a.getAttribute('onclick') || '';
            const text = a.textContent.trim();
            if (!text.includes('약관')) return;
            // fn_filedownX('/path/', 'displayName.pdf', 'serverName.pdf')
            const match = onclick.match(/fn_filedownX\\('([^']+)','([^']+)',\\s*'([^']+)'\\)/);
            if (match) {
                const tr = a.closest('tr');
                const tds = tr ? tr.querySelectorAll('td') : [];
                results.push({
                    path: match[1],
                    displayName: match[2],
                    serverName: match[3],
                    category: tds[0]?.textContent?.trim() || '',
                    productName: tds[2]?.textContent?.trim() || match[2].replace('_약관.pdf', ''),
                });
            }
        });
        return results;
    }"""


async def _click_next_page(page: object) -> bool:
    """다음 페이지 버튼을 클릭하고 클릭 성공 여부를 반환한다."""
    from playwright.async_api import Page  # type: ignore[attr-defined]
    page: Page  # type: ignore[no-redef]

    clicked = await page.evaluate("""() => {
        // 일반적인 '다음' 버튼 패턴 탐색
        const candidates = document.querySelectorAll('a, button, span, li');
        for (const el of candidates) {
            const text = el.textContent.trim();
            const cls = el.className || '';
            const onclick = el.getAttribute('onclick') || '';
            // 비활성화된 요소 제외
            if (cls.includes('disabled') || cls.includes('off') || el.disabled) continue;
            if (text === '다음' || text === '>' || text === '▶' || text === '다음페이지') {
                el.click();
                return true;
            }
        }
        return false;
    }""")
    return bool(clicked)


async def collect_items_from_page(page: object, tab_label: str, tab_idx: int) -> list[dict]:
    """Playwright 페이지에서 약관 다운로드 목록을 추출한다.

    사이트 구조:
    - 판매 / 판매중지 탭
      - 장기보험 / 일반보험 / 자동차보험 서브카테고리 탭
        - 각 카테고리별 페이지네이션
    """
    from playwright.async_api import Page  # type: ignore[attr-defined]
    page: Page  # type: ignore[no-redef]

    await page.goto(PAGE_URL, timeout=30000, wait_until="networkidle")
    await asyncio.sleep(3)

    if tab_idx == 1:
        # 판매중지 탭 클릭
        await page.evaluate("""() => {
            const tabs = document.querySelectorAll('a, li, button');
            for (const t of tabs) {
                if (t.textContent.trim() === '판매중지') { t.click(); return; }
            }
        }""")
        await asyncio.sleep(3)

    # 서브카테고리 탭 목록 감지 (장기보험, 일반보험, 자동차보험)
    sub_categories: list[str] = await page.evaluate("""() => {
        const keywords = ['장기보험', '일반보험', '자동차보험'];
        const found = [];
        for (const kw of keywords) {
            const els = document.querySelectorAll('a, li, button, span');
            for (const el of els) {
                if (el.textContent.trim() === kw) { found.push(kw); break; }
            }
        }
        return found;
    }""")

    if not sub_categories:
        logger.warning("[%s] %s 탭: 서브카테고리 탭을 찾지 못함, 현재 페이지만 수집", COMPANY_NAME, tab_label)
        sub_categories = [""]  # 빈 문자열 = 서브탭 클릭 없이 현재 상태 수집

    all_items: list[dict] = []
    seen_server_names: set[str] = set()

    for sub_cat in sub_categories:
        if sub_cat:
            # 서브카테고리 탭 클릭
            clicked_sub = await page.evaluate(f"""() => {{
                const els = document.querySelectorAll('a, li, button, span');
                for (const el of els) {{
                    if (el.textContent.trim() === '{sub_cat}') {{ el.click(); return true; }}
                }}
                return false;
            }}""")
            if not clicked_sub:
                logger.warning("[%s] %s 탭 > %s 서브탭 클릭 실패, 스킵", COMPANY_NAME, tab_label, sub_cat)
                continue
            await asyncio.sleep(2)

        page_num = 1
        sub_cat_display = sub_cat or "(전체)"
        while True:
            page_items: list[dict] = await page.evaluate(_extract_items_js())

            # 중복 제거
            new_items = [i for i in page_items if i["serverName"] not in seen_server_names]
            for i in new_items:
                seen_server_names.add(i["serverName"])
            all_items.extend(new_items)

            logger.info(
                "[%s] %s 탭 > %s > %d페이지: %d개 수집 (신규 %d개, 누적 %d개)",
                COMPANY_NAME, tab_label, sub_cat_display, page_num,
                len(page_items), len(new_items), len(all_items),
            )

            if not page_items:
                # 빈 페이지면 중단
                break

            # 다음 페이지 클릭 시도
            has_next = await _click_next_page(page)
            if not has_next:
                break
            await asyncio.sleep(2)
            page_num += 1

    logger.info("[%s] %s 탭: 총 %d개 약관 발견", COMPANY_NAME, tab_label, len(all_items))
    return all_items


async def ingest_pdf_bytes(
    session_factory: object,
    pdf_bytes: bytes,
    metadata: dict,
    dry_run: bool = False,
) -> dict:
    """PDF bytes를 임시 파일로 저장 후 인제스트하고 삭제한다."""
    from scripts.ingest_local_pdfs import process_single_file

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(pdf_bytes)
        tmp_path = Path(tmp.name)

    try:
        result = await process_single_file(
            session_factory=session_factory,
            pdf_path=tmp_path,
            metadata=metadata,
            dry_run=dry_run,
        )
    finally:
        if tmp_path.exists():
            tmp_path.unlink()

    return result


async def download_and_ingest_all(
    client: object,
    session_factory: object,
    items: list[dict],
    sale_status: str,
    state: HeungkukIngestState,
    state_output_path: Path,
    processed_urls: set[str],
    dry_run: bool = False,
    resume_urls: set[str] | None = None,
) -> dict[str, int]:
    """수집된 목록을 다운로드하고 인제스트한다."""
    import httpx as _httpx  # type: ignore[attr-defined]

    client: _httpx.AsyncClient  # type: ignore[no-redef]

    stats = {"total": 0, "success": 0, "skipped": 0, "failed": 0, "dry_run": 0}

    for idx, item in enumerate(items, 1):
        cat = item.get("category", "")
        product_name = item.get("productName", "")
        path = item.get("path", "")
        server_name = item.get("serverName", "")
        display_name = item.get("displayName", "")

        # 대상 카테고리 필터
        if cat not in TARGET_CATEGORIES:
            continue

        stats["total"] += 1
        file_path_str = f"{path}{server_name}"
        source_url = f"{DOWNLOAD_URL}?FILE_NAME={file_path_str}"

        # resume 모드: 지정된 URL만 재처리
        if resume_urls is not None and source_url not in resume_urls:
            stats["skipped"] += 1
            continue

        # 이미 처리된 URL 스킵 (중복 다운로드 방지)
        if source_url in processed_urls:
            stats["skipped"] += 1
            logger.debug("[%d] URL 스킵 (이미 처리됨): %s", idx, product_name[:40])
            continue

        if idx % 50 == 0 or idx == 1:
            logger.info(
                "진행: %d / %d (성공=%d, 스킵=%d, 실패=%d)",
                stats["total"], stats["total"] + (len(items) - idx),
                stats["success"], stats["skipped"], stats["failed"],
            )

        await asyncio.sleep(RATE_LIMIT)

        # PDF 다운로드
        pdf_bytes: bytes | None = None
        http_status: int | None = None
        try:
            resp = await client.get(
                DOWNLOAD_URL,
                params={"FILE_NAME": file_path_str, "TYPE": "filedownX", "FILE_EXT_NAME": display_name},
                timeout=60.0,
            )
            http_status = resp.status_code
            if resp.status_code == 200 and resp.content[:4] == b"%PDF" and len(resp.content) > 1000:
                pdf_bytes = resp.content
            elif resp.status_code == 200 and resp.content[:2] == b"PK" and len(resp.content) > 100:
                # ZIP 파일: 임베딩 보류, 실패 아님
                logger.info(
                    "[%d] ZIP 파일 인제스트 보류 (임베딩 미지원): %s (%d bytes)",
                    idx, product_name[:40], len(resp.content),
                )
                stats["skipped"] = stats.get("skipped", 0) + 1
                state.save(state_output_path)
                continue
            else:
                logger.warning(
                    "[%d] 다운로드 실패: %s | HTTP=%d | size=%d",
                    idx, product_name[:40], resp.status_code, len(resp.content),
                )
        except Exception as e:
            logger.warning("[%d] 다운로드 예외 %s: %s", idx, product_name[:40], e)

        if not pdf_bytes:
            stats["failed"] += 1
            state.failures.append(FailureRecord(
                product_name=product_name,
                category=cat,
                source_url=source_url,
                sale_status=sale_status,
                error=f"다운로드 실패 HTTP={http_status}",
            ))
            state.save(state_output_path)
            continue

        # 인제스트
        metadata = {
            "format_type": "B",
            "company_code": COMPANY_CODE,
            "company_name": COMPANY_NAME,
            "product_code": Path(server_name).stem,
            "product_name": product_name,
            "category": "NON_LIFE",
            "source_url": source_url,
            "sale_status": sale_status,
        }

        try:
            result = await ingest_pdf_bytes(session_factory, pdf_bytes, metadata, dry_run=dry_run)
        except Exception as e:
            error_msg = f"{type(e).__name__}: {e}"
            logger.error("[%d] 인제스트 예외 %s: %s", idx, product_name[:40], error_msg)
            result = {"status": "failed", "error": error_msg}

        gc.collect()

        status = result.get("status", "failed")
        if status == "success":
            stats["success"] += 1
            processed_urls.add(source_url)  # 런 중 중복 다운로드 방지
            logger.info("[%d] 완료: %s (%s)", idx, product_name[:40], cat)
        elif status == "skipped":
            stats["skipped"] += 1
            logger.debug("[%d] 스킵(중복): %s", idx, product_name[:40])
        elif status == "dry_run":
            stats["dry_run"] += 1
        else:
            stats["failed"] += 1
            error_msg = result.get("error", "")
            logger.warning("[%d] 인제스트 실패 %s: %s", idx, product_name[:40], error_msg)
            state.failures.append(FailureRecord(
                product_name=product_name,
                category=cat,
                source_url=source_url,
                sale_status=sale_status,
                error=error_msg,
            ))
            state.save(state_output_path)

    return stats


async def run(
    dry_run: bool = False,
    resume_state_path: Path | None = None,
    state_output_path: Path = Path("failure_state_heungkuk.json"),
) -> dict:
    """흥국화재 크롤링 + 인제스트 메인 실행 함수."""
    import httpx
    from playwright.async_api import async_playwright

    import app.core.database as _db
    from app.core.config import Settings
    from scripts.ingest_local_pdfs import load_processed_urls

    logger.info("=" * 60)
    logger.info("%s 크롤링 + 인제스트 시작", COMPANY_NAME)
    logger.info("=" * 60)

    # DB 초기화
    try:
        settings = Settings()  # type: ignore[call-arg]
        await _db.init_database(settings)
    except Exception as e:
        logger.error("DB 초기화 실패: %s", e)
        return {"error": str(e)}

    if _db.session_factory is None:
        logger.error("DB 세션 팩토리 초기화 실패")
        return {"error": "session_factory is None"}

    # 이미 처리된 URL 로드 (재시작 시 중복 다운로드 방지)
    async with _db.session_factory() as _session:
        processed_urls: set[str] = await load_processed_urls(_session, company_code=COMPANY_CODE)
    logger.info("이미 처리된 URL (%s): %d개 (재시작 시 스킵됨)", COMPANY_NAME, len(processed_urls))

    # resume 모드: 이전 실패 건 로드
    state = HeungkukIngestState()
    resume_urls: set[str] | None = None
    if resume_state_path and resume_state_path.exists():
        prev_state = HeungkukIngestState.load(resume_state_path)
        resume_urls = {f.source_url for f in prev_state.failures}
        logger.info("재처리 모드: %d건 재시도", len(resume_urls))

    total_stats: dict[str, int] = {"total": 0, "success": 0, "skipped": 0, "failed": 0, "dry_run": 0}

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context()
        page = await ctx.new_page()

        async with httpx.AsyncClient(
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": PAGE_URL,
            },
            follow_redirects=True,
        ) as client:
            for tab_label, tab_idx, sale_status in [
                ("판매", 0, "ON_SALE"),
                ("판매중지", 1, "DISCONTINUED"),
            ]:
                logger.info("--- [%s] %s 탭 처리 시작 ---", COMPANY_NAME, tab_label)

                # Step 1: Playwright로 목록 수집
                try:
                    items = await collect_items_from_page(page, tab_label, tab_idx)
                except Exception as e:
                    logger.error("[%s] 탭 목록 수집 실패: %s", tab_label, e)
                    continue

                # Step 2: 다운로드 + 인제스트
                tab_stats = await download_and_ingest_all(
                    client=client,
                    session_factory=_db.session_factory,
                    items=items,
                    sale_status=sale_status,
                    state=state,
                    state_output_path=state_output_path,
                    processed_urls=processed_urls,
                    dry_run=dry_run,
                    resume_urls=resume_urls,
                )

                for k, v in tab_stats.items():
                    total_stats[k] = total_stats.get(k, 0) + v

                logger.info(
                    "[%s] %s 탭 완료: 성공=%d, 스킵=%d, 실패=%d",
                    COMPANY_NAME, tab_label,
                    tab_stats["success"], tab_stats["skipped"], tab_stats["failed"],
                )

        await browser.close()

    # 최종 실패 상태 저장
    state.stop_reason = "completed"
    state.save(state_output_path)

    sep = "=" * 60
    print(f"\n{sep}")
    print(f"{COMPANY_NAME} 크롤링+인제스트 완료")
    print(sep)
    print(f"전체:        {total_stats['total']:>6,}개")
    print(f"성공:        {total_stats['success']:>6,}개")
    print(f"스킵(중복):  {total_stats['skipped']:>6,}개")
    print(f"실패:        {total_stats['failed']:>6,}개")
    if dry_run:
        print(f"dry-run:     {total_stats.get('dry_run', 0):>6,}개")
    print(sep)

    if state.failures:
        fail_rate = len(state.failures) / max(total_stats["total"], 1)
        print(f"실패율: {fail_rate:.1%} ({len(state.failures)}건)")
        print(f"재처리: python -m scripts.crawl_and_ingest_heungkuk --resume-state {state_output_path}")

    return total_stats


def main() -> None:
    import sys

    parser = argparse.ArgumentParser(description=f"{COMPANY_NAME} 크롤링 + 인제스트")
    parser.add_argument("--dry-run", action="store_true", help="크롤링만 하고 DB 저장 안 함")
    parser.add_argument(
        "--resume-state",
        metavar="FILE",
        help="이전 실패 상태 JSON 파일 경로 (실패 건만 재처리)",
    )
    parser.add_argument(
        "--state-output",
        metavar="FILE",
        default="failure_state_heungkuk.json",
        help="실패 상태 저장 경로 (기본값: failure_state_heungkuk.json)",
    )
    args = parser.parse_args()

    resume_path = Path(args.resume_state) if args.resume_state else None
    state_out = Path(args.state_output)

    result = asyncio.run(run(
        dry_run=args.dry_run,
        resume_state_path=resume_path,
        state_output_path=state_out,
    ))
    if isinstance(result, dict) and "error" in result:
        logger.error("크롤링 실패 → exit code 1")
        sys.exit(1)


if __name__ == "__main__":
    main()
