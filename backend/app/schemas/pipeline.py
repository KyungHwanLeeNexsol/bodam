"""파이프라인 API 스키마 (SPEC-PIPELINE-001 REQ-08)

파이프라인 트리거, 실행 응답, 상태 응답 Pydantic 모델 정의.
"""
from __future__ import annotations

from pydantic import BaseModel


class PipelineTriggerRequest(BaseModel):
    """파이프라인 트리거 요청 스키마"""

    # 트리거 유형 (기본값: MANUAL)
    trigger_type: str = "MANUAL"


class PipelineRunResponse(BaseModel):
    """파이프라인 실행 시작 응답 스키마"""

    # 생성된 파이프라인 실행 ID
    pipeline_run_id: str
    # 실행 상태 (예: "started", "error")
    status: str
    # 사용자 친화적 메시지
    message: str


class PipelineStatusResponse(BaseModel):
    """파이프라인 실행 상태 응답 스키마"""

    # 파이프라인 실행 ID
    id: str
    # 현재 상태
    status: str
    # 트리거 유형
    trigger_type: str
    # 시작 시각 (ISO 8601, 없으면 None)
    started_at: str | None
    # 완료 시각 (ISO 8601, 없으면 None)
    completed_at: str | None
    # 스텝별 통계
    stats: dict
    # 오류 상세 목록
    error_details: list


class DashboardResponse(BaseModel):
    """파이프라인 대시보드 응답 스키마 (REQ-17)

    크롤링 상태, 임베딩 커버리지, 파이프라인 메트릭을 단일 응답으로 제공.
    """

    # 크롤러별 헬스 상태 요약 (total, healthy 카운트 포함)
    crawling_status: dict
    # 임베딩 커버리지 정보 (REQ-14 데이터 포함)
    embedding_coverage: dict
    # 파이프라인 실행 메트릭 (REQ-15 데이터 포함)
    pipeline_metrics: dict
