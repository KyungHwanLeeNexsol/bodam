FROM python:3.13-slim
WORKDIR /app
# uv 패키지 매니저 설치 (빠른 의존성 관리)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
# 의존성 파일 먼저 복사 (레이어 캐싱 최적화)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
# 애플리케이션 코드 복사
COPY . .
EXPOSE 8000
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
