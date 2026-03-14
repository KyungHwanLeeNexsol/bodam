---
id: SPEC-OAUTH-001
version: 1.0.0
status: draft
created: 2026-03-15
updated: 2026-03-15
author: zuge3
priority: high
issue_number: 0
tags: [oauth, social-login, kakao, naver, google, jwt, auth]
depends_on: [SPEC-AUTH-001]
---

# SPEC-OAUTH-001: 소셜 로그인 통합 (카카오/네이버/구글)

## HISTORY

| 버전 | 날짜 | 작성자 | 변경 내용 |
|------|------|--------|-----------|
| 1.0.0 | 2026-03-15 | zuge3 | 초기 SPEC 작성 |

---

## 1. 환경 (Environment)

### 1.1 프로젝트 컨텍스트

Bodam(보담)은 AI 기반 한국 보험 보상 안내 플랫폼이다. 본 SPEC은 **소셜 로그인 통합 (Phase 2)**을 정의한다. SPEC-AUTH-001에서 이메일/비밀번호 기반 JWT 인증이 구현 완료된 상태이며, 본 SPEC에서는 카카오, 네이버, 구글 OAuth2 소셜 로그인을 추가하여 사용자 가입 허들을 낮추고, 한국 사용자에게 익숙한 인증 방식을 제공한다.

### 1.2 기존 인프라

- **Backend**: FastAPI 0.135.x, Python 3.13, SQLAlchemy 2.x async (asyncpg)
- **Database**: PostgreSQL 18 + pgvector
- **Frontend**: Next.js 16.1.x, React 19, TypeScript 5, Tailwind CSS 4, shadcn/ui
- **인증**: JWT access token (HS256, 30분 만료), bcrypt 비밀번호 해싱
- **기존 모델**: User (id, email, hashed_password, full_name, is_active)
- **기존 API**: POST /api/v1/auth/register, POST /api/v1/auth/login, GET /api/v1/auth/me
- **프론트엔드**: AuthContext (JWT localStorage 저장), LoginForm, RegisterForm
- **보안**: Rate limiting (SPEC-SEC-001), 보안 헤더 미들웨어

### 1.3 도메인 용어 정의

| 한국어 | 영어 | 설명 |
|--------|------|------|
| 소셜 로그인 | Social Login | OAuth2 기반 외부 제공자 인증 |
| 제공자 | Provider | 카카오, 네이버, 구글 등 OAuth2 인증 서비스 |
| 인가 코드 | Authorization Code | OAuth2 Authorization Code Flow의 임시 코드 |
| 콜백 | Callback | OAuth2 인가 후 리다이렉트되는 엔드포인트 |
| 계정 연결 | Account Linking | 기존 이메일 계정과 소셜 계정 연결 |
| 계정 해제 | Account Unlinking | 연결된 소셜 계정 제거 |
| 소셜 계정 | Social Account | 외부 제공자의 사용자 계정 정보 |

### 1.4 범위 외 (Out of Scope)

- 2단계 인증 (Two-Factor Authentication)
- Auth.js (NextAuth) v5 통합 (향후 마이그레이션 고려)
- Refresh token rotation
- 소셜 제공자 API를 통한 추가 기능 (친구 목록, 프로필 동기화 등)
- Apple ID 로그인
- SAML/OIDC 엔터프라이즈 SSO

---

## 2. 가정 (Assumptions)

- **A1**: 카카오, 네이버, 구글 모두 OAuth2 Authorization Code Flow를 지원한다.
- **A2**: 각 제공자의 Developer Console에서 앱 등록 및 Redirect URI 설정이 완료된 상태로 가정한다.
- **A3**: 소셜 로그인으로 가입한 사용자도 기존 JWT 인증 시스템을 동일하게 사용한다 (소셜 로그인 성공 시 자체 JWT 발급).
- **A4**: 소셜 제공자에서 이메일 정보를 필수로 제공한다고 가정한다 (카카오는 선택 동의이므로 별도 처리 필요).
- **A5**: 동일 이메일로 이메일/비밀번호 계정이 이미 존재하는 경우, 사용자 확인 후 계정을 병합할 수 있다.
- **A6**: 한 사용자가 여러 소셜 제공자를 동시에 연결할 수 있다.
- **A7**: 소셜 로그인 전용 사용자(비밀번호 없음)는 이메일/비밀번호 로그인을 사용할 수 없다.
- **A8**: 환경 변수로 각 제공자의 Client ID와 Client Secret을 관리한다.

