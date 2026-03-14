"""LLM 메트릭 수집 및 집계 서비스

SPEC-LLM-001 TASK-003: 쿼리별 메트릭 기록, 세션 집계, 비용 계산.
"""

from __future__ import annotations

import structlog

from app.services.llm.models import QueryMetrics, SessionMetrics

logger = structlog.get_logger()

# 모델별 토큰당 비용 테이블 (USD per 1M tokens)
# 입력 토큰 비용과 출력 토큰 비용
_MODEL_PRICING: dict[str, dict[str, float]] = {
    "gemini-2.0-flash": {
        "input": 0.075,   # $0.075 per 1M input tokens
        "output": 0.30,   # $0.30 per 1M output tokens
    },
    "gpt-4o": {
        "input": 2.50,    # $2.50 per 1M input tokens
        "output": 10.00,  # $10.00 per 1M output tokens
    },
    "gpt-4o-mini": {
        "input": 0.15,    # $0.15 per 1M input tokens
        "output": 0.60,   # $0.60 per 1M output tokens
    },
}


class LLMMetrics:
    """LLM 쿼리 메트릭 수집기

    쿼리별 지연 시간, 토큰 수, 비용을 기록하고
    세션 단위로 집계하는 클래스.
    """

    def __init__(self) -> None:
        """메트릭 수집기 초기화"""
        self._query_records: list[QueryMetrics] = []

    def record(self, metrics: QueryMetrics) -> None:
        """쿼리 메트릭 기록

        Args:
            metrics: 기록할 쿼리 메트릭 데이터
        """
        self._query_records.append(metrics)
        logger.info(
            "쿼리 메트릭 기록",
            model=metrics.model_used,
            latency_ms=metrics.latency_ms,
            tokens=metrics.input_tokens + metrics.output_tokens,
            cost_usd=metrics.estimated_cost_usd,
        )

    def get_session_metrics(self) -> SessionMetrics:
        """세션 누적 메트릭 반환

        Returns:
            현재까지 누적된 세션 메트릭
        """
        if not self._query_records:
            return SessionMetrics()

        total_cost = sum(r.estimated_cost_usd for r in self._query_records)
        total_tokens = sum(r.input_tokens + r.output_tokens for r in self._query_records)
        query_count = len(self._query_records)
        avg_latency = sum(r.latency_ms for r in self._query_records) / query_count
        models_used = list({r.model_used for r in self._query_records})

        return SessionMetrics(
            total_cost_usd=total_cost,
            total_tokens=total_tokens,
            query_count=query_count,
            avg_latency_ms=avg_latency,
            models_used=models_used,
        )

    def calculate_cost(self, model: str, input_tokens: int, output_tokens: int) -> float:
        """모델별 토큰 비용 계산

        Args:
            model: 모델명
            input_tokens: 입력 토큰 수
            output_tokens: 출력 토큰 수

        Returns:
            예상 비용 (USD), 알 수 없는 모델이면 0.0
        """
        pricing = _MODEL_PRICING.get(model)
        if pricing is None:
            logger.warning("알 수 없는 모델 비용 계산", model=model)
            return 0.0

        # 1M 토큰 단위 가격표 기준 계산
        input_cost = (input_tokens / 1_000_000) * pricing["input"]
        output_cost = (output_tokens / 1_000_000) * pricing["output"]
        return input_cost + output_cost

    def reset_session(self) -> None:
        """세션 메트릭 초기화"""
        self._query_records.clear()
        logger.info("세션 메트릭 초기화 완료")
