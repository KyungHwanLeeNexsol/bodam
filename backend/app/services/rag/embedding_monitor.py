"""임베딩 모니터링 서비스 모듈 (SPEC-EMBED-001 TASK-012)

PolicyChunk 테이블의 임베딩 상태를 모니터링하고,
누락된 임베딩을 감지하여 재생성을 트리거하는 서비스.
"""

from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import func, select

from app.models.insurance import PolicyChunk

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


class EmbeddingMonitorService:
    """PolicyChunk 임베딩 상태 모니터링 서비스

    전체 임베딩 현황 조회, 누락 청크 탐색, 재생성 트리거 기능 제공.
    """

    # # @MX:ANCHOR: [AUTO] EmbeddingMonitorService는 임베딩 품질 관리의 진입점
    # # @MX:REASON: Admin API의 /health, /regenerate 엔드포인트에서 호출됨

    def __init__(self, session: AsyncSession) -> None:
        """EmbeddingMonitorService 초기화

        Args:
            session: SQLAlchemy 비동기 세션
        """
        self._session = session

    async def get_missing_embeddings(self) -> list[uuid.UUID]:
        """임베딩이 NULL인 PolicyChunk ID 목록 조회

        Returns:
            임베딩이 누락된 청크 UUID 목록
        """
        stmt = select(PolicyChunk.id).where(PolicyChunk.embedding.is_(None))
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def get_embedding_stats(self) -> dict:
        """전체 임베딩 통계 조회

        전체 청크 수, 임베딩된 청크 수, 누락 청크 수, 커버리지 비율 반환.

        Returns:
            {"total_chunks", "embedded_chunks", "missing_chunks", "coverage_rate"} 딕셔너리
        """
        # 전체 청크 수
        total_stmt = select(func.count(PolicyChunk.id))
        total_result = await self._session.execute(total_stmt)
        total_chunks = total_result.scalar_one_or_none() or 0

        # 임베딩된 청크 수
        embedded_stmt = select(func.count(PolicyChunk.id)).where(
            PolicyChunk.embedding.is_not(None)
        )
        embedded_result = await self._session.execute(embedded_stmt)
        embedded_chunks = embedded_result.scalar_one_or_none() or 0

        missing_chunks = total_chunks - embedded_chunks
        coverage_rate = (embedded_chunks / total_chunks) if total_chunks > 0 else 0.0

        return {
            "total_chunks": total_chunks,
            "embedded_chunks": embedded_chunks,
            "missing_chunks": missing_chunks,
            "coverage_rate": coverage_rate,
        }

    async def regenerate_missing(self, chunk_ids: list[str]) -> str:
        """지정된 청크의 임베딩 재생성 트리거

        Celery 배치 임베딩 태스크를 실행하여 지정된 청크의 임베딩을 재생성.
        실제 구현에서는 청크 ID로 해당 정책을 찾아 재임베딩.

        Args:
            chunk_ids: 재생성할 청크 UUID 문자열 목록

        Returns:
            Celery 작업 ID 문자열
        """
        from app.tasks.embedding_tasks import bulk_embed_policies

        # 청크 ID에서 고유한 policy_id 추출
        policy_ids = await self._get_policy_ids_for_chunks(chunk_ids)

        if not policy_ids:
            # 빈 경우 더미 task_id 반환
            return str(uuid.uuid4())

        # Celery 배치 임베딩 태스크 실행 (force=True로 재임베딩)
        task = bulk_embed_policies.apply_async(
            kwargs={"policy_ids": policy_ids, "force": True}
        )
        return task.id

    async def _get_policy_ids_for_chunks(self, chunk_ids: list[str]) -> list[str]:
        """청크 ID 목록에서 고유한 policy_id 추출 (내부 메서드)

        Args:
            chunk_ids: 청크 UUID 문자열 목록

        Returns:
            고유한 policy_id 문자열 목록
        """
        if not chunk_ids:
            return []

        try:
            uuid_list = [uuid.UUID(cid) for cid in chunk_ids]
        except ValueError:
            logger.warning("유효하지 않은 청크 ID가 포함되어 있습니다")
            return []

        stmt = (
            select(PolicyChunk.policy_id)
            .where(PolicyChunk.id.in_(uuid_list))
            .distinct()
        )
        result = await self._session.execute(stmt)
        return [str(pid) for pid in result.scalars().all()]
