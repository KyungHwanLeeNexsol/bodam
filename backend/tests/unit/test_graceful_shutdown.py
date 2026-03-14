"""Graceful Shutdown 단위 테스트 (TDD RED Phase)

SPEC-INFRA-002 Milestone 4: Graceful Shutdown
- shutdown 핸들러가 로그 메시지를 기록한다
- shutdown flag 가 설정된다
- shutdown 이 타임아웃 내에 완료된다
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestShutdownHandler:
    """FastAPI lifespan shutdown 핸들러 테스트"""

    def test_shutdown_flag_is_false_initially(self):
        """초기 상태에서 shutdown flag 는 False 이다"""
        from app.core.shutdown import ShutdownHandler

        handler = ShutdownHandler()
        assert handler.is_shutting_down is False

    def test_shutdown_flag_set_on_shutdown(self):
        """shutdown() 호출 시 is_shutting_down flag 가 True 로 설정된다"""
        from app.core.shutdown import ShutdownHandler

        handler = ShutdownHandler()
        handler.shutdown()
        assert handler.is_shutting_down is True

    def test_shutdown_handler_logs_start_message(self):
        """shutdown() 호출 시 시작 로그 메시지가 기록된다"""
        from app.core.shutdown import ShutdownHandler

        handler = ShutdownHandler()
        with patch("app.core.shutdown.logger") as mock_logger:
            handler.shutdown()
            mock_logger.info.assert_called()

    @pytest.mark.asyncio
    async def test_graceful_shutdown_completes_within_timeout(self):
        """graceful_shutdown() 은 지정된 timeout 내에 완료된다"""
        import asyncio

        from app.core.shutdown import ShutdownHandler

        handler = ShutdownHandler()

        # 짧은 timeout으로 완료 확인
        start = asyncio.get_event_loop().time()
        await handler.graceful_shutdown(timeout=0.1)
        elapsed = asyncio.get_event_loop().time() - start

        # timeout보다 크지 않아야 함 (약간의 여유 허용)
        assert elapsed < 1.0

    @pytest.mark.asyncio
    async def test_graceful_shutdown_sets_shutdown_flag(self):
        """graceful_shutdown() 호출 후 is_shutting_down 이 True 이다"""
        from app.core.shutdown import ShutdownHandler

        handler = ShutdownHandler()
        await handler.graceful_shutdown(timeout=0.1)
        assert handler.is_shutting_down is True

    @pytest.mark.asyncio
    async def test_graceful_shutdown_logs_completion(self):
        """graceful_shutdown() 완료 시 완료 로그가 기록된다"""
        from app.core.shutdown import ShutdownHandler

        handler = ShutdownHandler()
        with patch("app.core.shutdown.logger") as mock_logger:
            await handler.graceful_shutdown(timeout=0.1)
            # info 가 최소 2번 호출되어야 함 (시작 + 완료)
            assert mock_logger.info.call_count >= 2
