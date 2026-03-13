# 데이터베이스 연결 관리 모듈
# SQLAlchemy 비동기 엔진 및 세션 팩토리 설정
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import Settings


async def init_db(settings: Settings):
    """비동기 데이터베이스 엔진과 세션 팩토리를 초기화하고 반환

    Args:
        settings: 애플리케이션 설정 인스턴스

    Returns:
        tuple: (engine, session_factory) 엔진과 세션 팩토리 쌍
    """
    engine = create_async_engine(
        settings.database_url,
        echo=settings.debug,
        # 연결 풀 설정 (프로덕션 최적화)
        pool_pre_ping=True,
    )
    session_factory = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,  # 커밋 후 객체 만료 방지 (detached instance 에러 예방)
    )
    return engine, session_factory
