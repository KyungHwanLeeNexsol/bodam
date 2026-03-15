# 헬스체크 엔드포인트 (SPEC-INFRA-002 M3)
# 3-tier 헬스체크: liveness / readiness / live
from __future__ import annotations

import asyncio
import time
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.core.config import get_settings

router = APIRouter()


async def check_database() -> dict[str, Any]:
    """데이터베이스 연결 상태 확인

    SQLAlchemy async engine ping 으로 연결 상태 확인.
    연결 실패 시 unhealthy 반환.
    """
    try:
        import app.core.database as db_module

        if db_module.engine is None:
            return {"status": "unhealthy", "latency_ms": None, "details": "engine not initialized"}

        start = time.monotonic()
        # 비동기 ping
        async with db_module.engine.connect() as conn:
            await conn.execute(__import__("sqlalchemy", fromlist=["text"]).text("SELECT 1"))
        latency_ms = round((time.monotonic() - start) * 1000, 2)
        return {"status": "healthy", "latency_ms": latency_ms, "details": "connected"}
    except Exception as exc:
        return {"status": "unhealthy", "latency_ms": None, "details": str(exc)}


async def check_redis() -> dict[str, Any]:
    """Redis 연결 상태 확인

    redis-py ping 명령으로 연결 상태 확인.
    연결 실패 시 unhealthy 반환.
    """
    try:
        import redis.asyncio as aioredis

        settings = get_settings()
        start = time.monotonic()
        client = aioredis.from_url(settings.redis_url)
        await client.ping()
        await client.aclose()
        latency_ms = round((time.monotonic() - start) * 1000, 2)
        return {"status": "healthy", "latency_ms": latency_ms, "details": "connected"}
    except Exception as exc:
        return {"status": "unhealthy", "latency_ms": None, "details": str(exc)}


async def check_celery() -> dict[str, Any]:
    """Celery 워커 상태 확인

    Celery inspector ping 으로 활성 워커 수 확인.
    1초 타임아웃으로 블로킹 방지.
    워커가 없거나 타임아웃 시 degraded 반환.
    """
    try:
        from app.core.celery_app import celery_app

        # executor 에서 실행하여 이벤트 루프 블로킹 방지
        def _inspect_ping() -> dict[str, Any]:
            inspector = celery_app.control.inspect(timeout=1.0)
            pong = inspector.ping()
            if pong:
                worker_count = len(pong)
                return {
                    "status": "healthy",
                    "active_workers": worker_count,
                    "details": f"{worker_count} workers active",
                }
            return {"status": "unhealthy", "active_workers": 0, "details": "no workers found"}

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, _inspect_ping)
        return result
    except Exception as exc:
        # Celery 가 없거나 Redis 미연결 시 degraded 처리
        return {"status": "unhealthy", "active_workers": 0, "details": str(exc)}


@router.get("/health")
async def health_check() -> dict:
    """기본 liveness 엔드포인트 - 앱이 실행 중이면 항상 200 반환

    Returns:
        dict: 서비스 상태와 버전 정보
    """
    settings = get_settings()
    return {
        "status": "ok",
        "version": settings.app_version,
    }


@router.get("/health/db-check")
async def db_table_check() -> dict:
    """임시 디버그: 테이블 존재 여부 및 INSERT 테스트"""
    import app.core.database as db_module
    from sqlalchemy import text
    results = {}
    try:
        async with db_module.engine.connect() as conn:
            # 테이블 목록
            r = await conn.execute(text(
                "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"
            ))
            results["tables"] = [row[0] for row in r]

            # chat_sessions 컬럼 정보
            r2 = await conn.execute(text(
                "SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_name='chat_sessions' ORDER BY ordinal_position"
            ))
            results["chat_sessions_columns"] = [{"col": row[0], "type": row[1], "udt": row[2]} for row in r2]

            # ORM으로 INSERT 테스트
            try:
                from app.models.chat import ChatSession
                from sqlalchemy.ext.asyncio import AsyncSession as AS
                async_session = AS(bind=conn)
                s = ChatSession(title="test")
                async_session.add(s)
                await async_session.flush()
                results["orm_insert"] = "ok"
                await async_session.rollback()
            except Exception as e:
                results["orm_insert_error"] = str(e)
                await conn.rollback()
    except Exception as e:
        results["error"] = str(e)
    return results


@router.get("/health/live")
async def health_live() -> dict:
    """컨테이너 오케스트레이션용 liveness 프로브

    앱 프로세스가 살아있는 경우 항상 200 반환.

    Returns:
        dict: alive 상태
    """
    return {"status": "alive"}


@router.get("/health/ready")
async def health_ready() -> JSONResponse:
    """Readiness 체크 엔드포인트

    PostgreSQL, Redis, Celery 워커 상태를 동시에 확인.
    모든 컴포넌트 정상 -> HTTP 200
    하나 이상 비정상 -> HTTP 503

    Returns:
        JSONResponse: 상세 컴포넌트 상태 포함
    """
    settings = get_settings()

    # 모든 컴포넌트 병렬 확인
    db_status, redis_status, celery_status = await asyncio.gather(
        check_database(),
        check_redis(),
        check_celery(),
    )

    components = {
        "database": db_status,
        "redis": redis_status,
        "celery": celery_status,
    }

    # 하나라도 unhealthy 면 전체 unhealthy
    all_healthy = all(c["status"] == "healthy" for c in components.values())
    overall_status = "healthy" if all_healthy else "unhealthy"
    http_status = 200 if all_healthy else 503

    response_body = {
        "status": overall_status,
        "version": settings.app_version,
        "timestamp": datetime.now(tz=UTC).isoformat(),
        "environment": "development",
        "components": components,
    }

    return JSONResponse(status_code=http_status, content=response_body)
