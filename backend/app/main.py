# FastAPI 애플리케이션 진입점
# 라이프사이클 관리 및 라우터 등록
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.v1.admin import admin_router
from app.api.v1.health import router as health_router
from app.api.v1.search import router as search_router
from app.core.config import get_settings
from app.core.database import init_database
from app.core.logging import setup_logging


@asynccontextmanager
async def lifespan(app: FastAPI):
    """애플리케이션 라이프사이클 관리

    startup: 로깅 설정, 데이터베이스 연결 초기화
    shutdown: 데이터베이스 엔진 정리
    """
    # 시작 시 설정 및 로깅 초기화
    settings = get_settings()
    setup_logging(debug=settings.debug)

    # 데이터베이스 엔진 및 세션 팩토리 초기화
    await init_database(settings)

    yield

    # 종료 시 DB 엔진 리소스 정리
    import app.core.database as db_module

    if db_module.engine is not None:
        await db_module.engine.dispose()


def create_app() -> FastAPI:
    """FastAPI 애플리케이션 인스턴스 생성 및 설정

    Returns:
        FastAPI: 설정된 애플리케이션 인스턴스
    """
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        lifespan=lifespan,
    )

    # API v1 라우터 등록
    app.include_router(health_router, prefix="/api/v1")
    app.include_router(search_router, prefix="/api/v1")
    app.include_router(admin_router, prefix="/api/v1/admin")

    return app


# 테스트 환경을 위한 기본 환경변수 설정
# 실제 프로덕션에서는 .env 파일 또는 환경변수를 통해 제공
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost/bodam")
os.environ.setdefault("SECRET_KEY", "change-me-in-production")

app = create_app()
