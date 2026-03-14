---
id: SPEC-AUTH-001
version: 1.1.0
status: completed
created: 2026-03-14
updated: 2026-03-14
author: zuge3
priority: P0
issue_number: 0
tags: [auth, jwt, bcrypt, login, register, middleware, security]
depends_on: [SPEC-CHAT-001, SPEC-FRONTEND-001]
---

# SPEC-AUTH-001: 사용자 인증 시스템 - Bodam (보담)

## HISTORY

| 버전 | 날짜 | 작성자 | 변경 내용 |
|------|------|--------|-----------|
| 1.0.0 | 2026-03-14 | zuge3 | 초기 SPEC 작성 |

---

## 1. 환경 (Environment)

### 1.1 프로젝트 컨텍스트

Bodam(보담)은 AI 기반 한국 보험 보상 안내 플랫폼이다. 본 SPEC은 **사용자 인증 시스템 (MVP Phase 1)**을 정의한다. 현재 모든 채팅 엔드포인트가 공개 상태이며, 사용자 모델이 존재하지 않는다. 이메일/비밀번호 기반 회원가입/로그인, JWT 인증, 보호된 엔드포인트, 프론트엔드 인증 UI를 구현한다.

### 1.2 기존 인프라

- **Backend**: FastAPI 0.135.x, Python 3.13, SQLAlchemy 2.x async (asyncpg)
- **Database**: PostgreSQL 18 + pgvector
- **Frontend**: Next.js 16.1.x, React 19, TypeScript 5, Tailwind CSS 4, shadcn/ui
- **Testing Backend**: pytest + pytest-asyncio
- **Testing Frontend**: Vitest + React Testing Library
- **Migration**: Alembic (기존 마이그레이션 존재)
- **기존 모델**: InsuranceCompany, Policy, Coverage, PolicyChunk, ChatSession, ChatMessage
- **현재 상태**:
  - `ChatSession.user_id`는 TEXT 타입, nullable (FK 없음, User 모델 없음)
  - 인증 미들웨어 없음
  - 로그인 페이지는 "준비 중" 플레이스홀더 상태

### 1.3 도메인 용어 정의

| 한국어 | 영어 | 설명 |
|--------|------|------|
| 사용자 | User | 보담 플랫폼 등록 사용자 |
| 회원가입 | Registration | 이메일/비밀번호로 계정 생성 |
| 로그인 | Login | 인증 자격 증명으로 세션 시작 |
| 액세스 토큰 | Access Token | JWT 기반 인증 토큰 |
| 보호된 경로 | Protected Route | 인증 필요한 페이지/엔드포인트 |

### 1.4 범위 외 (Phase 2)

- 소셜 로그인 (Kakao, Naver, Google)
- Auth.js v5 통합
- 이메일 인증
- Refresh token rotation
- 비밀번호 재설정
- 인증 엔드포인트 Rate limiting

---

## 2. 가정 (Assumptions)

- **A1**: PostgreSQL 18이 UUID 생성 (`gen_random_uuid()`)을 지원한다.
- **A2**: 기존 `ChatSession` 테이블에 데이터가 있을 수 있으므로, `user_id` 마이그레이션은 nullable을 유지하되 FK를 추가한다.
- **A3**: JWT access token만으로 MVP를 구현하며, refresh token은 Phase 2에서 추가한다.
- **A4**: 비밀번호 정책은 최소 8자, 영문+숫자 조합으로 한다.
- **A5**: 프론트엔드는 JWT를 localStorage 또는 쿠키에 저장한다 (MVP에서는 localStorage).
- **A6**: passlib[bcrypt]과 python-jose[cryptography]가 Python 3.13과 호환된다.

---

## 3. 요구사항 (Requirements)

### 모듈 1: UserModel - 사용자 모델 및 데이터베이스

> TAG: `[SPEC-AUTH-001-M1]`

**REQ-M1-01** (Ubiquitous):
시스템은 **항상** 사용자 정보를 `users` 테이블에 저장해야 한다. 필수 컬럼: `id` (UUID PK), `email` (UNIQUE, NOT NULL), `hashed_password` (NOT NULL), `full_name` (NOT NULL), `is_active` (BOOLEAN, DEFAULT TRUE), `created_at`, `updated_at`.
- 검증: `[ACC-01]`, `[ACC-02]`

**REQ-M1-02** (Ubiquitous):
시스템은 **항상** 이메일 주소를 대소문자 구분 없이 고유하게 관리해야 한다.
- 검증: `[ACC-03]`

**REQ-M1-03** (Event-Driven):
**WHEN** User 모델이 생성될 때 **THEN** `ChatSession.user_id` 컬럼을 TEXT에서 UUID로 변경하고 `users.id`에 대한 FK를 추가하는 Alembic 마이그레이션을 제공해야 한다.
- 검증: `[ACC-04]`

