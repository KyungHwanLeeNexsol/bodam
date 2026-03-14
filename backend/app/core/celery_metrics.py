"""Celery worker 메트릭 핸들러

SPEC-OPS-001 REQ-OPS-001-02:
Celery 시그널 핸들러를 통해 태스크 메트릭을 Prometheus로 수집한다.
- celery_tasks_total (task_name, state)
- celery_task_duration_seconds (task_name)
- celery_queue_length (queue_name)
"""

from __future__ import annotations

import time
from typing import Any

from prometheus_client import Counter, Gauge, Histogram

# ---------------------------------------------------------------------------
# Celery 메트릭 정의
# ---------------------------------------------------------------------------

# # @MX:ANCHOR: Celery 메트릭 전역 싱글톤
# # @MX:REASON: fan_in >= 3 (signal handlers, tests, celery app)
CELERY_TASKS_TOTAL = Counter(
    "celery_tasks_total",
    "Total Celery tasks by state",
    ["task_name", "state"],
)

CELERY_TASK_DURATION = Histogram(
    "celery_task_duration_seconds",
    "Celery task execution duration in seconds",
    ["task_name"],
    buckets=[0.1, 0.5, 1.0, 5.0, 10.0, 30.0, 60.0, 300.0],
)

CELERY_QUEUE_LENGTH = Gauge(
    "celery_queue_length",
    "Current number of tasks in the Celery queue",
    ["queue_name"],
)

# 태스크 시작 시간 추적 (task_id -> 시작 timestamp)
# # @MX:NOTE: dict를 사용한 인메모리 타이밍. 워커 재시작 시 데이터 손실 가능
_task_start_times: dict[str, float] = {}


# ---------------------------------------------------------------------------
# Celery 시그널 핸들러
# ---------------------------------------------------------------------------


def on_task_sent(task_id: str, task_name: str, queue: str = "celery", **kwargs: Any) -> None:
    """task_sent 시그널 핸들러: 태스크가 큐에 전송될 때 호출된다.

    Args:
        task_id: Celery 태스크 고유 ID
        task_name: 태스크 모듈 경로 (예: "app.tasks.embed_document")
        queue: 태스크가 전송된 큐 이름
        **kwargs: 추가 시그널 파라미터
    """
    CELERY_TASKS_TOTAL.labels(task_name=task_name, state="sent").inc()


def on_task_prerun(task_id: str, task_name: str, **kwargs: Any) -> None:
    """task_prerun 시그널 핸들러: 태스크 실행 직전에 호출된다.

    Args:
        task_id: Celery 태스크 고유 ID
        task_name: 태스크 모듈 경로
        **kwargs: 추가 시그널 파라미터
    """
    _task_start_times[task_id] = time.perf_counter()
    CELERY_TASKS_TOTAL.labels(task_name=task_name, state="started").inc()


def on_task_postrun(task_id: str, task_name: str, state: str = "SUCCESS", **kwargs: Any) -> None:
    """task_postrun 시그널 핸들러: 태스크 실행 완료 후 호출된다.

    Args:
        task_id: Celery 태스크 고유 ID
        task_name: 태스크 모듈 경로
        state: 태스크 최종 상태 (예: "SUCCESS", "FAILURE")
        **kwargs: 추가 시그널 파라미터
    """
    start_time = _task_start_times.pop(task_id, None)
    if start_time is not None:
        duration = time.perf_counter() - start_time
        CELERY_TASK_DURATION.labels(task_name=task_name).observe(duration)

    normalized_state = state.lower() if state else "unknown"
    CELERY_TASKS_TOTAL.labels(task_name=task_name, state=normalized_state).inc()


def on_task_failure(
    task_id: str,
    task_name: str,
    exception: Exception,
    **kwargs: Any,
) -> None:
    """task_failure 시그널 핸들러: 태스크 실패 시 호출된다.

    Args:
        task_id: Celery 태스크 고유 ID
        task_name: 태스크 모듈 경로
        exception: 발생한 예외 객체
        **kwargs: 추가 시그널 파라미터
    """
    start_time = _task_start_times.pop(task_id, None)
    if start_time is not None:
        duration = time.perf_counter() - start_time
        CELERY_TASK_DURATION.labels(task_name=task_name).observe(duration)

    CELERY_TASKS_TOTAL.labels(task_name=task_name, state="failure").inc()


def set_queue_length(queue_name: str, length: int) -> None:
    """Celery 큐 길이 게이지를 설정한다.

    Args:
        queue_name: 큐 이름
        length: 현재 큐에 있는 태스크 수
    """
    CELERY_QUEUE_LENGTH.labels(queue_name=queue_name).set(length)


# ---------------------------------------------------------------------------
# Celery 시그널 연결 함수
# ---------------------------------------------------------------------------


def connect_celery_signals() -> None:
    """Celery 시그널에 메트릭 핸들러를 연결한다.

    Celery 앱이 초기화된 후에 호출해야 한다.

    # @MX:NOTE: Celery 임포트를 지연하여 Celery 없이도 모듈 임포트 가능하도록 처리
    """
    try:
        from celery.signals import (
            task_failure,
            task_postrun,
            task_prerun,
            task_sent,
        )

        task_sent.connect(on_task_sent)
        task_prerun.connect(on_task_prerun)
        task_postrun.connect(on_task_postrun)
        task_failure.connect(on_task_failure)
    except ImportError:
        # Celery가 설치되지 않은 환경 (테스트 등)에서 무시
        pass


def start_metrics_server(port: int = 9808) -> None:
    """Celery worker용 독립 Prometheus HTTP 서버를 시작한다.

    celery-worker 컨테이너에서 포트 9808로 메트릭을 노출한다.

    Args:
        port: HTTP 서버 포트 번호 (기본값: 9808)
    """
    from prometheus_client import start_http_server

    start_http_server(port)
