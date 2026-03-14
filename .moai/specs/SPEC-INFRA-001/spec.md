---
id: SPEC-INFRA-001
version: 1.1.0
status: completed
created: 2026-03-13
updated: 2026-03-14
author: zuge3
priority: high
issue_number: 0
tags: [infra, docker, cicd, initial-setup, scaffolding]
---

# SPEC-INFRA-001: 프로젝트 초기 설정 및 스캐폴딩

---

## Environment (환경)

### 프로젝트 컨텍스트

- **프로젝트**: Bodam (보담) - AI 기반 한국 보험 청구 안내 플랫폼
- **개발 인원**: 1명 (솔로 개발자)
- **현재 상태**: 완전 신규 프로젝트 (코드 없음, Git 저장소 미초기화)
- **작업 디렉토리**: `C:\Users\zuge3\Documents\workspace\bodam` (Windows 10)
- **개발 모드**: TDD (quality.yaml 설정)
- **목표**: 3개월 내 MVP 출시

### 기술 스택 (tech.md 기준 확정 버전)

**프론트엔드:**
- Next.js 16.1.x, React 19.2.x, TypeScript 5.x
- Tailwind CSS 4.2.x, shadcn/ui CLI v4
- Vercel AI SDK 6.x, Auth.js v5
- 패키지 매니저: pnpm

**백엔드:**
- Python 3.13.x, FastAPI 0.135.x, Pydantic 2.12.x
- LangChain 1.2.x, SQLAlchemy 2.x, Alembic 1.x, Celery 5.x
- 패키지 매니저: uv

**데이터베이스:**
- PostgreSQL 18.x + pgvector 0.8.2
- Redis 7.x

**인프라:**
- Docker + Docker Compose
- GitHub Actions CI/CD

**개발 도구:**
- Ruff (Python 린터/포매터)
- ESLint + Prettier (TypeScript)
- Vitest (프론트엔드 테스트), pytest (백엔드 테스트)

---

## Assumptions (가정)

### 기술 가정

- [A1] 개발 환경에 Docker Desktop이 설치되어 있다
- [A2] Node.js 22 LTS와 Python 3.13.x가 시스템에 설치되어 있거나 Docker로 대체 가능하다
- [A3] pnpm과 uv가 전역으로 설치되어 있거나 설치 가능하다
- [A4] PostgreSQL 18.x 공식 Docker 이미지에 pgvector 0.8.2 확장을 추가할 수 있다
- [A5] Windows 환경에서 Docker Compose가 정상 동작한다

### 비즈니스 가정

- [A6] MVP 단계에서 로컬 Docker Compose 환경만으로 충분하다 (클라우드 배포는 별도 SPEC)
- [A7] 초기 설정 단계에서는 인증, AI/LLM 통합은 구현하지 않으며 스캐폴딩만 수행한다
- [A8] 모노레포 구조를 사용하며, 프론트엔드와 백엔드가 하나의 Git 저장소에 공존한다

### 위험 가정

- [A9] Next.js 16.1.x와 React 19.2.x의 호환성이 안정적이다 (2026-03 기준)
- [A10] pgvector 0.8.2가 PostgreSQL 18.x와 호환된다

---

## Requirements (요구사항)

### 모듈 1: Git 및 저장소 설정

**REQ-INFRA-001-01** (Ubiquitous)
시스템은 항상 `.gitignore` 파일을 통해 Python 캐시, Node.js 모듈, Docker 볼륨, IDE 설정, 환경 변수 파일을 버전 관리에서 제외해야 한다.

**REQ-INFRA-001-02** (Event-Driven)
WHEN Git 저장소가 초기화되면 THEN 모노레포 루트에 `.gitignore`, `README.md`, `LICENSE` 파일이 생성되어야 한다.

### 모듈 2: 백엔드 스캐폴딩 (Python/FastAPI)

**REQ-INFRA-001-03** (Event-Driven)
WHEN 백엔드 프로젝트가 초기화되면 THEN `backend/` 디렉토리에 `pyproject.toml`이 생성되고, uv를 통해 Python 3.13.x 가상환경이 구성되어야 한다.

**REQ-INFRA-001-04** (Ubiquitous)
시스템은 항상 다음 디렉토리 구조를 유지해야 한다: `backend/app/{api/v1/, core/, models/, schemas/, services/, workers/}`

**REQ-INFRA-001-05** (Event-Driven)
WHEN FastAPI 앱이 시작되면 THEN `GET /api/v1/health` 엔드포인트가 `{"status": "ok", "version": "0.1.0"}` 형태의 JSON을 반환해야 한다.