**REQ-M1-04** (Unwanted):
시스템은 비밀번호를 평문으로 저장**하지 않아야 한다**. 반드시 bcrypt 해싱을 적용해야 한다.
- 검증: `[ACC-05]`

### 모듈 2: AuthService - 인증 서비스

> TAG: `[SPEC-AUTH-001-M2]`

**REQ-M2-01** (Event-Driven):
**WHEN** 사용자가 유효한 이메일, 비밀번호, 이름으로 회원가입 요청을 보내면 **THEN** 비밀번호를 bcrypt로 해싱하고 사용자를 생성하여 사용자 정보를 반환해야 한다.
- 검증: `[ACC-06]`, `[ACC-07]`

**REQ-M2-02** (Event-Driven):
**WHEN** 사용자가 올바른 이메일과 비밀번호로 로그인 요청을 보내면 **THEN** JWT access token을 발급해야 한다. 토큰에는 `sub` (user_id), `exp` (만료시간) claim이 포함되어야 한다.
- 검증: `[ACC-08]`, `[ACC-09]`

**REQ-M2-03** (Unwanted):
시스템은 이미 등록된 이메일로의 중복 회원가입을 허용**하지 않아야 한다**. HTTP 409 Conflict를 반환해야 한다.
- 검증: `[ACC-10]`

**REQ-M2-04** (Unwanted):
시스템은 비활성(`is_active=False`) 사용자의 로그인을 허용**하지 않아야 한다**. HTTP 403 Forbidden을 반환해야 한다.
- 검증: `[ACC-11]`

**REQ-M2-05** (State-Driven):
**IF** 비밀번호가 8자 미만이거나 영문 또는 숫자만으로 구성되면 **THEN** HTTP 422와 함께 비밀번호 정책 위반 메시지를 반환해야 한다.
- 검증: `[ACC-12]`

### 모듈 3: AuthAPI - 인증 API 엔드포인트

> TAG: `[SPEC-AUTH-001-M3]`

**REQ-M3-01** (Ubiquitous):
시스템은 **항상** 다음 API 엔드포인트를 제공해야 한다:
- `POST /api/v1/auth/register` - 회원가입
- `POST /api/v1/auth/login` - 로그인
- `GET /api/v1/auth/me` - 현재 사용자 정보 조회 (인증 필요)
- 검증: `[ACC-06]`, `[ACC-08]`, `[ACC-13]`

**REQ-M3-02** (Event-Driven):
**WHEN** 잘못된 자격 증명으로 로그인 요청이 오면 **THEN** HTTP 401 Unauthorized를 반환해야 하며, 이메일 존재 여부를 노출하지 않는 일반적인 오류 메시지를 사용해야 한다.
- 검증: `[ACC-14]`

**REQ-M3-03** (Ubiquitous):
시스템은 **항상** 로그인 응답 시간을 500ms 이내로 유지해야 한다.
- 검증: `[ACC-15]`

### 모듈 4: AuthMiddleware - 인증 미들웨어 및 기존 엔드포인트 보호

> TAG: `[SPEC-AUTH-001-M4]`

**REQ-M4-01** (Ubiquitous):
시스템은 **항상** `get_current_user` FastAPI Dependency를 제공하여 `Authorization: Bearer <token>` 헤더에서 JWT를 검증하고 현재 사용자를 반환해야 한다.
- 검증: `[ACC-16]`, `[ACC-17]`

**REQ-M4-02** (Event-Driven):
**WHEN** 만료되었거나 유효하지 않은 JWT 토큰이 전달되면 **THEN** HTTP 401 Unauthorized를 반환해야 한다.
- 검증: `[ACC-17]`, `[ACC-18]`

**REQ-M4-03** (State-Driven):
**IF** 사용자가 인증된 상태이면 **THEN** 채팅 세션 생성 시 `user_id`를 자동으로 설정하고, 사용자는 자신의 채팅 세션만 조회할 수 있어야 한다.
- 검증: `[ACC-19]`, `[ACC-20]`

**REQ-M4-04** (Ubiquitous):
시스템은 **항상** JWT 검증 처리 시간을 50ms 이내로 유지해야 한다.
- 검증: `[ACC-21]`

### 모듈 5: AuthFrontend - 프론트엔드 인증 UI 및 상태관리

> TAG: `[SPEC-AUTH-001-M5]`

**REQ-M5-01** (Ubiquitous):
시스템은 **항상** 로그인 페이지(`/login`)와 회원가입 페이지(`/register`)를 제공해야 한다. react-hook-form + zod를 사용하여 클라이언트 측 폼 유효성 검사를 수행해야 한다.
- 검증: `[ACC-22]`, `[ACC-23]`

