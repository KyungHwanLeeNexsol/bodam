#!/usr/bin/env python3
"""한화생명 크롤링 + 즉시 인제스트 통합 파이프라인

GitHub Actions 환경에서 실행하기 위한 스크립트.
1단계: Playwright로 약관공시 페이지 방문 (세션 쿠키 확보)
2단계: page.evaluate() 내부 fetch()로 목록 API 호출 (SSL 레거시 이슈로 page.request 불가)
3단계: 카테고리 → 상품 → PDF 파일명 3단계 순회
4단계: page.request.post로 PDF 다운로드 → 즉시 인제스트 → 메모리 해제

실행:
    cd backend && PYTHONPATH=. uv run python -m scripts.crawl_and_ingest_hanwha_life --dry-run
    cd backend && PYTHONPATH=. uv run python -m scripts.crawl_and_ingest_hanwha_life
    cd backend && PYTHONPATH=. uv run python -m scripts.crawl_and_ingest_hanwha_life --resume-state failure_state_hanwha_life.json

# @MX:NOTE: [AUTO] www.hanwhalife.com은 SSL 레거시 재협상 이슈로 page.request 직접 호출 불가
# @MX:NOTE: [AUTO] 반드시 page.evaluate() 내부 fetch()를 통해 API 호출해야 함
# @MX:NOTE: [AUTO] 목록 API: POST /main/disclosure/goods/goodslist/getList.do (카테고리)
# @MX:NOTE: [AUTO] 상품 API: POST /main/disclosure/goods/goodslist/getList2.do (상품목록 + 첫상품PDF)
# @MX:NOTE: [AUTO] PDF API: POST /main/disclosure/goods/goodslist/getList3.do (특정상품 버전별 PDF)
# @MX:NOTE: [AUTO] PDF 다운로드: POST https://file.hanwhalife.com/www/announce/goods/download_chk.asp
"""
from __future__ import annotations

import argparse
import asyncio
import datetime
import gc
import json
import logging
import sys
import tempfile
from dataclasses import asdict, dataclass, field
from datetime import timezone
from pathlib import Path
from urllib.parse import quote, urlencode

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

COMPANY_CODE = "hanwha-life"
COMPANY_NAME = "한화생명"

# # @MX:NOTE: [AUTO] 약관공시 메인 페이지 (판매중 상품)
DISCLOSURE_URL = "https://www.hanwhalife.com/main/disclosure/goods/disclosurenotice/DF_GDDN000_P10000.do?MENU_ID1=DF_GDGL000"
LIST_BASE_URL = "https://www.hanwhalife.com/main/disclosure/goods/goodslist"
PDF_DOWNLOAD_URL = "https://file.hanwhalife.com/www/announce/goods/download_chk.asp"

RATE_LIMIT = 0.5  # 초
DEFAULT_STATE_FILE = "failure_state_hanwha_life.json"

# # @MX:NOTE: [AUTO] 수집 대상 카테고리 타입 (보험 종류 기준)
# GA=생존강화, GB=사망, GC=사망/생존혼합, GD=연금, GE=단체, GF=변액 관련 등
# 생명보험은 전체 수집 (건강/종신/CI/암/상해 포함)
# 판매채널: SA=대인, SB=단체, SC=다이렉트, SD=특별, SE=디지렉트
TARGET_SELL_TYPES = {"SA", "SC", "SE", "SD"}  # 개인/다이렉트/특별 채널 우선


@dataclass
class FailureRecord:
    """다운로드/인제스트 실패 건."""
    product_name: str
    category: str
    source_url: str
    sale_status: str
    error: str
    timestamp: str = field(default_factory=lambda: datetime.datetime.now(tz=timezone.utc).isoformat())


@dataclass
class HanwhaLifeIngestState:
    """한화생명 실패 상태 (재처리용 JSON 직렬화 가능)."""
    failures: list[FailureRecord] = field(default_factory=list)
    stop_reason: str = ""
    created_at: str = field(default_factory=lambda: datetime.datetime.now(timezone.utc).isoformat())

    def save(self, path: Path) -> None:
        data = asdict(self)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info("실패 상태 저장: %s (%d건)", path, len(self.failures))

    @classmethod
    def load(cls, path: Path) -> "HanwhaLifeIngestState":
        data = json.loads(path.read_text(encoding="utf-8"))
        failures = [FailureRecord(**f) for f in data.get("failures", [])]
        return cls(
            failures=failures,
            stop_reason=data.get("stop_reason", ""),
            created_at=data.get("created_at", ""),
        )


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


