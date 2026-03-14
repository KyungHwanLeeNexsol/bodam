"""프롬프트 관리자 서비스

SPEC-LLM-001 TASK-006: 의도별 프롬프트 템플릿, 메시지 빌더, 컨텍스트 윈도우 관리.
"""

from __future__ import annotations

import structlog

from app.services.llm.models import QueryIntent

logger = structlog.get_logger()

# 모델별 컨텍스트 윈도우 크기 (토큰 수 기준)
_MODEL_CONTEXT_WINDOWS: dict[str, int] = {
    "gemini-2.0-flash": 1_048_576,
    "gpt-4o": 128_000,
    "gpt-4o-mini": 128_000,
}

# 컨텍스트 윈도우 사용률 임계값 (80% 초과 시 히스토리 압축)
_CONTEXT_WINDOW_THRESHOLD = 0.8

# 평균 토큰당 문자 수 (한국어 기준 대략적 추정)
_AVG_CHARS_PER_TOKEN = 2

# 템플릿 레지스트리 버전
_TEMPLATE_VERSION = "1.0.0"

# 의도별 시스템 프롬프트 템플릿
_SYSTEM_PROMPTS: dict[QueryIntent, str] = {
    QueryIntent.POLICY_LOOKUP: """당신은 '보담'이라는 한국 보험 약관 전문 AI 상담사입니다.
보험 약관의 내용을 정확하고 친절하게 설명해주세요.

역할 및 규칙:
1. 제공된 약관 정보를 기반으로 정확한 내용을 안내하세요.
2. 약관의 보장 범위, 보장 조건, 면책 사항을 명확히 설명하세요.
3. 전문 보험 용어는 쉬운 말로 풀어서 설명하세요.
4. 약관 출처(회사명, 약관명)를 반드시 언급하세요.
5. 확실하지 않은 내용은 "정확한 확인이 필요합니다"라고 안내하세요.""",

    QueryIntent.CLAIM_GUIDANCE: """당신은 '보담'이라는 한국 보험금 청구 전문 AI 상담사입니다.
보험금 청구 절차와 방법을 단계별로 안내해주세요.

역할 및 규칙:
1. 청구 절차를 단계별로 명확하게 안내하세요.
2. 필요 서류 목록을 구체적으로 제시하세요.
3. 예상 보장 금액 범위를 가능한 경우 안내하세요.
4. 청구 가능 보장 항목을 나열하세요.
5. 청구 기한과 주의사항을 반드시 포함하세요.
6. 제공된 약관 정보를 바탕으로 정확한 청구 방법을 안내하세요.""",

    QueryIntent.GENERAL_QA: """당신은 '보담'이라는 한국 보험 전문 AI 상담사입니다.
보험에 관한 다양한 질문에 친절하고 정확하게 답변해주세요.

역할 및 규칙:
1. 보험 관련 질문에 이해하기 쉽게 답변하세요.
2. 제공된 약관 정보가 있으면 이를 활용해 구체적으로 설명하세요.
3. 전문 용어는 쉬운 말로 풀어서 설명하세요.
4. 확실하지 않은 정보는 "정확한 확인이 필요합니다"라고 안내하세요.
5. 보험 가입, 해지, 보장 내용 등 다양한 주제에 대응하세요.""",
}