**REQ-M5-02** (Event-Driven):
**WHEN** 사용자가 성공적으로 로그인하면 **THEN** JWT 토큰을 저장하고, AuthContext를 업데이트하고, 채팅 페이지(`/chat`)로 리다이렉트해야 한다.
- 검증: `[ACC-24]`

**REQ-M5-03** (State-Driven):
**IF** 인증되지 않은 사용자가 보호된 경로(`/chat`, `/chat/[id]`)에 접근하면 **THEN** 로그인 페이지로 리다이렉트해야 한다.
- 검증: `[ACC-25]`

**REQ-M5-04** (Event-Driven):
**WHEN** API 요청에서 401 응답을 받으면 **THEN** 저장된 토큰을 삭제하고 로그인 페이지로 리다이렉트해야 한다.
- 검증: `[ACC-26]`

**REQ-M5-05** (Event-Driven):
**WHEN** 폼 유효성 검사 실패 또는 API 오류 발생 시 **THEN** 사용자에게 한국어로 명확한 오류 메시지를 표시해야 한다.
- 검증: `[ACC-27]`

---

## 4. 사양 (Specifications)

### 4.1 기술 스택

| 구분 | 기술 | 버전 |
|------|------|------|
| 비밀번호 해싱 | passlib[bcrypt] | >=1.7.0 |
| JWT | python-jose[cryptography] | >=3.3.0 |
| 폼 관리 | react-hook-form | >=7.0.0 |
| 스키마 유효성 검사 | zod | >=3.0.0 |
| Zod 통합 | @hookform/resolvers | >=3.0.0 |

### 4.2 데이터 모델

```
User:
  id: UUID (PK, default=gen_random_uuid())
  email: VARCHAR(255) (UNIQUE, NOT NULL, LOWER INDEX)
  hashed_password: VARCHAR(255) (NOT NULL)
  full_name: VARCHAR(100) (NOT NULL)
  is_active: BOOLEAN (DEFAULT TRUE)
  created_at: TIMESTAMP WITH TIME ZONE (DEFAULT NOW())
  updated_at: TIMESTAMP WITH TIME ZONE (DEFAULT NOW(), ON UPDATE)
```

### 4.3 API 계약

```
POST /api/v1/auth/register
  Request: { email: string, password: string, full_name: string }
  Response 201: { id: uuid, email: string, full_name: string, is_active: bool }
  Response 409: { detail: "이미 등록된 이메일입니다" }
  Response 422: { detail: "비밀번호 정책 위반: ..." }

POST /api/v1/auth/login
  Request: { email: string, password: string } (OAuth2PasswordRequestForm)
  Response 200: { access_token: string, token_type: "bearer" }
  Response 401: { detail: "이메일 또는 비밀번호가 올바르지 않습니다" }
  Response 403: { detail: "비활성화된 계정입니다" }

GET /api/v1/auth/me
  Header: Authorization: Bearer <token>
  Response 200: { id: uuid, email: string, full_name: string, is_active: bool }
  Response 401: { detail: "인증 정보가 유효하지 않습니다" }
```

### 4.4 JWT 설정

- Algorithm: HS256
- Expiration: 30분 (환경 변수로 설정 가능)
- Secret Key: 환경 변수 `SECRET_KEY`에서 로드
- Claims: `sub` (user_id as string), `exp` (만료 시각)

### 4.5 추적성 (Traceability)

| 요구사항 | 검증 기준 | 모듈 |
|----------|-----------|------|
| REQ-M1-01~04 | ACC-01~05 | UserModel |
| REQ-M2-01~05 | ACC-06~12 | AuthService |
| REQ-M3-01~03 | ACC-06,08,13~15 | AuthAPI |
| REQ-M4-01~04 | ACC-16~21 | AuthMiddleware |
| REQ-M5-01~05 | ACC-22~27 | AuthFrontend |

---

## 5. 구현 기록 (Implementation Notes)

**상태 변경**: draft → implemented

**커밋**: 210bbf8

**기술 선택사항**:
- bcrypt: Python 3.13 호환성을 위해 passlib 대신 bcrypt를 직접 사용
- JWT: python-jose[cryptography] 사용
- 변경 내용: 32 파일 변경, +3,391 줄

**테스트 커버리지**:
- Backend: 500 테스트 (신규 63개)
- Frontend: 116 테스트 (신규 15개)

**구현 완료 항목**:
- User SQLAlchemy 모델 및 데이터베이스 마이그레이션
- bcrypt 해싱 및 JWT 토큰 발급
- FastAPI 인증 엔드포인트 (register, login, me)
- get_current_user FastAPI Dependency
- 보호된 채팅 엔드포인트
- 프론트엔드 로그인/회원가입 폼 (react-hook-form + zod)
- AuthContext를 사용한 프론트엔드 인증 상태 관리
- 미들웨어를 통한 보호된 라우트