def _make_source_url(idx: int, file_name: str) -> str:
    """한화생명 PDF source_url을 구성한다.

    # @MX:NOTE: [AUTO] source_url = 상품 idx + 파일명으로 구성 (dedup 기준)
    # @MX:NOTE: [AUTO] 실제 다운로드는 POST download_chk.asp로 수행 (직접 URL 없음)
    """
    return f"https://www.hanwhalife.com/disclosure/goods/{idx}/{file_name}"


# # @MX:ANCHOR: [AUTO] _fetch_via_page - page.evaluate() 내부 fetch()로 API 호출
# # @MX:REASON: www.hanwhalife.com은 SSL 레거시 재협상 이슈로 page.request 직접 불가
async def _fetch_via_page(page: object, url: str, form_data: dict) -> dict:
    """Playwright page.evaluate()를 통해 fetch POST를 실행하고 JSON을 반환한다.

    SSL 레거시 재협상 이슈로 page.request.post가 불가하므로
    브라우저 컨텍스트 내부에서 fetch를 직접 호출한다.
    """
    encoded = urlencode(form_data)
    js = f"""
    async () => {{
        const resp = await fetch("{url}", {{
            method: "POST",
            headers: {{
                "Content-Type": "application/x-www-form-urlencoded",
            }},
            body: {json.dumps(encoded)}
        }});
        const text = await resp.text();
        return text;
    }}
    """
    try:
        raw = await page.evaluate(js)  # type: ignore[attr-defined]
        return json.loads(raw)
    except Exception as exc:
        logger.warning("fetch API 호출 실패 (%s): %s", url, exc)
        return {}


