---
id: SPEC-OAUTH-001
type: plan
version: 1.0.0
created: 2026-03-15
updated: 2026-03-15
author: zuge3
tags: [SPEC-OAUTH-001-M1, SPEC-OAUTH-001-M2, SPEC-OAUTH-001-M3, SPEC-OAUTH-001-M4, SPEC-OAUTH-001-M5, SPEC-OAUTH-001-COMMON]
---

# SPEC-OAUTH-001 구현 계획: 소셜 로그인 통합

## 1. 아키텍처 설계

### 1.1 전체 흐름

```
[Frontend]                    [Backend]                      [OAuth Provider]
    |                            |                                |
    |-- 소셜 로그인 버튼 클릭 -->  |                                |
    |                            |-- state 생성, Redis 저장 -----> |
    |  <-- 307 Redirect ---------|                                |
    |                            |                                |
    |-- 제공자 인증 화면 -------> |                                |
    |                            |                   <-- code + state 콜백
    |                            |-- state 검증 ----------------> |
    |                            |-- code → access_token 교환 --> |
    |                            |-- access_token → 사용자 정보 -> |
    |                            |                                |
    |                            |-- User 조회/생성               |
    |                            |-- SocialAccount 저장           |
    |  <-- JWT 발급 + Redirect --|-- 자체 JWT 생성               |
```

### 1.2 백엔드 모듈 구조

```
backend/app/
├── api/v1/
│   └── auth.py                    # 기존 파일에 OAuth 라우트 추가 또는 분리
│   └── oauth.py                   # (신규) OAuth2 전용 라우터
├── models/
│   └── user.py                    # User 모델 수정 (hashed_password nullable)
│   └── social_account.py          # (신규) SocialAccount 모델
├── schemas/
│   └── oauth.py                   # (신규) OAuth 관련 Pydantic 스키마
├── services/
│   └── oauth_service.py           # (신규) OAuth2 비즈니스 로직
│   └── auth_service.py            # 기존 서비스 수정 (소셜 로그인 연동)
├── providers/                     # (신규) OAuth2 제공자별 어댑터
│   ├── __init__.py
│   ├── base.py                    # OAuthProvider 추상 베이스 클래스
│   ├── kakao.py                   # 카카오 OAuth2 구현
│   ├── naver.py                   # 네이버 OAuth2 구현
│   └── google.py                  # 구글 OAuth2 구현
└── core/
    └── config.py                  # OAuth 환경 변수 추가
```

### 1.3 프론트엔드 구조

```
frontend/
├── components/auth/
│   ├── LoginForm.tsx              # 기존 파일에 소셜 로그인 버튼 추가
│   ├── RegisterForm.tsx           # 기존 파일에 소셜 로그인 버튼 추가
│   ├── SocialLoginButtons.tsx     # (신규) 소셜 로그인 버튼 컴포넌트
│   ├── AccountMergeDialog.tsx     # (신규) 계정 병합 확인 다이얼로그
│   └── EmailInputDialog.tsx       # (신규) 카카오 이메일 미동의 시 이메일 입력
├── app/
│   └── auth/
│       └── callback/
│           └── [provider]/
│               └── page.tsx       # (신규) OAuth 콜백 처리 페이지
├── contexts/
│   └── AuthContext.tsx            # 기존 파일 수정 (소셜 로그인 상태 반영)
└── lib/
    └── auth.ts                    # 기존 파일에 소셜 인증 API 함수 추가
```

### 1.4 데이터베이스 변경

**Alembic 마이그레이션 1: User.hashed_password nullable 변경**
- `users.hashed_password` 컬럼을 `NOT NULL` → `NULLABLE`로 변경
- 소셜 로그인 전용 사용자는 비밀번호 없이 가입 가능

**Alembic 마이그레이션 2: social_accounts 테이블 생성**
- `social_accounts` 테이블 생성
- `(provider, provider_user_id)` UNIQUE constraint
- `user_id` → `users.id` FK with CASCADE DELETE
- `(provider, provider_email)` INDEX

---

## 2. 제공자별 OAuth2 세부 사항

### 2.1 카카오 (Kakao)

**Developer Console**: https://developers.kakao.com

| 항목 | 값 |
|------|-----|
| 인증 URL | `https://kauth.kakao.com/oauth/authorize` |
| 토큰 URL | `https://kauth.kakao.com/oauth/token` |
| 사용자 정보 URL | `https://kapi.kakao.com/v2/user/me` |
| 필수 scope | `profile_nickname`, `account_email` (선택 동의) |
| 이메일 제공 방식 | `kakao_account.email` (사용자가 이메일 동의를 거부할 수 있음) |
| 사용자 ID | `id` (정수형) |

