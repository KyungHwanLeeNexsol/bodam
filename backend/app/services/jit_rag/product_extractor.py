"""JIT RAG 보험 상품명 추출기 (SPEC-JIT-002)

메시지에서 보험사명 및 상품명을 추출하여 ProductInfo 반환.
INSURER_MAPPING 기반으로 긴 이름을 우선 매칭 (greedy).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.services.jit_rag.document_finder import INSURER_MAPPING


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

    INSURER_MAPPING의 키를 길이 내림차순으로 정렬하여
    "DB손해보험"이 "DB손보"보다 먼저 매칭되도록 보장.
    """

    def __init__(self) -> None:
        # 긴 이름 우선 매칭을 위해 길이 내림차순 정렬
        self._insurer_names = sorted(INSURER_MAPPING.keys(), key=len, reverse=True)

    def extract(self, message: str) -> ProductInfo | None:
        """메시지에서 보험 상품 정보 추출

        Args:
            message: 사용자 메시지 (예: "DB손보 아이사랑보험에서 용종 보장 알려줘")

        Returns:
            ProductInfo 또는 None (보험사명 미발견 시)
        """
        message_lower = message.lower()
        for insurer in self._insurer_names:
            if insurer.lower() in message_lower:
                product_name = self._extract_product_name(message, insurer)
                return ProductInfo(
                    company=insurer,
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
        idx = message.index(insurer)
        after = message[idx + len(insurer):].strip()

        # 한글 상품명 패턴: 보험/플러스/플랜/케어/라이프 포함 가능 + 숫자 버전
        match = re.match(
            r"([가-힣]+(?:보험|플러스|플랜|케어|라이프)?(?:\s*\d{2,4})?)",
            after,
        )
        if match:
            return f"{insurer} {match.group(1).strip()}"

        return insurer
