"""LLM 메트릭 서비스 단위 테스트

SPEC-LLM-001 TASK-003: 쿼리 메트릭 기록, 세션 집계, 비용 계산 검증.
"""

from __future__ import annotations

import pytest

from app.services.llm.metrics import LLMMetrics
from app.services.llm.models import QueryMetrics


class TestLLMMetricsInit:
    """LLMMetrics 초기화 테스트"""

    def test_initial_session_metrics(self):
        """초기 세션 메트릭은 빈 상태"""
        metrics = LLMMetrics()
        session = metrics.get_session_metrics()
        assert session.total_cost_usd == 0.0
        assert session.total_tokens == 0
        assert session.query_count == 0
        assert session.avg_latency_ms == 0.0
        assert session.models_used == []


class TestLLMMetricsRecord:
    """메트릭 기록 테스트"""

    def test_record_single_query(self):
        """단일 쿼리 메트릭 기록"""
        metrics = LLMMetrics()
        query_metrics = QueryMetrics(
            latency_ms=200.0,
            input_tokens=100,
            output_tokens=50,
            model_used="gemini-2.0-flash",
            estimated_cost_usd=0.001,
        )
        metrics.record(query_metrics)

        session = metrics.get_session_metrics()
        assert session.query_count == 1
        assert session.total_tokens == 150  # 100 + 50
        assert session.total_cost_usd == pytest.approx(0.001, abs=1e-6)
        assert session.avg_latency_ms == 200.0

    def test_record_multiple_queries(self):
        """여러 쿼리 메트릭 누적"""
        metrics = LLMMetrics()

        metrics.record(
            QueryMetrics(
                latency_ms=100.0,
                input_tokens=100,
                output_tokens=50,
                model_used="gemini-2.0-flash",
                estimated_cost_usd=0.001,
            )
        )
        metrics.record(
            QueryMetrics(
                latency_ms=300.0,
                input_tokens=200,
                output_tokens=100,
                model_used="gpt-4o",
                estimated_cost_usd=0.003,
            )
        )

        session = metrics.get_session_metrics()
        assert session.query_count == 2
        assert session.total_tokens == 450  # (100+50) + (200+100)
        assert session.total_cost_usd == pytest.approx(0.004, abs=1e-6)
        assert session.avg_latency_ms == pytest.approx(200.0, abs=1e-6)  # (100+300)/2

    def test_models_used_tracking(self):
        """사용된 모델 목록 추적"""
        metrics = LLMMetrics()
        metrics.record(
            QueryMetrics(
                latency_ms=100.0,
                input_tokens=100,
                output_tokens=50,
                model_used="gemini-2.0-flash",
                estimated_cost_usd=0.001,
            )
        )
        metrics.record(
            QueryMetrics(
                latency_ms=200.0,
                input_tokens=150,
                output_tokens=80,
                model_used="gpt-4o",
                estimated_cost_usd=0.002,
            )
        )
        metrics.record(
            QueryMetrics(
                latency_ms=150.0,
                input_tokens=120,
                output_tokens=60,
                model_used="gemini-2.0-flash",  # 중복
                estimated_cost_usd=0.001,
            )
        )

        session = metrics.get_session_metrics()
        # 중복 제거된 유니크 모델 목록
        assert set(session.models_used) == {"gemini-2.0-flash", "gpt-4o"}


class TestLLMMetricsCostCalculation:
    """비용 계산 테스트"""

    def test_calculate_cost_gemini_flash(self):
        """Gemini Flash 비용 계산"""
        metrics = LLMMetrics()
        # Gemini Flash: input $0.075/1M tokens, output $0.30/1M tokens
        cost = metrics.calculate_cost("gemini-2.0-flash", input_tokens=1_000_000, output_tokens=1_000_000)
        # 입력 비용 + 출력 비용
        assert cost > 0.0

    def test_calculate_cost_gpt4o(self):
        """GPT-4o 비용 계산"""
        metrics = LLMMetrics()
        cost = metrics.calculate_cost("gpt-4o", input_tokens=1000, output_tokens=500)
        assert cost > 0.0

    def test_calculate_cost_gpt4o_mini(self):
        """GPT-4o-mini 비용 계산"""
        metrics = LLMMetrics()
        cost = metrics.calculate_cost("gpt-4o-mini", input_tokens=1000, output_tokens=500)
        assert cost > 0.0

    def test_gpt4o_more_expensive_than_gemini(self):
        """GPT-4o는 Gemini Flash보다 비쌈"""
        metrics = LLMMetrics()
        gemini_cost = metrics.calculate_cost("gemini-2.0-flash", input_tokens=1000, output_tokens=500)
        gpt4o_cost = metrics.calculate_cost("gpt-4o", input_tokens=1000, output_tokens=500)
        assert gpt4o_cost > gemini_cost

    def test_unknown_model_returns_zero(self):
        """알 수 없는 모델은 비용 0 반환"""
        metrics = LLMMetrics()
        cost = metrics.calculate_cost("unknown-model", input_tokens=1000, output_tokens=500)
        assert cost == 0.0


class TestLLMMetricsReset:
    """세션 리셋 테스트"""

    def test_reset_session(self):
        """세션 메트릭 초기화"""
        metrics = LLMMetrics()
        metrics.record(
            QueryMetrics(
                latency_ms=100.0,
                input_tokens=100,
                output_tokens=50,
                model_used="gemini-2.0-flash",
                estimated_cost_usd=0.001,
            )
        )
        metrics.reset_session()

        session = metrics.get_session_metrics()
        assert session.query_count == 0
        assert session.total_cost_usd == 0.0
        assert session.total_tokens == 0