**REQ-INFRA-001-06** (Event-Driven)
WHEN 백엔드 설정이 로드되면 THEN `pydantic-settings`를 사용하여 환경 변수 기반 설정(`DATABASE_URL`, `REDIS_URL`, `SECRET_KEY`, `DEBUG` 등)이 타입 안전하게 로드되어야 한다.

**REQ-INFRA-001-07** (Event-Driven)
WHEN 데이터베이스 연결이 초기화되면 THEN SQLAlchemy 2.x 비동기 엔진(`asyncpg`)과 세션 팩토리가 구성되어야 한다.

**REQ-INFRA-001-08** (Event-Driven)
WHEN Alembic이 초기화되면 THEN `backend/alembic/` 디렉토리에 마이그레이션 환경이 구성되고, 비동기 SQLAlchemy와 호환되어야 한다.

**REQ-INFRA-001-09** (Event-Driven)
WHEN 초기 마이그레이션이 실행되면 THEN pgvector 확장(`CREATE EXTENSION IF NOT EXISTS vector`)이 활성화되어야 한다.

**REQ-INFRA-001-10** (Event-Driven)
WHEN `pytest` 명령이 실행되면 THEN `backend/tests/` 디렉토리의 테스트가 실행되고, `conftest.py`에서 테스트 DB 세션과 AsyncClient 픽스처가 제공되어야 한다.

### 모듈 3: 프론트엔드 스캐폴딩 (Next.js)

**REQ-INFRA-001-11** (Event-Driven)
WHEN 프론트엔드 프로젝트가 초기화되면 THEN `frontend/` 디렉토리에 Next.js 16 App Router 기반 프로젝트가 pnpm으로 생성되어야 한다.

**REQ-INFRA-001-12** (Ubiquitous)
시스템은 항상 TypeScript strict 모드를 활성화하고, `tsconfig.json`에 `strict: true`, `noUncheckedIndexedAccess: true` 설정을 포함해야 한다.

**REQ-INFRA-001-13** (Event-Driven)
WHEN Tailwind CSS가 초기화되면 THEN `frontend/` 디렉토리에 Tailwind CSS 4.2.x 설정이 적용되어야 한다.

**REQ-INFRA-001-14** (Event-Driven)
WHEN shadcn/ui가 초기화되면 THEN `components.json` 설정 파일이 생성되고 기본 UI 컴포넌트(`button`, `input`, `card`)를 설치할 수 있어야 한다.

**REQ-INFRA-001-15** (Event-Driven)
WHEN 루트 레이아웃이 생성되면 THEN `app/layout.tsx`에 한국어 메타데이터(`lang="ko"`), 글로벌 폰트 설정, Tailwind 글로벌 스타일이 적용되어야 한다.

**REQ-INFRA-001-16** (Event-Driven)
WHEN 랜딩 페이지가 생성되면 THEN `app/page.tsx`에 Bodam 서비스 소개 및 기본 레이아웃이 표시되어야 한다.

**REQ-INFRA-001-17** (Event-Driven)
WHEN ESLint와 Prettier가 설정되면 THEN `.eslintrc.json`과 `.prettierrc` 파일이 생성되고 TypeScript, React, Next.js 규칙이 활성화되어야 한다.

**REQ-INFRA-001-18** (Event-Driven)
WHEN Vitest가 설정되면 THEN `vitest.config.ts` 파일이 생성되고, React Testing Library와 함께 컴포넌트 테스트를 실행할 수 있어야 한다.

### 모듈 4: Docker 및 인프라

**REQ-INFRA-001-19** (Event-Driven)
WHEN `docker compose up`이 실행되면 THEN 4개 서비스(frontend, backend, postgres, redis)가 시작되어야 한다.

**REQ-INFRA-001-20** (Ubiquitous)
시스템은 항상 개발 환경에서 핫 리로드를 지원해야 한다: 프론트엔드는 Next.js dev 서버, 백엔드는 `uvicorn --reload`를 사용한다.

**REQ-INFRA-001-21** (Event-Driven)
WHEN PostgreSQL 컨테이너가 시작되면 THEN pgvector 확장이 사전 설치된 PostgreSQL 18.x 이미지가 사용되어야 한다.

**REQ-INFRA-001-22** (Event-Driven)
WHEN Docker Compose 서비스가 시작되면 THEN 각 서비스에 헬스체크가 정의되어 의존성 순서가 보장되어야 한다.

