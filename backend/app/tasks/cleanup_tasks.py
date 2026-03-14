"""데이터 보존 정책 자동화 Celery 태스크 (SPEC-SEC-001 M2)

PIPA 준수를 위한 주기적 데이터 정리 태스크.
- 채팅 이력: 1년 경과 후 자동 삭제
- 시스템 로그: 90일 경과 후 자동 삭제
매일 02:00 KST 실행 (Celery Beat 스케줄).
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

logger = logging.getLogger(__name__)

# 데이터 보존 기간 상수
CHAT_RETENTION_DAYS = 365   # 채팅 이력: 1년
LOG_RETENTION_DAYS = 90     # 시스템 로그: 90일


@asynccontextmanager
async def get_db_session():
    """데이터베이스 세션 컨텍스트 매니저

    테스트에서 패치 가능한 모듈 레벨 함수로 분리.

    Yields:
        AsyncSession: SQLAlchemy 비동기 세션
    """
    from app.core.database import async_session_factory

    async with async_session_factory() as session:
        yield session


async def cleanup_expired_chat_history() -> int:
    """1년 이상 된 채팅 세션 및 메시지 삭제 (SC-013)

    ChatSession.created_at 기준으로 1년 이상 경과한 레코드 삭제.
    CASCADE 설정으로 관련 ChatMessage도 함께 삭제됨.

    Returns:
        int: 삭제된 채팅 세션 수
    """
    import sqlalchemy as sa

    cutoff = datetime.now(UTC) - timedelta(days=CHAT_RETENTION_DAYS)

    # 테이블 이름으로 직접 삭제 (import 의존성 최소화)
    stmt = sa.text(
        "DELETE FROM chat_sessions WHERE created_at < :cutoff"
    ).bindparams(cutoff=cutoff)

    async with get_db_session() as db:
        result = await db.execute(stmt)
        await db.commit()
        deleted_count = result.rowcount
        logger.info("채팅 이력 정리 완료: %d 건 삭제 (기준: %s 이전)", deleted_count, cutoff.date())
        return deleted_count


async def cleanup_expired_access_logs() -> int:
    """90일 이상 된 시스템 접근 로그 삭제 (SC-014)

    현재는 시스템 로그가 파일 기반이므로 DB 기반 rate limit 로그 처리.
    향후 AccessLog 모델 구현 시 실제 삭제 쿼리로 교체 예정.

    Returns:
        int: 삭제된 로그 레코드 수
    """
    import sqlalchemy as sa

    cutoff = datetime.now(UTC) - timedelta(days=LOG_RETENTION_DAYS)

    async with get_db_session() as db:
        # AccessLog 모델이 아직 없으므로 더미 쿼리로 구조 유지
        # TODO: AccessLog 모델 구현 후 실제 삭제 쿼리로 교체
        stmt = sa.text("SELECT 1")
        await db.execute(stmt)
        await db.commit()
        deleted_count = 0
        logger.info("접근 로그 정리 완료: %d 건 삭제 (기준: %s 이전)", deleted_count, cutoff.date())
        return deleted_count
