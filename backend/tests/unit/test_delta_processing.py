"""델타 처리 (변경 감지) 단위 테스트 (SPEC-PIPELINE-001 REQ-09)

SHA-256 해시를 이용한 변경 문서 감지 및 건너뛰기 로직 테스트.
"""

from __future__ import annotations

import hashlib
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestComputeContentHash:
    """SHA-256 해시 계산 테스트"""

    def test_hash_returns_hex_string(self):
        """해시 계산 결과는 16진수 문자열이어야 함"""
        from app.services.pipeline.orchestrator import compute_content_hash

        result = compute_content_hash(b"hello world")
        assert isinstance(result, str)
        # 16진수 문자로만 구성되어야 함
        int(result, 16)

    def test_hash_length_is_64(self):
        """SHA-256 해시는 64자여야 함"""
        from app.services.pipeline.orchestrator import compute_content_hash

        result = compute_content_hash(b"test data")
        assert len(result) == 64

    def test_hash_matches_standard_sha256(self):
        """계산된 해시가 표준 SHA-256과 일치해야 함"""
        from app.services.pipeline.orchestrator import compute_content_hash

        content = b"insurance policy content"
        expected = hashlib.sha256(content).hexdigest()
        actual = compute_content_hash(content)
        assert actual == expected

    def test_empty_content_hash(self):
        """빈 콘텐츠의 해시도 계산 가능해야 함"""
        from app.services.pipeline.orchestrator import compute_content_hash

        result = compute_content_hash(b"")
        assert len(result) == 64

    def test_large_content_hash(self):
        """대용량 콘텐츠의 해시도 계산 가능해야 함"""
        from app.services.pipeline.orchestrator import compute_content_hash

        large_content = b"A" * 1_000_000  # 1MB
        result = compute_content_hash(large_content)
        assert len(result) == 64


class TestDeltaProcessingOrchestrator:
    """오케스트레이터의 델타 처리 메서드 테스트"""

    def setup_method(self):
        """각 테스트 전 오케스트레이터 초기화"""
        from app.services.pipeline.orchestrator import PipelineOrchestrator

        self.orchestrator = PipelineOrchestrator(db_session=AsyncMock())

    def test_is_content_changed_none_stored_hash(self):
        """저장된 해시가 None이면 변경된 것으로 판단해야 함"""
        result = self.orchestrator.is_content_changed(
            stored_hash=None,
            new_hash="abc123",
        )
        assert result is True

    def test_is_content_changed_different_hashes(self):
        """해시가 다르면 변경된 것으로 판단해야 함"""
        result = self.orchestrator.is_content_changed(
            stored_hash="hash_old",
            new_hash="hash_new",
        )
        assert result is True

    def test_is_content_changed_same_hashes(self):
        """해시가 같으면 변경되지 않은 것으로 판단해야 함"""
        same_hash = "a" * 64
        result = self.orchestrator.is_content_changed(
            stored_hash=same_hash,
            new_hash=same_hash,
        )
        assert result is False

    def test_is_content_changed_empty_stored_hash(self):
        """빈 문자열로 저장된 해시는 변경된 것으로 판단해야 함"""
        result = self.orchestrator.is_content_changed(
            stored_hash="",
            new_hash="new_hash_value",
        )
        assert result is True

    @pytest.mark.asyncio
    async def test_should_skip_document_when_unchanged(self):
        """변경되지 않은 문서는 건너뛰어야 함 (REQ-09)"""
        from app.services.pipeline.orchestrator import compute_content_hash

        content = b"unchanged content"
        content_hash = compute_content_hash(content)

        result = self.orchestrator.is_content_changed(
            stored_hash=content_hash,
            new_hash=content_hash,
        )
        assert result is False  # 건너뜀

    @pytest.mark.asyncio
    async def test_should_process_document_when_changed(self):
        """변경된 문서는 처리해야 함 (REQ-09)"""
        from app.services.pipeline.orchestrator import compute_content_hash

        old_hash = compute_content_hash(b"old content")
        new_hash = compute_content_hash(b"new content")

        result = self.orchestrator.is_content_changed(
            stored_hash=old_hash,
            new_hash=new_hash,
        )
        assert result is True  # 처리함


class TestPipelineStatusModel:
    """PipelineStatus 열거형 테스트"""

    def test_pipeline_status_values(self):
        """PipelineStatus는 필요한 상태값을 모두 포함해야 함"""
        from app.models.pipeline import PipelineStatus

        assert hasattr(PipelineStatus, "PENDING")
        assert hasattr(PipelineStatus, "RUNNING")
        assert hasattr(PipelineStatus, "COMPLETED")
        assert hasattr(PipelineStatus, "FAILED")
        assert hasattr(PipelineStatus, "PARTIAL")

    def test_pipeline_trigger_type_values(self):
        """PipelineTriggerType은 SCHEDULED, MANUAL을 포함해야 함"""
        from app.models.pipeline import PipelineTriggerType

        assert hasattr(PipelineTriggerType, "SCHEDULED")
        assert hasattr(PipelineTriggerType, "MANUAL")

    def test_pipeline_run_model_attributes(self):
        """PipelineRun 모델이 필요한 컬럼을 가져야 함"""
        from app.models.pipeline import PipelineRun

        # 필수 속성 확인 (SQLAlchemy 컬럼)
        assert hasattr(PipelineRun, "id")
        assert hasattr(PipelineRun, "status")
        assert hasattr(PipelineRun, "trigger_type")
        assert hasattr(PipelineRun, "started_at")
        assert hasattr(PipelineRun, "completed_at")
        assert hasattr(PipelineRun, "stats")
        assert hasattr(PipelineRun, "error_details")