**REQ-INFRA-001-23** (Ubiquitous)
시스템은 항상 `.env.example` 파일을 프론트엔드와 백엔드 루트에 제공하여 필수 환경 변수 목록을 문서화해야 한다.

**REQ-INFRA-001-24** (State-Driven)
IF 개발 환경에서 실행 중이라면 THEN 소스 코드 디렉토리가 Docker 볼륨으로 마운트되어 코드 변경이 실시간으로 반영되어야 한다.

### 모듈 5: CI/CD 파이프라인

**REQ-INFRA-001-25** (Event-Driven)
WHEN GitHub에 PR이 생성되거나 push가 발생하면 THEN GitHub Actions 워크플로우가 백엔드(lint + test)와 프론트엔드(lint + type-check + test)를 실행해야 한다.

**REQ-INFRA-001-26** (Unwanted)
시스템은 린트 오류 또는 테스트 실패가 있는 코드가 main 브랜치에 병합되지 않아야 한다.

---

## Specifications (세부 사양)

### S1: Git 저장소 구성

```
bodam/
  .gitignore          # Python, Node.js, Docker, IDE, .env 패턴
  README.md           # 프로젝트 개요
  LICENSE             # MIT 라이선스
```

**.gitignore 포함 패턴:**
- Python: `__pycache__/`, `*.pyc`, `.venv/`, `*.egg-info/`, `.ruff_cache/`
- Node.js: `node_modules/`, `.next/`, `.turbo/`
- Docker: `docker-compose.override.yml`
- IDE: `.vscode/`, `.idea/`, `*.swp`
- 환경: `.env`, `.env.local`, `.env.*.local`
- OS: `.DS_Store`, `Thumbs.db`
- 데이터: `*.sqlite3`, `data/uploads/`

### S2: 백엔드 프로젝트 구조

```
backend/
  pyproject.toml          # uv 프로젝트 설정
  app/
    __init__.py
    main.py               # FastAPI 앱 인스턴스 및 라이프사이클
    api/
      __init__.py
      v1/
        __init__.py
        health.py          # 헬스체크 엔드포인트
    core/
      __init__.py
      config.py            # pydantic-settings 기반 설정
      database.py          # SQLAlchemy 2.x 비동기 엔진/세션
      logging.py           # 로깅 설정
    models/
      __init__.py
    schemas/
      __init__.py
    services/
      __init__.py
    workers/
      __init__.py
  tests/
    __init__.py
    conftest.py            # pytest 픽스처 (AsyncClient, DB 세션)
    test_health.py         # 헬스체크 테스트
  alembic/
    env.py
    script.py.mako
    versions/
  alembic.ini
  .env.example
```

**pyproject.toml 핵심 의존성:**
```toml
[project]
name = "bodam-backend"
version = "0.1.0"
requires-python = ">=3.13"

[project.dependencies]
fastapi = ">=0.135.0,<0.136.0"
uvicorn = {version = ">=0.34.0", extras = ["standard"]}
pydantic = ">=2.12.0,<2.13.0"
pydantic-settings = ">=2.7.0"
sqlalchemy = {version = ">=2.0.0", extras = ["asyncio"]}
asyncpg = ">=0.30.0"
alembic = ">=1.14.0"
redis = ">=5.2.0"
celery = {version = ">=5.4.0", extras = ["redis"]}
pgvector = ">=0.3.6"

[project.optional-dependencies]
dev = [
    "pytest>=8.3.0",
    "pytest-asyncio>=0.24.0",
    "httpx>=0.28.0",
    "ruff>=0.8.0",
    "pytest-cov>=6.0.0",
]
```

### S3: 프론트엔드 프로젝트 구조

```
frontend/
  app/
    layout.tsx             # 루트 레이아웃 (lang="ko", 폰트, Tailwind)
    page.tsx               # 랜딩 페이지
    globals.css            # Tailwind 글로벌 스타일
  components/
    ui/                    # shadcn/ui 컴포넌트
  lib/
    utils.ts               # 유틸리티 함수 (cn 함수 등)
  types/
  hooks/
  public/
  next.config.ts
  tsconfig.json
  tailwind.config.ts
  package.json
  .eslintrc.json
  .prettierrc
  vitest.config.ts
  .env.example
```

**package.json 핵심 의존성:**
```json
{
  "dependencies": {
    "next": "^16.1.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "tailwindcss": "^4.2.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.6.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "@types/react": "^19.0.0",
    "@types/node": "^22.0.0",
    "eslint": "^9.0.0",
    "eslint-config-next": "^16.1.0",
    "prettier": "^3.4.0",
    "vitest": "^3.0.0",
    "@testing-library/react": "^16.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "jsdom": "^25.0.0"
  }
}
```

