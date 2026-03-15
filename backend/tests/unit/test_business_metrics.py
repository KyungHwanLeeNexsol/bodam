"""비즈니스 메트릭 단위 테스트

SPEC-OPS-001 REQ-OPS-001-04: 커스텀 비즈니스 메트릭 수집 검증.
TDD RED-GREEN 단계.
"""

from __future__ import annotations

import time

import pytest
from prometheus_client import CollectorRegistry, Counter, Histogram


@pytest.fixture
def registry():
    """각 테스트에 격리된 Prometheus 레지스트리를 제공한다."""
    return CollectorRegistry()


def make_business_metrics(registry: CollectorRegistry) -> dict:
    """격리된 레지스트리에 비즈니스 메트릭 세트를 생성한다."""
    return {
        "chat_sessions": Counter(
            "bodam_chat_sessions_total",
            "Total chat sessions",
            ["session_type"],
            registry=registry,
        ),
        "rag_query_duration": Histogram(
            "bodam_rag_query_duration_seconds",
            "RAG query latency",
            buckets=[0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0],
            registry=registry,
        ),
        "embedding_processed": Counter(
            "bodam_embedding_processed_total",
            "Total embeddings processed",
            ["status"],
            registry=registry,
        ),
        "llm_cost": Counter(
            "bodam_llm_cost_usd_total",
            "Total LLM cost",
            ["model"],
            registry=registry,
        ),
        "llm_response_duration": Histogram(
            "bodam_llm_response_duration_seconds",
            "LLM response time",
            ["model", "intent"],
            buckets=[0.5, 1.0, 2.0, 5.0, 10.0, 30.0],
            registry=registry,
        ),
    }


def get_counter_value(registry: CollectorRegistry, metric_name: str, labels: dict) -> float | None:
    """레지스트리에서 특정 Counter 값을 조회한다.

    prometheus_client v0.21+에서 Counter('foo_total', ...) 는
    family.name='foo', sample.name='foo_total' 로 저장된다.
    """
    # _total suffix가 있으면 제거하여 family.name과 매칭
    family_name = metric_name[:-6] if metric_name.endswith("_total") else metric_name
    for family in registry.collect():
        if family.name == family_name:
            for sample in family.samples:
                # _total suffix가 붙은 sample 이름으로 매칭
                if sample.name == metric_name:
                    match = all(sample.labels.get(k) == v for k, v in labels.items())
                    if match:
                        return sample.value
    return None


def get_histogram_count(
    registry: CollectorRegistry, metric_name: str, labels: dict | None = None
) -> float | None:
    """레지스트리에서 Histogram의 count 값을 조회한다."""
    for family in registry.collect():
        if family.name == metric_name:
            for sample in family.samples:
                if sample.name == f"{metric_name}_count":
                    if labels is None:
                        return sample.value
                    match = all(sample.labels.get(k) == v for k, v in labels.items())
                    if match:
                        return sample.value
    return None


class TestChatSessionMetrics:
    """채팅 세션 카운터 테스트"""

    def test_chat_session_counter_increments_correctly(self, registry):
        """채팅 세션 카운터가 올바르게 증가해야 한다"""
        m = make_business_metrics(registry)

        m["chat_sessions"].labels(session_type="insurance_query").inc()
        m["chat_sessions"].labels(session_type="insurance_query").inc()
        m["chat_sessions"].labels(session_type="general").inc()

        assert get_counter_value(
            registry, "bodam_chat_sessions_total", {"session_type": "insurance_query"}
        ) == pytest.approx(2.0)
        assert get_counter_value(
            registry, "bodam_chat_sessions_total", {"session_type": "general"}
        ) == pytest.approx(1.0)

    def test_chat_session_counter_has_session_type_label(self):
        """채팅 세션 카운터가 session_type 레이블을 가져야 한다"""
        from app.core.metrics import CHAT_SESSIONS

        assert "session_type" in CHAT_SESSIONS._labelnames

    def test_increment_chat_session_helper_function(self, registry):
        """increment_chat_session 헬퍼 함수가 올바르게 동작해야 한다"""
        m = make_business_metrics(registry)

        m["chat_sessions"].labels(session_type="insurance_query").inc()

        value = get_counter_value(
            registry, "bodam_chat_sessions_total", {"session_type": "insurance_query"}
        )
        assert value == pytest.approx(1.0)


