"""SearXNG API 클라이언트 모듈 (SPEC-JIT-003 T-003)

Fly.io에 배포된 SearXNG 인스턴스의 JSON API를 통해 검색을 수행.
실패 시 빈 리스트 반환으로 상위 레이어가 DuckDuckGo 폴백을 사용할 수 있도록 함.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)


@dataclass
class SearchResult:
    """SearXNG 검색 결과 하나를 나타내는 데이터 클래스"""

    url: str
    title: str
    content: str
    engine: str


class SearXNGClient:
    """SearXNG JSON API 클라이언트

    SearXNG의 /search 엔드포인트에 JSON 형식으로 요청하고
    SearchResult 목록을 반환함. 모든 오류는 캐치하여 빈 리스트 반환.
    """

    # @MX:NOTE: [AUTO] SearXNG API 형식: GET /search?q=...&format=json&engines=...
    # @MX:SPEC: SPEC-JIT-003

    def __init__(self, base_url: str, timeout: float = 15.0) -> None:
        """SearXNG 클라이언트 초기화

        Args:
            base_url: SearXNG 인스턴스 기본 URL (예: http://bodam-search.internal:8080)
            timeout: 요청 타임아웃 (초, 기본값: 15.0 - SearXNG 엔진 대기 8초 + 여유)
        """
        # 끝의 슬래시 제거 (일관된 URL 구성을 위해)
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    async def search(
        self,
        query: str,
        engines: list[str] | None = None,
    ) -> list[SearchResult]:
        """SearXNG JSON API 검색 수행

        Args:
            query: 검색 쿼리 문자열
            engines: 사용할 검색 엔진 목록 (None이면 SearXNG 기본값 사용)

        Returns:
            검색 결과 목록. PDF URL은 앞에 정렬됨. 실패 시 빈 리스트 반환.
        """
        search_url = f"{self._base_url}/search"
        params: dict[str, str] = {
            "q": query,
            "format": "json",
        }
        if engines:
            # SearXNG는 쉼표로 구분된 엔진 목록을 받음
            params["engines"] = ",".join(engines)

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.get(search_url, params=params)
                response.raise_for_status()
                data = response.json()

            raw_results = data.get("results", [])
            results = [
                SearchResult(
                    url=item.get("url", ""),
                    title=item.get("title", ""),
                    content=item.get("content", ""),
                    engine=item.get("engine", ""),
                )
                for item in raw_results
                if item.get("url")
            ]

            # PDF URL을 앞에 정렬 (약관 PDF 우선)
            results.sort(key=lambda r: 0 if r.url.lower().endswith(".pdf") else 1)

            logger.debug(
                "SearXNG 검색 완료: query=%s, results=%d (pdf=%d)",
                query,
                len(results),
                sum(1 for r in results if r.url.lower().endswith(".pdf")),
            )
            return results

        except httpx.TimeoutException:
            logger.warning("SearXNG 검색 타임아웃: query=%s", query)
            return []
        except httpx.HTTPStatusError as e:
            logger.warning("SearXNG HTTP 오류: query=%s, status=%s", query, e.response.status_code)
            return []
        except Exception as e:
            logger.warning("SearXNG 검색 실패: query=%s, error=%s", query, str(e))
            return []
