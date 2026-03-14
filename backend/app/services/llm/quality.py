"""품질 검증기 서비스

SPEC-LLM-001 TASK-009: 응답 품질 검증, 불충분 컨텍스트 처리, 구조화 출력.
"""

from __future__ import annotations

import structlog

from app.services.llm.models import LLMResponse, QueryIntent

logger = structlog.get_logger()

# 최소 허용 유사도 임계값 (이 미만이면 불충분 컨텍스트로 판단)
_MIN_CONTEXT_SIMILARITY = 0.5

# 불충분 컨텍스트 면책 고지 문구
_INSUFFICIENT_CONTEXT_DISCLAIMER = (
    "\n\n※ 주의: 관련 약관 정보가 충분하지 않아 일반적인 보험 지식을 바탕으로 답변했습니다. "
    "정확한 내용은 해당 보험사에 직접 확인하시기 바랍니다."
)


class QualityGuard:
    """LLM 응답 품질 검증기

    응답의 품질을 검증하고 필요 시 면책 고지를 추가합니다:
    - 불충분 컨텍스트: 면책 고지 추가
    - claim_guidance: 핵심 필드 포함 여부 확인
    """

    async def post_process(
        self,
        response: LLMResponse,
        context: list[dict],
        intent: QueryIntent,
    ) -> str:
        """응답 후처리

        Args:
            response: LLM 생성 응답
            context: RAG 검색 결과 컨텍스트
            intent: 쿼리 의도

        Returns:
            후처리된 응답 텍스트
        """
        content = response.content

        # 불충분 컨텍스트 확인 및 면책 고지 추가
        if self._is_insufficient_context(context):
            logger.info("불충분 컨텍스트 감지, 면책 고지 추가", context_count=len(context))
            content = content + _INSUFFICIENT_CONTEXT_DISCLAIMER

        # claim_guidance 구조화 처리
        if intent == QueryIntent.CLAIM_GUIDANCE:
            content = self._ensure_claim_structure(content, context)

        return content

    def _is_insufficient_context(self, context: list[dict]) -> bool:
        """컨텍스트 충분성 확인

        Args:
            context: RAG 검색 결과 목록

        Returns:
            True이면 컨텍스트 불충분 (면책 고지 필요)
        """
        if not context:
            return True

        max_similarity = max(
            (item.get("similarity", 0.0) for item in context),
            default=0.0,
        )
        return max_similarity < _MIN_CONTEXT_SIMILARITY

    def _ensure_claim_structure(self, content: str, context: list[dict]) -> str:
        """청구 안내 응답의 구조화 확인

        청구 안내 응답에 핵심 정보가 포함되도록 합니다.

        Args:
            content: 원본 응답 내용
            context: RAG 검색 결과 컨텍스트

        Returns:
            구조화된 청구 안내 텍스트
        """
        # 청구 안내에 최소 필수 정보가 없는 경우 안내 추가
        has_structure = any(
            keyword in content
            for keyword in ["서류", "절차", "청구", "단계", "방법", "신청"]
        )

        if not has_structure and context:
            # 기본 청구 안내 구조 추가
            additional_info = (
                "\n\n[청구 기본 안내]\n"
                "- 청구에 필요한 정확한 서류와 절차는 보험사 고객센터에 문의하시기 바랍니다.\n"
                "- 청구 기한을 확인하시고 기한 내에 청구하시기 바랍니다."
            )
            content = content + additional_info

        return content
