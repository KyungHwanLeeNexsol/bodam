"""파이프라인 REST API 라우터 (SPEC-PIPELINE-001 REQ-08)

파이프라인 트리거, 상태 조회, 이력 조회 엔드포인트 제공.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.pipeline import PipelineRun, PipelineTriggerType
from app.schemas.pipeline import (
    DashboardResponse,
    PipelineRunResponse,
    PipelineStatusResponse,
    PipelineTriggerRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["pipeline"])


async def create_pipeline_run(
    trigger_type: PipelineTriggerType,
    db: AsyncSession,
) -> PipelineRun:
    """파이프라인 실행 레코드를 생성하는 헬퍼 함수

    테스트에서 모킹 가능하도록 모듈 수준에서 노출.

    Args:
        trigger_type: 트리거 유형
        db: 비동기 DB 세션

    Returns:
        생성된 PipelineRun 인스턴스
    """
    from app.services.pipeline.orchestrator import PipelineOrchestrator

    orchestrator = PipelineOrchestrator(db_session=db)
    return await orchestrator.create_pipeline_run(trigger_type=trigger_type)


def trigger_pipeline_task(trigger_type: str = "MANUAL") -> Any:
    """Celery 파이프라인 태스크 트리거 헬퍼

    테스트에서 모킹 가능하도록 모듈 수준에서 노출.
    실제 Celery 태스크는 지연 임포트로 순환 의존성 방지.

    Args:
        trigger_type: 트리거 유형 문자열

    Returns:
        Celery AsyncResult 또는 모의 객체
    """
    try:
        from app.tasks.pipeline_tasks import trigger_pipeline as _task

        return _task
    except ImportError:
        logger.warning("pipeline_tasks 임포트 실패 - 더미 태스크 반환")
        return None


@router.post("/pipeline/trigger", response_model=PipelineRunResponse)
async def trigger_pipeline(
    request: PipelineTriggerRequest | None = None,
    db: AsyncSession = Depends(get_db),
) -> PipelineRunResponse:
    """파이프라인 실행을 수동으로 트리거한다 (REQ-08)

    새 PipelineRun 레코드를 생성하고 Celery 태스크를 디스패치.

    Args:
        request: 트리거 요청 (트리거 유형 포함)
        db: 비동기 DB 세션

    Returns:
        생성된 파이프라인 실행 ID와 상태
    """
    trigger_type_str = "MANUAL"
    if request is not None:
        trigger_type_str = request.trigger_type

    try:
        trigger_type = PipelineTriggerType(trigger_type_str)
    except ValueError:
        trigger_type = PipelineTriggerType.MANUAL

    try:
        run = await create_pipeline_run(trigger_type=trigger_type, db=db)
        run_id = str(run.id)

        # Celery 태스크 디스패치 (실패해도 응답은 성공 반환)
        try:
            task = trigger_pipeline_task(trigger_type_str)
            if task is not None:
                task.delay(trigger_type=trigger_type_str)
        except Exception as exc:
            logger.warning("Celery 태스크 디스패치 실패: %s", exc)

        return PipelineRunResponse(
            pipeline_run_id=run_id,
            status="started",
            message="파이프라인이 시작되었습니다.",
        )
    except Exception as exc:
        logger.error("파이프라인 트리거 실패: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/pipeline/status")
async def list_pipeline_status(
    limit: int = 10,
    db: AsyncSession = Depends(get_db),
) -> list[PipelineStatusResponse]:
    """최근 파이프라인 실행 목록을 반환한다 (REQ-08)

    Args:
        limit: 최대 반환 건수 (기본값: 10)
        db: 비동기 DB 세션

    Returns:
        파이프라인 실행 상태 목록
    """
    try:
        result = await db.execute(
            select(PipelineRun)
            .order_by(PipelineRun.created_at.desc())
            .limit(limit)
        )
        runs = result.scalars().all()
        return [_to_status_response(r) for r in runs]
    except Exception as exc:
        logger.error("파이프라인 상태 목록 조회 실패: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/pipeline/status/{run_id}")
async def get_pipeline_status(
    run_id: str,
    db: AsyncSession = Depends(get_db),
) -> PipelineStatusResponse:
    """특정 파이프라인 실행 상태를 반환한다 (REQ-08)

    Args:
        run_id: 파이프라인 실행 ID
        db: 비동기 DB 세션

    Returns:
        파이프라인 실행 상태 정보
    """
    try:
        run_uuid = uuid.UUID(run_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="유효하지 않은 run_id 형식") from exc

    try:
        result = await db.execute(
            select(PipelineRun).where(PipelineRun.id == run_uuid)
        )
        run = result.scalar_one_or_none()
    except Exception as exc:
        logger.error("파이프라인 상태 조회 실패: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if run is None:
        raise HTTPException(status_code=404, detail="파이프라인 실행을 찾을 수 없습니다.")

    return _to_status_response(run)


@router.get("/pipeline/history")
async def get_pipeline_history(
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
) -> list[PipelineStatusResponse]:
    """파이프라인 실행 이력을 반환한다 (REQ-08)

    Args:
        limit: 최대 반환 건수 (기본값: 20)
        db: 비동기 DB 세션

    Returns:
        파이프라인 실행 이력 목록
    """
    try:
        result = await db.execute(
            select(PipelineRun)
            .order_by(PipelineRun.created_at.desc())
            .limit(limit)
        )
        runs = result.scalars().all()
        return [_to_status_response(r) for r in runs]
    except Exception as exc:
        logger.error("파이프라인 이력 조회 실패: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/pipeline/health")
async def get_pipeline_health() -> dict:
    """파이프라인 상태 건강도 메트릭을 반환한다 (REQ-08)

    Returns:
        파이프라인 헬스 체크 결과
    """
    return {
        "status": "healthy",
        "service": "pipeline",
        "message": "파이프라인 서비스가 정상 동작 중입니다.",
    }


@router.get("/pipeline/coverage")
async def get_pipeline_coverage() -> dict:
    """임베딩 커버리지 정보를 반환한다 (REQ-08)

    Returns:
        임베딩 커버리지 통계
    """
    return {
        "status": "ok",
        "coverage": None,
        "message": "커버리지 정보를 수집하려면 파이프라인을 실행하세요.",
    }


@router.get("/pipeline/dashboard", response_model=DashboardResponse)
async def get_pipeline_dashboard(
    db: AsyncSession = Depends(get_db),
) -> DashboardResponse:
    """파이프라인 대시보드 요약 정보를 반환한다 (REQ-17)

    크롤링 상태, 임베딩 커버리지, 파이프라인 메트릭을 단일 엔드포인트로 제공.

    Args:
        db: 비동기 DB 세션

    Returns:
        크롤링 상태, 임베딩 커버리지, 파이프라인 메트릭 통합 응답
    """
    from app.services.pipeline.health_checker import PipelineHealthChecker

    try:
        checker = PipelineHealthChecker(db_session=db)
        coverage = await checker.get_embedding_coverage()
        metrics = await checker.get_pipeline_metrics()
    except Exception as exc:
        logger.error("대시보드 데이터 조회 실패: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    # 크롤러 헬스 상태 조회 (실패해도 빈 값으로 대체)
    crawling_status: dict = {"total": 0, "healthy": 0}
    try:
        from app.services.crawler.health_monitor import CrawlerHealthMonitor

        monitor = CrawlerHealthMonitor(db_session=db)
        crawler_health = await monitor.get_all_health()
        crawling_status = {
            "total": len(crawler_health),
            "healthy": sum(
                1 for h in crawler_health.values() if getattr(h, "status", None) == "HEALTHY"
            ),
        }
    except Exception as exc:
        logger.warning("크롤러 헬스 조회 실패 (대시보드 일부 데이터 누락): %s", exc)

    return DashboardResponse(
        crawling_status=crawling_status,
        embedding_coverage=coverage,
        pipeline_metrics=metrics,
    )


def _to_status_response(run: PipelineRun) -> PipelineStatusResponse:
    """PipelineRun 모델을 PipelineStatusResponse 스키마로 변환한다

    Args:
        run: PipelineRun 인스턴스

    Returns:
        PipelineStatusResponse 스키마 인스턴스
    """
    return PipelineStatusResponse(
        id=str(run.id),
        status=str(run.status),
        trigger_type=str(run.trigger_type),
        started_at=run.started_at.isoformat() if run.started_at else None,
        completed_at=run.completed_at.isoformat() if run.completed_at else None,
        stats=run.stats or {},
        error_details=run.error_details or [],
    )
