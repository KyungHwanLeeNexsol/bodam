#!/usr/bin/env python3
"""한화손해보험 크롤링 + 즉시 인제스트 통합 파이프라인

GitHub Actions 환경에서 실행하기 위한 스크립트.
1단계: Playwright(스텔스 모드)로 4단계 SPA API 순회하여 약관 목록 수집 (판매중 + 판매중지)
2단계: httpx로 PDF 직접 다운로드 → 즉시 인제스트 → 메모리 해제

실행:
    cd backend && PYTHONPATH=. uv run python -m scripts.crawl_and_ingest_hanwha
    cd backend && PYTHONPATH=. uv run python -m scripts.crawl_and_ingest_hanwha --dry-run
    cd backend && PYTHONPATH=. uv run python -m scripts.crawl_and_ingest_hanwha --resume-state failure_state_hanwha.json

# @MX:NOTE: [AUTO] 한화손보 evfw WAF 우회: --disable-blink-features=AutomationControlled + navigator.webdriver=undefined
# @MX:NOTE: [AUTO] 4단계 SPA: step1(상품그룹) → step2(상품명/코드) → step3(약관유형) → step4(PDF 파일)
# @MX:NOTE: [AUTO] POST /notice/ir/product-ing01-list.json (판매중) / product-stop01-list.json (판매중지)
# @MX:NOTE: [AUTO] PDF 경로: BASE_URL + item["file1"|"file2"|"file3"] (절대경로 포함)
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

# 한화손해보험 설정
COMPANY_CODE = "hanwha-general"
COMPANY_NAME = "한화손해보험"
BASE_URL = "https://www.hwgeneralins.com"

# 판매중 / 판매중지 API 엔드포인트
PRODUCT_ING_URL = f"{BASE_URL}/notice/ir/product-ing01-list.json"
PRODUCT_STOP_URL = f"{BASE_URL}/notice/ir/product-stop01-list.json"

RATE_LIMIT = 0.5  # 초 (요청 간 대기)
DEFAULT_STATE_PATH = Path("failure_state_hanwha.json")

# 수집 대상 상품 그룹 키워드 (소문자 비교)
# @MX:NOTE: [AUTO] 한화손보 goodsGrp 기준 필터 - 생명/자동차/화재/해상 제외
TARGET_GROUP_KEYWORDS: tuple[str, ...] = (
    "상해", "건강", "의료", "실손", "암", "종합", "어린이", "노인", "치아", "간병",
)
EXCLUDE_GROUP_KEYWORDS: tuple[str, ...] = (
    "자동차", "화재", "해상", "배상", "책임", "연금", "저축", "퇴직", "변액",
)

# POST 공통 바디 (isActive는 per-request로 설정)
POST_COMPANY = "(통합)한화손해보험"

# HTTP 헤더 (WAF 우회용)
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)


@dataclass
class FailureRecord:
    """다운로드/인제스트 실패 건 상세 정보."""

    idx: int
    url: str
    goods_name: str
    goods_grp: str
    sale_status: str
    error_type: str          # download_failed / ingest_failed
    http_status: int | None
    error_msg: str
    file_size: int
    timestamp: str = field(default_factory=lambda: datetime.now(tz=timezone.utc).isoformat())


@dataclass
class CrawlState:
    """크롤링 상태 (중단/재시작용 JSON 직렬화 가능)."""

    last_processed_idx: int = 0
    failures: list[FailureRecord] = field(default_factory=list)
    started_at: str = field(default_factory=lambda: datetime.now(tz=timezone.utc).isoformat())
    stopped_at: str | None = None
    stop_reason: str | None = None  # fail_immediate / completed / interrupted

    def to_json(self) -> str:
        data = asdict(self)
        return json.dumps(data, ensure_ascii=False, indent=2)

    @classmethod
    def from_json(cls, text: str) -> "CrawlState":
        data = json.loads(text)
        failures = [FailureRecord(**f) for f in data.pop("failures", [])]
        state = cls(**data)
        state.failures = failures
        return state


def save_state(state: CrawlState, state_path: Path) -> None:
    """크롤링 상태를 JSON으로 저장한다."""
    state_path.write_text(state.to_json(), encoding="utf-8")
    logger.info("상태 저장 완료: %s (실패 %d건)", state_path, len(state.failures))


def _is_target_group(goods_grp: str) -> bool:
    """상품 그룹이 수집 대상인지 판별한다.

    제외 키워드가 포함된 경우 우선 제외하고,
    포함 키워드가 하나라도 있으면 대상으로 판단한다.
    """
    grp_lower = goods_grp.lower()
    if any(kw in grp_lower for kw in EXCLUDE_GROUP_KEYWORDS):
        return False
    if any(kw in grp_lower for kw in TARGET_GROUP_KEYWORDS):
        return True
    # 키워드 미일치 시 기본 수집 제외 (안전 기본값)
    return False


async def _make_stealth_context(pw: object) -> object:
    """evfw WAF를 우회하는 스텔스 Playwright 컨텍스트를 생성한다.

    WAF가 navigator.webdriver 속성을 감지해 headless 여부를 판별하므로
    AutomationControlled 비활성화 + init_script로 속성을 재정의한다.
    """
    from playwright.async_api import Playwright  # type: ignore[attr-defined]
    pw: Playwright  # type: ignore[no-redef]

    # @MX:NOTE: [AUTO] --disable-blink-features=AutomationControlled 없으면 evfw 400 응답
    browser = await pw.chromium.launch(
        headless=True,
        args=["--disable-blink-features=AutomationControlled"],
    )
    ctx = await browser.new_context(
        user_agent=BROWSER_UA,
    )
    # navigator.webdriver 재정의 (evfw 감지 우회)
    await ctx.add_init_script(
        "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
    )
    return browser, ctx


async def _post_api(
    page: object,
    url: str,
    form_data: dict[str, str],
) -> list[dict]:
    """Playwright 페이지를 통해 POST API를 호출하고 list 응답을 반환한다."""
    # @MX:NOTE: [AUTO] evfw WAF 우회 핵심: fetch()가 아닌 jQuery $.ajax()로 호출해야 함
    # @MX:NOTE: [AUTO] fetch()는 evfw 토큰(WSPHii, 6mpyB4Zcu)이 자동 주입되지 않아 400 응답
    # @MX:NOTE: [AUTO] $.ajax()는 jQuery ajaxSetup/beforeSend 훅을 통해 토큰이 자동 포함됨
    # JSON 직렬화로 JS 인젝션 방지
    import json as _json
    data_json = _json.dumps(form_data)

    script = f"""
    async () => {{
        const formData = {data_json};
        return new Promise((resolve) => {{
            $.ajax({{
                method: "POST",
                url: "{url}",
                data: formData,
                dataType: "json"
            }}).done(function(data) {{
                resolve(data.list || []);
            }}).fail(function(xhr, status, err) {{
                resolve([]);
            }});
        }});
    }}
    """
    try:
        result = await page.evaluate(script)
        return result if isinstance(result, list) else []
    except Exception as e:
        logger.warning("API 호출 실패 [%s]: %s", url, e)
        return []


async def collect_pdf_items(
    page: object,
    api_url: str,
    is_active: str,
    sale_status: str,
) -> list[dict]:
    """4단계 SPA API를 순회하여 수집 대상 PDF 파일 목록을 반환한다.

    Returns:
        각 항목: {
            "goods_name": str,
            "goods_code": str,
            "goods_grp": str,
            "file_url": str,  # 최종 PDF 절대 URL
            "sale_status": str,
        }
    """
    # @MX:NOTE: [AUTO] Step1 응답 구조: goodsCode=null이면 그룹 헤더(dt), 있으면 선택 항목(dd)
    # @MX:NOTE: [AUTO] Step1 선택값: goodsGrp=item["goodsGrp"], goodsCode=item["goodsCode"](=코드분류)
    # @MX:NOTE: [AUTO] Step2 요청: goodsGrp+goodsCode로 상품명 목록 조회
    # @MX:NOTE: [AUTO] Step3 응답: 판매기간(path)별 항목, 각 항목에 file1~file3 직접 포함
    # @MX:NOTE: [AUTO] Step4 생략 가능: step3 결과에 이미 file1~file3 있음 (최신 path 자동 선택)

    collected: list[dict] = []
    seen_urls: set[str] = set()  # 판매기간별 중복 PDF 방지

    # --- Step 1: 상품 분류 목록 조회 ---
    # 응답: [{goodsGrp: "자동차보험", goodsCode: None}, {goodsGrp: "자동차보험", goodsCode: "개인용"}, ...]
    step1_raw = await _post_api(page, api_url, {
        "isActive": is_active,
        "company": POST_COMPANY,
        "goodsGrp": "",
        "goodsName": "",
        "goodsCode": "",
        "path": "",
        "gdFlgnm": "01",
    })
    logger.info("[%s] %s step1 상품그룹: %d개", COMPANY_NAME, sale_status, len(step1_raw))

    # goodsCode가 있는 항목만 실제 선택 항목 (그룹 헤더 제외)
    step1_items = [item for item in step1_raw if item.get("goodsCode")]

    for grp_item in step1_items:
        goods_grp = grp_item.get("goodsGrp", "")
        goods_code_cls = grp_item.get("goodsCode", "")  # 분류코드 (예: "개인용", "건강")

        if not goods_grp or not goods_code_cls:
            continue

        # 대상 그룹 필터 적용 (goodsGrp 또는 goodsCode 분류명으로 판별)
        # @MX:NOTE: [AUTO] 한화손보는 goodsGrp="장기보험"/"일반보험", 분류코드에 "상해/질병" 등 포함
        if not _is_target_group(goods_grp) and not _is_target_group(goods_code_cls):
            logger.debug("그룹 제외: %s / %s", goods_grp, goods_code_cls)
            continue

        # --- Step 2: 상품명 목록 조회 ---
        # 요청: goodsGrp=그룹명, goodsCode=분류코드
        step2_items = await _post_api(page, api_url, {
            "isActive": is_active,
            "company": POST_COMPANY,
            "goodsGrp": goods_grp,
            "goodsName": "",
            "goodsCode": goods_code_cls,
            "path": "",
            "gdFlgnm": "02",
        })

        for prod_item in step2_items:
            goods_name = prod_item.get("goodsName", "")
            goods_code = prod_item.get("goodsCode", "")
            if not goods_name:
                continue
            if not goods_code:
                goods_code = goods_code_cls

            # --- Step 3: 판매기간별 PDF 파일 목록 조회 ---
            # 응답: 각 항목에 path(판매기간) + file1~file3(PDF 경로) 포함
            step3_items = await _post_api(page, api_url, {
                "isActive": is_active,
                "company": POST_COMPANY,
                "goodsGrp": goods_grp,
                "goodsName": goods_name,
                "goodsCode": goods_code,
                "path": "",
                "gdFlgnm": "03",
            })

            for period_item in step3_items:
                term_path = period_item.get("path", "")

                # file1~file3 필드에 PDF 경로가 담겨 있음
                for file_key in ("file1", "file2", "file3"):
                    file_path = period_item.get(file_key, "") or ""
                    if not file_path:
                        continue
                    # 절대 경로 구성 (/upload/... 형태)
                    file_url = f"{BASE_URL}{file_path}"
                    if file_url in seen_urls:
                        continue
                    seen_urls.add(file_url)
                    collected.append({
                        "goods_name": goods_name,
                        "goods_code": goods_code,
                        "goods_grp": goods_grp,
                        "term_path": term_path,
                        "file_key": file_key,
                        "file_url": file_url,
                        "sale_status": sale_status,
                    })

        await asyncio.sleep(0.1)  # step2 루프 과부하 방지

    logger.info(
        "[%s] %s PDF 항목 수집 완료: %d개",
        COMPANY_NAME, sale_status, len(collected),
    )
    return collected


async def download_pdf_bytes(
    client: object,
    url: str,
) -> tuple[bytes, int | None]:
    """PDF URL에서 바이트를 다운로드한다.

    Returns:
        (content_bytes, http_status)
        content_bytes가 빈 bytes면 다운로드 실패.
    """
    import httpx as _httpx  # type: ignore[attr-defined]
    client: _httpx.AsyncClient  # type: ignore[no-redef]

    try:
        resp = await client.get(url, timeout=_httpx.Timeout(60.0, connect=10.0))
        status = resp.status_code

        if status >= 400:
            logger.warning("다운로드 HTTP %d: %s", status, url[-80:])
            return b"", status

        data = resp.content
        if not data or len(data) < 1000:
            logger.warning(
                "다운로드 응답 너무 작음 (%d bytes): %s",
                len(data) if data else 0, url[-80:],
            )
            return b"", status

        if data[:4] != b"%PDF":
            if data[:2] == b"PK":
                logger.info(
                    "ZIP 파일 수신: %s (%d bytes) → 저장 보류",
                    url[-80:], len(data),
                )
                return data, status
            logger.warning(
                "PDF 시그니처 불일치: %s (앞 20바이트: %r)",
                url[-80:], data[:20],
            )
            return b"", status

        return data, status

    except _httpx.TimeoutException as e:
        logger.warning("다운로드 타임아웃: %s (%s)", url[-80:], e)
        return b"", None
    except _httpx.ConnectError as e:
        logger.warning("다운로드 연결 실패: %s (%s)", url[-80:], e)
        return b"", None
    except Exception as e:
        logger.warning("다운로드 예외 %s: %s (%s)", url[-80:], e, type(e).__name__)
        return b"", None


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
    state: CrawlState,
    state_output_path: Path,
    processed_urls: set[str],
    dry_run: bool = False,
    resume_urls: set[str] | None = None,
    resume_from: int = 0,
) -> dict[str, int]:
    """수집된 PDF 목록을 다운로드하고 인제스트한다."""
    stats: dict[str, int] = {
        "total": 0,
        "success": 0,
        "skipped": 0,
        "failed": 0,
        "dry_run": 0,
    }

    for idx, item in enumerate(items, 1):
        file_url = item["file_url"]
        goods_name = item["goods_name"]
        goods_grp = item["goods_grp"]
        goods_code = item["goods_code"]
        sale_status = item["sale_status"]

        # resume_from: 지정 인덱스 이전 항목 스킵
        if idx <= resume_from:
            stats["skipped"] += 1
            continue

        stats["total"] += 1

        # resume 모드: 이전 실패 URL만 재처리
        if resume_urls is not None and file_url not in resume_urls:
            stats["skipped"] += 1
            continue

        # 이미 처리된 URL 스킵 (중복 방지)
        if file_url in processed_urls:
            stats["skipped"] += 1
            logger.debug("[%d] URL 스킵 (이미 처리됨): %s", idx, goods_name[:40])
            continue

        if idx % 50 == 0 or idx <= 3:
            logger.info(
                "진행: idx=%d / 전체=%d (성공=%d, 스킵=%d, 실패=%d)",
                idx, len(items),
                stats["success"], stats["skipped"], stats["failed"],
            )

        await asyncio.sleep(RATE_LIMIT)

        # PDF 다운로드
        pdf_bytes, http_status = await download_pdf_bytes(client, file_url)

        if not pdf_bytes:
            stats["failed"] += 1
            state.failures.append(FailureRecord(
                idx=idx,
                url=file_url,
                goods_name=goods_name,
                goods_grp=goods_grp,
                sale_status=sale_status,
                error_type="download_failed",
                http_status=http_status,
                error_msg=f"다운로드 실패 HTTP={http_status}",
                file_size=0,
            ))
            state.last_processed_idx = idx
            save_state(state, state_output_path)
            continue
        elif pdf_bytes[:2] == b"PK":
            # ZIP 파일: 임베딩 보류, 실패 아님
            logger.info(
                "[%d] ZIP 파일 인제스트 보류 (임베딩 미지원): %s (%d bytes)",
                idx, goods_name[:40], len(pdf_bytes),
            )
            continue

        # 인제스트 메타데이터 구성
        # PDF URL에서 파일명 기반 상품코드 추출
        product_code = Path(file_url.split("?")[0]).stem or goods_code
        metadata = {
            "format_type": "B",
            "company_code": COMPANY_CODE,
            "company_name": COMPANY_NAME,
            "product_code": product_code[:50],
            "product_name": goods_name,
            "category": "NON_LIFE",
            "source_url": file_url,
            "sale_status": sale_status,
        }

        try:
            result = await ingest_pdf_bytes(
                session_factory, pdf_bytes, metadata, dry_run=dry_run,
            )
        except Exception as e:
            error_msg = f"{type(e).__name__}: {e}"
            logger.error("[%d] 인제스트 예외 %s: %s", idx, goods_name[:40], error_msg)
            result = {"status": "failed", "error": error_msg}

        gc.collect()

        status = result.get("status", "failed")
        if status == "success":
            stats["success"] += 1
            processed_urls.add(file_url)
            logger.info("[%d] 완료: %s (%s)", idx, goods_name[:40], goods_grp)
        elif status == "skipped":
            stats["skipped"] += 1
            logger.debug("[%d] 스킵(중복): %s", idx, goods_name[:40])
        elif status == "dry_run":
            stats["dry_run"] += 1
        else:
            stats["failed"] += 1
            error_msg = result.get("error", "알 수 없는 오류")
            logger.warning("[%d] 인제스트 실패 %s: %s", idx, goods_name[:40], error_msg)
            state.failures.append(FailureRecord(
                idx=idx,
                url=file_url,
                goods_name=goods_name,
                goods_grp=goods_grp,
                sale_status=sale_status,
                error_type="ingest_failed",
                http_status=http_status,
                error_msg=error_msg,
                file_size=len(pdf_bytes),
            ))
            save_state(state, state_output_path)

        state.last_processed_idx = idx

    return stats


async def run(
    dry_run: bool = False,
    resume_from: int = 0,
    resume_state_path: Path | None = None,
    state_output_path: Path = DEFAULT_STATE_PATH,
) -> dict:
    """한화손해보험 크롤링 + 인제스트 메인 실행 함수."""
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
        processed_urls: set[str] = await load_processed_urls(
            _session, company_code=COMPANY_CODE,
        )
    logger.info(
        "이미 처리된 URL (%s): %d개 (재시작 시 스킵됨)",
        COMPANY_NAME, len(processed_urls),
    )

    # resume 모드: 이전 실패 건 로드
    state = CrawlState()
    resume_urls: set[str] | None = None
    if resume_state_path and resume_state_path.exists():
        prev_state = CrawlState.from_json(resume_state_path.read_text(encoding="utf-8"))
        resume_urls = {f.url for f in prev_state.failures}
        logger.info("재처리 모드: %d건 재시도", len(resume_urls))

    total_stats: dict[str, int] = {
        "total": 0,
        "success": 0,
        "skipped": 0,
        "failed": 0,
        "dry_run": 0,
    }

    # @MX:ANCHOR: [AUTO] Playwright 스텔스 컨텍스트 + httpx 클라이언트 생명주기 관리
    # @MX:REASON: evfw WAF 우회를 위해 browser/context가 세션 전체에 유지되어야 함
    async with async_playwright() as pw:
        browser, ctx = await _make_stealth_context(pw)
        page = await ctx.new_page()

        # 약관 공시 페이지 초기 로드 (evfw 세션/쿠키 초기화)
        try:
            await page.goto(
                f"{BASE_URL}/notice/ir/product-ing01.do",
                wait_until="networkidle",
                timeout=30000,
            )
            await asyncio.sleep(2)
            logger.info("초기 페이지 로드 완료: %s", await page.title())
        except Exception as e:
            logger.warning("초기 페이지 로드 실패 (계속 진행): %s", e)

        async with httpx.AsyncClient(
            headers={
                "User-Agent": BROWSER_UA,
                "Referer": f"{BASE_URL}/notice/ir/product-ing01.do",
            },
            follow_redirects=True,
        ) as client:
            # 판매중 + 판매중지 순차 처리
            # @MX:NOTE: [AUTO] 각 탭마다 해당 페이지로 이동해야 evfw 토큰이 올바른 API URL용으로 발급됨
            for api_url, page_url, is_active, sale_status, label in [
                (PRODUCT_ING_URL,  f"{BASE_URL}/notice/ir/product-ing01.do",  "1", "ON_SALE",      "판매중"),
                (PRODUCT_STOP_URL, f"{BASE_URL}/notice/ir/product-stop01.do", "0", "DISCONTINUED", "판매중지"),
            ]:
                logger.info("--- [%s] %s 처리 시작 ---", COMPANY_NAME, label)

                # 해당 탭 페이지로 이동 (evfw 세션/토큰 초기화)
                try:
                    await page.goto(page_url, wait_until="networkidle", timeout=30000)
                    await asyncio.sleep(2)
                    logger.info("페이지 이동 완료: %s", await page.title())
                except Exception as e:
                    logger.warning("페이지 이동 실패 (계속 진행): %s", e)

                # Phase 1: Playwright로 PDF 목록 수집
                try:
                    items = await collect_pdf_items(page, api_url, is_active, sale_status)
                except Exception as e:
                    logger.error("[%s] %s 목록 수집 실패: %s", COMPANY_NAME, label, e)
                    continue

                if not items:
                    logger.warning("[%s] %s: 수집된 항목 없음, 스킵", COMPANY_NAME, label)
                    continue

                # Phase 2: 다운로드 + 인제스트
                tab_stats = await download_and_ingest_all(
                    client=client,
                    session_factory=_db.session_factory,
                    items=items,
                    state=state,
                    state_output_path=state_output_path,
                    processed_urls=processed_urls,
                    dry_run=dry_run,
                    resume_urls=resume_urls,
                    resume_from=resume_from,
                )

                for k, v in tab_stats.items():
                    total_stats[k] = total_stats.get(k, 0) + v

                logger.info(
                    "[%s] %s 완료: 성공=%d, 스킵=%d, 실패=%d",
                    COMPANY_NAME, label,
                    tab_stats["success"], tab_stats["skipped"], tab_stats["failed"],
                )

        await browser.close()

    # 최종 상태 저장
    state.stopped_at = datetime.now(tz=timezone.utc).isoformat()
    state.stop_reason = "completed"
    save_state(state, state_output_path)

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
        print(
            f"재처리: python -m scripts.crawl_and_ingest_hanwha "
            f"--resume-state {state_output_path}"
        )

    return total_stats


def main() -> None:
    """CLI 진입점."""
    parser = argparse.ArgumentParser(description=f"{COMPANY_NAME} 크롤링 + 인제스트")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="크롤링만 하고 DB 저장 안 함",
    )
    parser.add_argument(
        "--resume-from",
        metavar="N",
        type=int,
        default=0,
        help="지정 인덱스 이후부터 처리 (기본값: 0, 처음부터)",
    )
    parser.add_argument(
        "--resume-state",
        metavar="FILE",
        help="이전 실패 상태 JSON 파일 경로 (실패 건만 재처리)",
    )
    parser.add_argument(
        "--state-output",
        metavar="FILE",
        default="failure_state_hanwha.json",
        help="실패 상태 저장 경로 (기본값: failure_state_hanwha.json)",
    )
    args = parser.parse_args()

    resume_path = Path(args.resume_state) if args.resume_state else None
    state_out = Path(args.state_output)

    result = asyncio.run(run(
        dry_run=args.dry_run,
        resume_from=args.resume_from,
        resume_state_path=resume_path,
        state_output_path=state_out,
    ))
    if isinstance(result, dict) and "error" in result:
        logger.error("크롤링 실패 → exit code 1")
        sys.exit(1)


if __name__ == "__main__":
    main()
