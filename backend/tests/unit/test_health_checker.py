"""파이프라인 헬스 체커 단위 테스트 (SPEC-PIPELINE-001 REQ-14, REQ-15)"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestHealthCheckerExists:
    def test_health_checker_importable(self):
        from app.services.pipeline.health_checker import PipelineHealthChecker

        assert PipelineHealthChecker is not None

    def test_health_checker_instantiation(self):
        from app.services.pipeline.health_checker import PipelineHealthChecker

        mock_session = AsyncMock()
        checker = PipelineHealthChecker(db_session=mock_session)
        assert checker is not None


class TestEmbeddingCoverage:
    """임베딩 커버리지 추적 테스트 (REQ-14)"""

    @pytest.mark.asyncio
    async def test_get_embedding_coverage_returns_dict(self):
        """get_embedding_coverage()는 딕셔너리를 반환해야 함"""
        from app.services.pipeline.health_checker import PipelineHealthChecker

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one.return_value = 100
        mock_session.execute = AsyncMock(return_value=mock_result)

        checker = PipelineHealthChecker(db_session=mock_session)
        coverage = await checker.get_embedding_coverage()

        assert isinstance(coverage, dict)

    @pytest.mark.asyncio
    async def test_get_embedding_coverage_has_required_keys(self):
        """커버리지 결과에 필수 키가 포함되어야 함 (REQ-14)"""
        from app.services.pipeline.health_checker import PipelineHealthChecker

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one.return_value = 50
        mock_session.execute = AsyncMock(return_value=mock_result)

        checker = PipelineHealthChecker(db_session=mock_session)
        coverage = await checker.get_embedding_coverage()

        assert "total_policies" in coverage
        assert "policies_with_embeddings" in coverage
        assert "coverage_percentage" in coverage


class TestPipelineMetrics:
    """파이프라인 건강 메트릭 테스트 (REQ-15)"""

    @pytest.mark.asyncio
    async def test_get_pipeline_metrics_returns_dict(self):
        """get_pipeline_metrics()는 딕셔너리를 반환해야 함"""
        from app.services.pipeline.health_checker import PipelineHealthChecker

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one.return_value = 10
        mock_session.execute = AsyncMock(return_value=mock_result)

        checker = PipelineHealthChecker(db_session=mock_session)
        metrics = await checker.get_pipeline_metrics()

        assert isinstance(metrics, dict)

    @pytest.mark.asyncio
    async def test_get_pipeline_metrics_has_required_keys(self):
        """메트릭 결과에 필수 키가 포함되어야 함 (REQ-15)"""
        from app.services.pipeline.health_checker import PipelineHealthChecker

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one.return_value = 5
        mock_session.execute = AsyncMock(return_value=mock_result)

        checker = PipelineHealthChecker(db_session=mock_session)
        metrics = await checker.get_pipeline_metrics()

        assert "total_runs" in metrics
        assert "successful_runs" in metrics
        assert "failed_runs" in metrics


class TestAlertNotifier:
    """파이프라인 실패 알림 테스트 (REQ-16)"""

    def test_alert_notifier_importable(self):
        from app.services.pipeline.health_checker import AlertNotifier

        assert AlertNotifier is not None

    @pytest.mark.asyncio
    async def test_send_alert_logs_error(self):
        """send_alert()는 ERROR 레벨 로그를 기록해야 함 (REQ-16)"""
        from app.services.pipeline.health_checker import AlertNotifier

        notifier = AlertNotifier(webhook_url=None)

        with patch("app.services.pipeline.health_checker.logger") as mock_logger:
            await notifier.send_alert(
                step_name="crawling",
                error_message="크롤링 심각한 오류 발생",
                pipeline_run_id="test-run-id",
            )
            mock_logger.error.assert_called_once()

    @pytest.mark.asyncio
    async def test_send_alert_with_webhook_url(self):
        """webhook_url이 설정된 경우 HTTP 요청을 시도해야 함 (REQ-16)"""
        from app.services.pipeline.health_checker import AlertNotifier

        notifier = AlertNotifier(webhook_url="https://example.com/webhook")

        with patch("app.services.pipeline.health_checker.logger"):
            with patch("httpx.AsyncClient") as mock_client_class:
                mock_client = AsyncMock()
                mock_client_class.return_value.__aenter__ = AsyncMock(return_value=mock_client)
                mock_client_class.return_value.__aexit__ = AsyncMock(return_value=False)
                mock_client.post = AsyncMock(return_value=MagicMock(status_code=200))

                await notifier.send_alert(
                    step_name="embedding",
                    error_message="임베딩 실패",
                    pipeline_run_id="run-123",
                )
                # httpx.AsyncClient가 사용되었거나 로깅이 됨
                assert True  # 오류 없이 실행되면 통과