---

## 3. 요구사항 (Requirements)

### 모듈 1: 카카오 OAuth2 연동

> TAG: `[SPEC-OAUTH-001-M1]`

**REQ-M1-01** (Event-Driven):
**WHEN** 사용자가 카카오 로그인 버튼을 클릭하면 **THEN** 시스템은 카카오 인증 서버(`kauth.kakao.com/oauth/authorize`)로 리다이렉트해야 한다. 요청에는 `client_id`, `redirect_uri`, `response_type=code`, `state` (CSRF 방지용) 파라미터가 포함되어야 한다.
- 검증: `[ACC-01]`

**REQ-M1-02** (Event-Driven):
**WHEN** 카카오 인증 서버에서 인가 코드와 함께 콜백 URL로 리다이렉트되면 **THEN** 시스템은 인가 코드를 사용하여 카카오 토큰 서버(`kauth.kakao.com/oauth/token`)에서 access token을 발급받고, 카카오 사용자 정보 API(`kapi.kakao.com/v2/user/me`)에서 사용자 프로필(이메일, 닉네임, 프로필 이미지)을 조회해야 한다.
- 검증: `[ACC-02]`

**REQ-M1-03** (State-Driven):
**IF** 카카오에서 이메일 동의가 거부된 경우 **THEN** 시스템은 사용자에게 이메일 입력 폼을 표시하여 수동으로 이메일을 등록할 수 있도록 해야 한다.
- 검증: `[ACC-03]`

**REQ-M1-04** (Ubiquitous):
시스템은 **항상** 카카오 REST API 키를 환경 변수(`KAKAO_CLIENT_ID`, `KAKAO_CLIENT_SECRET`)로 관리해야 한다.
- 검증: `[ACC-04]`

### 모듈 2: 네이버 OAuth2 연동

> TAG: `[SPEC-OAUTH-001-M2]`

**REQ-M2-01** (Event-Driven):
**WHEN** 사용자가 네이버 로그인 버튼을 클릭하면 **THEN** 시스템은 네이버 인증 서버(`nid.naver.com/oauth2.0/authorize`)로 리다이렉트해야 한다. 요청에는 `client_id`, `redirect_uri`, `response_type=code`, `state` (CSRF 방지용) 파라미터가 포함되어야 한다.
- 검증: `[ACC-05]`

**REQ-M2-02** (Event-Driven):
**WHEN** 네이버 인증 서버에서 인가 코드와 함께 콜백 URL로 리다이렉트되면 **THEN** 시스템은 인가 코드를 사용하여 네이버 토큰 서버(`nid.naver.com/oauth2.0/token`)에서 access token을 발급받고, 네이버 프로필 API(`openapi.naver.com/v1/nid/me`)에서 사용자 프로필(이메일, 이름, 프로필 이미지)을 조회해야 한다.
- 검증: `[ACC-06]`

**REQ-M2-03** (Ubiquitous):
시스템은 **항상** 네이버 API 키를 환경 변수(`NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`)로 관리해야 한다.
- 검증: `[ACC-07]`

### 모듈 3: 구글 OAuth2 연동

> TAG: `[SPEC-OAUTH-001-M3]`

**REQ-M3-01** (Event-Driven):
**WHEN** 사용자가 구글 로그인 버튼을 클릭하면 **THEN** 시스템은 구글 인증 서버(`accounts.google.com/o/oauth2/v2/auth`)로 리다이렉트해야 한다. 요청에는 `client_id`, `redirect_uri`, `response_type=code`, `scope=openid email profile`, `state` (CSRF 방지용) 파라미터가 포함되어야 한다.
- 검증: `[ACC-08]`

