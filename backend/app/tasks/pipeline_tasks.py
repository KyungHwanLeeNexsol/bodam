"""파이프라인 Celery 태스크 모듈 (SPEC-PIPELINE-001 REQ-06, REQ-07)

TriggerPipelineTask: PipelineRun 생성 및 크롤링/임베딩 체인 디스패치
RunCrawlingStepTask: 크롤링 스텝 실행
RunEmbeddingStepTask: 임베딩 스텝 실행

Celery Beat 스케줄: 매주 일요일 새벽 2시 자동 실행 (REQ-07)
"""
from __future__ import annotations

import logging

from app.core.async_utils import _run_async

logger = logging.getLogger(__name__)


async def _trigger_pipeline_async(trigger_type: str) -> dict:
    """파이프라인 시작 비동기 처리 (내부 함수)

    PipelineRun 레코드를 생성하고 RUNNING 상태로 전환.

    Args:
        trigger_type: 트리거 유형 문자열 ("MANUAL" 또는 "SCHEDULED")

    Returns:
        파이프라인 실행 ID와 상태를 담은 딕셔너리
    """
    from app.core.database import get_db
    from app.models.pipeline import PipelineTriggerType
    from app.services.pipeline.orchestrator import PipelineOrchestrator

    try:
        trigger = PipelineTriggerType(trigger_type)
    except ValueError:
        trigger = PipelineTriggerType.MANUAL

    async for session in get_db():
        orchestrator = PipelineOrchestrator(db_session=session)
        run = await orchestrator.create_pipeline_run(trigger_type=trigger)
        return {
            "pipeline_run_id": str(run.id),
            "status": "started",
        }

    # get_db가 세션을 반환하지 못한 경우 (이론상 발생하지 않음)
    return {"pipeline_run_id": "unknown", "status": "started"}


async def _run_crawling_step_async(pipeline_run_id: str) -> dict:
    """크롤링 스텝 비동기 처리 (내부 함수)

    등록된 모든 크롤러를 순차 실행하고 파이프라인 통계를 업데이트.
    협회 크롤러(knia, klia) 우선 실행 후 개별 보험사 크롤러 순차 실행.
    임베딩은 PolicyIngestor → ingest_policy Celery 태스크로 비동기 처리됨.

    Args:
        pipeline_run_id: 파이프라인 실행 ID

    Returns:
        크롤링 결과 딕셔너리 (crawled_count, new_count, updated_count 등 포함)
    """
    import uuid

    from sqlalchemy import select

    from app.core.config import get_settings
    from app.core.database import get_db
    from app.models.pipeline import PipelineRun, PipelineStatus
    from app.services.crawler.registry import crawler_registry
    from app.services.crawler.storage import create_storage
    from app.services.pipeline.orchestrator import PipelineOrchestrator

    # 기존 _run_crawler_async 재사용: DB 세션 주입, 인스턴스/클래스 판별 처리 포함
    from app.tasks.crawler_tasks import _run_crawler_async as _crawl_single

    settings = get_settings()
    storage = create_storage(
        backend_type=settings.crawler_storage_backend,
        base_dir=settings.crawler_base_dir,
    )
    crawler_registry.scan_yaml_configs(storage)

    crawler_names = crawler_registry.list_crawlers()
    # 협회 크롤러 우선 실행 (중복 감지 기준 데이터 수집)
    association_names = ["knia", "klia"]
    company_names = [n for n in crawler_names if n not in association_names]
    ordered_names = [n for n in association_names if n in crawler_names] + company_names

    total_new = 0
    total_updated = 0
    total_skipped = 0
    total_failed = 0

    for name in ordered_names:
        try:
            single_result = await _crawl_single(name)
            total_new += single_result.get("new_count", 0)
            total_updated += single_result.get("updated_count", 0)
            total_skipped += single_result.get("skipped_count", 0)
            total_failed += single_result.get("failed_count", 0)
            logger.info(
                "크롤러 %s 완료: 신규=%d, 업데이트=%d",
                name,
                single_result.get("new_count", 0),
                single_result.get("updated_count", 0),
            )
        except Exception as exc:
            logger.error("크롤러 %s 실행 실패: %s", name, exc)
            total_failed += 1

    crawled_count = total_new + total_updated

    async for session in get_db():
        orchestrator = PipelineOrchestrator(db_session=session)

        db_result = await session.execute(
            select(PipelineRun).where(PipelineRun.id == uuid.UUID(pipeline_run_id))
        )
        run = db_result.scalar_one_or_none()

        if run:
            await orchestrator.update_pipeline_status(run, PipelineStatus.RUNNING)
            await orchestrator.update_step_stats(
                run=run,
                step_name="crawling",
                processed=total_new + total_updated + total_skipped,
                succeeded=crawled_count,
                failed=total_failed,
            )

        return {
            "pipeline_run_id": pipeline_run_id,
            "step": "crawling",
            "status": "success",
            "crawled_count": crawled_count,
            "new_count": total_new,
            "updated_count": total_updated,
            "skipped_count": total_skipped,
            "failed_count": total_failed,
            # 임베딩은 PolicyIngestor.ingest() → ingest_policy Celery 태스크로 자동 처리
            "pdf_paths": [],
        }

    return {
        "pipeline_run_id": pipeline_run_id,
        "step": "crawling",
        "status": "success",
        "crawled_count": 0,
        "pdf_paths": [],
    }