**카카오 특이사항**:
- 이메일은 "선택 동의" 항목이므로 사용자가 거부할 수 있음 → 이메일 미제공 시 수동 입력 폼 필요 (REQ-M1-03)
- REST API 키와 Client Secret 모두 필요
- Redirect URI는 카카오 Developer Console에서 사전 등록 필수
- 토큰 교환 시 `Content-Type: application/x-www-form-urlencoded` 사용

### 2.2 네이버 (Naver)

**Developer Console**: https://developers.naver.com

| 항목 | 값 |
|------|-----|
| 인증 URL | `https://nid.naver.com/oauth2.0/authorize` |
| 토큰 URL | `https://nid.naver.com/oauth2.0/token` |
| 사용자 정보 URL | `https://openapi.naver.com/v1/nid/me` |
| 필수 scope | 기본 프로필 (이메일, 이름) |
| 이메일 제공 방식 | `response.email` (필수 동의) |
| 사용자 ID | `response.id` (문자열) |

**네이버 특이사항**:
- 이메일은 필수 동의 항목 (카카오와 다름)
- 사용자 정보 응답이 `response` 객체로 감싸져 있음
- 검수 전까지 등록된 개발자 계정만 로그인 가능
- `state` 파라미터가 네이버에서도 필수

### 2.3 구글 (Google)

**Developer Console**: https://console.cloud.google.com

| 항목 | 값 |
|------|-----|
| 인증 URL | `https://accounts.google.com/o/oauth2/v2/auth` |
| 토큰 URL | `https://oauth2.googleapis.com/token` |
| 사용자 정보 URL | `https://www.googleapis.com/oauth2/v2/userinfo` |
| 필수 scope | `openid email profile` |
| 이메일 제공 방식 | `email` (필수) |
| 사용자 ID | `id` (문자열) |

**구글 특이사항**:
- OpenID Connect 지원으로 `id_token`에서 사용자 정보 추출 가능 (추가 API 호출 불필요)
- 이메일은 항상 필수 제공
- 가장 표준적인 OAuth2 구현

---

## 3. OAuthProvider 추상 설계

```
OAuthProvider (Abstract Base Class):
  - provider_name: str
  - client_id: str
  - client_secret: str
  - authorize_url: str
  - token_url: str
  - userinfo_url: str
  - scopes: list[str]

  Methods:
  - get_authorize_url(state: str, redirect_uri: str) -> str
  - exchange_code(code: str, redirect_uri: str) -> OAuthToken
  - get_user_info(access_token: str) -> OAuthUserInfo
  - normalize_user_info(raw_data: dict) -> OAuthUserInfo

OAuthUserInfo (Pydantic):
  - provider: str
  - provider_user_id: str
  - email: str | None
  - name: str | None
  - profile_image: str | None

OAuthToken (Pydantic):
  - access_token: str
  - refresh_token: str | None
  - token_type: str
  - expires_in: int | None
```

---

## 4. 보안 고려사항

### 4.1 CSRF 방지
- `state` 파라미터: 서버에서 `secrets.token_urlsafe(32)`로 생성
- Redis에 `oauth_state:{state}` 키로 저장 (TTL 5분)
- 콜백 수신 시 Redis에서 검증 후 삭제 (일회용)

### 4.2 소셜 Access Token 보호
- 소셜 제공자의 access token은 클라이언트에 절대 노출하지 않음
- DB 저장 시 `cryptography.fernet`을 사용하여 대칭키 암호화
- 암호화 키는 환경 변수 `SOCIAL_TOKEN_ENCRYPTION_KEY`로 관리

### 4.3 계정 병합 보안
- 이메일 중복 시 자동 병합 금지
- 기존 계정의 비밀번호 확인 필수
- 병합 요청에 임시 `merge_token` 사용 (JWT, 5분 만료)

### 4.4 Redirect URI 검증
- 콜백 URL은 허용 목록에 포함된 도메인만 허용
- 개발 환경: `localhost:8000`, `localhost:3000`
- 프로덕션: 실제 도메인만 허용

---

## 5. 마일스톤

### Primary Goal: 백엔드 OAuth2 인프라 구축

- [ ] OAuthProvider 추상 베이스 클래스 구현
- [ ] 카카오 OAuth2 제공자 구현 (KakaoOAuthProvider)
- [ ] 네이버 OAuth2 제공자 구현 (NaverOAuthProvider)
- [ ] 구글 OAuth2 제공자 구현 (GoogleOAuthProvider)
- [ ] SocialAccount SQLAlchemy 모델 및 Alembic 마이그레이션
- [ ] User.hashed_password nullable 변경 마이그레이션
- [ ] OAuthService 핵심 비즈니스 로직 구현
- [ ] OAuth API 엔드포인트 구현 (authorize, callback)
- [ ] state 파라미터 Redis 기반 CSRF 방지
- [ ] 소셜 access token 암호화 저장