# # @MX:ANCHOR: [AUTO] collect_products - 한화생명 3단계 API로 상품 + PDF 파일명 수집
# # @MX:REASON: 카테고리→상품→PDF 3단계 순회, 전체 목록 수집의 진입점
async def collect_products(page: object) -> list[dict]:
    """Playwright page.evaluate() fetch로 3단계 API를 순회하여 상품+PDF 목록을 수집한다.

    반환 형식:
        [
          {
            "idx": 2582,
            "product_name": "한화생명 시그니처 H통합건강보험 무배당",
            "file_name": "한화생명_약관_20260201.pdf",
            "sell_type": "SA",
            "goods_type": "GA",
            "sell_start_dt": "2026-02-01",
            "sell_end_dt": "          ",
            "sale_status": "ON_SALE",
          },
          ...
        ]
    """
    # 세션 쿠키 확보를 위해 약관공시 페이지 방문
    logger.info("[%s] 약관공시 페이지 로딩 (세션 초기화)...", COMPANY_NAME)
    try:
        await page.goto(DISCLOSURE_URL, timeout=60_000, wait_until="networkidle")  # type: ignore[attr-defined]
        await asyncio.sleep(3)
    except Exception as exc:
        logger.warning("[%s] 초기 페이지 로드 실패 (계속 진행): %s", COMPANY_NAME, exc)

    # Step 1: 카테고리 목록 수집
    nonce = f"{__import__('random').random()}"
    list1_resp = await _fetch_via_page(
        page,
        f"{LIST_BASE_URL}/getList.do",
        {
            "PType": "1",
            "sellFlag": "Y",
            "goodsType": "",
            "sellType": "",
            "goodsIndex": "",
            "schText": "",
            "__MENU_ID": "DF_GDGL000",
            "_r_": nonce,
        },
    )
    categories: list[dict] = list1_resp.get("list1", [])
    logger.info("[%s] 카테고리 수: %d개", COMPANY_NAME, len(categories))

    all_products: list[dict] = []

    for cat in categories:
        sell_type = cat.get("SELL_TYPE", "")
        goods_type = cat.get("GOODS_TYPE", "")
        sell_type_nm = cat.get("SELL_TYPE_NM", "")
        goods_type_nm = cat.get("GOODS_TYPE_NM", "")
        category_label = f"{sell_type_nm}/{goods_type_nm}"

        await asyncio.sleep(RATE_LIMIT)

        # Step 2: 카테고리별 상품 목록 수집
        # # @MX:NOTE: [AUTO] getList2.do는 list2(상품목록) + list3(첫번째상품 PDF) 동시 반환
        nonce = f"{__import__('random').random()}"
        list2_resp = await _fetch_via_page(
            page,
            f"{LIST_BASE_URL}/getList2.do",
            {
                "PType": "1",
                "sellFlag": "Y",
                "goodsType": goods_type,
                "sellType": sell_type,
                "goodsIndex": "",
                "schText": "",
                "__MENU_ID": "DF_GDGL000",
                "_r_": nonce,
            },
        )
        products_in_cat: list[dict] = list2_resp.get("list2", [])
        first_pdfs: list[dict] = list2_resp.get("list3", [])

        if not products_in_cat:
            logger.debug("[%s] 카테고리 %s: 상품 없음", COMPANY_NAME, category_label)
            continue

        logger.info(
            "[%s] 카테고리 %s: 상품 %d개",
            COMPANY_NAME, category_label, len(products_in_cat),
        )

        for prod_idx, prod in enumerate(products_in_cat):
            idx = prod.get("IDX")
            product_name = prod.get("GOODS_NAME", "")

            if not idx or not product_name:
                continue

            await asyncio.sleep(RATE_LIMIT)

            # Step 3: 상품별 PDF 버전 목록 수집
            # 첫번째 상품은 getList2 응답의 list3에서 이미 있음
            if prod_idx == 0 and first_pdfs:
                pdf_versions = first_pdfs
            else:
                nonce = f"{__import__('random').random()}"
                list3_resp = await _fetch_via_page(
                    page,
                    f"{LIST_BASE_URL}/getList3.do",
                    {
                        "PType": "1",
                        "sellFlag": "Y",
                        "goodsType": goods_type,
                        "sellType": sell_type,
                        "goodsIndex": str(idx),
                        "schText": "",
                        "__MENU_ID": "DF_GDGL000",
                        "_r_": nonce,
                    },
                )
                pdf_versions = list3_resp.get("list3", [])

            if not pdf_versions:
                logger.debug(
                    "[%s] %s: PDF 없음 (idx=%s)",
                    COMPANY_NAME, product_name[:40], idx,
                )
                continue

            # getList3.do 응답 필드 구조 파악을 위한 첫 번째 버전 덤프 (최초 1회)
            if not all_products:
                logger.info(
                    "[DEBUG] getList3.do 첫 버전 raw 필드 (idx=%s, product=%s): %s",
                    idx, product_name[:40], json.dumps(pdf_versions[0], ensure_ascii=False),
                )

            # 각 버전의 PDF 파일 수집
            # # @MX:NOTE: [AUTO] 최신 버전(SELL_END_DT가 공백)의 약관 PDF만 수집 (FILE_NAME3 = 약관)
            for version in pdf_versions:
                sell_start_dt = version.get("SELL_START_DT", "").strip()
                sell_end_dt = version.get("SELL_END_DT", "").strip()

                # 판매중 여부: SELL_END_DT가 공백이면 현재 판매중
                sale_status = "ON_SALE" if not sell_end_dt else "DISCONTINUED"

                # FILE_NAME1=상품요약서, FILE_NAME2=상품약관, FILE_NAME3=약관, FILE_NAME4=주요내용요약서
                # 약관 파일 우선 수집 (FILE_NAME3)
                for file_key in ["FILE_NAME3", "FILE_NAME2", "FILE_NAME1"]:
                    file_name = version.get(file_key, "").strip()
                    if not file_name:
                        continue

                    all_products.append({
                        "idx": idx,
                        "product_name": product_name,
                        "file_name": file_name,
                        "file_key": file_key,
                        "sell_type": sell_type,
                        "goods_type": goods_type,
                        "category_label": category_label,
                        "sell_start_dt": sell_start_dt,
                        "sell_end_dt": sell_end_dt,
                        "sale_status": sale_status,
                    })
                    # 약관 파일 1개만 수집 (중복 방지)
                    break

    logger.info("[%s] 전체 상품 수집 완료: %d개", COMPANY_NAME, len(all_products))
    return all_products


