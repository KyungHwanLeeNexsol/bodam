# SPEC-INFRA-001: 수용 기준

## 참조

- **SPEC**: `.moai/specs/SPEC-INFRA-001/spec.md`
- **구현 계획**: `.moai/specs/SPEC-INFRA-001/plan.md`

---

## 모듈 1: Git 및 저장소 설정

### AC-01: Git 저장소 초기화

```gherkin
Given 프로젝트 루트 디렉토리 "bodam/"가 존재한다
When "git init" 명령이 실행된다
Then ".git/" 디렉토리가 생성되어야 한다
And "git status"가 정상적으로 실행되어야 한다
```

### AC-02: .gitignore 파일 검증

```gherkin
Given .gitignore 파일이 프로젝트 루트에 존재한다
When "__pycache__/" 디렉토리가 생성된다
Then "git status"에 "__pycache__/"가 표시되지 않아야 한다

Given .gitignore 파일이 프로젝트 루트에 존재한다
When "node_modules/" 디렉토리가 생성된다
Then "git status"에 "node_modules/"가 표시되지 않아야 한다

Given .gitignore 파일이 프로젝트 루트에 존재한다
When ".env" 파일이 생성된다
Then "git status"에 ".env"가 표시되지 않아야 한다
```

---

## 모듈 2: 백엔드 스캐폴딩

### AC-03: pyproject.toml 유효성

```gherkin
Given "backend/pyproject.toml" 파일이 존재한다
When "uv sync" 명령이 "backend/" 디렉토리에서 실행된다
Then 모든 의존성이 성공적으로 설치되어야 한다
And ".venv/" 디렉토리가 생성되어야 한다
And Python 버전이 3.13 이상이어야 한다
```

### AC-04: 디렉토리 구조 검증

```gherkin
Given 백엔드 프로젝트가 초기화되었다
When 디렉토리 구조를 확인한다
Then 다음 디렉토리가 모두 존재해야 한다:
  | 경로 |
  | backend/app/api/v1/ |
  | backend/app/core/ |
  | backend/app/models/ |
  | backend/app/schemas/ |
  | backend/app/services/ |
  | backend/app/workers/ |
  | backend/tests/ |
And 각 디렉토리에 "__init__.py" 파일이 존재해야 한다
```

### AC-05: 헬스체크 엔드포인트

```gherkin
Given FastAPI 서버가 실행 중이다
When "GET /api/v1/health" 요청을 보낸다
Then HTTP 상태 코드 200이 반환되어야 한다
And 응답 본문에 "status" 필드가 "ok" 값을 가져야 한다
And 응답 본문에 "version" 필드가 존재해야 한다
```

### AC-06: 환경 설정 로딩

```gherkin
Given "DATABASE_URL" 환경 변수가 설정되어 있다
When Settings 객체가 생성된다
Then "database_url" 속성이 설정된 값과 일치해야 한다

Given "DATABASE_URL" 환경 변수가 설정되지 않았다
When Settings 객체가 생성된다
Then ValidationError가 발생해야 한다
```

### AC-07: 데이터베이스 연결

```gherkin
Given PostgreSQL 서버가 실행 중이다
And DATABASE_URL이 올바르게 설정되어 있다
When 비동기 데이터베이스 세션을 생성한다
Then SQLAlchemy AsyncSession이 정상적으로 반환되어야 한다
And "SELECT 1" 쿼리가 성공적으로 실행되어야 한다
```

### AC-08: Alembic 마이그레이션

```gherkin
Given Alembic이 초기화되었다
And PostgreSQL 데이터베이스가 실행 중이다
When "alembic upgrade head" 명령이 실행된다
Then 마이그레이션이 성공적으로 적용되어야 한다

Given 초기 마이그레이션이 실행되었다
When PostgreSQL에서 "SELECT * FROM pg_extension WHERE extname = 'vector'" 쿼리를 실행한다
Then pgvector 확장이 활성화되어 있어야 한다
```

