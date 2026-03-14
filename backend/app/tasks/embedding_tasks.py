"""임베딩 Celery 태스크 모듈 (SPEC-EMBED-001 TASK-009, TASK-010)

bulk_embed_policies(): 여러 보험 상품을 배치로 임베딩하는 Celery 태스크.
Redis 락을 사용한 중복 작업 방지 및 진행률 추적 지원.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import redis as redis_module

logger = logging.getLogger(__name__)

# Redis 키 접두사
_PROGRESS_KEY_PREFIX = "embed_task"
_LOCK_KEY_PREFIX = "embed_lock"

# Redis 락 만료 시간 (초)
_LOCK_EXPIRE_SECONDS = 3600  # 1시간


def get_task_progress_key(task_id: str) -> str:
    """Redis 작업 진행률 키 생성

    Args:
        task_id: Celery 작업 ID

    Returns:
        "embed_task:{task_id}" 형식의 Redis 키
    """
    return f"{_PROGRESS_KEY_PREFIX}:{task_id}"


def get_policy_lock_key(policy_id: str) -> str:
    """정책 임베딩 Redis 락 키 생성

    Args:
        policy_id: 보험 상품 ID

    Returns:
        "embed_lock:{policy_id}" 형식의 Redis 키
    """
    return f"{_LOCK_KEY_PREFIX}:{policy_id}"


def create_initial_progress(total: int) -> dict:
    """초기 작업 진행률 딕셔너리 생성

    Args:
        total: 처리할 전체 정책 수

    Returns:
        진행률 초기값 딕셔너리
    """
    return {
        "status": "started",
        "total": total,
        "completed": 0,
        "failed": 0,
        "skipped": 0,
    }


def is_policy_embedding_in_progress(policy_id: str, redis_client: Any) -> bool:
    """정책 임베딩 작업이 이미 진행 중인지 확인

    Redis NX(Not eXists) 설정을 사용하여 락 획득 시도.
    락 획득 성공 = 진행 중 아님 (False 반환)
    락 획득 실패 = 이미 진행 중 (True 반환)

    Args:
        policy_id: 보험 상품 ID
        redis_client: Redis 클라이언트 인스턴스

    Returns:
        이미 진행 중이면 True, 아니면 False
    """
    lock_key = get_policy_lock_key(policy_id)
    # NX=True: 키가 없을 때만 설정 (원자적 연산)
    result = redis_client.set(lock_key, "1", nx=True, ex=_LOCK_EXPIRE_SECONDS)
    # set()이 True를 반환하면 새로 설정됨(진행 중 아님), None/False면 이미 존재(진행 중)
    return result is not True


def _run_async(coro):
    """비동기 코루틴을 동기 컨텍스트에서 실행하는 헬퍼

    Celery 워커(동기)에서 async 함수를 실행할 때 사용.

    Args:
        coro: 실행할 코루틴

    Returns:
        코루틴의 반환값
    """
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # 이미 실행 중인 이벤트 루프가 있으면 새 루프 생성
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                future = pool.submit(asyncio.run, coro)
                return future.result()
        return loop.run_until_complete(coro)
    except RuntimeError:
        return asyncio.run(coro)


async def _embed_policy_async(
    policy_id: str,
    force: bool,
    settings,
) -> dict:
    """단일 정책 임베딩 비동기 처리 (내부 함수)

    Args:
        policy_id: 보험 상품 ID
        force: True이면 기존 임베딩 무시하고 재처리
        settings: 애플리케이션 설정

    Returns:
        {"status": "success"/"skipped"/"error", "policy_id": str} 딕셔너리
    """
    from sqlalchemy import select

    from app.core.database import get_db
    from app.models.insurance import Policy
    from app.services.parser.document_processor import DocumentProcessor
    from app.services.parser.pdf_parser import PDFParser
    from app.services.parser.text_chunker import TextChunker
    from app.services.parser.text_cleaner import TextCleaner
    from app.services.rag.embeddings import EmbeddingService

    async for session in get_db():
        try:
            # 정책 조회
            result = await session.execute(select(Policy).where(Policy.id == uuid.UUID(policy_id)))
            policy = result.scalar_one_or_none()

            if not policy:
                return {"status": "error", "policy_id": policy_id, "reason": "정책을 찾을 수 없음"}

            if not policy.raw_text:
                return {"status": "skipped", "policy_id": policy_id, "reason": "raw_text 없음"}

            # 기존 청크가 있고 force=False이면 건너뜀
            if not force and policy.chunks:
                return {"status": "skipped", "policy_id": policy_id, "reason": "이미 임베딩됨"}

            # DocumentProcessor로 임베딩 처리
            embedding_service = EmbeddingService(
                api_key=settings.openai_api_key,
                model=settings.embedding_model,
                dimensions=settings.embedding_dimensions,
            )
            processor = DocumentProcessor(
                embedding_service=embedding_service,
                text_chunker=TextChunker(
                    chunk_size=settings.chunk_size_tokens,
                    chunk_overlap=settings.chunk_overlap_tokens,
                ),
                text_cleaner=TextCleaner(),
                pdf_parser=PDFParser(),
            )

            await processor.process_text(policy.raw_text)
            return {"status": "success", "policy_id": policy_id}

        except Exception as e:
            logger.error("정책 %s 임베딩 실패: %s", policy_id, str(e))
            return {"status": "error", "policy_id": policy_id, "reason": str(e)}


# Celery 앱 임포트는 순환 임포트 방지를 위해 지연 임포트
def _get_celery_app():
    from app.core.celery_app import celery_app
    return celery_app


# # @MX:ANCHOR: [AUTO] bulk_embed_policies는 임베딩 파이프라인의 핵심 배치 작업
# # @MX:REASON: Admin API, 스케줄러 등에서 이 태스크를 호출하여 대량 임베딩 처리
class BulkEmbedPoliciesTask:
    """여러 보험 상품 임베딩 Celery 태스크 클래스

    Celery bind=True 형식 대신 클래스 기반으로 구현하여
    테스트에서 더 쉽게 목킹 가능.
    """

    def run(self, policy_ids: list[str], force: bool = False) -> dict:
        """여러 보험 상품을 배치로 임베딩하는 태스크 실행

        각 정책에 대해 Redis 락을 획득하고 DocumentProcessor로 임베딩 처리.
        진행률을 Redis에 저장하고, 완료 후 요약 보고서를 로깅.

        Args:
            policy_ids: 임베딩할 보험 상품 UUID 목록
            force: True이면 기존 임베딩 무시하고 재처리

        Returns:
            {"success_count", "failed_count", "skipped_count", "total_duration"} 딕셔너리
        """
        from app.core.config import get_settings

        settings = get_settings()
        start_time = time.time()

        # 진행률 추적 초기화
        progress = create_initial_progress(len(policy_ids))

        results_summary = {
            "success_count": 0,
            "failed_count": 0,
            "skipped_count": 0,
        }

        for policy_id in policy_ids:
            try:
                result = _run_async(_embed_policy_async(policy_id, force, settings))

                if result["status"] == "success":
                    results_summary["success_count"] += 1
                    progress["completed"] += 1
                elif result["status"] == "skipped":
                    results_summary["skipped_count"] += 1
                    progress["skipped"] = progress.get("skipped", 0) + 1
                else:
                    results_summary["failed_count"] += 1
                    progress["failed"] += 1

            except Exception as e:
                logger.error("정책 %s 처리 중 예외: %s", policy_id, str(e))
                results_summary["failed_count"] += 1
                progress["failed"] += 1

        total_duration = time.time() - start_time
        progress["status"] = "completed"

        # 완료 요약 로깅 (TASK-014)
        logger.info(
            "임베딩 배치 완료: success=%d, failed=%d, skipped=%d, duration=%.2f초",
            results_summary["success_count"],
            results_summary["failed_count"],
            results_summary["skipped_count"],
            total_duration,
        )

        return {
            **results_summary,
            "total_duration": total_duration,
        }


# Celery 태스크로 등록
def _register_task():
    """Celery 앱에 태스크 등록 (지연 등록으로 순환 임포트 방지)"""
    celery_app = _get_celery_app()

    @celery_app.task(
        name="app.tasks.embedding_tasks.bulk_embed_policies",
        bind=False,
        acks_late=True,
        track_started=True,
    )
    def bulk_embed_policies(policy_ids: list[str], force: bool = False) -> dict:
        """여러 보험 상품을 배치로 임베딩하는 Celery 태스크

        Args:
            policy_ids: 임베딩할 보험 상품 UUID 목록
            force: True이면 기존 임베딩 무시하고 재처리

        Returns:
            완료 요약 딕셔너리
        """
        task = BulkEmbedPoliciesTask()
        return task.run(policy_ids=policy_ids, force=force)

    return bulk_embed_policies


bulk_embed_policies = _register_task()