**REQ-M3-02** (Event-Driven):
**WHEN** 구글 인증 서버에서 인가 코드와 함께 콜백 URL로 리다이렉트되면 **THEN** 시스템은 인가 코드를 사용하여 구글 토큰 서버(`oauth2.googleapis.com/token`)에서 access token을 발급받고, 구글 사용자 정보 API(`www.googleapis.com/oauth2/v2/userinfo`)에서 사용자 프로필(이메일, 이름, 프로필 이미지)을 조회해야 한다.
- 검증: `[ACC-09]`

**REQ-M3-03** (Ubiquitous):
시스템은 **항상** 구글 API 키를 환경 변수(`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`)로 관리해야 한다.
- 검증: `[ACC-10]`

### 모듈 4: 소셜 계정 연결/해제 관리

> TAG: `[SPEC-OAUTH-001-M4]`

**REQ-M4-01** (Ubiquitous):
시스템은 **항상** `social_accounts` 테이블에 소셜 계정 정보를 저장해야 한다. 필수 컬럼: `id` (UUID PK), `user_id` (FK to users.id), `provider` (VARCHAR, NOT NULL), `provider_user_id` (VARCHAR, NOT NULL), `provider_email` (VARCHAR), `provider_name` (VARCHAR), `access_token` (TEXT, 암호화 저장), `created_at`, `updated_at`. `(provider, provider_user_id)` 조합은 UNIQUE이어야 한다.
- 검증: `[ACC-11]`, `[ACC-12]`

**REQ-M4-02** (Event-Driven):
**WHEN** 인증된 사용자가 프로필 페이지에서 소셜 계정 연결을 요청하면 **THEN** 시스템은 해당 제공자의 OAuth2 인증 흐름을 시작하고, 성공 시 `social_accounts` 테이블에 연결 정보를 저장해야 한다.
- 검증: `[ACC-13]`

**REQ-M4-03** (Event-Driven):
**WHEN** 인증된 사용자가 소셜 계정 해제를 요청하면 **THEN** 시스템은 `social_accounts` 테이블에서 해당 연결을 삭제해야 한다.
- 검증: `[ACC-14]`

**REQ-M4-04** (Unwanted):
시스템은 사용자의 마지막 인증 수단(비밀번호 또는 유일한 소셜 계정)을 삭제**하지 않아야 한다**. 최소 1개의 인증 수단이 유지되어야 한다.
- 검증: `[ACC-15]`

**REQ-M4-05** (Ubiquitous):
시스템은 **항상** 다음 API 엔드포인트를 제공해야 한다:
- `GET /api/v1/auth/oauth/{provider}/authorize` - OAuth2 인증 URL 생성 및 리다이렉트
- `GET /api/v1/auth/oauth/{provider}/callback` - OAuth2 콜백 처리
- `GET /api/v1/auth/social-accounts` - 연결된 소셜 계정 목록 조회 (인증 필요)
- `DELETE /api/v1/auth/social-accounts/{provider}` - 소셜 계정 연결 해제 (인증 필요)
- 검증: `[ACC-16]`

### 모듈 5: 기존 이메일 계정과 소셜 계정 병합

> TAG: `[SPEC-OAUTH-001-M5]`

**REQ-M5-01** (Event-Driven):
**WHEN** 소셜 로그인으로 받은 이메일이 기존 이메일/비밀번호 계정과 동일하면 **THEN** 시스템은 자동 병합을 수행하지 않고, 사용자에게 "이미 등록된 이메일입니다. 기존 계정에 소셜 로그인을 연결하시겠습니까?"라는 확인 메시지를 표시해야 한다.
- 검증: `[ACC-17]`

**REQ-M5-02** (Event-Driven):
**WHEN** 사용자가 계정 병합을 승인하면 **THEN** 시스템은 기존 계정의 비밀번호를 확인한 후, 소셜 계정을 기존 `users` 레코드에 연결(`social_accounts` 테이블에 추가)해야 한다.
- 검증: `[ACC-18]`

