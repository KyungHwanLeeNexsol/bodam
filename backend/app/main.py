# FastAPI 애플리케이션 진입점
# 라이프사이클 관리 및 라우터 등록
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.admin import admin_router
from app.api.v1.auth import router as auth_router
from app.api.v1.b2b.api_keys import router as b2b_api_keys_router
from app.api.v1.b2b.clients import router as b2b_clients_router
from app.api.v1.b2b.dashboard import router as b2b_dashboard_router
from app.api.v1.b2b.organizations import router as b2b_org_router
from app.api.v1.b2b.usage import router as b2b_usage_router
from app.api.v1.chat import router as chat_router
from app.api.v1.health import router as health_router
from app.api.v1.oauth import router as oauth_router
from app.api.v1.pdf import router as pdf_router
from app.api.v1.search import router as search_router
from app.api.v1.users import router as users_router
from app.core.config import get_settings
from app.core.database import init_database
from app.core.logging import setup_logging
from app.core.metrics import PrometheusMiddleware, metrics_endpoint
from app.core.rate_limit import RateLimitMiddleware
from app.core.request_id_middleware import RequestIdMiddleware
from app.core.security_headers import SecurityHeadersMiddleware
from app.core.usage_tracking import UsageTrackingMiddleware


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

    # Graceful shutdown (SPEC-INFRA-002 M4): 진행 중인 요청 완료 대기
    from app.core.shutdown import shutdown_handler

    await shutdown_handler.graceful_shutdown(timeout=30.0)

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

    # Request ID 미들웨어 (SPEC-INFRA-002 M5: 요청 추적용 UUID 생성)
    app.add_middleware(RequestIdMiddleware)

    # 보안 헤더 미들웨어 (SPEC-SEC-001 M3: 모든 응답에 보안 헤더 주입)
    app.add_middleware(SecurityHeadersMiddleware)

    # CORS 미들웨어 (SPEC-SEC-001 M3: 환경별 허용 도메인 제한)
    allowed_origins = getattr(settings, "allowed_origins", "").split(",")
    allowed_origins = [o.strip() for o in allowed_origins if o.strip()]
    if not allowed_origins or settings.debug:
        allowed_origins = ["http://localhost:3000", "http://localhost:8000"]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
        allow_headers=["Authorization", "Content-Type"],
        max_age=600,
    )

    # Rate Limit 미들웨어 (SPEC-SEC-001 M1: IP 기반 속도 제한)
    app.add_middleware(RateLimitMiddleware)

    # 사용량 추적 미들웨어 (SPEC-B2B-001 Phase 4: B2B API 사용량 추적)
    app.add_middleware(UsageTrackingMiddleware)

    # Prometheus 미들웨어 등록 (HTTP 메트릭 자동 수집)
    app.add_middleware(PrometheusMiddleware)

    # 429 예외 핸들러 등록
    @app.exception_handler(429)
    async def rate_limit_handler(request, exc):
        return JSONResponse(
            status_code=429,
            content={"detail": "요청이 너무 많습니다. 잠시 후 다시 시도해주세요."},
            headers={"Retry-After": "60"},
        )

    # /metrics 엔드포인트 등록 (Prometheus 스크레이핑용)
    app.add_route("/metrics", metrics_endpoint)

    # API v1 라우터 등록
    app.include_router(health_router, prefix="/api/v1")
    app.include_router(auth_router, prefix="/api/v1")
    app.include_router(oauth_router, prefix="/api/v1")
    app.include_router(users_router, prefix="/api/v1")
    app.include_router(search_router, prefix="/api/v1")
    app.include_router(admin_router, prefix="/api/v1/admin")
    app.include_router(chat_router, prefix="/api/v1")
    app.include_router(pdf_router, prefix="/api/v1")
    app.include_router(b2b_org_router, prefix="/api/v1/b2b")
    app.include_router(b2b_api_keys_router, prefix="/api/v1/b2b")
    app.include_router(b2b_clients_router, prefix="/api/v1/b2b")
    app.include_router(b2b_usage_router, prefix="/api/v1/b2b")
    app.include_router(b2b_dashboard_router, prefix="/api/v1/b2b")

    return app


# 테스트 환경을 위한 기본 환경변수 설정
# 실제 프로덕션에서는 .env 파일 또는 환경변수를 통해 제공
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost/bodam")
os.environ.setdefault("SECRET_KEY", "change-me-in-production")

app = create_app()