### S4: Docker Compose 구성

```yaml
# docker-compose.yml (루트)
services:
  postgres:
    image: pgvector/pgvector:pg18
    ports: ["5432:5432"]
    environment:
      POSTGRES_DB: bodam
      POSTGRES_USER: bodam
      POSTGRES_PASSWORD: bodam_dev_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U bodam"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports: ["8000:8000"]
    volumes:
      - ./backend:/app
    env_file: ./backend/.env
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    ports: ["3000:3000"]
    volumes:
      - ./frontend:/app
      - /app/node_modules
    env_file: ./frontend/.env
    depends_on:
      - backend
    command: pnpm dev

volumes:
  postgres_data:
```

### S5: GitHub Actions 워크플로우

```yaml
# .github/workflows/test.yml
name: Test
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  backend-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg18
        env:
          POSTGRES_DB: bodam_test
          POSTGRES_USER: bodam
          POSTGRES_PASSWORD: test_password
        ports: ["5432:5432"]
        options: --health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v4
      - run: uv sync --dev
        working-directory: backend
      - run: uv run ruff check .
        working-directory: backend
      - run: uv run pytest --cov=app --cov-report=term-missing
        working-directory: backend

  frontend-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: frontend/pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
        working-directory: frontend
      - run: pnpm lint
        working-directory: frontend
      - run: pnpm tsc --noEmit
        working-directory: frontend
      - run: pnpm test
        working-directory: frontend
```

---

## Traceability (추적성)

| 요구사항 ID | 모듈 | plan.md 참조 | acceptance.md 참조 |
|------------|------|-------------|-------------------|
| REQ-INFRA-001-01~02 | M1: Git | Task 1.1~1.3 | AC-01~02 |
| REQ-INFRA-001-03~10 | M2: Backend | Task 2.1~2.7 | AC-03~10 |
| REQ-INFRA-001-11~18 | M3: Frontend | Task 3.1~3.7 | AC-11~16 |
| REQ-INFRA-001-19~24 | M4: Docker | Task 4.1~4.5 | AC-17~22 |
| REQ-INFRA-001-25~26 | M5: CI/CD | Task 5.1~5.2 | AC-23~24 |

---

## 5. Implementation Notes (구현 노트)

### Status

✅ **Completed** - Commit 0d23d4b (2026-03-14)

### Implementation Summary

The project infrastructure has been successfully implemented with the following components:

**Git Repository**:
- `.gitignore` configured for Python, Node.js, Docker, IDE, and environment files
- `README.md` created with project overview
- `LICENSE` (MIT) applied

**Backend (Python/FastAPI)**:
- `backend/pyproject.toml` configured with uv package manager
- Python 3.13 virtual environment setup
- FastAPI app with `/api/v1/health` health check endpoint
- SQLAlchemy 2.x async engine with asyncpg
- Alembic database migrations with pgvector extension initialization
- pytest + pytest-asyncio test framework with AsyncClient fixtures

**Frontend (Next.js)**:
- `frontend/` initialized with Next.js 16 App Router
- TypeScript strict mode enabled with required linting rules
- Tailwind CSS 4 styling framework integrated
- shadcn/ui component library initialized with Button, Input, Card components
- Root layout with Korean locale (lang="ko") and font configuration
- Landing page with Bodam service introduction

**Docker Infrastructure**:
- `docker-compose.yml` with 4 services: postgres (pgvector:pg18), redis (7-alpine), backend, frontend
- Health checks configured for database and cache
- Volume mounts for hot reload development
- Network configuration with service dependencies

**CI/CD Pipeline**:
- GitHub Actions workflow (`.github/workflows/test.yml`) created
- Backend testing: ruff lint check + pytest with coverage
- Frontend testing: ESLint + TypeScript type check + Vitest
- Pull request and push triggers for main and develop branches

**Environment Configuration**:
- `.env.example` files in both frontend and backend directories
- pydantic-settings integration for type-safe environment variable loading
- NEXT_PUBLIC_API_URL configured for frontend-backend communication

### Known Limitations

**Cloud Deployment**: Docker Compose environment is local-only. Production cloud deployment (AWS, GCP, Azure) deferred to separate SPEC.

---

**SPEC-INFRA-001** | 상태: Completed | 우선순위: High
