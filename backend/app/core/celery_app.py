"""Celery 애플리케이션 설정 모듈 (SPEC-EMBED-001 TASK-008)

Redis를 브로커로 사용하는 Celery 앱 설정.
acks_late=True로 작업 완료 후 ACK 처리.
"""

from __future__ import annotations

from celery import Celery

from app.core.config import get_settings


def create_celery_app() -> Celery:
    """Celery 애플리케이션 인스턴스 생성 및 설정

    Settings.redis_url을 브로커 및 결과 백엔드로 사용.
    작업 직렬화는 JSON, 늦은 ACK, 시작 추적 활성화.

    Returns:
        설정된 Celery 애플리케이션 인스턴스
    """
    settings = get_settings()

    app = Celery(
        "bodam",
        broker=settings.redis_url,
        backend=settings.redis_url,
    )

    app.conf.update(
        # 직렬화 설정
        task_serializer="json",
        accept_content=["json"],
        result_serializer="json",
        # 신뢰성 설정: 작업 완료 후 ACK (실패 시 재시도 가능)
        task_acks_late=True,
        # 작업 시작 상태 추적 활성화
        task_track_started=True,
        # 타임존 설정
        timezone="Asia/Seoul",
        enable_utc=True,
        # 작업 결과 만료 시간 (24시간)
        result_expires=86400,
        # 태스크 모듈 명시적 포함 (autodiscover_tasks는 기본적으로 tasks.py만 탐색)
        include=[
            "app.tasks.crawler_tasks",
            "app.tasks.embedding_tasks",
            "app.tasks.cleanup_tasks",
        ],
    )

    # 작업 모듈 자동 탐색
    app.autodiscover_tasks(["app.tasks"])

    # Celery Beat 주기적 태스크 스케줄 설정
    from celery.schedules import crontab

    app.conf.beat_schedule = {
        # 매주 일요일 새벽 2시에 전체 크롤링 실행
        "crawl-all-weekly": {
            "task": "app.tasks.crawler_tasks.crawl_all",
            "schedule": crontab(day_of_week=0, hour=2, minute=0),
        },
    }

    return app


# # @MX:ANCHOR: [AUTO] Celery 앱 싱글톤 인스턴스 - 모든 작업 정의에서 참조
# # @MX:REASON: embedding_tasks, 기타 Celery 작업 모듈이 이 인스턴스를 사용함
celery_app = create_celery_app()
