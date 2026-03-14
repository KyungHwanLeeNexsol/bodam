"""쿼리 재작성기 서비스

SPEC-LLM-001 TASK-007: 한국 보험 용어 사전 기반 쿼리 전처리.
"""

from __future__ import annotations

import structlog

logger = structlog.get_logger()

# 한국 보험 용어 축약어 → 전체 명칭 사전
_INSURANCE_TERM_DICT: dict[str, str] = {
    # 상품명 축약어
    "실손": "실손의료보험",
    "통원": "통원치료비",
    "입원": "입원치료비",
    "실비": "실손의료보험",
    "종신": "종신보험",
    "정기": "정기보험",
    "연금": "연금보험",
    "암보험": "암보험",
    "운전자": "운전자보험",
    "화재": "화재보험",
    # 보험금 및 청구 관련
    "보험료": "보험료",
    "보험금": "보험금",
    "청구": "보험금 청구",
    "면책": "면책 사항",
    "공제": "자기부담금(공제금액)",
    "부담금": "자기부담금",
    # 약관 관련
    "특약": "특별약관",
    "주계약": "주계약 보장",
    "갱신": "갱신형 보험",
    "비갱신": "비갱신형 보험",
    # 보장 관련
    "사망": "사망 보장",
    "후유장해": "후유장해 보장",
    "수술": "수술비 보장",
}


class QueryRewriter:
    """한국 보험 용어 기반 쿼리 재작성기

    보험 용어 축약어를 전체 명칭으로 확장하여 검색 정확도를 향상시킵니다.
    LLM 호출 없이 사전 기반으로 동작합니다.
    """

    def __init__(self) -> None:
        """쿼리 재작성기 초기화"""
        # 외부에서 접근 가능한 용어 사전 (테스트 검증용)
        self._term_dict: dict[str, str] = dict(_INSURANCE_TERM_DICT)

    def rewrite(self, query: str) -> str:
        """쿼리 재작성

        보험 용어 축약어를 전체 명칭으로 확장합니다.
        비보험 관련 쿼리는 변경 없이 그대로 반환합니다.

        Args:
            query: 원본 사용자 쿼리

        Returns:
            재작성된 쿼리 (축약어 확장 적용)
        """
        if not query:
            return query

        rewritten = query
        expanded_terms: list[str] = []

        for abbrev, full_term in self._term_dict.items():
            # 이미 전체 명칭이 포함된 경우 스킵
            if full_term in rewritten:
                continue
            # 축약어가 있고 전체 명칭과 다른 경우 확장
            if abbrev in rewritten and abbrev != full_term:
                rewritten = rewritten.replace(abbrev, full_term)
                expanded_terms.append(f"{abbrev}→{full_term}")

        if expanded_terms:
            logger.debug(
                "쿼리 재작성 완료",
                original=query,
                rewritten=rewritten,
                expansions=expanded_terms,
            )

        return rewritten