### Secondary Goal: 계정 관리 및 병합

- [ ] 계정 병합 로직 구현 (이메일 중복 감지 + 비밀번호 확인)
- [ ] 소셜 계정 연결/해제 API 구현
- [ ] 마지막 인증 수단 삭제 방지 로직
- [ ] 소셜 전용 계정 로그인 안내 메시지
- [ ] 카카오 이메일 미동의 처리 로직

### Final Goal: 프론트엔드 통합

- [ ] SocialLoginButtons 컴포넌트 구현 (카카오, 네이버, 구글)
- [ ] OAuth 콜백 페이지 구현 (`/auth/callback/[provider]`)
- [ ] LoginForm에 소셜 로그인 버튼 통합
- [ ] RegisterForm에 소셜 로그인 버튼 통합
- [ ] AccountMergeDialog 구현
- [ ] EmailInputDialog 구현 (카카오 이메일 미동의 시)
- [ ] AuthContext 소셜 로그인 상태 반영

### Optional Goal: 테스트 및 품질

- [ ] OAuthProvider 단위 테스트 (제공자별)
- [ ] OAuthService 통합 테스트
- [ ] API 엔드포인트 테스트 (mock 제공자)
- [ ] 프론트엔드 컴포넌트 테스트
- [ ] E2E 테스트 시나리오 (소셜 로그인 흐름)

---

## 6. 리스크 및 대응 방안

### 리스크 1: 카카오 이메일 미동의
- **영향**: 사용자 식별에 이메일 필수이므로 회원가입 불가
- **대응**: 이메일 수동 입력 폼 제공 (REQ-M1-03)

### 리스크 2: 제공자 API 변경
- **영향**: OAuth2 흐름 중단
- **대응**: OAuthProvider 추상화로 제공자별 변경 격리, 구조화된 로깅으로 빠른 감지

### 리스크 3: 제공자 서비스 장애
- **영향**: 소셜 로그인 불가
- **대응**: 이메일/비밀번호 로그인은 항상 유지, 에러 메시지로 대체 로그인 안내

### 리스크 4: 계정 병합 시 데이터 충돌
- **영향**: 동일 이메일에 대한 계정 중복
- **대응**: 병합 전 비밀번호 확인 필수, 트랜잭션으로 원자성 보장

### 리스크 5: 한국 제공자 검수 지연
- **영향**: 카카오/네이버 검수 완료 전 테스트 계정만 로그인 가능
- **대응**: 개발 단계에서 테스트 계정 활용, 검수 신청은 구현 완료 후 진행

---

## 7. 기존 코드 영향 분석

### 변경이 필요한 기존 파일

| 파일 | 변경 내용 |
|------|-----------|
| `backend/app/models/user.py` | `hashed_password` nullable 변경 |
| `backend/app/services/auth_service.py` | 소셜 전용 계정 로그인 시도 처리 |
| `backend/app/core/config.py` | OAuth 환경 변수 추가 |
| `frontend/components/auth/LoginForm.tsx` | 소셜 로그인 버튼 추가 |
| `frontend/components/auth/RegisterForm.tsx` | 소셜 로그인 버튼 추가 |
| `frontend/contexts/AuthContext.tsx` | 소셜 로그인 콜백 처리 로직 |
| `frontend/lib/auth.ts` | 소셜 인증 API 함수 추가 |
| `.env.example` | OAuth 환경 변수 템플릿 추가 |

### 신규 생성 파일

- `backend/app/models/social_account.py`
- `backend/app/providers/base.py`, `kakao.py`, `naver.py`, `google.py`
- `backend/app/services/oauth_service.py`
- `backend/app/api/v1/oauth.py`
- `backend/app/schemas/oauth.py`
- `frontend/components/auth/SocialLoginButtons.tsx`
- `frontend/components/auth/AccountMergeDialog.tsx`
- `frontend/components/auth/EmailInputDialog.tsx`
- `frontend/app/auth/callback/[provider]/page.tsx`
- Alembic 마이그레이션 파일 2개

---

## 8. 전문가 상담 권장

본 SPEC은 다음 도메인 전문가 상담을 권장한다:

- **expert-backend**: OAuth2 흐름 구현, 제공자 어댑터 패턴, 토큰 암호화 전략
- **expert-frontend**: 소셜 로그인 버튼 UI/UX, 콜백 페이지 구현, 계정 병합 다이얼로그
- **expert-security**: CSRF 방지 전략, 토큰 저장 보안, 계정 병합 보안 검토