# # @MX:ANCHOR: [AUTO] download_and_ingest_all - 상품별 PDF 다운로드 및 인제스트 루프
# # @MX:REASON: 크롤러 핵심 루프, 실패 상태 관리 및 resume 지원
async def download_and_ingest_all(
    page: object,
    session_factory: object,
    products: list[dict],
    state: HanwhaLifeIngestState,
    state_output_path: Path,
    processed_urls: set[str],
    dry_run: bool = False,
    resume_urls: set[str] | None = None,
    fail_stop: bool = False,
) -> dict[str, int]:
    """수집된 상품 목록에서 약관 PDF를 다운로드하고 인제스트한다.

    # @MX:NOTE: [AUTO] PDF 다운로드: POST download_chk.asp with file_name param (EUC-KR 인코딩)
    # @MX:NOTE: [AUTO] page.request.post는 file.hanwhalife.com에서는 동작함 (SSL 이슈 없음)
    """
    stats = {"total": 0, "success": 0, "skipped": 0, "failed": 0, "dry_run": 0}

    for idx_loop, item in enumerate(products, 1):
        prod_idx: int = item.get("idx", 0)
        product_name: str = item.get("product_name", "")
        file_name: str = item.get("file_name", "")
        file_key: str = item.get("file_key", "")
        category_label: str = item.get("category_label", "LIFE")
        sale_status: str = item.get("sale_status", "ON_SALE")
        sell_start_dt: str = item.get("sell_start_dt", "")

        if not prod_idx or not product_name or not file_name:
            continue

        stats["total"] += 1

        # source_url: dedup 기준 (idx + file_name으로 고유 식별)
        source_url = _make_source_url(prod_idx, file_name)

        # resume 모드: 지정된 URL만 재처리
        if resume_urls is not None and source_url not in resume_urls:
            stats["skipped"] += 1
            continue

        # 이미 처리된 URL 스킵 (중복 다운로드 방지)
        if source_url in processed_urls:
            stats["skipped"] += 1
            continue

        if idx_loop % 50 == 0 or idx_loop == 1:
            logger.info(
                "진행: %d / %d (성공=%d, 스킵=%d, 실패=%d)",
                stats["total"], len(products),
                stats["success"], stats["skipped"], stats["failed"],
            )

        await asyncio.sleep(RATE_LIMIT)

        # PDF 다운로드
        # # @MX:NOTE: [AUTO] file.hanwhalife.com은 POST download_chk.asp 사용
        # # @MX:NOTE: [AUTO] file_name 파라미터는 EUC-KR URL 인코딩으로 전송해야 함 (IIS/ASP CODEPAGE=949)
        # # @MX:NOTE: [AUTO] page.request.post(form={})는 UTF-8 인코딩 → 서버가 파일을 못 찾음
        # # @MX:NOTE: [AUTO] 수정: file_name을 EUC-KR bytes로 percent-encode 후 data=로 전송
        pdf_bytes: bytes | None = None
        try:
            # EUC-KR 인코딩: ASP CODEPAGE=949 서버가 EUC-KR percent-encoded 파라미터를 기대함
            try:
                file_name_encoded = quote(file_name.encode("euc-kr"), safe="")
            except (UnicodeEncodeError, LookupError):
                file_name_encoded = quote(file_name, safe="")
            form_body = f"file_name={file_name_encoded}"
            resp = await page.request.post(  # type: ignore[attr-defined]
                PDF_DOWNLOAD_URL,
                data=form_body,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=30_000,
            )
            if resp.status == 200:
                data = await resp.body()
                if len(data) > 1000 and data[:4] == b"%PDF":
                    pdf_bytes = data
                else:
                    # 오류 응답 내용을 EUC-KR로 디코딩해서 로그에 출력
                    try:
                        err_msg = data.decode("euc-kr", errors="replace").strip()[:120]
                    except Exception:
                        err_msg = repr(data[:80])
                    logger.warning(
                        "[%d] PDF 시그니처 불일치: %s (size=%d, msg=%s)",
                        idx_loop, product_name[:40], len(data), err_msg,
                    )
            else:
                logger.warning(
                    "[%d] 다운로드 실패: %s | HTTP=%d",
                    idx_loop, product_name[:40], resp.status,
                )
        except Exception as exc:
            logger.warning("[%d] 다운로드 예외 %s: %s", idx_loop, product_name[:40], exc)

        if not pdf_bytes:
            stats["failed"] += 1
            state.failures.append(FailureRecord(
                product_name=product_name,
                category=category_label,
                source_url=source_url,
                sale_status=sale_status,
                error="다운로드 실패 또는 PDF 시그니처 불일치",
            ))
            state.save(state_output_path)

            if fail_stop:
                total = stats["total"]
                fail_count = stats["failed"]
                if total >= 5 and fail_count / total > 0.05:
                    logger.error(
                        "실패율 %.1f%% 초과 (fail-stop 활성화) → 중단",
                        fail_count / total * 100,
                    )
                    state.stop_reason = "fail_stop"
                    state.save(state_output_path)
                    break
            continue

        # 인제스트
        metadata = {
            "format_type": "B",
            "company_code": COMPANY_CODE,
            "company_name": COMPANY_NAME,
            "product_name": product_name,
            "category": category_label,
            "source_url": source_url,
            "sale_status": sale_status,
        }

        try:
            result = await ingest_pdf_bytes(session_factory, pdf_bytes, metadata, dry_run=dry_run)
        except Exception as exc:
            error_msg = f"{type(exc).__name__}: {exc}"
            logger.error("[%d] 인제스트 예외 %s: %s", idx_loop, product_name[:40], error_msg)
            result = {"status": "failed", "error": error_msg}

        gc.collect()

        status = result.get("status", "failed")
        if status == "success":
            stats["success"] += 1
            processed_urls.add(source_url)
            logger.info(
                "[%d] 완료: %s | %s | %s",
                idx_loop, product_name[:40], sale_status, file_key,
            )
        elif status == "skipped":
            stats["skipped"] += 1
            logger.debug("[%d] 스킵(중복): %s", idx_loop, product_name[:40])
        elif status == "dry_run":
            stats["dry_run"] += 1
        else:
            stats["failed"] += 1
            error_msg = result.get("error", "")
            logger.warning("[%d] 인제스트 실패 %s: %s", idx_loop, product_name[:40], error_msg)
            state.failures.append(FailureRecord(
                product_name=product_name,
                category=category_label,
                source_url=source_url,
                sale_status=sale_status,
                error=error_msg,
            ))
            state.save(state_output_path)

    return stats


