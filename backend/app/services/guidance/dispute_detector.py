"""분쟁 탐지 서비스

SPEC-GUIDANCE-001 Phase G3: LLM 기반 약관 모호성 탐지 및 분쟁 유형 분류.
"""
from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING

from app.schemas.guidance import AmbiguousClause, DisputeType

if TYPE_CHECKING:
    from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

# 분쟁 유형 자동 감지용 시스템 프롬프트
_DISPUTE_TYPE_PROMPT = """당신은 보험 분쟁 유형을 분류하는 전문가입니다.
사용자의 상황 설명을 분석하여 다음 분쟁 유형 중 하나로 분류하세요:

1. claim_denial: 보험금 지급 거절 관련
2. coverage_dispute: 보장 범위 해석 분쟁
3. incomplete_sale: 불완전판매 (설명 의무 위반)
4. premium_dispute: 보험료 산정/환급 분쟁
5. contract_cancel: 계약 해지/갱신 분쟁
6. other: 위 유형에 해당하지 않는 기타 분쟁

반드시 다음 JSON 형식으로만 응답하세요:
{"dispute_type": "유형명", "confidence": 0.0~1.0, "reasoning": "분류 근거"}"""

# 약관 모호성 분석용 시스템 프롬프트
_AMBIGUITY_ANALYSIS_PROMPT = """당신은 보험 약관 분석 전문가입니다.
사용자의 분쟁 상황과 관련 약관 텍스트를 분석하여 모호한 조항을 식별하세요.

각 모호한 조항에 대해 다음을 분석해야 합니다:
- 모호한 약관 원문
- 모호성의 근거
- 소비자에게 유리한 해석
- 보험사에게 유리한 해석
- 권장 해석 방향 (약관 해석 원칙: 작성자 불이익 원칙에 따라 소비자 유리 해석 우선)

반드시 다음 JSON 형식으로만 응답하세요:
{"clauses": [
  {
    "clause_text": "...",
    "ambiguity_reason": "...",
    "consumer_favorable_interpretation": "...",
    "insurer_favorable_interpretation": "...",
    "recommendation": "..."
  }
]}"""


class DisputeDetector:
    """LLM 기반 분쟁 탐지 서비스

    사용자 쿼리에서 분쟁 유형을 감지하고,
    관련 약관 텍스트에서 모호한 조항을 분석합니다.
    """

    def __init__(self, client: AsyncOpenAI, model: str = "gpt-4o-mini") -> None:
        """DisputeDetector 초기화

        Args:
            client: OpenAI 비동기 클라이언트
            model: 사용할 LLM 모델명
        """
        self._client = client
        self._model = model

    async def detect_dispute_type(
        self,
        query: str,
    ) -> tuple[DisputeType, float, str]:
        """쿼리에서 분쟁 유형 자동 감지

        Args:
            query: 사용자 분쟁 상황 설명

        Returns:
            (분쟁 유형, 신뢰도, 분류 근거)
        """
        try:
            response = await self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": _DISPUTE_TYPE_PROMPT},
                    {"role": "user", "content": query},
                ],
                temperature=0.1,
                max_tokens=300,
            )
            content = response.choices[0].message.content or ""
            return self._parse_dispute_type(content)
        except Exception as e:
            logger.error("분쟁 유형 감지 오류, OTHER로 폴백", extra={"error": str(e)})
            return DisputeType.OTHER, 0.0, f"분류 오류: {str(e)}"

    async def analyze_ambiguous_clauses(
        self,
        query: str,
        clause_texts: list[str],
    ) -> list[AmbiguousClause]:
        """약관 조항의 모호성 분석

        Args:
            query: 사용자 분쟁 상황 설명
            clause_texts: 관련 약관 텍스트 목록

        Returns:
            모호한 조항 분석 결과 리스트
        """
        if not clause_texts:
            return []

        try:
            combined_clauses = "\n---\n".join(clause_texts)
            user_message = f"분쟁 상황: {query}\n\n관련 약관:\n{combined_clauses}"

            response = await self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": _AMBIGUITY_ANALYSIS_PROMPT},
                    {"role": "user", "content": user_message},
                ],
                temperature=0.2,
                max_tokens=1500,
            )
            content = response.choices[0].message.content or ""
            return self._parse_ambiguous_clauses(content)
        except Exception as e:
            logger.error("약관 모호성 분석 오류", extra={"error": str(e)})
            return []

    def _parse_dispute_type(
        self,
        content: str,
    ) -> tuple[DisputeType, float, str]:
        """LLM 응답에서 분쟁 유형 파싱

        Args:
            content: LLM 응답 텍스트 (JSON)

        Returns:
            (분쟁 유형, 신뢰도, 근거)
        """
        try:
            data = json.loads(content)
            dispute_type_str = data.get("dispute_type", "other")
            confidence = float(data.get("confidence", 0.0))
            reasoning = data.get("reasoning", "")
            dispute_type = DisputeType(dispute_type_str)
            return dispute_type, confidence, reasoning
        except (json.JSONDecodeError, ValueError, KeyError) as e:
            logger.warning("분쟁 유형 파싱 실패, OTHER로 폴백", extra={"error": str(e)})
            return DisputeType.OTHER, 0.0, "파싱 실패로 폴백"

    def _parse_ambiguous_clauses(
        self,
        content: str,
    ) -> list[AmbiguousClause]:
        """LLM 응답에서 모호한 조항 파싱

        Args:
            content: LLM 응답 텍스트 (JSON)

        Returns:
            AmbiguousClause 리스트
        """
        try:
            data = json.loads(content)
            clauses_data = data.get("clauses", [])
            return [
                AmbiguousClause(
                    clause_text=c["clause_text"],
                    ambiguity_reason=c["ambiguity_reason"],
                    consumer_favorable_interpretation=c["consumer_favorable_interpretation"],
                    insurer_favorable_interpretation=c["insurer_favorable_interpretation"],
                    recommendation=c["recommendation"],
                )
                for c in clauses_data
                if all(
                    k in c
                    for k in [
                        "clause_text",
                        "ambiguity_reason",
                        "consumer_favorable_interpretation",
                        "insurer_favorable_interpretation",
                        "recommendation",
                    ]
                )
            ]
        except (json.JSONDecodeError, KeyError) as e:
            logger.warning("모호한 조항 파싱 실패", extra={"error": str(e)})
            return []
