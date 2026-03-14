"""의도 분류기 서비스

SPEC-LLM-001 TASK-004: GPT-4o-mini를 사용한 보험 쿼리 의도 분류.
"""

from __future__ import annotations

import json

import structlog
from openai import AsyncOpenAI

from app.services.llm.models import IntentResult, QueryIntent

logger = structlog.get_logger()

# 의도 분류 시스템 프롬프트
_CLASSIFIER_SYSTEM_PROMPT = """당신은 보험 관련 질문의 의도를 분류하는 전문가입니다.
사용자의 질문을 분석하여 다음 세 가지 카테고리 중 하나로 분류하세요:

1. policy_lookup: 보험 약관, 보장 내용, 가입 조건 등 약관 정보 조회
2. claim_guidance: 보험금 청구 절차, 필요 서류, 청구 방법 등 청구 안내
3. general_qa: 보험에 대한 일반적인 질문이나 정보 요청

반드시 다음 JSON 형식으로만 응답하세요:
{"intent": "카테고리명", "confidence": 0.0~1.0, "reasoning": "분류 근거"}"""


class IntentClassifier:
    """GPT-4o-mini 기반 쿼리 의도 분류기

    사용자 쿼리를 분석하여 policy_lookup, claim_guidance, general_qa 중
    하나의 의도로 분류합니다. API 오류 시 general_qa로 폴백합니다.
    """

    def __init__(self, settings: object) -> None:
        """의도 분류기 초기화

        Args:
            settings: 애플리케이션 설정 (openai_api_key, llm_classifier_model 포함)
        """
        self._settings = settings
        self._client = AsyncOpenAI(api_key=getattr(settings, "openai_api_key", "") or "dummy")
        self._model = getattr(settings, "llm_classifier_model", "gpt-4o-mini")

    async def classify(self, query: str) -> IntentResult:
        """쿼리 의도 분류

        GPT-4o-mini를 사용하여 쿼리의 의도를 분류합니다.
        오류 발생 시 general_qa로 폴백합니다.

        Args:
            query: 분류할 사용자 쿼리

        Returns:
            IntentResult: 분류 결과 (의도, 신뢰도, 근거)
        """
        try:
            response = await self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": _CLASSIFIER_SYSTEM_PROMPT},
                    {"role": "user", "content": query},
                ],
                temperature=0.1,
                max_tokens=200,
            )
            content = response.choices[0].message.content or ""
            return self._parse_response(content)

        except Exception as e:
            logger.error("의도 분류 오류 발생, general_qa로 폴백", error=str(e))
            return IntentResult(
                intent=QueryIntent.GENERAL_QA,
                confidence=0.0,
                reasoning=f"분류 오류로 폴백: {str(e)}",
            )

    def _parse_response(self, content: str) -> IntentResult:
        """LLM 응답을 IntentResult로 파싱

        Args:
            content: LLM 응답 텍스트 (JSON 형식)

        Returns:
            파싱된 IntentResult, 파싱 실패 시 general_qa 폴백
        """
        try:
            data = json.loads(content)
            intent_str = data.get("intent", "general_qa")
            confidence = float(data.get("confidence", 0.0))
            reasoning = data.get("reasoning", "")

            # 유효한 의도값 검증
            intent = QueryIntent(intent_str)

            return IntentResult(
                intent=intent,
                confidence=confidence,
                reasoning=reasoning,
            )

        except (json.JSONDecodeError, ValueError, KeyError) as e:
            logger.warning("의도 분류 응답 파싱 실패, general_qa로 폴백", error=str(e), content=content[:100])
            return IntentResult(
                intent=QueryIntent.GENERAL_QA,
                confidence=0.0,
                reasoning="응답 파싱 실패로 폴백",
            )
