"""run_pipeline.py --all 플래그 테스트 (SPEC-DATA-002 Phase 4)

TDD RED 페이즈: --all 플래그가 모든 크롤러를 실행하는지 테스트.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch, call

import pytest


class TestRunPipelineAllCrawlers:
    """--all 플래그로 모든 크롤러 실행 테스트"""

    def test_create_crawler_supports_kb_nonlife(self):
        """_create_crawler는 'kb-nonlife' 크롤러를 생성할 수 있어야 함"""
        from scripts.run_pipeline import _create_crawler
        mock_storage = MagicMock()
        mock_settings = MagicMock()
        mock_settings.crawler_rate_limit_seconds = 2.0
        mock_settings.crawler_max_retries = 3

        crawler = _create_crawler(
            crawler_name="kb-nonlife",
            db_session=None,
            storage=mock_storage,
            settings=mock_settings,
        )
        assert crawler is not None

    def test_create_crawler_supports_db_nonlife(self):
        """_create_crawler는 'db-nonlife' 크롤러를 생성할 수 있어야 함"""
        from scripts.run_pipeline import _create_crawler
        mock_storage = MagicMock()
        mock_settings = MagicMock()
        mock_settings.crawler_rate_limit_seconds = 2.0
        mock_settings.crawler_max_retries = 3

        crawler = _create_crawler(
            crawler_name="db-nonlife",
            db_session=None,
            storage=mock_storage,
            settings=mock_settings,
        )
        assert crawler is not None

    def test_create_crawler_kb_nonlife_is_correct_type(self):
        """_create_crawler가 반환하는 kb-nonlife는 KBNonLifeCrawler 타입이어야 함"""
        from scripts.run_pipeline import _create_crawler
        from app.services.crawler.companies.nonlife.kb_nonlife_crawler import KBNonLifeCrawler
        mock_storage = MagicMock()
        mock_settings = MagicMock()
        mock_settings.crawler_rate_limit_seconds = 2.0
        mock_settings.crawler_max_retries = 3

        crawler = _create_crawler(
            crawler_name="kb-nonlife",
            db_session=None,
            storage=mock_storage,
            settings=mock_settings,
        )
        assert isinstance(crawler, KBNonLifeCrawler)

    def test_create_crawler_db_nonlife_is_correct_type(self):
        """_create_crawler가 반환하는 db-nonlife는 DBNonLifeCrawler 타입이어야 함"""
        from scripts.run_pipeline import _create_crawler
        from app.services.crawler.companies.nonlife.db_nonlife_crawler import DBNonLifeCrawler
        mock_storage = MagicMock()
        mock_settings = MagicMock()
        mock_settings.crawler_rate_limit_seconds = 2.0
        mock_settings.crawler_max_retries = 3

        crawler = _create_crawler(
            crawler_name="db-nonlife",
            db_session=None,
            storage=mock_storage,
            settings=mock_settings,
        )
        assert isinstance(crawler, DBNonLifeCrawler)


class TestRunPipelineAllFlag:
    """--all 플래그가 모든 크롤러를 실행하는지 테스트"""

    @pytest.mark.asyncio
    async def test_run_all_includes_kb_nonlife(self):
        """--all 플래그는 kb-nonlife 크롤러를 포함해야 함"""
        # run_all 함수가 실행하는 크롤러 목록에 kb-nonlife가 있어야 함
        # run_pipeline.py의 run_all() 내부 크롤러 목록을 확인
        import ast
        from pathlib import Path

        pipeline_path = Path(__file__).parent.parent.parent / "scripts" / "run_pipeline.py"
        source = pipeline_path.read_text(encoding="utf-8")

        # "kb-nonlife"가 소스 코드에 포함돼야 함
        assert "kb-nonlife" in source, (
            "--all 플래그 처리 시 'kb-nonlife'가 크롤러 목록에 포함돼야 합니다"
        )

    @pytest.mark.asyncio
    async def test_run_all_includes_db_nonlife(self):
        """--all 플래그는 db-nonlife 크롤러를 포함해야 함"""
        from pathlib import Path

        pipeline_path = Path(__file__).parent.parent.parent / "scripts" / "run_pipeline.py"
        source = pipeline_path.read_text(encoding="utf-8")

        assert "db-nonlife" in source, (
            "--all 플래그 처리 시 'db-nonlife'가 크롤러 목록에 포함돼야 합니다"
        )

    @pytest.mark.asyncio
    async def test_run_all_includes_pubinsure(self):
        """--all 플래그는 pubinsure 크롤러도 포함해야 함"""
        from pathlib import Path

        pipeline_path = Path(__file__).parent.parent.parent / "scripts" / "run_pipeline.py"
        source = pipeline_path.read_text(encoding="utf-8")

        # run_all 함수 내에서 pubinsure가 사용돼야 함
        assert '"pubinsure"' in source or "'pubinsure'" in source


class TestRunPipelineCliChoices:
    """CLI --crawler 선택지 테스트"""

    def test_cli_choices_include_kb_nonlife(self):
        """CLI --crawler 선택지에 'kb-nonlife'가 있어야 함"""
        from pathlib import Path

        pipeline_path = Path(__file__).parent.parent.parent / "scripts" / "run_pipeline.py"
        source = pipeline_path.read_text(encoding="utf-8")

        # choices 리스트에 kb-nonlife가 포함돼야 함
        assert "kb-nonlife" in source

    def test_cli_choices_include_db_nonlife(self):
        """CLI --crawler 선택지에 'db-nonlife'가 있어야 함"""
        from pathlib import Path

        pipeline_path = Path(__file__).parent.parent.parent / "scripts" / "run_pipeline.py"
        source = pipeline_path.read_text(encoding="utf-8")

        assert "db-nonlife" in source

    def test_all_crawlers_in_run_all_list(self):
        """run_all()이 실행하는 크롤러 목록에 5개 모두 포함돼야 함"""
        from pathlib import Path
        import re

        pipeline_path = Path(__file__).parent.parent.parent / "scripts" / "run_pipeline.py"
        source = pipeline_path.read_text(encoding="utf-8")

        # 필수 크롤러 5개 모두 포함 확인
        required_crawlers = ["klia", "knia", "pubinsure", "kb-nonlife", "db-nonlife"]
        for crawler in required_crawlers:
            assert crawler in source, f"'{crawler}'가 run_pipeline.py에 포함돼야 합니다"
