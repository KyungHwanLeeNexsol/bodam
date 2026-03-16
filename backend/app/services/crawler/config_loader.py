"""YAML 설정 로더 - 보험사별 크롤링 설정 관리 (SPEC-CRAWLER-002)

각 보험사의 크롤링 설정을 YAML 파일로 관리.
Pydantic v2로 설정 유효성 검사.
lru_cache로 중복 로딩 방지.
"""

from __future__ import annotations

import logging
from functools import cache
from pathlib import Path

import yaml
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class SelectorConfig(BaseModel):
    """CSS 선택자 설정

    보험사 웹페이지의 DOM 구조에 맞게 정의.
    필수 선택자 3개 + 선택적 선택자.
    """

    listing_container: str       # 약관 목록 컨테이너 셀렉터
    product_name: str            # 상품명 셀렉터
    pdf_link: str                # PDF 링크 셀렉터
    product_code: str | None = None       # 상품코드 셀렉터 (없으면 자동 생성)
    sale_status: str | None = None        # 판매상태 셀렉터
    next_page: str | None = None          # 다음 페이지 버튼 셀렉터
    discontinued_tab: str | None = None   # 판매중지 탭 셀렉터


class PaginationConfig(BaseModel):
    """페이지네이션 설정

    numbered: 번호 기반 페이지네이션
    infinite_scroll: 무한 스크롤
    load_more: '더 보기' 버튼
    """

    type: str = "numbered"       # numbered | infinite_scroll | load_more
    max_pages: int = 50          # 최대 크롤링 페이지 수


class CompanyCrawlerConfig(BaseModel):
    """보험사 크롤러 전체 설정

    YAML 파일에서 로드되는 보험사별 크롤링 설정.
    GenericLifeCrawler에서 직접 사용.
    """

    company_name: str            # 보험사 명칭 (예: 흥국생명)
    company_code: str            # 보험사 코드 (예: heungkuk-life)
    category: str = "LIFE"       # LIFE | NON_LIFE
    base_url: str                # 보험사 기본 URL
    listing_url: str             # 약관 목록 페이지 URL
    discontinued_url: str | None = None   # 판매중지 상품 별도 URL
    selectors: SelectorConfig    # CSS 선택자 설정
    pagination: PaginationConfig = PaginationConfig()  # 페이지네이션 설정
    rate_limit_seconds: float = 3.0       # 요청 간 대기 시간 (초)
    wait_for_selector: str | None = None  # SPA 로딩 대기 셀렉터
    timeout_ms: int = 30000               # 페이지 타임아웃 (밀리초)


def _get_config_file(company_code: str) -> Path:
    """보험사 코드에 해당하는 YAML 설정 파일 경로 반환

    이 함수는 테스트에서 monkeypatch로 교체 가능.

    Args:
        company_code: 보험사 코드 (예: heungkuk_life)

    Returns:
        YAML 설정 파일 경로
    """
    config_dir = Path(__file__).parent / "config" / "companies"
    return config_dir / f"{company_code}.yaml"


# @MX:ANCHOR: [AUTO] 보험사 설정 로더 함수 - lru_cache 적용
# @MX:REASON: GenericLifeCrawler 및 크롤러 팩토리에서 3회 이상 호출, 중복 로딩 방지 필요
@cache
def load_company_config(company_code: str) -> CompanyCrawlerConfig:
    """보험사 코드로 YAML 설정 로드

    lru_cache로 동일 설정 파일 중복 로딩 방지.
    설정 변경 시 load_company_config.cache_clear() 호출 필요.

    Args:
        company_code: 보험사 코드 (예: heungkuk_life)

    Returns:
        CompanyCrawlerConfig 인스턴스

    Raises:
        FileNotFoundError: 설정 파일이 없을 때
        pydantic.ValidationError: YAML 데이터가 스키마와 맞지 않을 때
    """
    config_file = _get_config_file(company_code)

    if not config_file.exists():
        raise FileNotFoundError(f"설정 파일 없음: {config_file}")

    with open(config_file, encoding="utf-8") as f:
        data = yaml.safe_load(f)

    logger.debug("보험사 설정 로드 완료: %s", company_code)
    return CompanyCrawlerConfig(**data)


def list_company_configs() -> list[CompanyCrawlerConfig]:
    """모든 보험사 설정 목록 반환

    config/companies/ 디렉토리의 모든 YAML 파일을 로드.
    파싱 실패한 파일은 건너뛰고 경고 로그 출력.

    Returns:
        로드된 CompanyCrawlerConfig 목록
    """
    config_dir = Path(__file__).parent / "config" / "companies"
    configs: list[CompanyCrawlerConfig] = []

    for yaml_file in config_dir.glob("*.yaml"):
        try:
            with open(yaml_file, encoding="utf-8") as f:
                data = yaml.safe_load(f)
            configs.append(CompanyCrawlerConfig(**data))
        except Exception as exc:  # noqa: BLE001
            logger.warning("보험사 설정 파일 로드 실패 (%s): %s", yaml_file.name, str(exc))

    return configs
