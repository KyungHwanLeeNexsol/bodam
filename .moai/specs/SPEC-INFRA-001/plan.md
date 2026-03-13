# SPEC-INFRA-001: 구현 계획

## 참조

- **SPEC**: `.moai/specs/SPEC-INFRA-001/spec.md`
- **수용 기준**: `.moai/specs/SPEC-INFRA-001/acceptance.md`

---

## 구현 전략

### 접근 방식

프로젝트 초기 설정은 **순차적 모듈 방식**으로 진행한다. 각 모듈은 이전 모듈에 의존하며, 모듈 간 경계가 명확하여 각 단계를 독립적으로 검증할 수 있다.

### 모듈 의존성 그래프

```
M1: Git 설정 (의존성 없음)
    |
    v
M2: 백엔드 스캐폴딩 (M1에 의존)
    |
M3: 프론트엔드 스캐폴딩 (M1에 의존)
    |       |
    v       v
M4: Docker 인프라 (M2, M3에 의존)
    |
    v
M5: CI/CD 파이프라인 (M2, M3, M4에 의존)
```

**참고**: M2와 M3는 M1 이후 독립적으로 병렬 진행 가능하나, 솔로 개발자이므로 순차 진행을 권장한다.

---

## 마일스톤

### Primary Goal: 핵심 프로젝트 구조 (M1 + M2 + M3)

#### Task 1: Git 및 저장소 설정 (M1)

| Task ID | 설명 | 관련 요구사항 |
|---------|------|-------------|
| T-1.1 | `git init`으로 저장소 초기화 | REQ-INFRA-001-02 |
| T-1.2 | `.gitignore` 생성 (Python, Node.js, Docker, IDE, .env 패턴) | REQ-INFRA-001-01 |
| T-1.3 | `README.md`, `LICENSE` (MIT) 파일 생성 | REQ-INFRA-001-02 |
| T-1.4 | 초기 커밋 생성 | - |

**기술적 고려사항:**
- `.gitignore`에 `.moai/` 디렉토리의 선택적 포함/제외 패턴 설정 필요
- MoAI 설정 파일(`.moai/config/`, `.moai/project/`)은 추적, 임시 상태 파일은 제외

#### Task 2: 백엔드 스캐폴딩 (M2)

| Task ID | 설명 | 관련 요구사항 |
|---------|------|-------------|
| T-2.1 | `backend/` 디렉토리 및 `pyproject.toml` 생성 (uv 프로젝트) | REQ-INFRA-001-03 |
| T-2.2 | FastAPI 앱 디렉토리 구조 생성 (`app/api/v1/`, `core/`, `models/`, `schemas/`, `services/`, `workers/`) | REQ-INFRA-001-04 |
| T-2.3 | `core/config.py` 작성 (pydantic-settings 기반 환경 설정) | REQ-INFRA-001-06 |
| T-2.4 | `core/database.py` 작성 (SQLAlchemy 2.x async 엔진 + 세션) | REQ-INFRA-001-07 |
| T-2.5 | Alembic 초기화 및 pgvector 확장 마이그레이션 | REQ-INFRA-001-08, 09 |
| T-2.6 | `api/v1/health.py` 헬스체크 엔드포인트 구현 | REQ-INFRA-001-05 |
| T-2.7 | pytest 설정: `conftest.py`, `test_health.py` 작성 | REQ-INFRA-001-10 |

**기술적 고려사항:**
- SQLAlchemy 2.x 비동기 패턴 사용 (`create_async_engine`, `async_sessionmaker`)
- asyncpg 드라이버 사용 (PostgreSQL 비동기 연결)
- Alembic `env.py`에서 비동기 엔진 사용을 위한 설정 필요
- Ruff 설정을 `pyproject.toml`에 포함 (`line-length = 120`, `target-version = "py313"`)

**의존성 체인:**
- T-2.1 -> T-2.2 -> T-2.3 -> T-2.4 -> T-2.5 -> T-2.6 -> T-2.7

#### Task 3: 프론트엔드 스캐폴딩 (M3)

| Task ID | 설명 | 관련 요구사항 |
|---------|------|-------------|
| T-3.1 | `create-next-app`으로 Next.js 16 프로젝트 생성 (pnpm, TypeScript, Tailwind, App Router) | REQ-INFRA-001-11 |
| T-3.2 | TypeScript strict 모드 설정 (`tsconfig.json` 수정) | REQ-INFRA-001-12 |
| T-3.3 | Tailwind CSS 4.2.x 설정 검증 및 커스텀 테마 설정 | REQ-INFRA-001-13 |
| T-3.4 | shadcn/ui 초기화 (`npx shadcn@latest init`) 및 기본 컴포넌트 설치 | REQ-INFRA-001-14 |
| T-3.5 | 루트 레이아웃 (`app/layout.tsx`) 및 랜딩 페이지 (`app/page.tsx`) 구현 | REQ-INFRA-001-15, 16 |
| T-3.6 | ESLint + Prettier 설정 | REQ-INFRA-001-17 |
| T-3.7 | Vitest + React Testing Library 설정 | REQ-INFRA-001-18 |

**기술적 고려사항:**
- `create-next-app`이 Tailwind CSS 4.x를 기본으로 설정하므로 별도 수동 설정 불필요할 수 있음
- shadcn/ui CLI v4가 Next.js 16과 호환되는지 초기화 시 확인 필요
- Vitest 설정 시 `@vitejs/plugin-react`과 `jsdom` 환경 필요
- `next.config.ts`에서 turbopack 활성화 여부 결정

**의존성 체인:**
- T-3.1 -> T-3.2, T-3.3 (병렬 가능) -> T-3.4 -> T-3.5 -> T-3.6, T-3.7 (병렬 가능)

