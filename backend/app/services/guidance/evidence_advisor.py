"""증거 전략 자문 서비스

SPEC-GUIDANCE-001 Phase G4: 분쟁 유형별 필요 증빙 서류 및 준비 전략 제공.
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING

from app.schemas.guidance import DisputeType, EvidenceStrategy

if TYPE_CHECKING:
    from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

# 분쟁 유형별 기본 필수/권장 서류 매핑
_DEFAULT_DOCUMENTS: dict[DisputeType, dict[str, list[str]]] = {
    DisputeType.CLAIM_DENIAL: {
        "required": ["보험금 청구서 사본", "보험금 지급 거절 통지서", "진단서 또는 사고 확인서", "보험증권 사본"],
        "recommended": ["진료비 영수증", "입퇴원 확인서", "사고 경위서", "목격자 진술서"],
    },
    DisputeType.COVERAGE_DISPUTE: {
        "required": ["보험증권 사본", "약관 전문", "보장 범위 관련 통지서"],
        "recommended": ["가입 당시 설명서", "모집인 명함 또는 연락처", "가입 상담 녹취록"],
    },
    DisputeType.INCOMPLETE_SALE: {
        "required": ["보험 가입 신청서 사본", "보험증권 사본", "약관 수령 확인서"],
        "recommended": ["가입 당시 설명 녹취록", "모집인 명함", "문자/이메일 기록", "청약 철회 관련 기록"],
    },
    DisputeType.PREMIUM_DISPUTE: {
        "required": ["보험증권 사본", "보험료 납입 내역서", "보험료 변경 통지서"],
        "recommended": ["자동이체 내역", "보험료 산출 내역서", "계약 변경 이력서"],
    },
    DisputeType.CONTRACT_CANCEL: {
        "required": ["보험증권 사본", "해지 통지서", "보험료 납입 내역서"],
        "recommended": ["해지 사유 통지 기록", "부활 청약서", "해지 환급금 산출 내역서"],
    },
    DisputeType.OTHER: {
        "required": ["보험증권 사본", "관련 통지서"],
        "recommended": ["계약 관련 서류 일체"],
    },
}

_EVIDENCE_PROMPT = """당신은 보험 분쟁 증거 전략 자문 전문가입니다.
분쟁 상황을 분석하여 추가로 필요한 증빙 서류와 준비 요령을 제안하세요.

반드시 다음 JSON 형식으로만 응답하세요:
{"additional_required": ["서류1"], "additional_recommended": ["서류1"],
"preparation_tips": ["팁1"], "timeline_advice": "시한 관련 조언"}"""


class EvidenceAdvisor:
    """증거 전략 자문 서비스"""

    def __init__(self, client: AsyncOpenAI, model: str = "gpt-4o-mini") -> None:
        self._client = client
        self._model = model

    async def advise(
        self,
        query: str,
        dispute_type: DisputeType,
    ) -> EvidenceStrategy:
        """분쟁 유형에 맞는 증거 전략 제공

        Args:
            query: 분쟁 상황 설명
            dispute_type: 분쟁 유형

        Returns:
            EvidenceStrategy 객체
        """
        # 기본 서류 목록 조회
        defaults = _DEFAULT_DOCUMENTS.get(dispute_type, _DEFAULT_DOCUMENTS[DisputeType.OTHER])
        required = list(defaults["required"])
        recommended = list(defaults["recommended"])

        # LLM으로 추가 서류 및 팁 생성
        tips: list[str] = []
        timeline = ""
        try:
            user_message = f"분쟁 유형: {dispute_type.value}\n상황: {query}"
            response = await self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": _EVIDENCE_PROMPT},
                    {"role": "user", "content": user_message},
                ],
                temperature=0.3,
                max_tokens=500,
            )
            content = response.choices[0].message.content or ""
            extra = self._parse_response(content)

            # 기본 목록에 LLM 추천 추가 (중복 제거)
            for doc in extra.get("additional_required", []):
                if doc not in required:
                    required.append(doc)
            for doc in extra.get("additional_recommended", []):
                if doc not in recommended:
                    recommended.append(doc)

            tips = extra.get("preparation_tips", [])
            timeline = extra.get("timeline_advice", "")

        except Exception as e:
            logger.error("증거 전략 LLM 오류: %s", str(e))

        return EvidenceStrategy(
            required_documents=required,
            recommended_documents=recommended,
            preparation_tips=tips,
            timeline_advice=timeline,
        )

    def get_default_documents(self, dispute_type: DisputeType) -> dict[str, list[str]]:
        """분쟁 유형별 기본 서류 목록 조회 (LLM 호출 없이)

        Args:
            dispute_type: 분쟁 유형

        Returns:
            {"required": [...], "recommended": [...]}
        """
        defaults = _DEFAULT_DOCUMENTS.get(dispute_type, _DEFAULT_DOCUMENTS[DisputeType.OTHER])
        return {"required": list(defaults["required"]), "recommended": list(defaults["recommended"])}

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
            logger.warning("증거 전략 응답 파싱 실패")
            return {}
