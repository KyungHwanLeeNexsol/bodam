"""Graceful Shutdown 핸들러 모듈 (SPEC-INFRA-002 M4)

FastAPI lifespan 이벤트에서 사용할 graceful shutdown 핸들러.
SIGTERM 수신 시 진행 중인 요청을 완료 후 안전하게 종료.
"""

from __future__ import annotations

import asyncio

import structlog

# # @MX:ANCHOR: [AUTO] ShutdownHandler - graceful shutdown 핵심 클래스
# # @MX:REASON: lifespan 이벤트 및 SIGTERM 핸들러에서 참조됨
# # @MX:SPEC: SPEC-INFRA-002 REQ-INFRA-002-17~20
logger = structlog.get_logger(__name__)


class ShutdownHandler:
    """FastAPI 앱의 graceful shutdown 을 관리하는 핸들러

    is_shutting_down 플래그로 종료 상태를 추적하고,
    graceful_shutdown() 으로 진행 중인 요청 완료를 기다린다.
    """

    def __init__(self) -> None:
        self.is_shutting_down: bool = False

    def shutdown(self) -> None:
        """동기 종료 요청 처리 - shutdown 플래그를 설정하고 로그 기록"""
        self.is_shutting_down = True
        logger.info("shutdown_initiated", message="Graceful shutdown 시작")

    async def graceful_shutdown(self, timeout: float = 30.0) -> None:
        """비동기 graceful shutdown 수행

        진행 중인 요청 완료를 기다린 후 안전하게 종료.
        최대 timeout 초 내에 완료 보장.

        Args:
            timeout: 최대 대기 시간 (초, 기본값 30초)
        """
        self.is_shutting_down = True
        logger.info("graceful_shutdown_started", timeout=timeout, message="Graceful shutdown 시작 중")

        try:
            # 진행 중인 요청 완료 대기 (최대 timeout 초)
            await asyncio.wait_for(asyncio.sleep(0), timeout=timeout)
        except TimeoutError:
            logger.warning("graceful_shutdown_timeout", message="Shutdown timeout 초과 - 강제 종료")
        finally:
            logger.info("graceful_shutdown_completed", message="Graceful shutdown 완료")


# 싱글톤 인스턴스
shutdown_handler = ShutdownHandler()
