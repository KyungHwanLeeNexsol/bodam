"""파이프라인 Celery 태스크 단위 테스트 (SPEC-PIPELINE-001 REQ-06, REQ-07)

Celery chain/chord 기반 파이프라인 태스크와 스케줄링 설정 테스트.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


class TestPipelineTasksModule:
    """파이프라인 태스크 모듈 존재 테스트"""

    def test_pipeline_tasks_module_importable(self):
        """pipeline_tasks 모듈이 임포트 가능해야 함"""
        import app.tasks.pipeline_tasks as pipeline_tasks

        assert pipeline_tasks is not None

    def test_trigger_pipeline_task_exists(self):
        """trigger_pipeline Celery 태스크가 존재해야 함"""
        from app.tasks.pipeline_tasks import TriggerPipelineTask

        assert TriggerPipelineTask is not None

    def test_run_crawling_step_task_exists(self):
        """run_crawling_step 태스크가 존재해야 함"""
        from app.tasks.pipeline_tasks import RunCrawlingStepTask

        assert RunCrawlingStepTask is not None

    def test_run_embedding_step_task_exists(self):
        """run_embedding_step 태스크가 존재해야 함"""
        from app.tasks.pipeline_tasks import RunEmbeddingStepTask

        assert RunEmbeddingStepTask is not None


class TestTriggerPipelineTask:
    """TriggerPipelineTask 테스트"""

    def test_trigger_pipeline_run_returns_run_id(self):
        """trigger_pipeline 실행은 pipeline_run_id를 반환해야 함 (REQ-06)"""
        from app.tasks.pipeline_tasks import TriggerPipelineTask

        task = TriggerPipelineTask()

        with patch("app.tasks.pipeline_tasks._run_async") as mock_run_async:
            mock_run_async.return_value = {
                "pipeline_run_id": "test-uuid-1234",
                "status": "started",
            }
            result = task.run(trigger_type="MANUAL")

        assert "pipeline_run_id" in result
        assert result["status"] == "started"

    def test_trigger_pipeline_run_handles_error(self):
        """trigger_pipeline 실행 실패 시 오류 정보를 반환해야 함"""
        from app.tasks.pipeline_tasks import TriggerPipelineTask

        task = TriggerPipelineTask()

        with patch("app.tasks.pipeline_tasks._run_async") as mock_run_async:
            mock_run_async.side_effect = Exception("DB 연결 실패")
            result = task.run(trigger_type="MANUAL")

        assert result["status"] == "error"
        assert "error" in result


class TestCeleryBeatSchedule:
    """Celery Beat 스케줄 설정 테스트 (REQ-07)"""

    def test_pipeline_weekly_schedule_exists(self):
        """주간 파이프라인 스케줄이 Celery Beat에 등록되어야 함"""
        from app.core.celery_app import celery_app

        beat_schedule = celery_app.conf.beat_schedule
        assert beat_schedule is not None

        # pipeline-run-weekly 스케줄이 존재하는지 확인
        assert "pipeline-run-weekly" in beat_schedule

    def test_pipeline_weekly_schedule_task_name(self):
        """주간 파이프라인 스케줄이 올바른 태스크를 가리켜야 함"""
        from app.core.celery_app import celery_app

        schedule = celery_app.conf.beat_schedule.get("pipeline-run-weekly", {})
        assert schedule.get("task") == "app.tasks.pipeline_tasks.trigger_pipeline"

    def test_pipeline_weekly_schedule_day_and_time(self):
        """주간 파이프라인은 일요일 새벽 2시에 실행되어야 함 (REQ-07)"""
        from celery.schedules import crontab

        from app.core.celery_app import celery_app

        schedule = celery_app.conf.beat_schedule.get("pipeline-run-weekly", {})
        cron = schedule.get("schedule")

        assert isinstance(cron, crontab)
        # 일요일 = 0 (Celery crontab 기준)
        assert "0" in str(cron.day_of_week)
        assert "2" in str(cron.hour)
        assert "0" in str(cron.minute)


class TestRunCrawlingStepTask:
    """크롤링 스텝 태스크 테스트 (REQ-06)"""

    def test_run_crawling_step_accepts_pipeline_run_id(self):
        """크롤링 스텝은 pipeline_run_id를 인자로 받아야 함"""
        from app.tasks.pipeline_tasks import RunCrawlingStepTask

        task = RunCrawlingStepTask()

        with patch("app.tasks.pipeline_tasks._run_async") as mock_run_async:
            mock_run_async.return_value = {
                "pipeline_run_id": "test-uuid",
                "step": "crawling",
                "status": "success",
                "crawled_count": 5,
            }
            result = task.run(pipeline_run_id="test-uuid")

        assert result["step"] == "crawling"
        assert "crawled_count" in result

    def test_run_crawling_step_passes_result_to_next(self):
        """크롤링 스텝 결과는 다음 스텝에 전달할 수 있는 형식이어야 함 (REQ-06)"""
        from app.tasks.pipeline_tasks import RunCrawlingStepTask

        task = RunCrawlingStepTask()

        with patch("app.tasks.pipeline_tasks._run_async") as mock_run_async:
            mock_run_async.return_value = {
                "pipeline_run_id": "test-uuid",
                "step": "crawling",
                "status": "success",
                "crawled_count": 3,
                "pdf_paths": ["/path/a.pdf", "/path/b.pdf", "/path/c.pdf"],
            }
            result = task.run(pipeline_run_id="test-uuid")

        # 다음 스텝에 pipeline_run_id가 포함되어야 함
        assert "pipeline_run_id" in result
        # PDF 경로 목록이 포함되어야 함
        assert "pdf_paths" in result


class TestRunEmbeddingStepTask:
    """임베딩 스텝 태스크 테스트 (REQ-06)"""

    def test_run_embedding_step_accepts_previous_result(self):
        """임베딩 스텝은 이전 스텝 결과를 인자로 받아야 함"""
        from app.tasks.pipeline_tasks import RunEmbeddingStepTask

        task = RunEmbeddingStepTask()

        with patch("app.tasks.pipeline_tasks._run_async") as mock_run_async:
            mock_run_async.return_value = {
                "pipeline_run_id": "test-uuid",
                "step": "embedding",
                "status": "success",
                "embedded_count": 10,
            }
            result = task.run(pipeline_run_id="test-uuid")

        assert result["step"] == "embedding"
        assert "embedded_count" in result