### AC-09: Ruff 린터

```gherkin
Given Ruff가 개발 의존성으로 설치되어 있다
When "ruff check ." 명령이 "backend/" 디렉토리에서 실행된다
Then 린트 오류가 0개여야 한다
```

### AC-10: pytest 실행

```gherkin
Given pytest와 pytest-asyncio가 설치되어 있다
When "pytest" 명령이 "backend/" 디렉토리에서 실행된다
Then 모든 테스트가 통과해야 한다
And 헬스체크 엔드포인트 테스트가 포함되어야 한다
```

---

## 모듈 3: 프론트엔드 스캐폴딩

### AC-11: Next.js 프로젝트 생성

```gherkin
Given "frontend/" 디렉토리가 존재한다
When "pnpm dev" 명령이 실행된다
Then Next.js 개발 서버가 포트 3000에서 시작되어야 한다
And 브라우저에서 "http://localhost:3000"에 접근 가능해야 한다
```

### AC-12: TypeScript strict 모드

```gherkin
Given "frontend/tsconfig.json"이 존재한다
When TypeScript 설정을 확인한다
Then "strict" 옵션이 true여야 한다

Given TypeScript strict 모드가 활성화되어 있다
When "pnpm tsc --noEmit" 명령이 실행된다
Then 타입 오류가 0개여야 한다
```

### AC-13: shadcn/ui 초기화

```gherkin
Given shadcn/ui가 초기화되었다
When "frontend/components.json" 파일을 확인한다
Then shadcn/ui 설정이 올바르게 포함되어야 한다

Given shadcn/ui가 초기화되었다
When "npx shadcn@latest add button" 명령이 실행된다
Then "components/ui/button.tsx" 파일이 생성되어야 한다
```

### AC-14: 루트 레이아웃 및 랜딩 페이지

```gherkin
Given Next.js 개발 서버가 실행 중이다
When "http://localhost:3000"에 접근한다
Then HTML의 lang 속성이 "ko"여야 한다
And 페이지 제목에 "보담" 또는 "Bodam"이 포함되어야 한다
And Tailwind CSS 스타일이 적용되어야 한다
```

### AC-15: ESLint 및 Prettier

```gherkin
Given ESLint와 Prettier가 설정되어 있다
When "pnpm lint" 명령이 실행된다
Then 린트 오류가 0개여야 한다
```

### AC-16: Vitest 테스트 실행

```gherkin
Given Vitest가 설정되어 있다
When "pnpm test" 명령이 실행된다
Then Vitest가 정상적으로 시작되어야 한다
And 테스트 실행 결과가 출력되어야 한다
```

---

## 모듈 4: Docker 및 인프라

### AC-17: Docker Compose 서비스 시작

```gherkin
Given docker-compose.yml 파일이 프로젝트 루트에 존재한다
And Docker Desktop이 실행 중이다
When "docker compose up -d" 명령이 실행된다
Then 4개 서비스(frontend, backend, postgres, redis)가 모두 시작되어야 한다
And 모든 서비스의 상태가 "running" 또는 "healthy"여야 한다
```

### AC-18: PostgreSQL + pgvector 컨테이너

```gherkin
Given postgres 서비스가 실행 중이다
When PostgreSQL에 연결하여 "CREATE EXTENSION IF NOT EXISTS vector" 쿼리를 실행한다
Then pgvector 확장이 성공적으로 생성되어야 한다
```

### AC-19: Redis 컨테이너

```gherkin
Given redis 서비스가 실행 중이다
When "redis-cli ping" 명령이 실행된다
Then "PONG" 응답이 반환되어야 한다
```

### AC-20: 백엔드 컨테이너 핫 리로드

```gherkin
Given backend 서비스가 실행 중이다
When "backend/app/api/v1/health.py" 파일을 수정한다
Then uvicorn이 자동으로 리로드되어야 한다
And 변경사항이 API 응답에 반영되어야 한다
```

