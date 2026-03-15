"""에스컬레이션 단계 자문 서비스

SPEC-GUIDANCE-001 Phase G4: 분쟁 상황에 적합한 에스컬레이션 단계 권장.
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING

from app.schemas.guidance import (
    DisputeType,
    EscalationLevel,
    EscalationRecommendation,
)

if TYPE_CHECKING:
    from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

# 분쟁 유형별 기본 에스컬레이션 매핑
_DEFAULT_ESCALATION: dict[DisputeType, EscalationLevel] = {
    DisputeType.CLAIM_DENIAL: EscalationLevel.COMPANY_COMPLAINT,
    DisputeType.COVERAGE_DISPUTE: EscalationLevel.FSS_COMPLAINT,
    DisputeType.INCOMPLETE_SALE: EscalationLevel.FSS_COMPLAINT,
    DisputeType.PREMIUM_DISPUTE: EscalationLevel.COMPANY_COMPLAINT,
    DisputeType.CONTRACT_CANCEL: EscalationLevel.COMPANY_COMPLAINT,
    DisputeType.OTHER: EscalationLevel.SELF_RESOLUTION,
}

# 에스컬레이션 레벨별 기본 다음 단계
_DEFAULT_NEXT_STEPS: dict[EscalationLevel, list[str]] = {
    EscalationLevel.SELF_RESOLUTION: [
        "보험사 고객센터에 민원 접수",
        "담당 설계사에게 상황 설명",
        "보험사 홈페이지 온라인 민원 접수",
    ],
    EscalationLevel.COMPANY_COMPLAINT: [
        "보험사 공식 민원 채널로 서면 민원 제출",
        "민원 접수번호 확인 및 보관",
        "14영업일 내 처리결과 미회신 시 금감원 민원 검토",
    ],
    EscalationLevel.FSS_COMPLAINT: [
        "금융감독원 민원포털(fcsc.kr) 접속",
        "온라인 민원 접수 또는 1332 전화 상담",
        "증빙자료 첨부하여 민원 제출",
        "처리 결과 통보 대기 (약 30일)",
    ],
    EscalationLevel.DISPUTE_MEDIATION: [
        "금융분쟁조정위원회 조정 신청",
        "분쟁조정 신청서 작성 및 제출",
        "조정 결과 수용 여부 결정",
    ],
    EscalationLevel.LEGAL_ACTION: [
        "보험 전문 변호사 상담",
        "소장 작성 및 법원 제출",
        "소송 비용 및 기간 확인",
    ],
}

_ESCALATION_PROMPT = """당신은 보험 분쟁 에스컬레이션 전문가입니다.
분쟁 상황을 분석하여 적합한 에스컬레이션 단계를 권장하세요.

에스컬레이션 단계:
1. self_resolution: 자체 해결 (경미한 분쟁)
2. company_complaint: 보험사 민원 (일반적 분쟁)
3. fss_complaint: 금감원 민원 (보험사 미해결 시)
4. dispute_mediation: 분쟁조정 (복잡한 분쟁)
5. legal_action: 법적 소송 (고액, 중대 분쟁)

반드시 다음 JSON 형식으로만 응답하세요:
{"recommended_level": "단계명", "reason": "권장 근거",
"estimated_duration": "예상 기간", "cost_estimate": "예상 비용"}"""


class EscalationAdvisor:
    """에스컬레이션 단계 자문 서비스"""

    def __init__(self, client: AsyncOpenAI, model: str = "gpt-4o-mini") -> None:
        self._client = client
        self._model = model

    async def recommend(
        self,
        query: str,
        dispute_type: DisputeType,
        probability_score: float | None = None,
    ) -> EscalationRecommendation:
        """에스컬레이션 단계 권장

        Args:
            query: 분쟁 상황 설명
            dispute_type: 분쟁 유형
            probability_score: 승소 확률 (참고용)

        Returns:
            EscalationRecommendation 객체
        """
        default_level = _DEFAULT_ESCALATION.get(dispute_type, EscalationLevel.SELF_RESOLUTION)
        default_steps = list(_DEFAULT_NEXT_STEPS.get(default_level, []))

        try:
            context_parts = [f"분쟁 유형: {dispute_type.value}", f"상황: {query}"]
            if probability_score is not None:
                context_parts.append(f"예상 승소 확률: {probability_score:.1%}")

            user_message = "\n".join(context_parts)

            response = await self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": _ESCALATION_PROMPT},
                    {"role": "user", "content": user_message},
                ],
                temperature=0.2,
                max_tokens=400,
            )
            content = response.choices[0].message.content or ""
            parsed = self._parse_response(content)

            level: EscalationLevel = default_level
            raw_level = parsed.get("recommended_level", default_level)
            if isinstance(raw_level, str):
                try:
                    level = EscalationLevel(raw_level)
                except ValueError:
                    level = default_level
            elif isinstance(raw_level, EscalationLevel):
                level = raw_level

            next_steps = list(_DEFAULT_NEXT_STEPS.get(level, default_steps))

            return EscalationRecommendation(
                recommended_level=level,
                reason=parsed.get("reason", "기본 권장"),
                next_steps=next_steps,
                estimated_duration=parsed.get("estimated_duration", ""),
                cost_estimate=parsed.get("cost_estimate", ""),
            )
        except Exception as e:
            logger.error("에스컬레이션 자문 오류: %s", str(e))
            return EscalationRecommendation(
                recommended_level=default_level,
                reason="자동 권장 (LLM 오류)",
                next_steps=default_steps,
            )

    def get_default_escalation(self, dispute_type: DisputeType) -> EscalationLevel:
        """분쟁 유형별 기본 에스컬레이션 레벨 조회

        Args:
            dispute_type: 분쟁 유형

        Returns:
            EscalationLevel 기본값
        """
        return _DEFAULT_ESCALATION.get(dispute_type, EscalationLevel.SELF_RESOLUTION)

    def _parse_response(self, content: str) -> dict:
        """LLM 응답 파싱

        Args:
            content: LLM 응답 문자열

        Returns:
            파싱된 dict 또는 빈 dict (파싱 실패 시)
        """
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            logger.warning("에스컬레이션 응답 파싱 실패")
            return {}
