"""JIT RAG 보험 상품명 추출기 (SPEC-JIT-002)

메시지에서 보험사명 및 상품명을 추출하여 ProductInfo 반환.
INSURER_DOMAIN_MAPPING 기반으로 긴 이름을 우선 매칭 (greedy).
사용자가 자주 사용하는 축약/브랜드명도 _ALIAS_MAPPING을 통해 매칭.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.services.jit_rag.document_finder import INSURER_DOMAIN_MAPPING

# 사용자가 자주 사용하는 축약/브랜드명 → 정식 보험사명 매핑
# @MX:NOTE: [AUTO] INSURER_DOMAIN_MAPPING에 없는 축약어만 등록 - 긴 이름 우선 매칭은 기존 로직이 처리
_ALIAS_MAPPING: dict[str, str] = {
    "DB": "DB손보",
    "db손보": "DB손보",
    "삼성": "삼성화재",
    "현대": "현대해상",
    "KB": "KB손보",
    "kb손보": "KB손보",
    "메리츠": "메리츠화재",
    "롯데": "롯데손보",
    "한화": "한화손보",
    "흥국": "흥국화재",
    "MG": "MG손보",
    "교보": "교보생명",
    "신한": "신한라이프",
    "NH": "NH농협생명",
    "미래에셋": "미래에셋생명",
    "동양": "동양생명",
    "ABL": "ABL생명",
    "KDB": "KDB생명",
}


@dataclass
class ProductInfo:
    """추출된 보험 상품 정보"""

    # 매칭된 보험사명 (예: "DB손보")
    company: str
    # 전체 상품명 (예: "DB손보 아이사랑보험 2104")
    product_name: str
    # DocumentFinder에 전달할 쿼리 (현재 product_name과 동일)
    full_query: str


class ProductNameExtractor:
    """메시지에서 보험사 + 상품명을 추출하는 클래스

    1단계: INSURER_DOMAIN_MAPPING 키를 길이 내림차순으로 정렬하여 greedy 매칭
           (예: "DB손해보험"이 "DB손보"보다 먼저 매칭)
    2단계: 매칭 실패 시 _ALIAS_MAPPING으로 축약/브랜드명 매칭
           (예: "db아이사랑보험" → alias "DB" → full name "DB손보")
    """

    def __init__(self) -> None:
        # 긴 이름 우선 매칭을 위해 길이 내림차순 정렬
        self._insurer_names = sorted(INSURER_DOMAIN_MAPPING.keys(), key=len, reverse=True)
        # alias도 긴 것 우선으로 정렬 (예: "db손보"가 "db"보다 먼저 시도)
        self._alias_entries = sorted(
            _ALIAS_MAPPING.items(),
            key=lambda kv: len(kv[0]),
            reverse=True,
        )

    def extract(self, message: str) -> ProductInfo | None:
        """메시지에서 보험 상품 정보 추출

        Args:
            message: 사용자 메시지 (예: "DB손보 아이사랑보험에서 용종 보장 알려줘")

        Returns:
            ProductInfo 또는 None (보험사명 미발견 시)
        """
        message_lower = message.lower()

        # 1단계: 정식 보험사명 매칭 (긴 이름 우선)
        for insurer in self._insurer_names:
            if insurer.lower() in message_lower:
                product_name = self._extract_product_name(message, insurer)
                return ProductInfo(
                    company=insurer,
                    product_name=product_name,
                    full_query=product_name,
                )

        # 2단계: 축약/브랜드명 alias 매칭
        return self._extract_via_alias(message)

    def _extract_via_alias(self, message: str) -> ProductInfo | None:
        """축약 보험사명(alias)으로 매칭 시도

        alias 뒤에 한글 문자나 공백이 이어지는 경우에만 매칭하여 오탐 방지.
        예: "DB아이사랑" → 매칭 O, "DBZ드라이브" → 매칭 X

        Args:
            message: 사용자 메시지

        Returns:
            ProductInfo 또는 None
        """
        message_lower = message.lower()

        for alias, full_name in self._alias_entries:
            alias_lower = alias.lower()
            idx = message_lower.find(alias_lower)
            if idx == -1:
                continue

            # alias 직후 문자 확인: 영문자/숫자가 연속되면 오탐 가능성 있어 건너뜀
            # (예: "ABL생명"에서 "AB"가 매칭되지 않도록 방지)
            after_idx = idx + len(alias)
            if after_idx < len(message):
                next_char = message[after_idx]
                if re.match(r"[a-zA-Z0-9]", next_char):
                    continue

            # alias 이후 텍스트로 상품명 추출
            product_name = self._extract_product_name_with_alias(
                message=message,
                alias_start=idx,
                alias_len=len(alias),
                full_name=full_name,
            )
            return ProductInfo(
                company=full_name,
                product_name=product_name,
                full_query=product_name,
            )

        return None

    def _extract_product_name(self, message: str, insurer: str) -> str:
        """보험사명 뒤에 오는 상품 유형 단어를 추출하여 전체 상품명 구성

        Args:
            message: 사용자 메시지
            insurer: 매칭된 보험사명

        Returns:
            "보험사명 + 상품유형" 형태의 전체 상품명
        """
        idx = message.lower().index(insurer.lower())
        after = message[idx + len(insurer):].strip()

        # 한글 상품명 패턴: 보험/플러스/플랜/케어/라이프 포함 가능 + 숫자 버전
        match = re.match(
            r"([가-힣]+(?:보험|플러스|플랜|케어|라이프)?(?:\s*\d{2,4})?)",
            after,
        )
        if match:
            return f"{insurer} {match.group(1).strip()}"

        return insurer

    def _extract_product_name_with_alias(
        self,
        message: str,
        alias_start: int,
        alias_len: int,
        full_name: str,
    ) -> str:
        """alias 위치 기반으로 상품명 추출 (alias를 full_name으로 교체)

        Args:
            message: 원본 메시지
            alias_start: alias가 시작하는 위치 (소문자 기준 인덱스)
            alias_len: alias 길이
            full_name: 매핑된 정식 보험사명

        Returns:
            "정식보험사명 + 상품유형" 형태의 전체 상품명
        """
        # alias 이후 텍스트 추출 (원본 대소문자 유지)
        after = message[alias_start + alias_len:].strip()

        # 한글 상품명 패턴 매칭
        match = re.match(
            r"([가-힣]+(?:보험|플러스|플랜|케어|라이프)?(?:\s*\d{2,4})?)",
            after,
        )
        if match:
            return f"{full_name} {match.group(1).strip()}"

        return full_name
