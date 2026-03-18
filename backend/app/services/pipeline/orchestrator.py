"""파이프라인 오케스트레이터 모듈 (SPEC-PIPELINE-001 REQ-05, REQ-09)

PipelineRun 생성/업데이트 및 델타 처리(변경 감지) 로직 제공.
DB 세션을 주입받아 파이프라인 실행 이력을 관리.
"""
from __future__ import annotations

import hashlib
import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.pipeline import PipelineRun, PipelineStatus, PipelineTriggerType

logger = logging.getLogger(__name__)


def compute_content_hash(content: bytes) -> str:
    """바이트 콘텐츠의 SHA-256 해시를 계산한다 (REQ-09)

    변경 감지를 위한 콘텐츠 지문 생성에 사용.

    Args:
        content: 해시를 계산할 바이트 데이터

    Returns:
        64자 SHA-256 16진수 다이제스트 문자열
    """
    return hashlib.sha256(content).hexdigest()


class PipelineOrchestrator:
    """파이프라인 실행 이력 관리 오케스트레이터 (REQ-05)

    PipelineRun 레코드의 생성, 상태 전환, 통계 업데이트, 오류 기록을 담당.
    모든 DB 작업은 주입된 AsyncSession을 통해 수행.
    """

    def __init__(self, db_session: AsyncSession) -> None:
        """오케스트레이터 초기화

        Args:
            db_session: 비동기 SQLAlchemy 세션
        """
        self._session = db_session

    async def create_pipeline_run(
        self, trigger_type: PipelineTriggerType
    ) -> PipelineRun:
        """새 PipelineRun 레코드를 생성하고 PENDING 상태로 저장한다 (REQ-05)

        Args:
            trigger_type: 파이프라인 트리거 유형 (MANUAL 또는 SCHEDULED)

        Returns:
            저장된 PipelineRun 인스턴스
        """
        run = PipelineRun(
            status=PipelineStatus.PENDING,
            trigger_type=trigger_type,
            stats={},
            error_details=[],
        )
        self._session.add(run)
        await self._session.commit()
        await self._session.refresh(run)
        logger.info("파이프라인 실행 레코드 생성: id=%s, trigger=%s", run.id, trigger_type)
        return run

    async def update_pipeline_status(
        self, run: PipelineRun, status: PipelineStatus
    ) -> None:
        """파이프라인 실행 상태를 업데이트한다 (REQ-05)

        RUNNING 전환 시 started_at, COMPLETED/FAILED/PARTIAL 전환 시 completed_at을 기록.

        Args:
            run: 업데이트할 PipelineRun 인스턴스
            status: 새 상태값
        """
        run.status = status
        now = datetime.now(UTC)

        if status == PipelineStatus.RUNNING:
            run.started_at = now
        elif status in (
            PipelineStatus.COMPLETED,
            PipelineStatus.FAILED,
            PipelineStatus.PARTIAL,
        ):
            run.completed_at = now

        await self._session.commit()
        logger.info("파이프라인 상태 변경: id=%s → %s", run.id, status)

    async def update_step_stats(
        self,
        run: PipelineRun,
        step_name: str,
        processed: int,
        succeeded: int,
        failed: int,
    ) -> None:
        """파이프라인 스텝 처리 통계를 업데이트한다 (REQ-05)

        Args:
            run: 업데이트할 PipelineRun 인스턴스
            step_name: 스텝 이름 (예: "crawling", "embedding")
            processed: 처리 시도 건수
            succeeded: 성공 건수
            failed: 실패 건수
        """
        if run.stats is None:
            run.stats = {}

        # SQLAlchemy JSONB 변경 감지를 위해 딕셔너리 복사 후 재할당
        updated_stats: dict[str, Any] = dict(run.stats)
        updated_stats[step_name] = {
            "processed": processed,
            "succeeded": succeeded,
            "failed": failed,
        }
        run.stats = updated_stats

        await self._session.commit()
        logger.debug(
            "스텝 통계 업데이트: id=%s, step=%s, processed=%d, succeeded=%d, failed=%d",
            run.id,
            step_name,
            processed,
            succeeded,
            failed,
        )

    async def record_error(
        self,
        run: PipelineRun,
        step_name: str,
        error_message: str,
    ) -> None:
        """파이프라인 실행 오류를 기록한다 (REQ-05)

        Args:
            run: 업데이트할 PipelineRun 인스턴스
            step_name: 오류가 발생한 스텝 이름
            error_message: 오류 메시지
        """
        if run.error_details is None:
            run.error_details = []

        # SQLAlchemy JSONB 변경 감지를 위해 리스트 복사 후 재할당
        updated_errors: list[dict[str, Any]] = list(run.error_details)
        updated_errors.append(
            {
                "step": step_name,
                "message": error_message,
                "timestamp": datetime.now(UTC).isoformat(),
            }
        )
        run.error_details = updated_errors

        await self._session.commit()
        logger.warning("파이프라인 오류 기록: id=%s, step=%s, error=%s", run.id, step_name, error_message)

    def is_content_changed(
        self, stored_hash: str | None, new_hash: str
    ) -> bool:
        """저장된 해시와 새 해시를 비교하여 콘텐츠 변경 여부를 반환한다 (REQ-09)

        None이거나 빈 문자열인 stored_hash는 항상 변경된 것으로 처리.

        Args:
            stored_hash: 기존에 저장된 해시값 (없으면 None 또는 빈 문자열)
            new_hash: 새로 계산한 해시값

        Returns:
            True이면 변경됨, False이면 동일함
        """
        if not stored_hash:
            return True
        return stored_hash != new_hash
