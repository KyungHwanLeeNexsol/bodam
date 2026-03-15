#!/bin/sh

echo "=== Schema migration check ==="

# 스키마 정합성 확인: role 컬럼이 없으면 alembic 버전을 리셋
# (이전 배포에서 stamp head로 인해 스키마가 꼬인 경우 복구)
uv run python -c "
import asyncio, os

async def check_and_fix():
    import asyncpg
    url = os.environ.get('DATABASE_URL', '').replace('postgresql+asyncpg://', 'postgresql://')
    if not url:
        print('DATABASE_URL not set, skipping schema check')
        return
    conn = await asyncpg.connect(url)
    try:
        row = await conn.fetchrow(
            \"SELECT column_name FROM information_schema.columns \"
            \"WHERE table_name='users' AND column_name='role'\"
        )
        if not row:
            print('Schema mismatch detected: role column missing from users table')
            print('Resetting alembic version to h8i9j0k1l2m3 (before RBAC migration)...')
            await conn.execute(\"UPDATE alembic_version SET version_num = 'h8i9j0k1l2m3'\")
            print('Alembic version reset complete')
        else:
            print('Schema OK')
    finally:
        await conn.close()

asyncio.run(check_and_fix())
" 2>&1 || echo "WARN: Schema check failed, continuing anyway..."

echo "=== Running alembic migrations ==="
uv run alembic upgrade head 2>&1 || {
    echo "WARN: Alembic migration failed, starting app anyway..."
}

echo "=== Starting uvicorn ==="
exec uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