### Secondary Goal: 인프라 통합 (M4)

#### Task 4: Docker 및 인프라 (M4)

| Task ID | 설명 | 관련 요구사항 |
|---------|------|-------------|
| T-4.1 | `backend/Dockerfile` 작성 (Python 3.13 + uv) | REQ-INFRA-001-19 |
| T-4.2 | `frontend/Dockerfile` 작성 (Node.js 22 + pnpm) | REQ-INFRA-001-19 |
| T-4.3 | `docker-compose.yml` 작성 (4개 서비스 + 볼륨 + 네트워크) | REQ-INFRA-001-19, 22 |
| T-4.4 | 헬스체크 및 서비스 의존성 순서 설정 | REQ-INFRA-001-22 |
| T-4.5 | `.env.example` 파일 생성 (프론트엔드, 백엔드) | REQ-INFRA-001-23 |

**기술적 고려사항:**
- PostgreSQL 이미지로 `pgvector/pgvector:pg18` 사용 (pgvector 확장 사전 포함)
- 개발 환경용 볼륨 마운트: 소스 코드 실시간 반영, `node_modules`는 제외 (anonymous volume)
- `backend/Dockerfile`에서 uv를 이용한 의존성 설치 최적화
- Docker 네트워크를 통한 서비스 간 통신 (`backend:8000`, `postgres:5432`)

### Final Goal: CI/CD 자동화 (M5)

#### Task 5: CI/CD 파이프라인 (M5)

| Task ID | 설명 | 관련 요구사항 |
|---------|------|-------------|
| T-5.1 | `.github/workflows/test.yml` 워크플로우 작성 | REQ-INFRA-001-25 |
| T-5.2 | 브랜치 보호 규칙 문서화 (main 브랜치 PR 필수) | REQ-INFRA-001-26 |

**기술적 고려사항:**
- GitHub Actions에서 PostgreSQL + pgvector 서비스 컨테이너 사용
- `astral-sh/setup-uv@v4` 액션으로 uv 설치
- `pnpm/action-setup@v4` 액션으로 pnpm 설치
- 프론트엔드와 백엔드 테스트를 별도 Job으로 분리하여 병렬 실행

---

## 기술 아키텍처 방향

### 백엔드 아키텍처

```
FastAPI App (main.py)
  ├── Lifespan: DB 연결 초기화/정리
  ├── API Router v1
  │     └── health.py (GET /api/v1/health)
  ├── Core
  │     ├── config.py (Settings: pydantic-settings)
  │     ├── database.py (AsyncEngine, async_sessionmaker)
  │     └── logging.py (structlog 또는 기본 logging)
  └── Alembic
        └── env.py (비동기 마이그레이션 환경)
```

### 프론트엔드 아키텍처

```
Next.js App Router
  ├── app/
  │     ├── layout.tsx (루트 레이아웃: 메타데이터, 폰트, Providers)
  │     ├── page.tsx (랜딩 페이지)
  │     └── globals.css (Tailwind 지시자)
  ├── components/ui/ (shadcn/ui 컴포넌트)
  ├── lib/utils.ts (cn 유틸리티)
  └── types/ (공유 타입 정의)
```

### Docker 서비스 아키텍처

```
[Browser :3000] --> [Frontend Container (Next.js dev)]
                         |
                         v
                    [Backend Container (FastAPI :8000)]
                         |
                    +---------+
                    |         |
                    v         v
            [PostgreSQL :5432]  [Redis :6379]
            (pgvector 0.8.2)
```

---

## 위험 분석 및 대응

| 위험 | 심각도 | 대응 방안 |
|------|--------|----------|
| Next.js 16.1.x + React 19.2.x 호환성 이슈 | Medium | `create-next-app@latest`로 최신 안정 버전 사용, 생성 시 버전 확인 |
| pgvector/pgvector:pg18 Docker 이미지 미존재 | Medium | 이미지 존재 확인 후, 없으면 `postgres:18` + pgvector 수동 빌드 Dockerfile 작성 |
| shadcn/ui CLI v4와 Next.js 16 호환성 | Low | shadcn/ui 공식 문서 확인, 호환 안 되면 수동 설정 |
| Windows에서 Docker 볼륨 마운트 성능 | Medium | WSL2 백엔드 사용, 필요 시 볼륨 마운트 전략 조정 |
| uv가 Windows에서 비동기 패키지 빌드 실패 | Low | Docker 컨테이너 내에서 uv 실행으로 우회 |
| Tailwind CSS 4.2.x 설정 변경사항 | Low | create-next-app 기본 설정 활용, CSS-first 설정 확인 |

---

## 구현 순서 요약

```
1. [M1] Git 초기화 + .gitignore + README + LICENSE
     |
2. [M2] Backend: pyproject.toml -> 디렉토리 구조 -> config -> database -> alembic -> health -> tests
     |
3. [M3] Frontend: create-next-app -> TypeScript -> Tailwind -> shadcn -> layout/page -> lint -> test
     |
4. [M4] Docker: Dockerfile (BE/FE) -> docker-compose.yml -> .env.example
     |
5. [M5] CI/CD: test.yml 워크플로우
     |
6. 최종 커밋 및 검증
```

---

## Expert Consultation 권장사항

이 SPEC은 인프라 초기 설정에 해당하므로, 다음 Expert 상담을 권장합니다:

- **expert-backend**: FastAPI 프로젝트 구조, SQLAlchemy 비동기 패턴, Alembic 설정 검증
- **expert-frontend**: Next.js 16 App Router 설정, shadcn/ui 통합, Vitest 구성 검증
- **expert-devops**: Docker Compose 최적화, CI/CD 워크플로우 구조, Windows Docker 호환성

---

**SPEC-INFRA-001** | 구현 계획 | 상태: Planned
