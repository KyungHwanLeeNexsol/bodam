# SPEC-ENV-001: 환경변수 파편화 정리

## 메타데이터

| 항목 | 내용 |
|------|------|
| SPEC ID | SPEC-ENV-001 |
| 제목 | Environment Variable Fragmentation Cleanup |
| 생성일 | 2026-03-16 |
| 상태 | Planned |
| 우선순위 | High |
| 담당 | expert-backend, expert-devops |

## TAG

`SPEC-ENV-001` `env` `configuration` `devops` `cleanup`

---

## 1. Environment (환경)

### 1.1 현재 파일 구조

```
bodam/
+-- .env.prod.example          # 루트 prod 예시 (docker-compose.prod.yml 참조)
+-- .env.prod                  # 실제 prod 파일 (서버, gitignored)
+-- docker-compose.yml         # Dev: backend/.env, frontend/.env 참조
+-- docker-compose.prod.yml    # Prod: .env.prod (루트) 참조
+-- docker-compose.staging.yml # Staging: .env.staging 참조 (예시 파일 없음!)
+-- backend/
|   +-- .env.example           # Dev 백엔드 예시 (157줄)
|   +-- .env.prod.example      # 혼란 유발: 루트와 중복, 불완전
|   +-- app/core/config.py     # Pydantic Settings - 40+ 환경변수
+-- frontend/
    +-- .env.example           # Dev 프론트엔드 예시
    +-- .env.prod.example      # 죽은 파일: Vercel에서 프론트엔드 관리
```

### 1.2 docker-compose 환경변수 참조 관계

| compose 파일 | env_file 경로 | 예시 파일 존재 여부 |
|---|---|---|
| `docker-compose.yml` | `./backend/.env` | backend/.env.example (O) |
| `docker-compose.yml` | `./frontend/.env` | frontend/.env.example (O) |
| `docker-compose.prod.yml` | `.env.prod` (루트) | .env.prod.example (O) |
| `docker-compose.staging.yml` | `.env.staging` (루트) | .env.staging.example (X - 없음!) |

### 1.3 config.py 환경변수 전체 목록 (40개)

config.py에 정의된 모든 Settings 필드:

**기본 설정**: `app_name`, `app_version`, `debug`

**인프라**: `database_url`, `redis_url`, `secret_key`

**LLM API 키**: `openai_api_key`, `gemini_api_key`

**임베딩 설정**: `embedding_model`, `embedding_dimensions`

**RAG 청크 설정**: `chunk_size_tokens`, `chunk_overlap_tokens`

**LLM 라우팅**: `llm_primary_model`, `llm_fallback_model`, `llm_classifier_model`, `llm_confidence_threshold`, `llm_fallback_on_low_confidence`, `llm_cost_tracking_enabled`

**Chat AI**: `chat_model`, `chat_max_tokens`, `chat_temperature`, `chat_history_limit`, `chat_context_top_k`, `chat_context_threshold`

**크롤러**: `crawler_storage_backend`, `crawler_base_dir`, `crawler_rate_limit_seconds`, `crawler_max_retries`

**인증/JWT**: `access_token_expire_minutes`, `jwt_algorithm`

**Rate Limiting**: `rate_limit_general`, `rate_limit_auth`, `rate_limit_chat_daily`

**CORS**: `allowed_origins`

**OAuth2**: `kakao_client_id`, `kakao_client_secret`, `kakao_redirect_uri`, `naver_client_id`, `naver_client_secret`, `naver_redirect_uri`, `google_client_id`, `google_client_secret`, `google_redirect_uri`, `social_token_encryption_key`

**B2B**: `b2b_encryption_key`

---

## 2. Assumptions (가정)

- A1: `docker-compose.prod.yml`의 `env_file: .env.prod` 경로는 변경하지 않는다 (out of scope).
- A2: `config.py`의 Settings 클래스 구조는 변경하지 않는다 (out of scope).
- A3: 프론트엔드 프로덕션은 Vercel에서 관리되며, Docker 프론트엔드 프로덕션 서비스는 존재하지 않는다.
- A4: 스테이징 환경은 프로덕션과 동일한 변수 세트를 사용하되, 값만 다르다.
- A5: 실제 시크릿 값(.env.prod, .env.staging 등)은 이 작업에서 변경하지 않는다.
- A6: `GEMINI_API_KEY`와 `GOOGLE_API_KEY`는 config.py에서 `gemini_api_key`로 통합 사용된다.

---

## 3. Requirements (요구사항)

### REQ-01: 중복 prod 예시 파일 삭제

**EARS Pattern: Ubiquitous**

시스템은 **항상** 각 환경에 대해 하나의 예시 파일만 유지해야 한다.

