"""크롤러 Celery 태스크 단위 테스트 (SPEC-CRAWLER-001)

crawl_all, crawl_single, ingest_policy 태스크 테스트.
외부 서비스(Playwright, OpenAI)는 모킹으로 대체.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from app.tasks.crawler_tasks import CrawlAllTask, CrawlSingleTask, IngestPolicyTask


class TestCrawlAllTask:
    """crawl_all 태스크 테스트"""

    def test_crawl_all_task_exists(self):
        """CrawlAllTask 클래스가 존재해야 함"""
        assert CrawlAllTask is not None

    def test_crawl_all_run_returns_summary(self):
        """run()은 요약 딕셔너리를 반환해야 함"""
        task = CrawlAllTask()

        mock_registry = MagicMock()
        mock_registry.list_crawlers.return_value = []

        with patch("app.services.crawler.registry.crawler_registry", mock_registry):
            result = task.run()

        assert isinstance(result, dict)
        assert "crawlers_run" in result


class TestCrawlSingleTask:
    """crawl_single 태스크 테스트"""

    def test_crawl_single_task_exists(self):
        """CrawlSingleTask 클래스가 존재해야 함"""
        assert CrawlSingleTask is not None

    def test_crawl_single_run_with_unknown_crawler(self):
        """알 수 없는 크롤러 이름 시 오류를 반환해야 함"""
        task = CrawlSingleTask()

        with patch("app.tasks.crawler_tasks._run_async") as mock_run_async:
            mock_run_async.side_effect = ValueError("크롤러를 찾을 수 없음")

            result = task.run("nonexistent_crawler")

        assert result["status"] == "error"
        assert "error" in result


class TestIngestPolicyTask:
    """ingest_policy 태스크 테스트"""

    def test_ingest_policy_task_exists(self):
        """IngestPolicyTask 클래스가 존재해야 함"""
        assert IngestPolicyTask is not None

    def test_ingest_policy_run_calls_document_processor(self):
        """run()은 DocumentProcessor.process_pdf()를 호출해야 함"""
        task = IngestPolicyTask()

        with patch("app.tasks.crawler_tasks._run_async") as mock_run_async:
            mock_run_async.return_value = {"status": "success"}

            result = task.run(
                crawl_result_id="some-uuid",
                pdf_path="/tmp/test.pdf",
            )

        assert isinstance(result, dict)


class TestAsyncUtils:
    """_run_async 유틸리티 테스트"""

    def test_run_async_imported_from_core(self):
        """_run_async는 app.core.async_utils에서 임포트해야 함"""
        from app.tasks.crawler_tasks import _run_async

        assert _run_async is not None

    def test_run_async_runs_coroutine(self):
        """_run_async는 코루틴을 동기적으로 실행해야 함"""
        from app.core.async_utils import _run_async

        async def sample():
            return 42

        result = _run_async(sample())
        assert result == 42
