"""JIT RAG 문서 다운로더 (SPEC-JIT-001)

URL에서 PDF/HTML 문서를 다운로드하는 서비스.
httpx를 사용하는 비동기 다운로더, playwright로 JS 렌더링 지원.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

# 다운로드 타임아웃 (초)
_DOWNLOAD_TIMEOUT = 30.0
# 재시도 횟수
_MAX_RETRIES = 2


@dataclass
class FetchResult:
    """문서 다운로드 결과"""

    # Content-Type (예: "application/pdf", "text/html")
    content_type: str
    # 원본 바이트 데이터
    data: bytes
    # 최종 URL (리다이렉트 후)
    url: str


class DocumentFetcher:
    """비동기 문서 다운로더

    PDF URL → FetchResult(content_type, data, url) 반환.
    HTML 페이지에 JS 렌더링이 필요한 경우 playwright 사용.
    """

    async def fetch(self, url: str) -> FetchResult:
        """URL에서 문서 다운로드

        Args:
            url: 다운로드할 문서 URL

        Returns:
            FetchResult 인스턴스

        Raises:
            httpx.HTTPError: HTTP 오류 발생 시
            Exception: 다운로드 실패 시
        """
        last_error: Exception | None = None

        for attempt in range(_MAX_RETRIES + 1):
            try:
                result = await self._fetch_with_httpx(url)
                return result
            except Exception as e:
                last_error = e
                logger.warning(
                    "문서 다운로드 시도 %d/%d 실패: url=%s, error=%s",
                    attempt + 1,
                    _MAX_RETRIES + 1,
                    url,
                    str(e),
                )

        raise last_error or Exception(f"문서 다운로드 실패: {url}")

    async def _fetch_with_httpx(self, url: str) -> FetchResult:
        """httpx로 문서 다운로드

        Args:
            url: 다운로드할 URL

        Returns:
            FetchResult 인스턴스
        """
        async with httpx.AsyncClient(
            timeout=_DOWNLOAD_TIMEOUT,
            follow_redirects=True,
        ) as client:
            response = await client.get(url)
            response.raise_for_status()

            content_type = response.headers.get("content-type", "").split(";")[0].strip()
            return FetchResult(
                content_type=content_type,
                data=response.content,
                url=str(response.url),
            )

    async def fetch_with_js(self, url: str) -> FetchResult:
        """playwright로 JS 렌더링 후 페이지 소스 가져오기

        JS가 필요한 동적 페이지용 (금감원 공시 등).

        Args:
            url: 렌더링할 페이지 URL

        Returns:
            FetchResult (content_type="text/html")
        """
        try:
            from playwright.async_api import async_playwright

            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True)
                try:
                    page = await browser.new_page()
                    await page.goto(url, timeout=int(_DOWNLOAD_TIMEOUT * 1000))
                    await page.wait_for_load_state("networkidle")
                    content = await page.content()
                    return FetchResult(
                        content_type="text/html",
                        data=content.encode("utf-8"),
                        url=url,
                    )
                finally:
                    await browser.close()
        except Exception as e:
            logger.error("playwright 다운로드 실패: url=%s, error=%s", url, str(e))
            raise
