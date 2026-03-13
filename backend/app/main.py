# FastAPI 애플리케이션 진입점
# 라이프사이클 관리 및 라우터 등록
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.v1.health import router as health_router
from app.core.config import get_settings
from app.core.logging import setup_logging


@asynccontextmanager
async def lifespan(app: FastAPI):
    """애플리케이션 라이프사이클 관리

    startup: 로깅 설정, 데이터베이스 연결 초기화
    shutdown: 데이터베이스 연결 정리
    """
    # 시작 시 설정 및 로깅 초기화
    settings = get_settings()
    setup_logging(debug=settings.debug)

    yield

    # 종료 시 정리 작업 (필요 시 데이터베이스 연결 종료)


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

    return app


# 테스트 환경을 위한 기본 환경변수 설정
# 실제 프로덕션에서는 .env 파일 또는 환경변수를 통해 제공
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost/bodam")
os.environ.setdefault("SECRET_KEY", "change-me-in-production")

app = create_app()
