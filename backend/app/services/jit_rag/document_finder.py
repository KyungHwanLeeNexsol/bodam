"""JIT RAG 문서 파인더 (SPEC-JIT-001)

보험 상품명 → 약관 문서 URL 발견 서비스.
3단계 전략:
  1. 직접 보험사 URL 매핑 (상위 10개사)
  2. 금융감독원 공시 검색 (FSS) - playwright 필요
  3. DuckDuckGo 검색 폴백
"""

from __future__ import annotations

import logging

import httpx

logger = logging.getLogger(__name__)


class DocumentNotFoundError(Exception):
    """보험 문서를 찾을 수 없을 때 발생하는 예외"""

    pass


# 주요 보험사 URL 매핑 (상위 10개사)
# @MX:NOTE: [AUTO] 보험사 URL은 정기적으로 변경될 수 있음 - 주기적 검증 필요
INSURER_MAPPING: dict[str, str] = {
    "삼성화재": "https://www.samsungfire.com/SFPF100024M.action",
    "현대해상": "https://www.hi.co.kr/",
    "KB손보": "https://www.kbinsure.co.kr/",
    "DB손보": "https://www.idbins.com/",
    "메리츠": "https://www.meritzfire.com/",
    "삼성생명": "https://www.samsunglife.com/",
    "교보생명": "https://www.kyobo.co.kr/",
    "한화생명": "https://www.hanwhlife.com/",
    "신한라이프": "https://www.shinhanlife.co.kr/",
    "NH농협생명": "https://www.nhlife.co.kr/",
}


class DocumentFinder:
    """보험 상품명 → 약관 문서 URL 발견기

    3단계 전략으로 순차 시도, 모두 실패 시 DocumentNotFoundError 발생.
    """

    async def find_url(self, product_name: str) -> str:
        """보험 상품명으로 약관 문서 URL 발견

        Args:
            product_name: 검색할 보험 상품명 (예: "삼성화재 운전자보험")

        Returns:
            발견된 문서 URL

        Raises:
            DocumentNotFoundError: 모든 전략 실패 시
        """
        # 전략 1: 보험사 직접 URL 매핑
        url = self._try_direct_mapping(product_name)
        if url:
            logger.info("전략1(직접 매핑) 성공: product=%s, url=%s", product_name, url)
            return url

        # 전략 2: FSS 금융감독원 공시 검색 (TODO: playwright 완전 구현)
        try:
            url = await self._try_fss_search(product_name)
            if url:
                logger.info("전략2(FSS) 성공: product=%s, url=%s", product_name, url)
                return url
        except Exception as e:
            logger.warning("전략2(FSS) 실패: %s", str(e))

        # 전략 3: DuckDuckGo 검색 폴백
        try:
            url = await self._try_duckduckgo_search(product_name)
            if url:
                logger.info("전략3(DuckDuckGo) 성공: product=%s, url=%s", product_name, url)
                return url
        except Exception as e:
            logger.warning("전략3(DuckDuckGo) 실패: %s", str(e))

        raise DocumentNotFoundError(f"보험 문서를 찾을 수 없습니다: {product_name}")

    def _try_direct_mapping(self, product_name: str) -> str | None:
        """전략 1: 보험사 이름 키워드로 직접 URL 반환

        Args:
            product_name: 상품명 (보험사 이름 포함)

        Returns:
            발견된 URL 또는 None
        """
        for insurer_name, url in INSURER_MAPPING.items():
            if insurer_name in product_name:
                return url
        return None

    async def _try_fss_search(self, product_name: str) -> str | None:
        """전략 2: 금융감독원 공시 검색 (TODO: playwright 완전 구현)

        # @MX:TODO: [AUTO] playwright를 사용한 FSS 검색 완전 구현 필요
        # @MX:PRIORITY: P2

        Args:
            product_name: 검색할 상품명

        Returns:
            발견된 URL 또는 None
        """
        # TODO: playwright를 사용한 FSS 공시 검색 구현
        # URL: https://www.fss.or.kr 에서 상품명으로 약관 PDF URL 검색
        logger.debug("FSS 검색 - 현재 stub 구현: product=%s", product_name)
        return None

    async def _try_duckduckgo_search(self, product_name: str) -> str | None:
        """전략 3: DuckDuckGo 검색으로 약관 PDF URL 발견

        Args:
            product_name: 검색할 상품명

        Returns:
            발견된 URL 또는 None
        """
        # DuckDuckGo HTML 검색
        query = f"{product_name} 약관 filetype:pdf"
        search_url = f"https://html.duckduckgo.com/html/?q={httpx.utils.quote(query)}"

        try:
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                headers = {
                    "User-Agent": (
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/120.0.0.0 Safari/537.36"
                    )
                }
                response = await client.get(search_url, headers=headers)
                response.raise_for_status()

                # 간단한 PDF URL 파싱
                import re
                pdf_urls = re.findall(
                    r'href="(https?://[^"]+\.pdf[^"]*)"',
                    response.text,
                )
                if pdf_urls:
                    return pdf_urls[0]

        except Exception as e:
            logger.warning("DuckDuckGo 검색 실패: %s", str(e))

        return None