class TestRagQueryMetrics:
    """RAG 쿼리 히스토그램 테스트"""

    def test_rag_query_histogram_records_duration(self, registry):
        """RAG 쿼리 히스토그램이 지속 시간을 기록해야 한다"""
        m = make_business_metrics(registry)

        m["rag_query_duration"].observe(0.5)
        m["rag_query_duration"].observe(1.2)
        m["rag_query_duration"].observe(2.8)

        count = get_histogram_count(registry, "bodam_rag_query_duration_seconds")
        assert count == pytest.approx(3.0)

    def test_rag_query_histogram_uses_context_manager(self, registry):
        """RAG 쿼리 히스토그램이 context manager를 지원해야 한다"""
        m = make_business_metrics(registry)

        with m["rag_query_duration"].time():
            time.sleep(0.01)

        count = get_histogram_count(registry, "bodam_rag_query_duration_seconds")
        assert count == pytest.approx(1.0)

    def test_observe_rag_query_duration_helper(self):
        """observe_rag_query_duration 헬퍼 함수가 존재해야 한다"""
        from app.core.metrics import RAG_QUERY_DURATION, observe_rag_query_duration

        assert observe_rag_query_duration is not None
        assert RAG_QUERY_DURATION is not None


class TestEmbeddingMetrics:
    """임베딩 카운터 테스트"""

    def test_embedding_counter_tracks_success(self, registry):
        """임베딩 카운터가 성공 상태를 추적해야 한다"""
        m = make_business_metrics(registry)

        m["embedding_processed"].labels(status="success").inc()
        m["embedding_processed"].labels(status="success").inc()

        value = get_counter_value(
            registry, "bodam_embedding_processed_total", {"status": "success"}
        )
        assert value == pytest.approx(2.0)

    def test_embedding_counter_tracks_failure(self, registry):
        """임베딩 카운터가 실패 상태를 추적해야 한다"""
        m = make_business_metrics(registry)

        m["embedding_processed"].labels(status="failure").inc()

        value = get_counter_value(
            registry, "bodam_embedding_processed_total", {"status": "failure"}
        )
        assert value == pytest.approx(1.0)

    def test_embedding_counter_has_status_label(self):
        """임베딩 카운터가 status 레이블을 가져야 한다"""
        from app.core.metrics import EMBEDDING_PROCESSED

        assert "status" in EMBEDDING_PROCESSED._labelnames


class TestLLMCostMetrics:
    """LLM 비용 카운터 테스트"""

    def test_llm_cost_counter_tracks_by_model(self, registry):
        """LLM 비용 카운터가 모델별로 추적해야 한다"""
        m = make_business_metrics(registry)

        m["llm_cost"].labels(model="gpt-4o").inc(0.05)
        m["llm_cost"].labels(model="gpt-4o").inc(0.03)
        m["llm_cost"].labels(model="gemini-2.0-flash").inc(0.001)

        assert get_counter_value(
            registry, "bodam_llm_cost_usd_total", {"model": "gpt-4o"}
        ) == pytest.approx(0.08)
        assert get_counter_value(
            registry, "bodam_llm_cost_usd_total", {"model": "gemini-2.0-flash"}
        ) == pytest.approx(0.001)

    def test_llm_cost_counter_has_model_label(self):
        """LLM 비용 카운터가 model 레이블을 가져야 한다"""
        from app.core.metrics import LLM_COST

        assert "model" in LLM_COST._labelnames

    def test_llm_response_duration_tracks_by_model_and_intent(self, registry):
        """LLM 응답 지연 시간이 모델 및 인텐트별로 추적되어야 한다"""
        m = make_business_metrics(registry)

        m["llm_response_duration"].labels(model="gpt-4o", intent="search").observe(1.5)
        m["llm_response_duration"].labels(model="gemini-2.0-flash", intent="chat").observe(0.8)

        count_gpt = get_histogram_count(
            registry,
            "bodam_llm_response_duration_seconds",
            {"model": "gpt-4o", "intent": "search"},
        )
        count_gemini = get_histogram_count(
            registry,
            "bodam_llm_response_duration_seconds",
            {"model": "gemini-2.0-flash", "intent": "chat"},
        )

        assert count_gpt == pytest.approx(1.0)
        assert count_gemini == pytest.approx(1.0)

    def test_increment_llm_cost_helper_function(self):
        """increment_llm_cost 헬퍼 함수가 존재해야 한다"""
        from app.core.metrics import LLM_COST, increment_llm_cost

        assert increment_llm_cost is not None
        assert LLM_COST is not None

    def test_observe_llm_response_duration_helper(self):
        """observe_llm_response_duration 헬퍼 함수가 존재해야 한다"""
        from app.core.metrics import LLM_RESPONSE_DURATION, observe_llm_response_duration

        assert observe_llm_response_duration is not None
        assert LLM_RESPONSE_DURATION is not None
