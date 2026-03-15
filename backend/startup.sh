#!/bin/sh

echo "=== Schema auto-repair ==="

# SQLAlchemy create_all(checkfirst=True)로 누락된 테이블 자동 생성
# 이미 존재하는 테이블은 건너뜀
uv run python -c "
import asyncio, os

async def repair_schema():
    from sqlalchemy.ext.asyncio import create_async_engine

    url = os.environ.get('DATABASE_URL', '')
    if not url:
        print('DATABASE_URL not set, skipping')
        return

    # 모든 모델 임포트 (Base.metadata에 등록)
    from app.models.base import Base
    from app.models import user, social_account, chat, insurance, crawler, pdf
    from app.models import organization, organization_member, case_precedent, usage_record

    # ENUM 타입 먼저 생성 (IF NOT EXISTS)
    import asyncpg
    sync_url = url.replace('postgresql+asyncpg://', 'postgresql://')
    conn = await asyncpg.connect(sync_url)
    try:
        for enum_sql in [
            \"DO \$\$ BEGIN CREATE TYPE userrole AS ENUM ('B2C_USER','AGENT','AGENT_ADMIN','ORG_OWNER','SYSTEM_ADMIN'); EXCEPTION WHEN duplicate_object THEN NULL; END \$\$\",
            \"DO \$\$ BEGIN CREATE TYPE orgtype AS ENUM ('GA','INDEPENDENT','CORPORATE'); EXCEPTION WHEN duplicate_object THEN NULL; END \$\$\",
            \"DO \$\$ BEGIN CREATE TYPE plantype AS ENUM ('FREE_TRIAL','BASIC','PROFESSIONAL','ENTERPRISE'); EXCEPTION WHEN duplicate_object THEN NULL; END \$\$\",
            \"DO \$\$ BEGIN CREATE TYPE orgmemberrole AS ENUM ('ORG_OWNER','AGENT_ADMIN','AGENT'); EXCEPTION WHEN duplicate_object THEN NULL; END \$\$\",
            \"DO \$\$ BEGIN CREATE TYPE consentstatus AS ENUM ('PENDING','ACTIVE','REVOKED'); EXCEPTION WHEN duplicate_object THEN NULL; END \$\$\",
        ]:
            await conn.execute(enum_sql)

        # hashed_password nullable 보장
        await conn.execute('ALTER TABLE users ALTER COLUMN hashed_password DROP NOT NULL')

        # role 컬럼 추가 (없으면)
        role = await conn.fetchrow(\"SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='role'\")
        if not role:
            await conn.execute(\"ALTER TABLE users ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'B2C_USER'\")
    except Exception as e:
        print(f'Pre-fix warning: {e}')
    finally:
        await conn.close()

    # create_all: 누락 테이블 자동 생성 (checkfirst=True가 기본값)
    engine = create_async_engine(url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()
    print('All missing tables created')

asyncio.run(repair_schema())
" 2>&1 || echo "WARN: Schema repair failed, continuing..."

echo "=== Alembic stamp head ==="
uv run alembic stamp head 2>&1 || true

echo "=== Starting uvicorn ==="
exec uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