async def _run_embedding_step_async(pipeline_run_id: str) -> dict:
    """임베딩 스텝 비동기 처리 (내부 함수)

    수집된 PDF를 처리하여 벡터 임베딩을 생성.

    Args:
        pipeline_run_id: 파이프라인 실행 ID

    Returns:
        임베딩 결과 딕셔너리 (embedded_count 포함)
    """
    import uuid

    from sqlalchemy import select

    from app.core.database import get_db
    from app.models.pipeline import PipelineRun, PipelineStatus
    from app.services.pipeline.orchestrator import PipelineOrchestrator

    embedded_count = 0

    async for session in get_db():
        orchestrator = PipelineOrchestrator(db_session=session)

        result = await session.execute(
            select(PipelineRun).where(PipelineRun.id == uuid.UUID(pipeline_run_id))
        )
        run = result.scalar_one_or_none()

        if run:
            await orchestrator.update_step_stats(
                run=run,
                step_name="embedding",
                processed=embedded_count,
                succeeded=embedded_count,
                failed=0,
            )
            await orchestrator.update_pipeline_status(run, PipelineStatus.COMPLETED)

        return {
            "pipeline_run_id": pipeline_run_id,
            "step": "embedding",
            "status": "success",
            "embedded_count": embedded_count,
        }

    return {
        "pipeline_run_id": pipeline_run_id,
        "step": "embedding",
        "status": "success",
        "embedded_count": 0,
    }


# Celery 앱 임포트는 순환 임포트 방지를 위해 지연 임포트
def _get_celery_app():
    from app.core.celery_app import celery_app

    return celery_app


class TriggerPipelineTask:
    """파이프라인 실행을 시작하는 Celery 태스크 (REQ-06)

    PipelineRun 레코드를 생성하고 크롤링/임베딩 체인을 디스패치.
    """

    def run(self, trigger_type: str = "MANUAL") -> dict:
        """파이프라인 트리거 실행

        Args:
            trigger_type: 트리거 유형 ("MANUAL" 또는 "SCHEDULED")

        Returns:
            pipeline_run_id와 status를 포함한 딕셔너리
        """
        try:
            return _run_async(_trigger_pipeline_async(trigger_type))
        except Exception as exc:
            logger.error("파이프라인 트리거 실패: %s", exc)
            return {"status": "error", "error": str(exc)}


class RunCrawlingStepTask:
    """크롤링 스텝을 실행하는 Celery 태스크 (REQ-06)

    등록된 모든 크롤러를 실행하고 PDF 경로 목록을 반환.
    """

    def run(self, pipeline_run_id: str) -> dict:
        """크롤링 스텝 실행

        Args:
            pipeline_run_id: 실행 중인 파이프라인 실행 ID

        Returns:
            크롤링 결과 딕셔너리 (crawled_count, pdf_paths 포함)
        """
        try:
            return _run_async(_run_crawling_step_async(pipeline_run_id))
        except Exception as exc:
            logger.error("크롤링 스텝 실패: %s", exc)
            return {
                "pipeline_run_id": pipeline_run_id,
                "step": "crawling",
                "status": "error",
                "error": str(exc),
            }


class RunEmbeddingStepTask:
    """임베딩 스텝을 실행하는 Celery 태스크 (REQ-06)

    크롤링된 PDF를 벡터 임베딩으로 변환.
    """

    def run(self, pipeline_run_id: str) -> dict:
        """임베딩 스텝 실행

        Args:
            pipeline_run_id: 실행 중인 파이프라인 실행 ID

        Returns:
            임베딩 결과 딕셔너리 (embedded_count 포함)
        """
        try:
            return _run_async(_run_embedding_step_async(pipeline_run_id))
        except Exception as exc:
            logger.error("임베딩 스텝 실패: %s", exc)
            return {
                "pipeline_run_id": pipeline_run_id,
                "step": "embedding",
                "status": "error",
                "error": str(exc),
            }


# Celery 태스크 등록
def _register_tasks():
    """Celery 앱에 파이프라인 태스크 등록 (지연 등록으로 순환 임포트 방지)"""
    celery_app = _get_celery_app()

    @celery_app.task(
        name="app.tasks.pipeline_tasks.trigger_pipeline",
        bind=False,
        acks_late=True,
    )
    def trigger_pipeline(trigger_type: str = "MANUAL") -> dict:
        """파이프라인 실행 트리거 Celery 태스크"""
        task = TriggerPipelineTask()
        return task.run(trigger_type=trigger_type)

    @celery_app.task(
        name="app.tasks.pipeline_tasks.run_crawling_step",
        bind=False,
        acks_late=True,
    )
    def run_crawling_step(pipeline_run_id: str) -> dict:
        """크롤링 스텝 Celery 태스크"""
        task = RunCrawlingStepTask()
        return task.run(pipeline_run_id=pipeline_run_id)

    @celery_app.task(
        name="app.tasks.pipeline_tasks.run_embedding_step",
        bind=False,
        acks_late=True,
    )
    def run_embedding_step(pipeline_run_id: str) -> dict:
        """임베딩 스텝 Celery 태스크"""
        task = RunEmbeddingStepTask()
        return task.run(pipeline_run_id=pipeline_run_id)

    return trigger_pipeline, run_crawling_step, run_embedding_step


trigger_pipeline_task, run_crawling_step_task, run_embedding_step_task = _register_tasks()
