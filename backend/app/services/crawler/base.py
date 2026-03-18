"""크롤러 기본 클래스 및 데이터 모델 (SPEC-CRAWLER-001, SPEC-CRAWLER-002)

BaseCrawler ABC와 공통 데이터클래스 정의.
재시도, 레이트 리밋, 해시 계산 등 공통 기능 제공.
"""

from __future__ import annotations

import asyncio
import dataclasses
import hashlib
import logging
from abc import ABC, abstractmethod
from datetime import date
from enum import StrEnum
from typing import Any

logger = logging.getLogger(__name__)


class SaleStatus(StrEnum):
    """보험 상품 판매 상태

    판매 중인 상품과 판매 중지된 상품을 구분하기 위한 열거형.
    StrEnum 상속으로 JSON 직렬화 및 문자열 비교에 친화적.
    """

    ON_SALE = "ON_SALE"           # 판매중
    DISCONTINUED = "DISCONTINUED"  # 판매중지
    UNKNOWN = "UNKNOWN"           # 미확인


# @MX:ANCHOR: [AUTO] StructureChangedError - CSS 선택자가 예상 요소를 찾지 못할 때 발생
# @MX:REASON: BaseCrawler 구현체들이 페이지 구조 변경 감지 시 이 예외를 발생시킴
class StructureChangedError(Exception):
    """페이지 구조 변경 감지 예외 (SPEC-PIPELINE-001 REQ-02)

    CSS 선택자가 예상 DOM 요소를 찾지 못할 때 발생.
    이 예외 발생 시 해당 회사의 health_status가 DEGRADED로 업데이트됨.
    """


@dataclasses.dataclass
class PolicyListing:
    """크롤링으로 발견된 보험 상품 정보

    크롤러가 파싱한 개별 상품 항목.
    PDF URL 및 보험사/상품 식별 정보 포함.
    SPEC-CRAWLER-002: 판매 상태 및 유효기간 필드 추가.
    """

    # 보험사 명칭 (예: 삼성생명)
    company_name: str
    # 상품명 (예: 삼성 종신보험 2024)
    product_name: str
    # 금감원 상품 코드
    product_code: str
    # 보험 분류 (LIFE, NON_LIFE, THIRD_SECTOR)
    category: str
    # 약관 PDF 다운로드 URL
    pdf_url: str
    # 보험사 식별 코드 (예: samsung-life)
    company_code: str
    # 판매 상태 (기본값: UNKNOWN으로 하위 호환성 유지)
    sale_status: SaleStatus = dataclasses.field(default=SaleStatus.UNKNOWN)
    # 효력 발생일 (판매 시작일)
    effective_date: date | None = dataclasses.field(default=None)
    # 판매 종료일 (판매 중지 기준일)
    expiry_date: date | None = dataclasses.field(default=None)


@dataclasses.dataclass
class DeltaResult:
    """변경 감지 결과

    SHA-256 해시 비교를 통한 신규/변경/동일 분류 결과.
    """

    # 새로 발견된 상품 목록
    new: list[PolicyListing]
    # 변경된 상품 목록 (해시 불일치)
    updated: list[PolicyListing]
    # 변경 없는 상품 목록 (해시 일치)
    unchanged: list[PolicyListing]


@dataclasses.dataclass
class CrawlRunResult:
    """크롤링 실행 결과 요약

    1회 크롤링 실행의 집계 통계와 개별 결과 목록.
    """

    # 총 발견 상품 수
    total_found: int
    # 신규 상품 수
    new_count: int
    # 업데이트 상품 수
    updated_count: int
    # 건너뜀 수 (변경 없음)
    skipped_count: int
    # 실패 수
    failed_count: int
    # 개별 처리 결과 목록
    results: list[dict]


