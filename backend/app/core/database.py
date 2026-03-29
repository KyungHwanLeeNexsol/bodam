"""데이터베이스 연결 관리 모듈

SQLAlchemy 비동기 엔진 및 세션 팩토리 설정.
모듈 레벨 싱글턴 패턴으로 앱 전역에서 공유.
FastAPI 의존성 주입용 get_db() 제너레이터 포함.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import TYPE_CHECKING

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import Settings

if TYPE_CHECKING:
    pass


def _normalize_url(database_url: str) -> str:
    """DATABASE_URL을 postgresql+asyncpg:// 형식으로 정규화.

    다양한 URL 형식 지원:
    - postgresql://...          → postgresql+asyncpg://...
    - postgresql+asyncpg://...  → 그대로 유지
    - sslmode 파라미터 제거 (asyncpg는 connect_args로 처리)
    """
    # sslmode 파라미터 제거 (asyncpg는 URL 파라미터로 sslmode를 지원하지 않음)
    url = (
        database_url
        .replace("&sslmode=require", "")
        .replace("?sslmode=require", "")
        .replace("&sslmode=verify-full", "")
        .replace("?sslmode=verify-full", "")
    )
    # postgres:// 또는 postgresql:// → postgresql+asyncpg://
    if url.startswith("postgresql://"):
        url = "postgresql+asyncpg://" + url[len("postgresql://"):]
    elif url.startswith("postgres://"):
        url = "postgresql+asyncpg://" + url[len("postgres://"):]
    return url


# ─────────────────────────────────────────────
# 모듈 레벨 싱글턴 (앱 시작 시 init_database()로 초기화)
# ─────────────────────────────────────────────

# 비동기 DB 엔진 인스턴스 (None: 미초기화)
engine: AsyncEngine | None = None

# 비동기 세션 팩토리 (None: 미초기화)
session_factory: async_sessionmaker[AsyncSession] | None = None


async def init_database(settings: Settings) -> None:
    """모듈 레벨 engine, session_factory를 초기화 (앱 시작 시 호출)

    Args:
        settings: 애플리케이션 설정 인스턴스
    """
    global engine, session_factory

    clean_url = _normalize_url(settings.database_url)
    engine = create_async_engine(
        clean_url,
        echo=settings.debug,
        pool_pre_ping=True,  # 유효하지 않은 연결 자동 재연결
        pool_size=10,  # 표준 PostgreSQL: 연결 풀 확대
        max_overflow=20,
        connect_args={"ssl": "require"},  # Neon DB SSL 필수
    )

    session_factory = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,  # 커밋 후 객체 만료 방지 (detached instance 에러 예방)
    )


async def get_db() -> AsyncGenerator[AsyncSession]:
    """FastAPI 의존성 주입용 DB 세션 제너레이터

    트랜잭션 자동 관리:
    - 정상 종료 시 commit
    - 예외 발생 시 rollback

    Yields:
        AsyncSession: 현재 요청에 사용할 DB 세션

    Raises:
        RuntimeError: init_database()가 호출되지 않은 경우
    """
    if session_factory is None:
        raise RuntimeError("데이터베이스가 초기화되지 않았습니다. init_database()를 먼저 호출하세요.")

    async with session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_db(settings: Settings) -> tuple[AsyncEngine, async_sessionmaker[AsyncSession]]:
    """비동기 데이터베이스 엔진과 세션 팩토리를 초기화하고 반환 (하위 호환성 유지)

    Args:
        settings: 애플리케이션 설정 인스턴스

    Returns:
        tuple: (engine, session_factory) 엔진과 세션 팩토리 쌍
    """
    _engine = create_async_engine(
        settings.database_url,
        echo=settings.debug,
        pool_pre_ping=True,
    )
    _session_factory = async_sessionmaker(
        _engine,
        class_=AsyncSession,
        expire_on_commit=False,  # 커밋 후 객체 만료 방지 (detached instance 에러 예방)
    )
    return _engine, _session_factory