**REQ-M5-03** (Unwanted):
시스템은 사용자 확인 없이 자동으로 계정을 병합**하지 않아야 한다**. 보안을 위해 반드시 기존 계정의 비밀번호 확인 또는 이메일 인증을 거쳐야 한다.
- 검증: `[ACC-19]`

**REQ-M5-04** (Event-Driven):
**WHEN** 소셜 로그인으로 받은 이메일에 해당하는 기존 계정이 없으면 **THEN** 시스템은 새로운 User 레코드를 생성하고 (`hashed_password`는 NULL 허용), 소셜 계정 정보를 `social_accounts` 테이블에 저장하고, 자체 JWT를 발급해야 한다.
- 검증: `[ACC-20]`

**REQ-M5-05** (State-Driven):
**IF** 사용자가 소셜 로그인 전용 계정(비밀번호 없음)이면 **THEN** 이메일/비밀번호 로그인 시도 시 "소셜 로그인으로 가입된 계정입니다. 카카오/네이버/구글로 로그인해주세요."라는 안내 메시지를 반환해야 한다.
- 검증: `[ACC-21]`

### 공통 요구사항

> TAG: `[SPEC-OAUTH-001-COMMON]`

**REQ-C-01** (Ubiquitous):
시스템은 **항상** OAuth2 Authorization Code Flow에서 `state` 파라미터를 사용하여 CSRF 공격을 방지해야 한다. `state` 값은 서버에서 생성한 랜덤 문자열이며, 콜백 시 검증해야 한다.
- 검증: `[ACC-22]`

**REQ-C-02** (Unwanted):
시스템은 소셜 제공자로부터 받은 access token을 클라이언트에 노출**하지 않아야 한다**. 소셜 access token은 서버에서만 사용하고, 클라이언트에는 자체 JWT만 발급해야 한다.
- 검증: `[ACC-23]`

**REQ-C-03** (Ubiquitous):
시스템은 **항상** 소셜 로그인 콜백 처리 시간을 3초 이내로 유지해야 한다 (외부 API 호출 포함).
- 검증: `[ACC-24]`

**REQ-C-04** (Event-Driven):
**WHEN** 소셜 제공자 API 호출이 실패하면 (타임아웃, 서버 오류 등) **THEN** 시스템은 사용자에게 "소셜 로그인에 실패했습니다. 잠시 후 다시 시도해주세요."라는 오류 메시지를 표시하고, 오류를 구조화된 로그로 기록해야 한다.
- 검증: `[ACC-25]`

**REQ-C-05** (Ubiquitous):
시스템은 **항상** 소셜 로그인 관련 API 엔드포인트에 Rate Limiting을 적용해야 한다 (기존 SPEC-SEC-001 Rate Limiting 정책 준수).
- 검증: `[ACC-26]`

---

## 4. 사양 (Specifications)

### 4.1 기술 스택

| 구분 | 기술 | 버전/용도 |
|------|------|-----------|
| HTTP Client | httpx | >=0.27.0 (비동기 OAuth2 API 호출) |
| 암호화 | cryptography | >=43.0.0 (소셜 access token 암호화 저장) |
| 상태 관리 | Redis | 기존 Redis 7.x (state 파라미터 임시 저장) |

### 4.2 데이터 모델

```
SocialAccount:
  id: UUID (PK, default=gen_random_uuid())
  user_id: UUID (FK -> users.id, ON DELETE CASCADE, NOT NULL)
  provider: VARCHAR(20) (NOT NULL) -- 'kakao', 'naver', 'google'
  provider_user_id: VARCHAR(255) (NOT NULL)
  provider_email: VARCHAR(255) (NULLABLE)
  provider_name: VARCHAR(100) (NULLABLE)
  access_token: TEXT (NULLABLE, 암호화 저장)
  created_at: TIMESTAMP WITH TIME ZONE (DEFAULT NOW())
  updated_at: TIMESTAMP WITH TIME ZONE (DEFAULT NOW(), ON UPDATE)

  UNIQUE CONSTRAINT: (provider, provider_user_id)
  INDEX: user_id
  INDEX: (provider, provider_email)
```

