FROM python:3.13-slim
WORKDIR /app
# Tesseract OCR + 한국어 데이터 설치 (이미지 전용 PDF 텍스트 추출용)
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-kor \
    && rm -rf /var/lib/apt/lists/*
# uv 패키지 매니저 설치 (빠른 의존성 관리)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
# 의존성 파일 먼저 복사 (레이어 캐싱 최적화)
# build context = project root (fly.toml 기준)
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --extra ocr
# 애플리케이션 코드 복사
COPY backend/ .
EXPOSE 8000
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
