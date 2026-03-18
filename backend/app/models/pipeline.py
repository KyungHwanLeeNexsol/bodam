"""파이프라인 도메인 SQLAlchemy 모델 (SPEC-PIPELINE-001 REQ-05)

PipelineRun 모델과 PipelineStatus, PipelineTriggerType 열거형 정의.
"""
from __future__ import annotations

import uuid
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class PipelineStatus(StrEnum):
    """파이프라인 실행 상태 열거형"""

    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    PARTIAL = "PARTIAL"


class PipelineTriggerType(StrEnum):
    """파이프라인 트리거 유형 열거형"""

    SCHEDULED = "SCHEDULED"
    MANUAL = "MANUAL"


class PipelineRun(Base, TimestampMixin):
    """파이프라인 실행 이력 모델

    파이프라인 실행마다 하나의 레코드가 생성되어 상태, 통계, 오류 정보를 기록.
    """

    __tablename__ = "pipeline_runs"

    # 파이프라인 실행 고유 식별자
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # 현재 실행 상태
    status: Mapped[PipelineStatus] = mapped_column(
        sa.Enum(PipelineStatus, name="pipelinestatus"),
        nullable=False,
        default=PipelineStatus.PENDING,
    )
    # 파이프라인 트리거 유형 (수동/스케줄)
    trigger_type: Mapped[PipelineTriggerType] = mapped_column(
        sa.Enum(PipelineTriggerType, name="pipelinetriggertype"),
        nullable=False,
    )
    # 실행 시작 시각
    started_at: Mapped[sa.DateTime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    # 실행 완료 시각
    completed_at: Mapped[sa.DateTime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    # 스텝별 처리 통계 (예: {"crawling": {"processed": 10, "succeeded": 8, "failed": 2}})
    stats: Mapped[dict | None] = mapped_column(JSONB, nullable=True, default=dict)
    # 오류 상세 목록 (예: [{"step": "crawling", "message": "...", "timestamp": "..."}])
    error_details: Mapped[list | None] = mapped_column(JSONB, nullable=True, default=list)
