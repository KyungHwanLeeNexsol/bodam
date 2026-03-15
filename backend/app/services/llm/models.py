"""LLM 서비스 Pydantic 모델 정의

SPEC-LLM-001 TASK-002: 의도 분류, LLM 응답, 메트릭 관련 데이터 모델.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel


class QueryIntent(StrEnum):
    """사용자 쿼리 의도 분류"""

    # 보험 약관 조회 의도
    POLICY_LOOKUP = "policy_lookup"
    # 보험금 청구 안내 의도
    CLAIM_GUIDANCE = "claim_guidance"
    # 일반 질의응답 의도
    GENERAL_QA = "general_qa"
    # 보험 분쟁 가이던스 의도
    DISPUTE_GUIDANCE = "dispute_guidance"


class LLMProviderType(StrEnum):
    """지원하는 LLM 제공자 유형"""

    # Google Gemini 2.0 Flash (주 모델)
    GEMINI_FLASH = "gemini-2.0-flash"
    # OpenAI GPT-4o (폴백 모델)
    GPT_4O = "gpt-4o"
    # OpenAI GPT-4o-mini (분류용 경량 모델)
    GPT_4O_MINI = "gpt-4o-mini"


class IntentResult(BaseModel):
    """의도 분류 결과 모델"""

    # 분류된 쿼리 의도
    intent: QueryIntent
    # 분류 신뢰도 (0.0~1.0)
    confidence: float
    # 분류 근거 설명
    reasoning: str = ""


class SourceCitation(BaseModel):
    """응답 출처 인용 모델"""

    # 보험사명
    company_name: str
    # 약관명
    policy_name: str
    # 관련 약관 텍스트 (최대 200자)
    chunk_text: str
    # 벡터 유사도 점수
    similarity: float


class LLMResponse(BaseModel):
    """LLM 응답 결과 모델"""

    # 생성된 응답 텍스트
    content: str
    # 실제 사용된 모델명
    model_used: str
    # 입력 토큰 수
    input_tokens: int = 0
    # 출력 토큰 수
    output_tokens: int = 0
    # 예상 비용 (USD)
    estimated_cost_usd: float = 0.0
    # 응답 신뢰도 점수
    confidence_score: float = 0.0
    # 출처 인용 목록
    sources: list[SourceCitation] = []
    # 응답 지연 시간 (밀리초)
    latency_ms: float = 0.0


class QueryMetrics(BaseModel):
    """단일 쿼리 메트릭"""

    # 쿼리 처리 지연 시간 (밀리초)
    latency_ms: float
    # 입력 토큰 수
    input_tokens: int
    # 출력 토큰 수
    output_tokens: int
    # 사용된 모델명
    model_used: str
    # 예상 비용 (USD)
    estimated_cost_usd: float
    # 검색 결과 관련성 점수
    retrieval_relevance: float = 0.0


class SessionMetrics(BaseModel):
    """세션 누적 메트릭"""

    # 세션 총 비용 (USD)
    total_cost_usd: float = 0.0
    # 세션 총 토큰 수
    total_tokens: int = 0
    # 쿼리 횟수
    query_count: int = 0
    # 평균 지연 시간 (밀리초)
    avg_latency_ms: float = 0.0
    # 사용된 모델 목록
    models_used: list[str] = []