class PromptManager:
    """보험 AI 프롬프트 관리자

    의도별 시스템 프롬프트 제공, 컨텍스트를 포함한 메시지 빌드,
    컨텍스트 윈도우 초과 시 히스토리 압축 기능을 제공합니다.
    """

    def __init__(self, model: str = "gemini-2.0-flash") -> None:
        """프롬프트 관리자 초기화

        Args:
            model: 사용할 LLM 모델명 (컨텍스트 윈도우 크기 결정에 사용)
        """
        self._model = model
        self._template_version = _TEMPLATE_VERSION
        self._context_window = _MODEL_CONTEXT_WINDOWS.get(model, 128_000)

    def get_system_prompt(self, intent: QueryIntent) -> str:
        """의도에 맞는 시스템 프롬프트 반환

        Args:
            intent: 쿼리 의도

        Returns:
            한국어 시스템 프롬프트 문자열
        """
        return _SYSTEM_PROMPTS.get(intent, _SYSTEM_PROMPTS[QueryIntent.GENERAL_QA])

    def build_messages(
        self,
        history: list[dict],
        context: list[dict],
        query: str,
        intent: QueryIntent,
    ) -> list[dict]:
        """메시지 목록 빌드

        시스템 프롬프트, 대화 히스토리, 컨텍스트, 사용자 쿼리를 조합하여
        LLM API 호출용 메시지 목록을 생성합니다.

        Args:
            history: 이전 대화 히스토리 목록 (role, content 딕셔너리)
            context: RAG 검색 결과 목록 (company_name, policy_name, chunk_text 포함)
            query: 현재 사용자 쿼리
            intent: 분류된 쿼리 의도

        Returns:
            LLM API 호출용 메시지 딕셔너리 목록
        """
        system_prompt = self.get_system_prompt(intent)
        messages: list[dict] = [{"role": "system", "content": system_prompt}]

        # 컨텍스트 윈도우 초과 여부 확인 후 히스토리 압축
        compressed_history = self._compress_history_if_needed(
            history=history,
            system_prompt=system_prompt,
            context=context,
            query=query,
        )
        messages.extend(compressed_history)

        # 사용자 메시지에 약관 컨텍스트 추가
        user_content = self._build_user_content(context=context, query=query)
        messages.append({"role": "user", "content": user_content})

        return messages

    def _build_user_content(self, context: list[dict], query: str) -> str:
        """사용자 메시지에 약관 컨텍스트를 추가한 내용 생성

        Args:
            context: RAG 검색 결과 목록
            query: 사용자 쿼리

        Returns:
            컨텍스트가 포함된 사용자 메시지 문자열
        """
        if not context:
            return query

        context_parts = ["다음은 관련 약관 정보입니다:\n"]
        for i, item in enumerate(context, 1):
            company = item.get("company_name", "")
            policy = item.get("policy_name", "")
            text = item.get("chunk_text", "")
            context_parts.append(f"[출처 {i}] {company} - {policy}\n{text}\n")

        context_str = "\n".join(context_parts)
        return f"{context_str}\n사용자 질문: {query}"

    def _estimate_tokens(self, text: str) -> int:
        """텍스트의 토큰 수 추정

        한국어 텍스트 기준 대략적 토큰 수를 계산합니다.

        Args:
            text: 토큰 수를 추정할 텍스트

        Returns:
            추정 토큰 수
        """
        return max(1, len(text) // _AVG_CHARS_PER_TOKEN)

    def _compress_history_if_needed(
        self,
        history: list[dict],
        system_prompt: str,
        context: list[dict],
        query: str,
    ) -> list[dict]:
        """컨텍스트 윈도우 초과 시 히스토리 압축

        전체 메시지가 컨텍스트 윈도우의 80%를 초과하는 경우
        오래된 히스토리를 제거합니다.

        Args:
            history: 원본 대화 히스토리
            system_prompt: 시스템 프롬프트
            context: RAG 검색 결과
            query: 현재 사용자 쿼리

        Returns:
            압축된 대화 히스토리
        """
        if not history:
            return []

        # 고정 토큰 수 추정 (시스템 + 컨텍스트 + 현재 쿼리)
        fixed_content = system_prompt + self._build_user_content(context, query)
        fixed_tokens = self._estimate_tokens(fixed_content)

        # 허용 가능한 최대 히스토리 토큰 수
        max_context = int(self._context_window * _CONTEXT_WINDOW_THRESHOLD)
        available_tokens = max_context - fixed_tokens

        if available_tokens <= 0:
            return []

        # 히스토리를 뒤에서부터 추가 (최근 메시지 우선 유지)
        compressed: list[dict] = []
        used_tokens = 0
        for msg in reversed(history):
            msg_tokens = self._estimate_tokens(msg.get("content", ""))
            if used_tokens + msg_tokens > available_tokens:
                break
            compressed.insert(0, msg)
            used_tokens += msg_tokens

        if len(compressed) < len(history):
            logger.info(
                "대화 히스토리 압축",
                original_count=len(history),
                compressed_count=len(compressed),
            )

        return compressed
