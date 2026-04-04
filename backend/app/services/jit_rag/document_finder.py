"""JIT RAG 문서 파인더 (SPEC-JIT-003 업데이트)

보험 상품명 → 약관 문서 URL 발견 서비스.

SearXNG 클라이언트가 제공되면 4단계 SearXNG 전략을 사용:
  1. site:{보험사 도메인} {상품명} 약관 filetype:pdf (SearXNG)
  2. site:kpub.knia.or.kr OR site:pub.insure.or.kr {상품명} 약관 (SearXNG)
  3. {상품명} 약관 filetype:pdf (SearXNG 일반)
  4. {상품명} 약관 (SearXNG, PDF 미한정)
  폴백: 기존 DuckDuckGo 3단계 전략

SearXNG 클라이언트가 없으면 기존 DuckDuckGo 3단계 전략만 사용.
"""

from __future__ import annotations

import logging
import re
from urllib.parse import quote as url_quote

import httpx

from app.services.jit_rag.searxng_client import SearXNGClient

logger = logging.getLogger(__name__)


class DocumentNotFoundError(Exception):
    """보험 문서를 찾을 수 없을 때 발생하는 예외"""

    pass


# 주요 보험사 → 웹사이트 도메인 매핑 (약관 사이트 내 검색용)
# @MX:NOTE: [AUTO] 보험사 URL은 정기적으로 변경될 수 있음 - 주기적 검증 필요
INSURER_DOMAIN_MAPPING: dict[str, str] = {
    # 손해보험
    "삼성화재": "samsungfire.com",
    "현대해상": "hi.co.kr",
    "KB손보": "kbinsure.co.kr",
    "KB손해보험": "kbinsure.co.kr",
    "DB손보": "idbins.com",
    "DB손해보험": "idbins.com",
    "메리츠화재": "meritzfire.com",
    "메리츠": "meritzfire.com",
    "롯데손보": "lotteins.co.kr",
    "롯데손해보험": "lotteins.co.kr",
    "한화손보": "hwgeneralins.com",
    "한화손해보험": "hwgeneralins.com",
    "흥국화재": "heungkukfire.co.kr",
    "MG손보": "mgfi.co.kr",
    # 생명보험
    "삼성생명": "samsunglife.com",
    "교보생명": "kyobo.co.kr",
    "한화생명": "hanwhlife.com",
    "신한라이프": "shinhanlife.co.kr",
    "NH농협생명": "nhlife.co.kr",
    "미래에셋생명": "miraeassetlife.co.kr",
    "동양생명": "myangel.co.kr",
    "ABL생명": "abllife.co.kr",
    "흥국생명": "heungkuklife.co.kr",
    "DB생명": "dblife.co.kr",
    "KDB생명": "kdblife.co.kr",
    "메트라이프": "metlife.co.kr",
}

# 생명보험 식별 키워드
_LIFE_KEYWORDS: frozenset[str] = frozenset([
    "생명", "라이프", "생보", "종신", "연금", "변액",
    "삼성생명", "교보생명", "한화생명", "신한라이프", "NH농협생명",
    "미래에셋생명", "동양생명", "ABL생명", "흥국생명", "DB생명",
    "KDB생명", "메트라이프", "푸본현대",
])

# 손해보험 식별 키워드
_NON_LIFE_KEYWORDS: frozenset[str] = frozenset([
    "화재", "손보", "손해보험", "다이렉트", "자동차보험", "운전자보험",
    "재물보험", "상해보험", "배상보험", "여행보험",
    "삼성화재", "현대해상", "KB손보", "DB손보", "메리츠화재",
    "롯데손보", "한화손보", "흥국화재",
])

# DuckDuckGo 검색 공통 헤더
_SEARCH_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
}