# @MX:ANCHOR: [AUTO] BaseCrawler는 모든 보험사 크롤러의 기반 추상 클래스
# @MX:REASON: KLIACrawler, KNIACrawler 등 모든 구체 크롤러가 이를 상속하여 사용
class BaseCrawler(ABC):
    """보험사 약관 크롤러 추상 기본 클래스

    재시도, 레이트 리밋, 해시 계산 등 공통 기능 제공.
    구체 크롤러는 crawl, parse_listing, download_pdf, detect_changes를 구현해야 함.
    """

    def __init__(
        self,
        crawler_name: str,
        db_session: Any,
        storage: Any,
        rate_limit_seconds: float = 2.0,
        max_retries: int = 3,
    ) -> None:
        """크롤러 초기화

        Args:
            crawler_name: 크롤러 식별자 (예: klia, knia)
            db_session: SQLAlchemy 비동기 세션
            storage: 스토리지 백엔드 인스턴스
            rate_limit_seconds: 요청 간 대기 시간 (초)
            max_retries: 최대 재시도 횟수
        """
        self.crawler_name = crawler_name
        self.db_session = db_session
        self.storage = storage
        self.rate_limit_seconds = rate_limit_seconds
        self.max_retries = max_retries

    @abstractmethod
    async def crawl(self) -> CrawlRunResult:
        """크롤링 메인 진입점

        Returns:
            크롤링 실행 결과 요약
        """
        ...

    @abstractmethod
    async def parse_listing(self, page: Any) -> list[PolicyListing]:
        """페이지 HTML에서 상품 목록 파싱

        Args:
            page: HTML 문자열 또는 Playwright 페이지 객체

        Returns:
            파싱된 상품 목록
        """
        ...

    @abstractmethod
    async def download_pdf(self, listing: PolicyListing) -> bytes:
        """상품 약관 PDF 다운로드

        Args:
            listing: 다운로드할 상품 정보

        Returns:
            PDF 바이너리 데이터
        """
        ...

    @abstractmethod
    async def detect_changes(self, listings: list[PolicyListing]) -> DeltaResult:
        """기존 데이터와 비교하여 변경 감지

        SHA-256 해시를 비교하여 신규/변경/동일 분류.

        Args:
            listings: 크롤링으로 발견된 상품 목록

        Returns:
            변경 감지 결과
        """
        ...

    def _compute_hash(self, data: bytes) -> str:
        """바이너리 데이터의 SHA-256 해시 계산

        Args:
            data: 해시를 계산할 바이너리 데이터

        Returns:
            64자 소문자 헥사 문자열
        """
        return hashlib.sha256(data).hexdigest()

    async def _rate_limit(self) -> None:
        """요청 간 레이트 리밋 적용

        설정된 rate_limit_seconds 만큼 대기.
        서버 과부하 방지 목적.
        """
        await asyncio.sleep(self.rate_limit_seconds)

    async def _retry_request(self, coro: Any) -> Any:
        """지수 백오프를 적용한 재시도 요청

        첫 번째 코루틴 실행 실패 시 동일 코루틴 객체로 재시도.
        코루틴이 이미 소진된 경우 마지막 예외를 전파.
        max_retries 초과 시 마지막 예외를 전파.

        Args:
            coro: 실행할 코루틴

        Returns:
            코루틴의 반환값

        Raises:
            Exception: 모든 재시도 소진 후 마지막 예외
        """
        last_exc: Exception | None = None
        for attempt in range(self.max_retries):
            try:
                return await coro
            except Exception as exc:
                last_exc = exc
                if attempt >= self.max_retries - 1:
                    logger.error(
                        "크롤러 %s 요청 실패 (최대 재시도 초과): %s",
                        self.crawler_name,
                        str(exc),
                    )
                    break
                wait = 2**attempt
                logger.warning(
                    "크롤러 %s 요청 실패 (재시도 %d/%d, %d초 후): %s",
                    self.crawler_name,
                    attempt + 1,
                    self.max_retries,
                    wait,
                    str(exc),
                )
                await asyncio.sleep(wait)
        raise last_exc  # type: ignore[misc]

    async def _retry_request_fn(self, coro_fn: Any, *args: Any, **kwargs: Any) -> Any:
        """callable을 지수 백오프로 재시도하는 메서드

        코루틴 객체 대신 callable(코루틴 팩토리)를 받아
        매 재시도마다 새 코루틴을 생성하여 실행.

        Args:
            coro_fn: async 함수 (호출 시 코루틴을 생성하는 callable)
            *args: coro_fn에 전달할 위치 인자
            **kwargs: coro_fn에 전달할 키워드 인자

        Returns:
            코루틴의 반환값

        Raises:
            Exception: 모든 재시도 소진 후 마지막 예외
        """
        last_exc: Exception | None = None
        for attempt in range(self.max_retries):
            try:
                return await coro_fn(*args, **kwargs)
            except Exception as exc:
                last_exc = exc
                if attempt >= self.max_retries - 1:
                    logger.error(
                        "크롤러 %s 요청 실패 (최대 재시도 초과): %s",
                        self.crawler_name,
                        str(exc),
                    )
                    break
                wait = 2**attempt
                logger.warning(
                    "크롤러 %s 요청 실패 (재시도 %d/%d, %d초 후): %s",
                    self.crawler_name,
                    attempt + 1,
                    self.max_retries,
                    wait,
                    str(exc),
                )
                await asyncio.sleep(wait)
        raise last_exc  # type: ignore[misc]
