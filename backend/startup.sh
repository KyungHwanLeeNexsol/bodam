#!/bin/sh

echo "=== Schema migration fix ==="

# stamp head로 인해 누락된 테이블/컬럼을 직접 생성 (일회성 복구)
# alembic 버전은 건드리지 않음 - 이미 head로 되어있을 수 있으므로
uv run python -c "
import asyncio, os

async def fix_schema():
    import asyncpg
    url = os.environ.get('DATABASE_URL', '').replace('postgresql+asyncpg://', 'postgresql://')
    if not url:
        print('DATABASE_URL not set, skipping')
        return
    conn = await asyncpg.connect(url)
    try:
        # social_accounts 테이블 존재 여부
        sa_table = await conn.fetchrow(
            \"SELECT 1 FROM information_schema.tables WHERE table_name='social_accounts'\"
        )
        if not sa_table:
            print('Creating missing table: social_accounts')
            await conn.execute('''
                CREATE TABLE IF NOT EXISTS social_accounts (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    provider VARCHAR(20) NOT NULL,
                    provider_user_id VARCHAR(255) NOT NULL,
                    provider_email VARCHAR(255),
                    provider_name VARCHAR(100),
                    access_token TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    UNIQUE(provider, provider_user_id)
                )
            ''')
            await conn.execute('CREATE INDEX IF NOT EXISTS ix_social_accounts_user_id ON social_accounts(user_id)')
            await conn.execute('CREATE INDEX IF NOT EXISTS ix_social_provider_email ON social_accounts(provider, provider_email)')
            print('social_accounts table created')

        # role 컬럼 존재 여부
        role_col = await conn.fetchrow(
            \"SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='role'\"
        )
        if not role_col:
            print('Adding missing column: users.role')
            await conn.execute(\"ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'B2C_USER'\")
            print('users.role column added')

        # hashed_password nullable 확인
        hp_col = await conn.fetchrow(
            \"SELECT is_nullable FROM information_schema.columns WHERE table_name='users' AND column_name='hashed_password'\"
        )
        if hp_col and hp_col['is_nullable'] == 'NO':
            print('Making hashed_password nullable')
            await conn.execute('ALTER TABLE users ALTER COLUMN hashed_password DROP NOT NULL')
            print('hashed_password is now nullable')

        print('Schema OK')
    finally:
        await conn.close()

asyncio.run(fix_schema())
" 2>&1 || echo "WARN: Schema fix failed, continuing..."

echo "=== Running alembic migrations ==="
uv run alembic stamp head 2>&1 || true
uv run alembic upgrade head 2>&1 || {
    echo "WARN: Alembic migration failed, starting app anyway..."
}

echo "=== Starting uvicorn ==="
exec uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