class DocumentFinder:
    """보험 상품명 → 약관 문서 URL 발견기

    SearXNG 클라이언트가 제공되면 4단계 SearXNG 전략을 사용.
    제공되지 않거나 모두 실패하면 기존 DuckDuckGo 3단계 폴백 사용.
    모두 실패 시 DocumentNotFoundError 발생.
    """

    # @MX:ANCHOR: [AUTO] DocumentFinder.find_url - JIT RAG 파이프라인의 핵심 진입점
    # @MX:REASON: chat_service, JIT API 등 다수 호출자가 사용하는 공개 API

    def __init__(self, searxng_client: SearXNGClient | None = None) -> None:
        """DocumentFinder 초기화

        Args:
            searxng_client: SearXNG API 클라이언트 (None이면 DuckDuckGo만 사용)
        """
        self._searxng_client = searxng_client

    async def find_url(self, product_name: str) -> str:
        """보험 상품명으로 약관 문서 URL 발견

        SearXNG 클라이언트가 있으면 4단계 SearXNG 전략을 순차 시도.
        없거나 모두 실패하면 기존 DuckDuckGo 3단계 전략으로 폴백.

        Args:
            product_name: 검색할 보험 상품명 (예: "DB손해보험 아이사랑보험 2104")

        Returns:
            발견된 문서 URL

        Raises:
            DocumentNotFoundError: 모든 전략 실패 시
        """
        # SearXNG 클라이언트가 있으면 4단계 SearXNG 전략 먼저 시도
        if self._searxng_client is not None:
            searxng_url = await self._try_searxng_strategies(product_name)
            if searxng_url:
                return searxng_url

        # DuckDuckGo 폴백 (기존 3단계 전략)
        url = await self._try_duckduckgo_fallback(product_name)
        if url:
            return url

        raise DocumentNotFoundError(f"보험 문서를 찾을 수 없습니다: {product_name}")

    async def _try_searxng_strategies(self, product_name: str) -> str | None:
        """SearXNG 4단계 검색 전략 순차 시도

        Args:
            product_name: 검색할 상품명

        Returns:
            발견된 URL 또는 None
        """
        # 전략 1: 보험사 사이트 내 약관 PDF 검색
        try:
            url = await self._try_searxng_insurer_site(product_name)
            if url:
                logger.info("SearXNG 전략1(보험사 사이트 PDF) 성공: product=%s, url=%s", product_name, url)
                return url
        except Exception as e:
            logger.warning("SearXNG 전략1 실패: %s", str(e))

        # 전략 2: 보험협회/공시 도메인 검색
        try:
            url = await self._try_searxng_public_disclosure(product_name)
            if url:
                logger.info("SearXNG 전략2(공시 도메인) 성공: product=%s, url=%s", product_name, url)
                return url
        except Exception as e:
            logger.warning("SearXNG 전략2 실패: %s", str(e))

        # 전략 3: 도메인 없이 PDF 일반 검색
        try:
            url = await self._try_searxng_pdf_general(product_name)
            if url:
                logger.info("SearXNG 전략3(일반 PDF) 성공: product=%s, url=%s", product_name, url)
                return url
        except Exception as e:
            logger.warning("SearXNG 전략3 실패: %s", str(e))

        # 전략 4: PDF 미한정 일반 검색
        try:
            url = await self._try_searxng_general(product_name)
            if url:
                logger.info("SearXNG 전략4(일반) 성공: product=%s, url=%s", product_name, url)
                return url
        except Exception as e:
            logger.warning("SearXNG 전략4 실패: %s", str(e))

        return None

    async def _try_searxng_insurer_site(self, product_name: str) -> str | None:
        """SearXNG 전략1: site:{보험사 도메인} {상품명} 약관 filetype:pdf

        Args:
            product_name: 검색할 상품명

        Returns:
            발견된 URL 또는 None
        """
        domain = self._find_insurer_domain(product_name)
        if not domain or self._searxng_client is None:
            return None

        query = f"site:{domain} {product_name} 약관 filetype:pdf"
        results = await self._searxng_client.search(query)
        return results[0].url if results else None

    async def _try_searxng_public_disclosure(self, product_name: str) -> str | None:
        """SearXNG 전략2: 보험협회/공시 도메인 약관 검색

        kpub.knia.or.kr (손보협회 공시) OR pub.insure.or.kr (생보협회 공시)

        Args:
            product_name: 검색할 상품명

        Returns:
            발견된 URL 또는 None
        """
        if self._searxng_client is None:
            return None

        query = f"site:kpub.knia.or.kr OR site:pub.insure.or.kr {product_name} 약관"
        results = await self._searxng_client.search(query)
        return results[0].url if results else None

    async def _try_searxng_pdf_general(self, product_name: str) -> str | None:
        """SearXNG 전략3: 도메인 없이 filetype:pdf 일반 검색

        Args:
            product_name: 검색할 상품명

        Returns:
            발견된 URL 또는 None
        """
        if self._searxng_client is None:
            return None

        query = f"{product_name} 약관 filetype:pdf"
        results = await self._searxng_client.search(query)
        return results[0].url if results else None

    async def _try_searxng_general(self, product_name: str) -> str | None:
        """SearXNG 전략4: PDF 미한정 일반 약관 검색

        Args:
            product_name: 검색할 상품명

        Returns:
            발견된 URL 또는 None
        """
        if self._searxng_client is None:
            return None

        query = f"{product_name} 약관"
        results = await self._searxng_client.search(query)
        return results[0].url if results else None

    async def _try_duckduckgo_fallback(self, product_name: str) -> str | None:
        """DuckDuckGo 폴백: 기존 3단계 전략

        SearXNG 전략이 모두 실패하거나 클라이언트가 없을 때 사용.

        Args:
            product_name: 검색할 상품명

        Returns:
            발견된 URL 또는 None
        """
        # 전략 1: 보험사 사이트 내 약관 검색
        try:
            url = await self._try_insurer_site_search(product_name)
            if url:
                logger.info("전략1(보험사 사이트) 성공: product=%s, url=%s", product_name, url)
                return url
        except Exception as e:
            logger.warning("전략1(보험사 사이트) 실패: %s", str(e))

        # 전략 2: FSS 금융감독원/보험협회 공시 검색
        try:
            url = await self._try_fss_search(product_name)
            if url:
                logger.info("전략2(FSS) 성공: product=%s, url=%s", product_name, url)
                return url
        except Exception as e:
            logger.warning("전략2(FSS) 실패: %s", str(e))

        # 전략 3: DuckDuckGo 일반 검색 폴백
        try:
            url = await self._try_duckduckgo_search(product_name)
            if url:
                logger.info("전략3(DuckDuckGo) 성공: product=%s, url=%s", product_name, url)
                return url
        except Exception as e:
            logger.warning("전략3(DuckDuckGo) 실패: %s", str(e))

        return None

    def _find_insurer_domain(self, product_name: str) -> str | None:
        """상품명에서 보험사 도메인 추출

        Args:
            product_name: 상품명

        Returns:
            보험사 웹사이트 도메인 또는 None
        """
        product_lower = product_name.lower()
        for insurer_name, domain in INSURER_DOMAIN_MAPPING.items():
            if insurer_name.lower() in product_lower:
                return domain
        return None

    async def _try_insurer_site_search(self, product_name: str) -> str | None:
        """전략 1: 보험사 사이트 내 약관 페이지 검색

        보험사 도메인을 특정하고 DuckDuckGo site: 필터로 약관 PDF/페이지를 검색.

        Args:
            product_name: 검색할 상품명

        Returns:
            발견된 URL 또는 None
        """
        domain = self._find_insurer_domain(product_name)
        if not domain:
            return None

        # 보험사 사이트 내에서 상품명 + 약관 검색
        query = f"site:{domain} {product_name} 약관"
        return await self._search_duckduckgo(query)

    async def _try_fss_search(self, product_name: str) -> str | None:
        """전략 2: 보험협회/금감원 공시 도메인 타겟 검색

        보험 유형(생보/손보)을 감지하여 적합한 공시 도메인에서 약관 PDF URL을 검색.

        Args:
            product_name: 검색할 상품명

        Returns:
            발견된 URL 또는 None
        """
        product_lower = product_name.lower()
        is_life = any(kw in product_lower for kw in _LIFE_KEYWORDS)
        is_non_life = any(kw in product_lower for kw in _NON_LIFE_KEYWORDS)

        if is_life and not is_non_life:
            domains = ["klia.or.kr", "fss.or.kr"]
        elif is_non_life and not is_life:
            domains = ["knia.or.kr", "fss.or.kr"]
        else:
            domains = ["klia.or.kr", "knia.or.kr", "fss.or.kr"]

        for domain in domains:
            try:
                query = f"site:{domain} {product_name} 약관"
                url = await self._search_duckduckgo(query)
                if url:
                    logger.info("FSS/협회 검색 성공: domain=%s, url=%s", domain, url)
                    return url
            except Exception as e:
                logger.debug("FSS/협회 도메인 검색 실패: domain=%s, error=%s", domain, str(e))

        return None

    async def _try_duckduckgo_search(self, product_name: str) -> str | None:
        """전략 3: DuckDuckGo 일반 검색으로 약관 문서 URL 발견

        Args:
            product_name: 검색할 상품명

        Returns:
            발견된 URL 또는 None
        """
        # PDF 우선 검색
        query = f"{product_name} 약관 PDF"
        url = await self._search_duckduckgo(query)
        if url:
            return url

        # PDF 못 찾으면 일반 약관 페이지
        query = f"{product_name} 약관"
        return await self._search_duckduckgo(query, pdf_only=False)

    async def _search_duckduckgo(self, query: str, pdf_only: bool = True) -> str | None:
        """DuckDuckGo HTML 검색에서 URL 추출

        Args:
            query: 검색 쿼리
            pdf_only: True면 PDF URL만 반환, False면 약관 관련 페이지도 반환

        Returns:
            발견된 URL 또는 None
        """
        search_url = f"https://html.duckduckgo.com/html/?q={url_quote(query)}"

        try:
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                response = await client.get(search_url, headers=_SEARCH_HEADERS)
                response.raise_for_status()

                # 1순위: PDF URL 추출
                pdf_urls = re.findall(
                    r'href="(https?://[^"]+\.pdf[^"]*)"',
                    response.text,
                )
                # DuckDuckGo 자체 URL 필터링
                pdf_urls = [u for u in pdf_urls if "duckduckgo.com" not in u]
                if pdf_urls:
                    return pdf_urls[0]

                if not pdf_only:
                    # 2순위: 약관 관련 키워드가 있는 페이지 URL
                    page_urls = re.findall(
                        r'href="(https?://[^"]*(?:agree|terms|yakwan|약관|공시|clause|product)[^"]*)"',
                        response.text,
                        re.IGNORECASE,
                    )
                    page_urls = [u for u in page_urls if "duckduckgo.com" not in u]
                    if page_urls:
                        return page_urls[0]

                    # 3순위: 검색 결과의 첫 번째 외부 링크
                    all_urls = re.findall(
                        r'class="result__a" href="(https?://[^"]+)"',
                        response.text,
                    )
                    all_urls = [u for u in all_urls if "duckduckgo.com" not in u]
                    if all_urls:
                        return all_urls[0]

        except Exception as e:
            logger.debug("DuckDuckGo 검색 실패: query=%s, error=%s", query, str(e))

        return None
