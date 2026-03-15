"""승소 확률 예측 서비스

SPEC-GUIDANCE-001 Phase G4: LLM 기반 보험 분쟁 승소 확률 예측.
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING

from app.schemas.guidance import DisputeType, ProbabilityScore
from app.services.guidance.disclaimer import DisclaimerGenerator

if TYPE_CHECKING:
    from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

_PROBABILITY_PROMPT = """당신은 보험 분쟁 승소 확률을 예측하는 전문가입니다.
사용자의 분쟁 상황, 관련 판례, 약관 분석을 기반으로 승소 확률을 예측하세요.

주의: 이 예측은 법적 조언이 아니며, 참고용 정보입니다.

반드시 다음 JSON 형식으로만 응답하세요:
{"overall_score": 0.0~1.0, "factors": ["요인1", "요인2"], "confidence": 0.0~1.0}"""


class ProbabilityScorer:
    """LLM 기반 승소 확률 예측 서비스"""

    def __init__(self, client: AsyncOpenAI, model: str = "gpt-4o-mini") -> None:
        self._client = client
        self._model = model

    async def predict(
        self,
        query: str,
        dispute_type: DisputeType,
        precedent_summaries: list[str] | None = None,
        clause_analysis: list[str] | None = None,
    ) -> ProbabilityScore:
        """승소 확률 예측

        Args:
            query: 분쟁 상황 설명
            dispute_type: 분쟁 유형
            precedent_summaries: 관련 판례 요약 목록
            clause_analysis: 약관 분석 결과 목록

        Returns:
            ProbabilityScore 객체
        """
        try:
            context_parts = [f"분쟁 유형: {dispute_type.value}", f"상황: {query}"]
            if precedent_summaries:
                context_parts.append("관련 판례:\n" + "\n".join(precedent_summaries))
            if clause_analysis:
                context_parts.append("약관 분석:\n" + "\n".join(clause_analysis))

            user_message = "\n\n".join(context_parts)

            response = await self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": _PROBABILITY_PROMPT},
                    {"role": "user", "content": user_message},
                ],
                temperature=0.2,
                max_tokens=500,
            )
            content = response.choices[0].message.content or ""
            return self._parse_response(content)
        except Exception as e:
            logger.error("승소 확률 예측 오류: %s", str(e))
            return ProbabilityScore(
                overall_score=0.5,
                factors=[f"예측 오류: {str(e)}"],
                confidence=0.0,
                disclaimer=DisclaimerGenerator.get_probability_disclaimer(),
            )

    def _parse_response(self, content: str) -> ProbabilityScore:
        """LLM 응답 파싱

        Args:
            content: LLM 응답 문자열

        Returns:
            ProbabilityScore 객체
        """
        try:
            data = json.loads(content)
            return ProbabilityScore(
                overall_score=max(0.0, min(1.0, float(data.get("overall_score", 0.5)))),
                factors=data.get("factors", []),
                confidence=max(0.0, min(1.0, float(data.get("confidence", 0.0)))),
                disclaimer=DisclaimerGenerator.get_probability_disclaimer(),
            )
        except (json.JSONDecodeError, ValueError, KeyError):
            logger.warning("확률 예측 응답 파싱 실패")
            return ProbabilityScore(
                overall_score=0.5,
                factors=["응답 파싱 실패"],
                confidence=0.0,
                disclaimer=DisclaimerGenerator.get_probability_disclaimer(),
            )
