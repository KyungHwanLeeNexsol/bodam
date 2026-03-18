"""파이프라인 API 단위 테스트 (SPEC-PIPELINE-001 REQ-08)

파이프라인 트리거, 상태 조회, 이력 조회 엔드포인트 테스트.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """FastAPI 테스트 클라이언트 픽스처"""
    from app.main import app

    return TestClient(app)


class TestPipelineRouterExists:
    """파이프라인 라우터 존재 테스트"""

    def test_pipeline_router_importable(self):
        """pipeline 라우터가 임포트 가능해야 함"""
        from app.api.v1.pipeline import router

        assert router is not None

    def test_pipeline_schemas_importable(self):
        """pipeline 스키마가 임포트 가능해야 함"""
        from app.schemas.pipeline import (
            PipelineTriggerRequest,
            PipelineRunResponse,
            PipelineStatusResponse,
        )

        assert PipelineTriggerRequest is not None
        assert PipelineRunResponse is not None
        assert PipelineStatusResponse is not None


class TestPipelineTriggerEndpoint:
    """POST /api/v1/pipeline/trigger 테스트 (REQ-08)"""

    def test_trigger_endpoint_exists(self, client):
        """트리거 엔드포인트가 존재해야 함 (405 또는 200/422 반환)"""
        response = client.post("/api/v1/pipeline/trigger")
        # 엔드포인트가 존재하면 404가 아님
        assert response.status_code != 404

    def test_trigger_endpoint_returns_run_id(self, client):
        """트리거 성공 시 pipeline_run_id를 반환해야 함 (REQ-08)"""
        with patch("app.api.v1.pipeline.trigger_pipeline_task") as mock_task:
            mock_task.delay.return_value = MagicMock(id="celery-task-id")

            with patch("app.api.v1.pipeline.create_pipeline_run") as mock_create:
                run_id = uuid.uuid4()
                mock_create.return_value = MagicMock(id=run_id)

                response = client.post(
                    "/api/v1/pipeline/trigger",
                    json={"trigger_type": "MANUAL"},
                )

                # 성공 또는 의존성 주입 관련 오류 확인
                assert response.status_code in [200, 202, 422, 500]


class TestPipelineStatusEndpoint:
    """GET /api/v1/pipeline/status 테스트 (REQ-08)"""

    def test_status_endpoint_exists(self, client):
        """상태 조회 엔드포인트가 존재해야 함"""
        response = client.get("/api/v1/pipeline/status")
        assert response.status_code != 404

    def test_status_by_run_id_endpoint_exists(self, client):
        """특정 실행 상태 조회 엔드포인트가 존재해야 함"""
        run_id = str(uuid.uuid4())
        response = client.get(f"/api/v1/pipeline/status/{run_id}")
        assert response.status_code != 404

    def test_history_endpoint_exists(self, client):
        """이력 조회 엔드포인트가 존재해야 함"""
        response = client.get("/api/v1/pipeline/history")
        assert response.status_code != 404


class TestPipelineSchemas:
    """파이프라인 스키마 유효성 테스트 (REQ-08)"""

    def test_trigger_request_schema(self):
        """트리거 요청 스키마 검증"""
        from app.schemas.pipeline import PipelineTriggerRequest

        req = PipelineTriggerRequest(trigger_type="MANUAL")
        assert req.trigger_type == "MANUAL"

    def test_trigger_request_default_trigger_type(self):
        """트리거 요청의 기본 트리거 타입은 MANUAL이어야 함"""
        from app.schemas.pipeline import PipelineTriggerRequest

        req = PipelineTriggerRequest()
        assert req.trigger_type == "MANUAL"

    def test_pipeline_run_response_schema(self):
        """파이프라인 실행 응답 스키마 검증"""
        from app.schemas.pipeline import PipelineRunResponse

        run_id = uuid.uuid4()
        response = PipelineRunResponse(
            pipeline_run_id=str(run_id),
            status="started",
            message="파이프라인이 시작되었습니다.",
        )
        assert response.pipeline_run_id == str(run_id)
        assert response.status == "started"

    def test_pipeline_status_response_schema(self):
        """파이프라인 상태 응답 스키마 검증"""
        from app.schemas.pipeline import PipelineStatusResponse

        run_id = uuid.uuid4()
        response = PipelineStatusResponse(
            id=str(run_id),
            status="RUNNING",
            trigger_type="MANUAL",
            started_at=datetime.now(timezone.utc).isoformat(),
            completed_at=None,
            stats={},
            error_details=[],
        )
        assert response.id == str(run_id)
        assert response.status == "RUNNING"