### AC-21: 프론트엔드 컨테이너 핫 리로드

```gherkin
Given frontend 서비스가 실행 중이다
When "frontend/app/page.tsx" 파일을 수정한다
Then Next.js가 자동으로 페이지를 업데이트해야 한다
And 브라우저에서 변경사항이 반영되어야 한다
```

### AC-22: 서비스 헬스체크 및 의존성

```gherkin
Given docker-compose.yml에 헬스체크가 정의되어 있다
When 서비스를 순서대로 시작한다
Then postgres 서비스가 healthy가 된 후에 backend 서비스가 시작되어야 한다
And redis 서비스가 healthy가 된 후에 backend 서비스가 시작되어야 한다
```

---

## 모듈 5: CI/CD 파이프라인

### AC-23: GitHub Actions 워크플로우 유효성

```gherkin
Given ".github/workflows/test.yml" 파일이 존재한다
When YAML 문법을 검증한다
Then 유효한 GitHub Actions 워크플로우여야 한다
And "backend-test"와 "frontend-test" 두 개의 job이 정의되어야 한다
```

### AC-24: CI 파이프라인 실행

```gherkin
Given test.yml 워크플로우가 설정되어 있다
When main 또는 develop 브랜치에 push가 발생한다
Then backend-test job이 실행되어야 한다:
  - uv sync 성공
  - ruff check 통과
  - pytest 통과
And frontend-test job이 실행되어야 한다:
  - pnpm install 성공
  - pnpm lint 통과
  - pnpm tsc --noEmit 통과
  - pnpm test 통과
```

---

## Quality Gate (품질 게이트)

### Definition of Done

다음 조건이 모두 충족되어야 SPEC-INFRA-001이 완료된 것으로 간주한다:

- [ ] Git 저장소가 초기화되고 .gitignore가 올바르게 동작한다
- [ ] 백엔드 프로젝트 구조가 생성되고 `uv sync`가 성공한다
- [ ] FastAPI 헬스체크 엔드포인트가 200 OK를 반환한다
- [ ] pydantic-settings 기반 환경 설정이 동작한다
- [ ] SQLAlchemy 비동기 DB 연결이 성공한다
- [ ] Alembic 초기 마이그레이션이 pgvector 확장을 활성화한다
- [ ] pytest가 헬스체크 테스트를 통과한다
- [ ] Ruff 린트 검사를 통과한다
- [ ] Next.js 프로젝트가 생성되고 개발 서버가 시작된다
- [ ] TypeScript strict 모드가 활성화되고 타입 오류가 없다
- [ ] shadcn/ui가 초기화되고 컴포넌트 추가가 가능하다
- [ ] ESLint 린트 검사를 통과한다
- [ ] Vitest 테스트가 실행된다
- [ ] Docker Compose로 4개 서비스가 모두 시작된다
- [ ] 모든 서비스에 헬스체크가 설정되어 있다
- [ ] 핫 리로드가 프론트엔드와 백엔드 모두에서 동작한다
- [ ] GitHub Actions 워크플로우가 유효한 YAML이다
- [ ] `.env.example` 파일이 프론트엔드와 백엔드에 존재한다

### 검증 도구

| 검증 대상 | 도구/명령 |
|----------|----------|
| 백엔드 린트 | `uv run ruff check .` |
| 백엔드 테스트 | `uv run pytest --cov=app` |
| 프론트엔드 린트 | `pnpm lint` |
| 프론트엔드 타입 체크 | `pnpm tsc --noEmit` |
| 프론트엔드 테스트 | `pnpm test` |
| Docker 서비스 | `docker compose ps` |
| 헬스체크 | `curl http://localhost:8000/api/v1/health` |
| GitHub Actions | `act` (로컬 실행) 또는 GitHub push |

---

**SPEC-INFRA-001** | 수용 기준 | 상태: Planned
