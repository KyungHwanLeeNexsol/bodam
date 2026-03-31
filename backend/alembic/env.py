# Alembic 마이그레이션 환경 설정
# SQLAlchemy 비동기 엔진을 사용하는 Alembic 환경
import asyncio
import os
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from alembic import context

# Alembic Config 객체 (alembic.ini 값 접근)
config = context.config

# 로깅 설정 초기화
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# 모델 메타데이터 (autogenerate 지원용)
# 모델이 추가되면 아래 주석을 해제하고 Base.metadata로 교체
# from app.models.base import Base
# target_metadata = Base.metadata
target_metadata = None

# 환경변수에서 데이터베이스 URL 가져오기 (alembic.ini 값을 오버라이드)
database_url = os.environ.get("DATABASE_URL", "")
if database_url:
    # asyncpg는 sslmode URL 파라미터를 지원하지 않으므로 제거
    database_url = (
        database_url
        .replace("&sslmode=require", "")
        .replace("?sslmode=require", "")
        .replace("&sslmode=verify-full", "")
        .replace("?sslmode=verify-full", "")
    )
    # postgresql:// → postgresql+asyncpg:// 정규화
    if database_url.startswith("postgresql://"):
        database_url = "postgresql+asyncpg://" + database_url[len("postgresql://"):]
    config.set_main_option("sqlalchemy.url", database_url)


def run_migrations_offline() -> None:
    """오프라인 모드에서 마이그레이션 실행

    URL만으로 컨텍스트를 구성하며, 실제 DB 연결 없이 SQL 스크립트를 생성.
    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    """마이그레이션 실행 (동기 컨텍스트에서 호출)"""
    context.configure(connection=connection, target_metadata=target_metadata)

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """비동기 엔진을 사용하여 온라인 모드에서 마이그레이션 실행"""
    url = config.get_main_option("sqlalchemy.url")

    connectable = create_async_engine(
        url,
        poolclass=pool.NullPool,
        connect_args={
            # DDL 작업(CREATE INDEX 등)이 장시간 소요될 수 있으므로 타임아웃 해제
            "command_timeout": None,
            # PostgreSQL 세션 레벨 statement_timeout도 해제 (Neon 기본 60s 오버라이드)
            "server_settings": {"statement_timeout": "0"},
        },
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """온라인 모드에서 마이그레이션 실행 (비동기 엔진 사용)"""
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
