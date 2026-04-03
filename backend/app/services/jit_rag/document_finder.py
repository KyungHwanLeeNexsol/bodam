"""JIT RAG 문서 파인더 (SPEC-JIT-001)

보험 상품명 → 약관 문서 URL 발견 서비스.
3단계 전략:
  1. 직접 보험사 URL 매핑 (주요 25개사)
  2. 보험협회/금감원 공시 도메인 타겟 검색 (KLIA/KNIA/FSS)
  3. DuckDuckGo 검색 폴백
"""

from __future__ import annotations

import logging
import re
from urllib.parse import quote as url_quote

import httpx

logger = logging.getLogger(__name__)


class DocumentNotFoundError(Exception):
    """보험 문서를 찾을 수 없을 때 발생하는 예외"""

    pass


# 주요 보험사 URL 매핑 (손해보험 + 생명보험 주요 25개사)
# @MX:NOTE: [AUTO] 보험사 URL은 정기적으로 변경될 수 있음 - 주기적 검증 필요
INSURER_MAPPING: dict[str, str] = {
    # 손해보험
    "삼성화재": "https://www.samsungfire.com/SFPF100024M.action",
    "현대해상": "https://www.hi.co.kr/",
    "KB손보": "https://www.kbinsure.co.kr/",
    "KB손해보험": "https://www.kbinsure.co.kr/",
    "DB손보": "https://www.idbins.com/",
    "DB손해보험": "https://www.idbins.com/",
    "메리츠화재": "https://www.meritzfire.com/",
    "메리츠": "https://www.meritzfire.com/",
    "롯데손보": "https://www.lotteins.co.kr/",
    "롯데손해보험": "https://www.lotteins.co.kr/",
    "한화손보": "https://www.hwgeneralins.com/",
    "한화손해보험": "https://www.hwgeneralins.com/",
    "흥국화재": "https://www.heungkukfire.co.kr/",
    "MG손보": "https://www.mgfi.co.kr/",
    # 생명보험
    "삼성생명": "https://www.samsunglife.com/",
    "교보생명": "https://www.kyobo.co.kr/",
    "한화생명": "https://www.hanwhlife.com/",
    "신한라이프": "https://www.shinhanlife.co.kr/",
    "NH농협생명": "https://www.nhlife.co.kr/",
    "미래에셋생명": "https://www.miraeassetlife.co.kr/",
    "동양생명": "https://www.myangel.co.kr/",
    "ABL생명": "https://www.abllife.co.kr/",
    "흥국생명": "https://www.heungkuklife.co.kr/",
    "DB생명": "https://www.dblife.co.kr/",
    "KDB생명": "https://www.kdblife.co.kr/",
    "메트라이프": "https://www.metlife.co.kr/",
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
        """전략 2: 보험협회/금감원 공시 도메인 타겟 검색

        보험 유형(생보/손보)을 감지하여 적합한 공시 도메인에서 약관 PDF URL을 검색합니다.
        DuckDuckGo의 site: 필터를 활용해 신뢰할 수 있는 도메인으로 검색 범위를 제한합니다.

        # @MX:NOTE: [AUTO] KLIA(생보협회)/KNIA(손보협회)/FSS 도메인 타겟 검색
        # @MX:SPEC: SPEC-JIT-001 전략2 구현 (P2 → 완료)

        Args:
            product_name: 검색할 상품명

        Returns:
            발견된 URL 또는 None
        """
        # 보험 유형 감지
        is_life = any(kw in product_name for kw in _LIFE_KEYWORDS)
        is_non_life = any(kw in product_name for kw in _NON_LIFE_KEYWORDS)

        # 유형별 우선 검색 도메인 결정
        if is_life and not is_non_life:
            domains = ["klia.or.kr", "fss.or.kr"]
        elif is_non_life and not is_life:
            domains = ["knia.or.kr", "fss.or.kr"]
        else:
            # 유형 불명 또는 복합: 모든 공시 도메인 검색
            domains = ["klia.or.kr", "knia.or.kr", "fss.or.kr"]

        for domain in domains:
            try:
                url = await self._search_portal_domain(product_name, domain)
                if url:
                    logger.info("FSS/협회 검색 성공: domain=%s, product=%s, url=%s", domain, product_name, url)
                    return url
            except Exception as e:
                logger.debug("FSS/협회 도메인 검색 실패: domain=%s, error=%s", domain, str(e))

        return None

    async def _search_portal_domain(self, product_name: str, domain: str) -> str | None:
        """보험협회 공시 도메인에서 DuckDuckGo site: 검색으로 PDF URL 발견

        Args:
            product_name: 검색할 상품명
            domain: 검색 대상 도메인 (예: klia.or.kr)

        Returns:
            발견된 URL 또는 None
        """
        query = f"site:{domain} {product_name} 약관"
        search_url = f"https://html.duckduckgo.com/html/?q={url_quote(query)}"

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

                # domain 내 PDF URL 추출
                escaped = re.escape(domain)
                pdf_pattern = rf'href="(https?://(?:[^"]*\.)?{escaped}[^"]+\.pdf[^"]*)"'
                pdf_urls = re.findall(pdf_pattern, response.text)
                if pdf_urls:
                    return pdf_urls[0]

                # PDF가 없으면 domain 내 일반 페이지 URL (약관 관련 키워드 포함)
                page_pattern = rf'href="(https?://(?:[^"]*\.)?{escaped}[^"]*(?:agree|terms|yakwan|약관|공시)[^"]*)"'
                page_urls = re.findall(page_pattern, response.text, re.IGNORECASE)
                if page_urls:
                    return page_urls[0]

        except Exception as e:
            logger.debug("포털 도메인 검색 실패: domain=%s, error=%s", domain, str(e))

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
        search_url = f"https://html.duckduckgo.com/html/?q={url_quote(query)}"

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
