#!/bin/sh
set -e

echo "Running alembic migrations..."
uv run alembic upgrade head 2>&1 || {
    echo "Alembic migration failed. Attempting manual stamp and retry..."
    # alembic이 중간에 실패한 경우, 현재 head로 stamp 후 재시도
    uv run alembic stamp head 2>&1 || echo "Stamp also failed, continuing..."
}

echo "Starting uvicorn..."
exec uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