async def run(
    dry_run: bool = False,
    resume_state_path: Path | None = None,
    state_output_path: Path = Path(DEFAULT_STATE_FILE),
    fail_stop: bool = False,
) -> dict:
    """한화생명 크롤링 + 인제스트 메인 실행 함수."""
    from playwright.async_api import async_playwright

    logger.info("=" * 60)
    logger.info("%s 크롤링 + 인제스트 시작", COMPANY_NAME)
    logger.info("=" * 60)

    # DB 초기화 (dry-run 시 스킵)
    _db = None
    if not dry_run:
        import app.core.database as db_module
        from app.core.config import Settings
        try:
            settings = Settings()  # type: ignore[call-arg]
            await db_module.init_database(settings)
        except Exception as exc:
            logger.error("DB 초기화 실패: %s", exc)
            return {"error": str(exc)}

        if db_module.session_factory is None:
            logger.error("DB 세션 팩토리 초기화 실패")
            return {"error": "session_factory is None"}

        _db = db_module

    # 이미 처리된 URL 로드 (재시작 시 중복 다운로드 방지, dry-run 시 빈 set)
    if not dry_run and _db is not None:
        from scripts.ingest_local_pdfs import load_processed_urls
        async with _db.session_factory() as _session:
            processed_urls: set[str] = await load_processed_urls(_session, company_code=COMPANY_CODE)
        logger.info(
            "이미 처리된 URL (%s): %d개 (재시작 시 스킵됨)",
            COMPANY_NAME, len(processed_urls),
        )
    else:
        processed_urls = set()
        logger.info("이미 처리된 URL (%s): 0개 (dry-run 모드)", COMPANY_NAME)

    # resume 모드: 이전 실패 건 로드
    state = HanwhaLifeIngestState()
    resume_urls: set[str] | None = None
    if resume_state_path and resume_state_path.exists():
        prev_state = HanwhaLifeIngestState.load(resume_state_path)
        resume_urls = {f.source_url for f in prev_state.failures}
        logger.info("재처리 모드: %d건 재시도", len(resume_urls))

    total_stats: dict[str, int] = {"total": 0, "success": 0, "skipped": 0, "failed": 0, "dry_run": 0}

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context()
        page = await ctx.new_page()

        # Step 1: 3단계 API로 상품 목록 수집
        try:
            products = await collect_products(page)
        except Exception as exc:
            logger.error("[%s] 상품 목록 수집 실패: %s", COMPANY_NAME, exc)
            await browser.close()
            return {"error": str(exc)}

        if not products:
            logger.warning("[%s] 수집된 상품 없음", COMPANY_NAME)
            await browser.close()
            state.stop_reason = "no_products"
            state.save(state_output_path)
            return total_stats

        if dry_run:
            logger.info("[%s] DRY-RUN: 수집된 상품 %d개 출력", COMPANY_NAME, len(products))
            on_sale_count = sum(1 for p in products if p.get("sale_status") == "ON_SALE")
            disc_count = len(products) - on_sale_count
            logger.info("  판매중: %d개, 판매중지: %d개", on_sale_count, disc_count)
            for i, p in enumerate(products[:30], 1):
                logger.info(
                    "  [%d] idx=%s | %s | %s | %s | %s",
                    i,
                    p.get("idx"),
                    p.get("product_name", "")[:45],
                    p.get("sale_status"),
                    p.get("file_key"),
                    p.get("file_name", "")[:50],
                )
            if len(products) > 30:
                logger.info("  ... (총 %d개 중 30개 출력)", len(products))
            total_stats["total"] = len(products)
            total_stats["dry_run"] = len(products)
        else:
            # Step 1.5: file.hanwhalife.com 세션 확보
            # download_chk.asp는 ASPSESSIONID 쿠키가 없으면 JavaScript redirect(138B) 반환
            # www.hanwhalife.com 쿠키는 file.hanwhalife.com 도메인에 전달 안 됨
            try:
                await page.goto(  # type: ignore[attr-defined]
                    "https://file.hanwhalife.com/",
                    timeout=15_000,
                    wait_until="domcontentloaded",
                )
                await asyncio.sleep(1)
                logger.info("[%s] file.hanwhalife.com 세션 쿠키 확보 완료", COMPANY_NAME)
            except Exception as exc:
                logger.warning("[%s] file.hanwhalife.com 방문 실패 (계속): %s", COMPANY_NAME, exc)

            # Step 2: PDF 다운로드 + 인제스트
            total_stats = await download_and_ingest_all(
                page=page,
                session_factory=_db.session_factory if _db is not None else None,
                products=products,
                state=state,
                state_output_path=state_output_path,
                processed_urls=processed_urls,
                dry_run=dry_run,
                resume_urls=resume_urls,
                fail_stop=fail_stop,
            )

        await browser.close()

    # 최종 실패 상태 저장
    if not state.stop_reason:
        state.stop_reason = "completed"
    state.save(state_output_path)

    sep = "=" * 60
    logger.info("\n%s", sep)
    logger.info("%s 크롤링+인제스트 완료", COMPANY_NAME)
    logger.info("%s", sep)
    logger.info("전체:        %6d개", total_stats["total"])
    logger.info("성공:        %6d개", total_stats["success"])
    logger.info("스킵(중복):  %6d개", total_stats["skipped"])
    logger.info("실패:        %6d개", total_stats["failed"])
    if dry_run:
        logger.info("dry-run:     %6d개", total_stats.get("dry_run", 0))
    logger.info("%s", sep)

    if state.failures:
        fail_rate = len(state.failures) / max(total_stats["total"], 1)
        logger.info("실패율: %.1f%% (%d건)", fail_rate * 100, len(state.failures))
        logger.info(
            "재처리: python -m scripts.crawl_and_ingest_hanwha_life --resume-state %s",
            state_output_path,
        )

    return total_stats


def main() -> None:
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
        default=DEFAULT_STATE_FILE,
        help=f"실패 상태 저장 경로 (기본값: {DEFAULT_STATE_FILE})",
    )
    parser.add_argument(
        "--fail-stop",
        action="store_true",
        help="실패율 5%% 초과 시 즉시 중단",
    )
    args = parser.parse_args()

    resume_path = Path(args.resume_state) if args.resume_state else None
    output_path = Path(args.state_output)

    asyncio.run(
        run(
            dry_run=args.dry_run,
            resume_state_path=resume_path,
            state_output_path=output_path,
            fail_stop=args.fail_stop,
        )
    )


if __name__ == "__main__":
    main()