- [HARD] `backend/.env.prod.example` 파일을 삭제한다.
  WHY: 루트 `.env.prod.example`과 중복되며, docker-compose.prod.yml은 루트의 `.env.prod`를 참조한다. 두 파일의 변수 목록과 값이 불일치하여 (예: REDIS_URL에 패스워드 유무, GEMINI_API_KEY 존재 여부) 개발자 혼란을 야기한다.
  IMPACT: 오늘 발생한 OAuth 키 CHANGE_ME 버그와 같은 설정 불일치 사고를 방지한다.

### REQ-02: 죽은 프론트엔드 prod 예시 파일 삭제

**EARS Pattern: Ubiquitous**

시스템은 **항상** 실제 사용되지 않는 설정 파일을 제거해야 한다.

- [HARD] `frontend/.env.prod.example` 파일을 삭제한다.
  WHY: 프론트엔드 프로덕션은 Vercel 대시보드에서 환경변수를 관리하며, docker-compose.prod.yml에 frontend 서비스가 없다.
  IMPACT: 개발자가 실제 사용되지 않는 파일을 참조하여 시간을 낭비하는 것을 방지한다.

### REQ-03: 루트 .env.prod.example을 완전한 프로덕션 레퍼런스로 업데이트

**EARS Pattern: Ubiquitous**

시스템은 **항상** `.env.prod.example`에 config.py의 모든 환경변수를 포함해야 한다.

- [HARD] 루트 `.env.prod.example`에 현재 누락된 다음 변수들을 추가한다:
  - Chat AI 설정: `CHAT_MODEL`, `CHAT_MAX_TOKENS`, `CHAT_TEMPERATURE`, `CHAT_HISTORY_LIMIT`, `CHAT_CONTEXT_TOP_K`, `CHAT_CONTEXT_THRESHOLD`
  - 임베딩 설정: `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`
  - RAG 청크 설정: `CHUNK_SIZE_TOKENS`, `CHUNK_OVERLAP_TOKENS`
  - LLM 라우팅 추가: `LLM_CLASSIFIER_MODEL`, `LLM_CONFIDENCE_THRESHOLD`, `LLM_FALLBACK_ON_LOW_CONFIDENCE`, `LLM_COST_TRACKING_ENABLED`
  - 크롤러 설정: `CRAWLER_STORAGE_BACKEND`, `CRAWLER_BASE_DIR`, `CRAWLER_RATE_LIMIT_SECONDS`, `CRAWLER_MAX_RETRIES`
  - `GEMINI_API_KEY` 변수명 통일 (현재 `GOOGLE_API_KEY`로 되어 있음)
  WHY: 환경변수 예시 파일이 실제 config.py와 일치하지 않으면 배포 시 변수 누락이 발생한다.
  IMPACT: 프로덕션 배포 시 config.py 기본값에 의존하는 위험을 제거한다.

### REQ-04: 스테이징 환경 예시 파일 생성

**EARS Pattern: Event-Driven**

**WHEN** 개발자가 스테이징 환경을 구성할 때 **THEN** `.env.staging.example`을 참조하여 `.env.staging`을 생성할 수 있어야 한다.

- [HARD] 루트에 `.env.staging.example` 파일을 생성한다.
  - `.env.prod.example`의 구조를 기반으로 한다.
  - 스테이징에 적절한 기본값과 주석을 포함한다.
  - 스테이징 도메인, 로그 레벨 등 환경별 차이를 주석으로 명시한다.
  WHY: `docker-compose.staging.yml`이 `.env.staging`을 참조하지만 예시 파일이 없어 개발자가 어떤 변수를 설정해야 하는지 알 수 없다.
  IMPACT: 스테이징 환경 구성 시간을 단축하고 설정 오류를 방지한다.

### REQ-05: 개발 환경 예시 파일 업데이트

**EARS Pattern: Ubiquitous**

시스템은 **항상** `backend/.env.example`에 config.py의 모든 환경변수를 포함해야 한다.

- [HARD] `backend/.env.example`에 현재 누락된 다음 변수들을 추가한다:
  - Chat AI 설정: `CHAT_MODEL`, `CHAT_MAX_TOKENS`, `CHAT_TEMPERATURE`, `CHAT_HISTORY_LIMIT`, `CHAT_CONTEXT_TOP_K`, `CHAT_CONTEXT_THRESHOLD`
  - 임베딩 설정: `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`
  - RAG 청크 설정: `CHUNK_SIZE_TOKENS`, `CHUNK_OVERLAP_TOKENS`
  - LLM 추가 설정: `LLM_CLASSIFIER_MODEL`, `LLM_CONFIDENCE_THRESHOLD`, `LLM_FALLBACK_ON_LOW_CONFIDENCE`, `LLM_COST_TRACKING_ENABLED`
  - 크롤러 추가 설정: `CRAWLER_RATE_LIMIT_SECONDS`, `CRAWLER_MAX_RETRIES`
  WHY: 개발자가 로컬 환경 설정 시 config.py 소스 코드를 직접 확인할 필요 없이 예시 파일만으로 모든 옵션을 파악할 수 있어야 한다.
  IMPACT: 새 개발자 온보딩 시간을 단축하고 설정 누락을 방지한다.

