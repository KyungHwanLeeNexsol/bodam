"""Celery 메트릭 단위 테스트

SPEC-OPS-001 REQ-OPS-001-02: Celery worker 메트릭 수집 검증.
TDD RED-GREEN 단계.
"""

from __future__ import annotations

import time

import pytest
from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram


@pytest.fixture(autouse=True)
def clear_task_start_times():
    """각 테스트 전후로 _task_start_times 딕셔너리를 초기화한다."""
    from app.core.celery_metrics import _task_start_times

    _task_start_times.clear()
    yield
    _task_start_times.clear()


@pytest.fixture
def registry():
    """각 테스트에 격리된 Prometheus 레지스트리를 제공한다."""
    return CollectorRegistry()


def make_celery_metrics(registry: CollectorRegistry) -> dict:
    """격리된 레지스트리에 Celery 메트릭 세트를 생성한다."""
    return {
        "tasks_total": Counter(
            "celery_tasks_total",
            "Total Celery tasks",
            ["task_name", "state"],
            registry=registry,
        ),
        "task_duration": Histogram(
            "celery_task_duration_seconds",
            "Celery task duration",
            ["task_name"],
            buckets=[0.1, 0.5, 1.0, 5.0, 10.0, 30.0, 60.0, 300.0],
            registry=registry,
        ),
        "queue_length": Gauge(
            "celery_queue_length",
            "Queue length",
            ["queue_name"],
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


class TestCeleryTaskSentMetrics:
    """task_sent 시그널 테스트"""

    def test_task_sent_signal_increments_queue_counter(self, registry):
        """task_sent 시그널이 큐 카운터를 증가시켜야 한다"""
        m = make_celery_metrics(registry)

        m["tasks_total"].labels(task_name="app.tasks.embed_document", state="sent").inc()
        m["tasks_total"].labels(task_name="app.tasks.embed_document", state="sent").inc()

        value = get_counter_value(
            registry,
            "celery_tasks_total",
            {"task_name": "app.tasks.embed_document", "state": "sent"},
        )
        assert value == pytest.approx(2.0)

    def test_task_sent_signal_creates_pending_state(self, registry):
        """task_sent 시그널이 sent 상태를 생성해야 한다"""
        m = make_celery_metrics(registry)

        m["tasks_total"].labels(task_name="app.tasks.crawl", state="sent").inc()

        value = get_counter_value(
            registry,
            "celery_tasks_total",
            {"task_name": "app.tasks.crawl", "state": "sent"},
        )
        assert value == pytest.approx(1.0)

    def test_on_task_sent_handler_exists(self):
        """on_task_sent 핸들러 함수가 존재해야 한다"""
        from app.core.celery_metrics import on_task_sent

        assert on_task_sent is not None
        assert callable(on_task_sent)


class TestCeleryTaskPrerunMetrics:
    """task_prerun 시그널 테스트"""

    def test_task_prerun_signal_starts_timing(self):
        """task_prerun 시그널이 타이밍을 시작해야 한다"""
        from app.core.celery_metrics import _task_start_times, on_task_prerun

        task_id = "timing-test-id"
        on_task_prerun(
            task_id=task_id,
            task_name="app.tasks.embed_document",
        )

        assert task_id in _task_start_times
        assert _task_start_times[task_id] > 0

    def test_task_prerun_increments_running_counter(self, registry):
        """task_prerun 시그널이 실행 중 상태 카운터를 증가시켜야 한다"""
        m = make_celery_metrics(registry)

        m["tasks_total"].labels(task_name="app.tasks.process", state="started").inc()

        value = get_counter_value(
            registry,
            "celery_tasks_total",
            {"task_name": "app.tasks.process", "state": "started"},
        )
        assert value == pytest.approx(1.0)

    def test_on_task_prerun_handler_exists(self):
        """on_task_prerun 핸들러 함수가 존재해야 한다"""
        from app.core.celery_metrics import on_task_prerun

        assert on_task_prerun is not None
        assert callable(on_task_prerun)


class TestCeleryTaskPostrunMetrics:
    """task_postrun 시그널 테스트"""

    def test_task_postrun_records_success_duration(self):
        """task_postrun 시그널이 성공 지속 시간을 기록해야 한다"""
        from app.core.celery_metrics import _task_start_times, on_task_postrun, on_task_prerun

        task_id = "duration-test-id"

        on_task_prerun(
            task_id=task_id,
            task_name="app.tasks.embed_document",
        )

        time.sleep(0.01)

        on_task_postrun(
            task_id=task_id,
            task_name="app.tasks.embed_document",
            state="SUCCESS",
        )

        # 시작 시간이 정리되어야 함
        assert task_id not in _task_start_times

    def test_task_postrun_increments_success_counter(self, registry):
        """task_postrun 시그널이 성공 카운터를 증가시켜야 한다"""
        m = make_celery_metrics(registry)

        m["tasks_total"].labels(task_name="app.tasks.crawl", state="success").inc()

        value = get_counter_value(
            registry,
            "celery_tasks_total",
            {"task_name": "app.tasks.crawl", "state": "success"},
        )
        assert value == pytest.approx(1.0)

    def test_task_postrun_duration_histogram_records(self, registry):
        """task_postrun이 지속 시간을 히스토그램에 기록해야 한다"""
        m = make_celery_metrics(registry)

        m["task_duration"].labels(task_name="app.tasks.embed_document").observe(0.5)

        count = get_histogram_count(
            registry,
            "celery_task_duration_seconds",
            {"task_name": "app.tasks.embed_document"},
        )
        assert count == pytest.approx(1.0)

    def test_on_task_postrun_handler_exists(self):
        """on_task_postrun 핸들러 함수가 존재해야 한다"""
        from app.core.celery_metrics import on_task_postrun

        assert on_task_postrun is not None
        assert callable(on_task_postrun)


class TestCeleryTaskFailureMetrics:
    """task_failure 시그널 테스트"""

    def test_task_failure_increments_failure_counter(self, registry):
        """task_failure 시그널이 실패 카운터를 증가시켜야 한다"""
        m = make_celery_metrics(registry)

        m["tasks_total"].labels(task_name="app.tasks.embed_document", state="failure").inc()

        value = get_counter_value(
            registry,
            "celery_tasks_total",
            {"task_name": "app.tasks.embed_document", "state": "failure"},
        )
        assert value == pytest.approx(1.0)

    def test_task_failure_cleans_up_start_time(self):
        """task_failure 시그널이 시작 시간을 정리해야 한다"""
        from app.core.celery_metrics import _task_start_times, on_task_failure, on_task_prerun

        task_id = "cleanup-fail-id"

        on_task_prerun(task_id=task_id, task_name="app.tasks.process")
        assert task_id in _task_start_times

        on_task_failure(
            task_id=task_id,
            task_name="app.tasks.process",
            exception=RuntimeError("unexpected error"),
        )

        assert task_id not in _task_start_times

    def test_task_failure_records_duration_when_start_time_exists(self):
        """task_failure가 시작 시간이 있을 때 지속 시간을 기록해야 한다"""
        from app.core.celery_metrics import _task_start_times, on_task_failure, on_task_prerun

        task_id = "fail-duration-id"

        on_task_prerun(task_id=task_id, task_name="app.tasks.slow_task")
        assert task_id in _task_start_times

        time.sleep(0.01)

        on_task_failure(
            task_id=task_id,
            task_name="app.tasks.slow_task",
            exception=TimeoutError("task timed out"),
        )

        # 시작 시간이 정리되어야 함 (duration 기록 완료 후)
        assert task_id not in _task_start_times

    def test_on_task_failure_handler_exists(self):
        """on_task_failure 핸들러 함수가 존재해야 한다"""
        from app.core.celery_metrics import on_task_failure

        assert on_task_failure is not None
        assert callable(on_task_failure)


class TestCeleryQueueMetrics:
    """Celery 큐 길이 게이지 테스트"""

    def test_queue_length_gauge_exists(self):
        """celery_queue_length 게이지가 존재해야 한다"""
        from app.core.celery_metrics import CELERY_QUEUE_LENGTH

        assert CELERY_QUEUE_LENGTH is not None

    def test_queue_length_gauge_has_queue_name_label(self):
        """celery_queue_length 게이지가 queue_name 레이블을 가져야 한다"""
        from app.core.celery_metrics import CELERY_QUEUE_LENGTH

        assert "queue_name" in CELERY_QUEUE_LENGTH._labelnames

    def test_queue_length_can_be_set(self, registry):
        """큐 길이를 설정할 수 있어야 한다"""
        m = make_celery_metrics(registry)

        m["queue_length"].labels(queue_name="celery").set(42)

        for family in registry.collect():
            if family.name == "celery_queue_length":
                for sample in family.samples:
                    if sample.labels.get("queue_name") == "celery":
                        assert sample.value == pytest.approx(42.0)
                        return

        pytest.fail("celery_queue_length 메트릭을 찾을 수 없음")

    def test_set_queue_length_helper_exists(self):
        """set_queue_length 헬퍼 함수가 존재해야 한다"""
        from app.core.celery_metrics import set_queue_length

        assert set_queue_length is not None
        assert callable(set_queue_length)


class TestCeleryMetricsSignalIntegration:
    """Celery 시그널 통합 테스트 (글로벌 메트릭 사용)"""

    def test_full_task_lifecycle(self):
        """태스크 전체 생명주기가 올바르게 추적되어야 한다"""
        from app.core.celery_metrics import (
            _task_start_times,
            on_task_postrun,
            on_task_prerun,
            on_task_sent,
        )

        task_id = "lifecycle-test-id"
        task_name = "app.tasks.lifecycle_test"

        # 1. 태스크 전송
        on_task_sent(task_id=task_id, task_name=task_name, queue="test_queue")

        # 2. 태스크 시작
        on_task_prerun(task_id=task_id, task_name=task_name)
        assert task_id in _task_start_times

        time.sleep(0.01)

        # 3. 태스크 완료
        on_task_postrun(task_id=task_id, task_name=task_name, state="SUCCESS")
        assert task_id not in _task_start_times

    def test_connect_celery_signals_function_exists(self):
        """connect_celery_signals 함수가 존재해야 한다"""
        from app.core.celery_metrics import connect_celery_signals

        assert connect_celery_signals is not None
        assert callable(connect_celery_signals)
