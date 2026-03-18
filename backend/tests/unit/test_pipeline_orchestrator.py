"""파이프라인 오케스트레이터 단위 테스트 (SPEC-PIPELINE-001 REQ-05, REQ-09)

PipelineOrchestrator의 통합 파이프라인 워크플로우 및 델타 처리 로직 테스트.
외부 서비스(DB, Celery, OpenAI)는 모킹으로 대체.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.pipeline.orchestrator import PipelineOrchestrator
from app.models.pipeline import PipelineRun, PipelineStatus, PipelineTriggerType


class TestPipelineOrchestrator:
    """PipelineOrchestrator 기본 테스트"""

    def test_orchestrator_class_exists(self):
        """PipelineOrchestrator 클래스가 존재해야 함"""
        assert PipelineOrchestrator is not None

    def test_orchestrator_instantiation(self):
        """PipelineOrchestrator는 db_session을 받아 생성할 수 있어야 함"""
        mock_session = AsyncMock()
        orchestrator = PipelineOrchestrator(db_session=mock_session)
        assert orchestrator is not None

    @pytest.mark.asyncio
    async def test_start_pipeline_creates_run_record(self):
        """파이프라인 시작 시 PipelineRun 레코드를 생성해야 함 (REQ-05)"""
        mock_session = AsyncMock()
        mock_session.add = MagicMock()
        mock_session.commit = AsyncMock()
        mock_session.refresh = AsyncMock()

        orchestrator = PipelineOrchestrator(db_session=mock_session)
        run = await orchestrator.create_pipeline_run(
            trigger_type=PipelineTriggerType.MANUAL
        )

        assert run is not None
        mock_session.add.assert_called_once()
        mock_session.commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_pipeline_run_initial_status_is_pending(self):
        """새로 생성된 PipelineRun의 초기 상태는 PENDING이어야 함"""
        mock_session = AsyncMock()
        mock_session.add = MagicMock()
        mock_session.commit = AsyncMock()
        mock_session.refresh = AsyncMock()

        orchestrator = PipelineOrchestrator(db_session=mock_session)

        # add() 호출 시 전달된 PipelineRun 객체 캡처
        captured_run = None

        def capture_add(obj):
            nonlocal captured_run
            captured_run = obj

        mock_session.add.side_effect = capture_add

        await orchestrator.create_pipeline_run(trigger_type=PipelineTriggerType.MANUAL)

        assert captured_run is not None
        assert captured_run.status == PipelineStatus.PENDING

    @pytest.mark.asyncio
    async def test_update_pipeline_status(self):
        """파이프라인 상태를 업데이트할 수 있어야 함 (REQ-05)"""
        mock_session = AsyncMock()
        mock_session.commit = AsyncMock()

        orchestrator = PipelineOrchestrator(db_session=mock_session)

        run = PipelineRun(
            id=uuid.uuid4(),
            status=PipelineStatus.PENDING,
            trigger_type=PipelineTriggerType.MANUAL,
        )

        await orchestrator.update_pipeline_status(run, PipelineStatus.RUNNING)

        assert run.status == PipelineStatus.RUNNING
        mock_session.commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_update_step_stats(self):
        """개별 파이프라인 스텝 통계를 업데이트할 수 있어야 함 (REQ-05)"""
        mock_session = AsyncMock()
        mock_session.commit = AsyncMock()

        orchestrator = PipelineOrchestrator(db_session=mock_session)
        run = PipelineRun(
            id=uuid.uuid4(),
            status=PipelineStatus.RUNNING,
            trigger_type=PipelineTriggerType.MANUAL,
            stats={},
        )

        await orchestrator.update_step_stats(
            run=run,
            step_name="crawling",
            processed=10,
            succeeded=8,
            failed=2,
        )

        assert "crawling" in run.stats
        assert run.stats["crawling"]["processed"] == 10
        assert run.stats["crawling"]["succeeded"] == 8
        assert run.stats["crawling"]["failed"] == 2

    @pytest.mark.asyncio
    async def test_record_error(self):
        """파이프라인 오류를 기록할 수 있어야 함 (REQ-05)"""
        mock_session = AsyncMock()
        mock_session.commit = AsyncMock()

        orchestrator = PipelineOrchestrator(db_session=mock_session)
        run = PipelineRun(
            id=uuid.uuid4(),
            status=PipelineStatus.RUNNING,
            trigger_type=PipelineTriggerType.MANUAL,
            error_details=[],
        )

        await orchestrator.record_error(
            run=run,
            step_name="pdf_download",
            error_message="PDF 다운로드 실패",
        )

        assert len(run.error_details) == 1
        assert run.error_details[0]["step"] == "pdf_download"
        assert "PDF 다운로드 실패" in run.error_details[0]["message"]


class TestDeltaProcessing:
    """델타 처리 (변경 감지) 테스트 (REQ-09)"""

    def test_compute_content_hash_returns_sha256(self):
        """콘텐츠 해시는 SHA-256 형식의 64자 문자열을 반환해야 함"""
        from app.services.pipeline.orchestrator import compute_content_hash

        content = b"test content"
        hash_value = compute_content_hash(content)

        assert isinstance(hash_value, str)
        assert len(hash_value) == 64

    def test_compute_content_hash_deterministic(self):
        """동일한 콘텐츠는 항상 같은 해시를 반환해야 함"""
        from app.services.pipeline.orchestrator import compute_content_hash

        content = b"same content"
        hash1 = compute_content_hash(content)
        hash2 = compute_content_hash(content)

        assert hash1 == hash2

    def test_compute_content_hash_different_content(self):
        """다른 콘텐츠는 다른 해시를 반환해야 함"""
        from app.services.pipeline.orchestrator import compute_content_hash

        hash1 = compute_content_hash(b"content A")
        hash2 = compute_content_hash(b"content B")

        assert hash1 != hash2

    @pytest.mark.asyncio
    async def test_is_content_changed_returns_true_when_hash_differs(self):
        """저장된 해시와 다른 경우 변경된 것으로 판단해야 함 (REQ-09)"""
        orchestrator = PipelineOrchestrator(db_session=AsyncMock())
        result = orchestrator.is_content_changed(
            stored_hash="old_hash_abc",
            new_hash="new_hash_xyz",
        )
        assert result is True

    @pytest.mark.asyncio
    async def test_is_content_changed_returns_false_when_hash_same(self):
        """저장된 해시와 같은 경우 변경되지 않은 것으로 판단해야 함 (REQ-09)"""
        orchestrator = PipelineOrchestrator(db_session=AsyncMock())
        result = orchestrator.is_content_changed(
            stored_hash="same_hash_123",
            new_hash="same_hash_123",
        )
        assert result is False

    @pytest.mark.asyncio
    async def test_is_content_changed_returns_true_when_no_stored_hash(self):
        """저장된 해시가 없는 경우 변경된 것으로 판단해야 함 (새 문서)"""
        orchestrator = PipelineOrchestrator(db_session=AsyncMock())
        result = orchestrator.is_content_changed(
            stored_hash=None,
            new_hash="new_hash_xyz",
        )
        assert result is True