### REQ-06: docker-compose 파일에 예시 파일 참조 주석 추가

**EARS Pattern: Optional**

**가능하면** docker-compose 파일에 올바른 예시 파일 경로를 안내하는 주석을 제공한다.

- [SOFT] 각 docker-compose 파일의 `env_file` 항목 근처에 해당 예시 파일 경로를 주석으로 추가한다.
  - `docker-compose.yml`: `# 예시 파일: backend/.env.example, frontend/.env.example`
  - `docker-compose.prod.yml`: `# 예시 파일: .env.prod.example`
  - `docker-compose.staging.yml`: `# 예시 파일: .env.staging.example`
  WHY: env_file과 example 파일 간의 관계를 명시적으로 알 수 있어 혼란을 줄인다.
  IMPACT: 새 팀원 온보딩 시 설정 파일 찾는 시간을 절약한다.

### REQ-07: 루트 README에 환경변수 구조 설명 추가

**EARS Pattern: Optional**

**가능하면** 루트 README에 환경 파일 구조를 설명하는 섹션을 추가한다.

- [SOFT] README.md에 다음 내용을 포함하는 "Environment Configuration" 섹션을 추가한다:
  - 환경별 env 파일 매핑 (dev, staging, prod)
  - 각 예시 파일의 위치와 용도
  - `.env` 파일 생성 명령어
  - Vercel 프론트엔드 환경변수 관리에 대한 안내
  WHY: 프로젝트의 환경변수 관리 전략을 한눈에 파악할 수 있는 문서가 필요하다.
  IMPACT: 프로젝트 구조 이해도를 높이고 설정 오류를 예방한다.

---

## 4. Specifications (상세 명세)

### 4.1 삭제 대상 파일

| 파일 | 사유 |
|------|------|
| `backend/.env.prod.example` | 루트 `.env.prod.example`과 중복. docker-compose.prod.yml은 루트 `.env.prod` 참조 |
| `frontend/.env.prod.example` | 프론트엔드 prod는 Vercel 관리. docker 서비스 없음 |

### 4.2 수정 대상 파일

| 파일 | 변경 내용 |
|------|-----------|
| `.env.prod.example` | config.py 전체 변수 반영, 섹션별 그룹핑, 주석 보강 |
| `backend/.env.example` | config.py 전체 변수 반영 (chat_*, embedding_*, llm_*, crawler_* 추가) |
| `docker-compose.yml` | env_file 참조 주석 추가 |
| `docker-compose.prod.yml` | env_file 참조 주석 추가 |
| `docker-compose.staging.yml` | env_file 참조 주석 추가 |
| `README.md` | Environment Configuration 섹션 추가 |

### 4.3 생성 대상 파일

| 파일 | 내용 |
|------|------|
| `.env.staging.example` | .env.prod.example 기반, 스테이징 적절 기본값 |

### 4.4 변경하지 않는 파일 (Out of Scope)

| 파일 | 사유 |
|------|------|
| `backend/app/core/config.py` | Settings 클래스 구조 변경 불가 |
| `docker-compose.*.yml`의 `env_file` 경로 | 기존 참조 경로 유지 |
| `.env.prod`, `.env.staging` 등 실제 시크릿 파일 | 실제 값 변경 불가 |

### 4.5 GEMINI_API_KEY vs GOOGLE_API_KEY 정리

config.py에서는 `gemini_api_key`로 정의되어 있으나:
- 루트 `.env.prod.example`에서는 `GOOGLE_API_KEY`로 표기
- `backend/.env.example`에서는 `GOOGLE_API_KEY`로 표기
- `backend/.env.prod.example`에서는 `GEMINI_API_KEY`로 표기

config.py의 `gemini_api_key` 필드명을 기준으로, 예시 파일에서는 `GEMINI_API_KEY`로 통일한다. 단, config.py 수정은 out of scope이므로 `GOOGLE_API_KEY`를 함께 주석으로 안내한다.

---

## Traceability

| 요구사항 | 수락 기준 | 관련 파일 |
|----------|-----------|-----------|
| REQ-01 | ACC-01 | backend/.env.prod.example |
| REQ-02 | ACC-02 | frontend/.env.prod.example |
| REQ-03 | ACC-03 | .env.prod.example |
| REQ-04 | ACC-04 | .env.staging.example |
| REQ-05 | ACC-05 | backend/.env.example |
| REQ-06 | ACC-06 | docker-compose.*.yml |
| REQ-07 | ACC-07 | README.md |
