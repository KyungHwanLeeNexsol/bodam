FROM python:3.13-slim
WORKDIR /app
# uv 패키지 매니저 설치
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
# 의존성 파일 먼저 복사 (레이어 캐싱 최적화)
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev
# 백엔드 애플리케이션 코드 복사
COPY backend/ .
EXPOSE 8000
CMD ["sh", "-c", "uv run alembic upgrade head || echo 'Migration failed, continuing...' ; uv run uvicorn app.main:app --host 0.0.0.0 --port 8000"]