User 모델 변경:
```
User:
  hashed_password: VARCHAR(255) -> NULLABLE 변경 (소셜 전용 계정 지원)
```

### 4.3 API 계약

```
GET /api/v1/auth/oauth/{provider}/authorize
  Path: provider = 'kakao' | 'naver' | 'google'
  Query: redirect_uri (optional, 프론트엔드 최종 리다이렉트 URL)
  Response 307: Location 헤더에 제공자 인증 URL
  Response 400: { detail: "지원하지 않는 소셜 로그인 제공자입니다" }

GET /api/v1/auth/oauth/{provider}/callback
  Path: provider = 'kakao' | 'naver' | 'google'
  Query: code (인가 코드), state (CSRF 검증용)
  Response 200: { access_token: string, token_type: "bearer", is_new_user: bool }
  Response 400: { detail: "유효하지 않은 state 값입니다" }
  Response 409: { detail: "이미 등록된 이메일입니다", action: "merge", provider: string }
  Response 502: { detail: "소셜 로그인 서비스에 일시적 오류가 발생했습니다" }

POST /api/v1/auth/oauth/merge
  Header: Authorization: Bearer <token> (선택) 또는 merge_token
  Body: { provider: string, merge_token: string, password: string }
  Response 200: { access_token: string, token_type: "bearer" }
  Response 401: { detail: "비밀번호가 올바르지 않습니다" }

GET /api/v1/auth/social-accounts
  Header: Authorization: Bearer <token>
  Response 200: [{ provider: string, provider_email: string, provider_name: string, connected_at: datetime }]

DELETE /api/v1/auth/social-accounts/{provider}
  Header: Authorization: Bearer <token>
  Path: provider = 'kakao' | 'naver' | 'google'
  Response 204: (성공)
  Response 400: { detail: "마지막 인증 수단은 삭제할 수 없습니다" }
  Response 404: { detail: "연결된 소셜 계정이 없습니다" }
```

### 4.4 OAuth2 Flow

```
1. 프론트엔드 → GET /api/v1/auth/oauth/{provider}/authorize
2. 백엔드 → state 생성 → Redis에 저장 (TTL 5분) → 307 Redirect to Provider
3. 사용자 → 제공자 인증 화면에서 동의
4. 제공자 → GET /api/v1/auth/oauth/{provider}/callback?code=xxx&state=yyy
5. 백엔드 → state 검증 → 인가 코드로 access token 교환 → 사용자 정보 조회
6. 백엔드 → 사용자 조회/생성 → 자체 JWT 발급 → 프론트엔드로 리다이렉트
```

### 4.5 환경 변수

```
# 카카오
KAKAO_CLIENT_ID=
KAKAO_CLIENT_SECRET=
KAKAO_REDIRECT_URI=http://localhost:8000/api/v1/auth/oauth/kakao/callback

# 네이버
NAVER_CLIENT_ID=
NAVER_CLIENT_SECRET=
NAVER_REDIRECT_URI=http://localhost:8000/api/v1/auth/oauth/naver/callback

# 구글
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:8000/api/v1/auth/oauth/google/callback

# 소셜 토큰 암호화
SOCIAL_TOKEN_ENCRYPTION_KEY=
```

### 4.6 추적성 (Traceability)

| 요구사항 | 검증 기준 | 모듈 |
|----------|-----------|------|
| REQ-M1-01~04 | ACC-01~04 | 카카오 OAuth2 |
| REQ-M2-01~03 | ACC-05~07 | 네이버 OAuth2 |
| REQ-M3-01~03 | ACC-08~10 | 구글 OAuth2 |
| REQ-M4-01~05 | ACC-11~16 | 소셜 계정 관리 |
| REQ-M5-01~05 | ACC-17~21 | 계정 병합 |
| REQ-C-01~05 | ACC-22~26 | 공통 요구사항 |
