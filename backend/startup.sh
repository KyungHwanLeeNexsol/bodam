#!/bin/sh

echo "=== Schema migration check ==="

# 스키마 정합성 확인: 누락된 테이블/컬럼이 있으면 alembic 버전을 리셋
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
        # social_accounts 테이블 존재 여부 확인
        sa_table = await conn.fetchrow(
            \"SELECT table_name FROM information_schema.tables \"
            \"WHERE table_name='social_accounts'\"
        )
        if not sa_table:
            # social_accounts 이전으로 리셋 (f6 = pdf_analysis 이후)
            print('Missing table: social_accounts')
            print('Resetting alembic to f6g7h8i9j0k1 (before social_accounts)...')
            await conn.execute(\"UPDATE alembic_version SET version_num = 'f6g7h8i9j0k1'\")
            print('Alembic version reset complete')
            return

        # role 컬럼 존재 여부 확인
        role_col = await conn.fetchrow(
            \"SELECT column_name FROM information_schema.columns \"
            \"WHERE table_name='users' AND column_name='role'\"
        )
        if not role_col:
            print('Missing column: users.role')
            print('Resetting alembic to h8i9j0k1l2m3 (before RBAC)...')
            await conn.execute(\"UPDATE alembic_version SET version_num = 'h8i9j0k1l2m3'\")
            print('Alembic version reset complete')
            return

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
