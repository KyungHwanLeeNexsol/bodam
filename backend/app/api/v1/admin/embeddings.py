"""임베딩 Admin API (SPEC-EMBED-001 TASK-011, TASK-013)

보험 상품 배치 임베딩 작업 시작, 진행률 조회,
임베딩 상태 점검 및 재생성 엔드포인트.
"""

from __future__ import annotations

import json
import uuid

import redis as redis_module
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.services.rag.embedding_monitor import EmbeddingMonitorService

# # @MX:ANCHOR: [AUTO] 임베딩 Admin 라우터 - 배치 임베딩 및 모니터링 API 진입점
# # @MX:REASON: 배치 임베딩 시작, 진행률 조회, 상태 점검을 제공하는 공개 Admin API

router = APIRouter(tags=["embeddings"])


# ─────────────────────────────────────────────
# Pydantic 스키마
# ─────────────────────────────────────────────


class BatchEmbedRequest(BaseModel):
    """배치 임베딩 시작 요청 스키마"""

    policy_ids: list[uuid.UUID] = Field(..., min_length=1, description="임베딩할 보험 상품 UUID 목록")
    force: bool = Field(False, description="기존 임베딩 무시하고 재처리 여부")


class BatchEmbedResponse(BaseModel):
    """배치 임베딩 시작 응답 스키마"""

    task_id: str = Field(..., description="Celery 작업 ID")
    status: str = Field(..., description="작업 상태 (accepted)")
    policy_count: int = Field(..., description="처리할 정책 수")


class TaskProgressResponse(BaseModel):
    """작업 진행률 조회 응답 스키마"""

    task_id: str = Field(..., description="Celery 작업 ID")
    status: str = Field(..., description="작업 상태")
    total: int = Field(..., description="전체 정책 수")
    completed: int = Field(..., description="완료된 정책 수")
    failed: int = Field(..., description="실패한 정책 수")


class EmbeddingHealthResponse(BaseModel):
    """임베딩 상태 점검 응답 스키마"""

    total_chunks: int = Field(..., description="전체 청크 수")
    embedded_chunks: int = Field(..., description="임베딩된 청크 수")
    missing_chunks: int = Field(..., description="임베딩 누락 청크 수")
    coverage_rate: float = Field(..., description="임베딩 커버리지 비율 (0.0~1.0)")


class RegenerateRequest(BaseModel):
    """임베딩 재생성 요청 스키마"""

    chunk_ids: list[uuid.UUID] = Field(..., min_length=1, description="재생성할 청크 UUID 목록")


class RegenerateResponse(BaseModel):
    """임베딩 재생성 응답 스키마"""

    task_id: str = Field(..., description="재생성 작업 ID")
    chunk_count: int = Field(..., description="재생성 대상 청크 수")
    status: str = Field(..., description="작업 상태")


# ─────────────────────────────────────────────
# 의존성
# ─────────────────────────────────────────────


def get_redis_client(settings: Settings = Depends(get_settings)) -> redis_module.Redis:
    """Redis 클라이언트 의존성

    Args:
        settings: 애플리케이션 설정

    Returns:
        Redis 클라이언트 인스턴스
    """
    return redis_module.from_url(settings.redis_url, decode_responses=True)


# ─────────────────────────────────────────────
# 엔드포인트
# ─────────────────────────────────────────────


@router.post(
    "/batch",
    response_model=BatchEmbedResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="배치 임베딩 작업 시작",
)
async def start_batch_embedding(
    request: BatchEmbedRequest,
    settings: Settings = Depends(get_settings),
) -> BatchEmbedResponse:
    """보험 상품 배치 임베딩 Celery 작업 시작

    지정된 보험 상품 목록에 대해 임베딩 파이프라인을 비동기로 실행.
    202 Accepted와 함께 task_id를 반환하며, 진행률은 GET /batch/{task_id}로 조회.

    Args:
        request: 배치 임베딩 요청 (policy_ids, force)

    Returns:
        202 응답과 task_id
    """
    from app.tasks.embedding_tasks import bulk_embed_policies

    policy_id_strs = [str(pid) for pid in request.policy_ids]

    # Celery 작업 비동기 실행
    task = bulk_embed_policies.apply_async(
        kwargs={"policy_ids": policy_id_strs, "force": request.force}
    )

    return BatchEmbedResponse(
        task_id=task.id,
        status="accepted",
        policy_count=len(request.policy_ids),
    )


@router.get(
    "/batch/{task_id}",
    response_model=TaskProgressResponse,
    summary="배치 임베딩 진행률 조회",
)
async def get_batch_progress(
    task_id: str,
    redis_client: redis_module.Redis = Depends(get_redis_client),
) -> TaskProgressResponse:
    """Celery 작업 진행률을 Redis에서 조회

    Args:
        task_id: 배치 임베딩 작업 ID

    Returns:
        작업 상태 및 진행률 정보

    Raises:
        404: 작업을 찾을 수 없는 경우
    """
    from app.tasks.embedding_tasks import get_task_progress_key

    progress_key = get_task_progress_key(task_id)
    progress_data = redis_client.get(progress_key)

    if not progress_data:
        # Celery 작업 상태 직접 조회
        from celery.result import AsyncResult

        from app.core.celery_app import celery_app

        result = AsyncResult(task_id, app=celery_app)
        if result.state == "PENDING":
            return TaskProgressResponse(
                task_id=task_id,
                status="pending",
                total=0,
                completed=0,
                failed=0,
            )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"작업 {task_id}를 찾을 수 없습니다",
        )

    progress = json.loads(progress_data)
    return TaskProgressResponse(
        task_id=task_id,
        status=progress.get("status", "unknown"),
        total=progress.get("total", 0),
        completed=progress.get("completed", 0),
        failed=progress.get("failed", 0),
    )


@router.get(
    "/health",
    response_model=EmbeddingHealthResponse,
    summary="임베딩 상태 점검",
)
async def get_embedding_health(
    settings: Settings = Depends(get_settings),
) -> EmbeddingHealthResponse:
    """전체 정책 청크의 임베딩 상태 통계 조회

    임베딩이 누락된 청크 수와 커버리지 비율을 반환.

    Returns:
        임베딩 상태 통계
    """
    async for session in get_db():
        monitor = EmbeddingMonitorService(session=session)
        stats = await monitor.get_embedding_stats()
        return EmbeddingHealthResponse(**stats)

    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="DB 연결 실패")


@router.post(
    "/regenerate",
    response_model=RegenerateResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="청크 임베딩 재생성",
)
async def regenerate_embeddings(
    request: RegenerateRequest,
    settings: Settings = Depends(get_settings),
) -> RegenerateResponse:
    """지정된 청크의 임베딩을 재생성

    임베딩이 누락되거나 손상된 청크에 대해 재임베딩 수행.

    Args:
        request: 재생성 요청 (chunk_ids)

    Returns:
        재생성 작업 정보
    """
    chunk_id_strs = [str(cid) for cid in request.chunk_ids]

    async for session in get_db():
        monitor = EmbeddingMonitorService(session=session)
        task_id = await monitor.regenerate_missing(chunk_id_strs)
        return RegenerateResponse(
            task_id=task_id,
            chunk_count=len(request.chunk_ids),
            status="accepted",
        )

    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="DB 연결 실패")
