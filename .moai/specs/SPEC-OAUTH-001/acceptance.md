---
id: SPEC-OAUTH-001
type: acceptance
version: 1.0.0
created: 2026-03-15
updated: 2026-03-15
author: zuge3
tags: [SPEC-OAUTH-001-M1, SPEC-OAUTH-001-M2, SPEC-OAUTH-001-M3, SPEC-OAUTH-001-M4, SPEC-OAUTH-001-M5, SPEC-OAUTH-001-COMMON]
---

# SPEC-OAUTH-001 수락 기준: 소셜 로그인 통합

## 모듈 1: 카카오 OAuth2 연동

### ACC-01: 카카오 인증 URL 리다이렉트

```gherkin
Given 사용자가 로그인 페이지에 있다
When 사용자가 "카카오로 로그인" 버튼을 클릭한다
Then 시스템은 GET /api/v1/auth/oauth/kakao/authorize 를 호출한다
And 서버는 state 파라미터를 생성하여 Redis에 저장한다 (TTL 5분)
And 서버는 HTTP 307 응답으로 카카오 인증 URL로 리다이렉트한다
And 리다이렉트 URL에 client_id, redirect_uri, response_type=code, state 파라미터가 포함된다
```

### ACC-02: 카카오 콜백 처리 및 로그인 성공

```gherkin
Given 사용자가 카카오 인증을 완료하여 인가 코드가 발급되었다
When 카카오 서버가 GET /api/v1/auth/oauth/kakao/callback?code={code}&state={state} 로 리다이렉트한다
Then 서버는 Redis에서 state 값을 검증한다
And 서버는 인가 코드로 카카오 토큰 서버에서 access token을 발급받는다
And 서버는 access token으로 카카오 사용자 정보 API에서 이메일, 닉네임을 조회한다
And 서버는 사용자 정보로 User 레코드를 조회하거나 생성한다
And 서버는 SocialAccount 레코드를 생성하거나 업데이트한다
And 서버는 자체 JWT access token을 발급하여 프론트엔드로 리다이렉트한다
```

### ACC-03: 카카오 이메일 미동의 시 수동 입력

```gherkin
Given 사용자가 카카오 인증에서 이메일 동의를 거부했다
When 카카오 콜백에서 이메일 정보가 없는 상태로 처리된다
Then 서버는 임시 토큰과 함께 이메일 입력 필요 응답을 반환한다
And 프론트엔드는 이메일 입력 다이얼로그를 표시한다
And 사용자가 이메일을 입력하면 해당 이메일로 계정이 생성된다
```

### ACC-04: 카카오 환경 변수 관리

```gherkin
Given 서버가 시작된다
When OAuth 설정을 로드한다
Then KAKAO_CLIENT_ID 환경 변수가 설정되어 있어야 한다
And KAKAO_CLIENT_SECRET 환경 변수가 설정되어 있어야 한다
And 환경 변수가 없으면 카카오 로그인 엔드포인트가 비활성화된다
```

---

## 모듈 2: 네이버 OAuth2 연동

### ACC-05: 네이버 인증 URL 리다이렉트

```gherkin
Given 사용자가 로그인 페이지에 있다
When 사용자가 "네이버로 로그인" 버튼을 클릭한다
Then 시스템은 GET /api/v1/auth/oauth/naver/authorize 를 호출한다
And 서버는 state 파라미터를 생성하여 Redis에 저장한다 (TTL 5분)
And 서버는 HTTP 307 응답으로 네이버 인증 URL로 리다이렉트한다
And 리다이렉트 URL에 client_id, redirect_uri, response_type=code, state 파라미터가 포함된다
```

### ACC-06: 네이버 콜백 처리 및 로그인 성공

```gherkin
Given 사용자가 네이버 인증을 완료하여 인가 코드가 발급되었다
When 네이버 서버가 GET /api/v1/auth/oauth/naver/callback?code={code}&state={state} 로 리다이렉트한다
Then 서버는 Redis에서 state 값을 검증한다
And 서버는 인가 코드로 네이버 토큰 서버에서 access token을 발급받는다
And 서버는 access token으로 네이버 프로필 API에서 이메일, 이름을 조회한다
And 서버는 사용자 정보로 User 레코드를 조회하거나 생성한다
And 서버는 SocialAccount 레코드를 생성하거나 업데이트한다
And 서버는 자체 JWT access token을 발급하여 프론트엔드로 리다이렉트한다
```

### ACC-07: 네이버 환경 변수 관리

```gherkin
Given 서버가 시작된다
When OAuth 설정을 로드한다
Then NAVER_CLIENT_ID 환경 변수가 설정되어 있어야 한다
And NAVER_CLIENT_SECRET 환경 변수가 설정되어 있어야 한다
And 환경 변수가 없으면 네이버 로그인 엔드포인트가 비활성화된다
```

---

## 모듈 3: 구글 OAuth2 연동

### ACC-08: 구글 인증 URL 리다이렉트

```gherkin
Given 사용자가 로그인 페이지에 있다
When 사용자가 "구글로 로그인" 버튼을 클릭한다
Then 시스템은 GET /api/v1/auth/oauth/google/authorize 를 호출한다
And 서버는 state 파라미터를 생성하여 Redis에 저장한다 (TTL 5분)
And 서버는 HTTP 307 응답으로 구글 인증 URL로 리다이렉트한다
And 리다이렉트 URL에 client_id, redirect_uri, response_type=code, scope=openid+email+profile, state 파라미터가 포함된다
```

### ACC-09: 구글 콜백 처리 및 로그인 성공

```gherkin
Given 사용자가 구글 인증을 완료하여 인가 코드가 발급되었다
When 구글 서버가 GET /api/v1/auth/oauth/google/callback?code={code}&state={state} 로 리다이렉트한다
Then 서버는 Redis에서 state 값을 검증한다
And 서버는 인가 코드로 구글 토큰 서버에서 access token을 발급받는다
And 서버는 access token으로 구글 사용자 정보 API에서 이메일, 이름을 조회한다
And 서버는 사용자 정보로 User 레코드를 조회하거나 생성한다
And 서버는 SocialAccount 레코드를 생성하거나 업데이트한다
And 서버는 자체 JWT access token을 발급하여 프론트엔드로 리다이렉트한다
```

### ACC-10: 구글 환경 변수 관리

```gherkin
Given 서버가 시작된다
When OAuth 설정을 로드한다
Then GOOGLE_CLIENT_ID 환경 변수가 설정되어 있어야 한다
And GOOGLE_CLIENT_SECRET 환경 변수가 설정되어 있어야 한다
And 환경 변수가 없으면 구글 로그인 엔드포인트가 비활성화된다
```

---

## 모듈 4: 소셜 계정 연결/해제 관리

### ACC-11: SocialAccount 테이블 생성

```gherkin
Given Alembic 마이그레이션이 실행된다
When social_accounts 테이블이 생성된다
Then 테이블에 id (UUID PK), user_id (FK), provider, provider_user_id, provider_email, provider_name, access_token, created_at, updated_at 컬럼이 존재한다
And (provider, provider_user_id) UNIQUE constraint가 적용된다
And user_id에 INDEX가 생성된다
And users.id에 대한 FK constraint가 CASCADE DELETE로 설정된다
```

### ACC-12: SocialAccount 데이터 무결성

```gherkin
Given 사용자가 카카오로 로그인에 성공했다
When SocialAccount 레코드가 생성된다
Then provider 필드에 'kakao'가 저장된다
And provider_user_id 필드에 카카오 사용자 ID가 저장된다
And access_token은 암호화된 상태로 저장된다
And 동일한 provider + provider_user_id 조합으로 중복 생성이 불가능하다
```

### ACC-13: 인증된 사용자의 소셜 계정 연결

```gherkin
Given 사용자가 이메일/비밀번호로 로그인된 상태이다
When 사용자가 프로필 페이지에서 "네이버 계정 연결" 버튼을 클릭한다
Then 시스템은 네이버 OAuth2 인증 흐름을 시작한다
And 인증 완료 후 social_accounts 테이블에 새 레코드가 추가된다
And 사용자는 이후 네이버 로그인으로도 접근할 수 있다
```

### ACC-14: 소셜 계정 해제

```gherkin
Given 사용자가 카카오와 네이버 계정이 연결된 상태이다
And 사용자가 이메일/비밀번호 인증도 설정된 상태이다
When 사용자가 DELETE /api/v1/auth/social-accounts/kakao 를 요청한다
Then 카카오 소셜 계정 연결이 해제된다
And social_accounts 테이블에서 해당 레코드가 삭제된다
And 응답 코드는 204 No Content 이다
```

### ACC-15: 마지막 인증 수단 삭제 방지

```gherkin
Given 사용자가 소셜 로그인 전용 계정이다 (비밀번호 없음)
And 카카오 계정만 연결된 상태이다
When 사용자가 DELETE /api/v1/auth/social-accounts/kakao 를 요청한다
Then 서버는 HTTP 400 응답을 반환한다
And 응답 본문에 "마지막 인증 수단은 삭제할 수 없습니다" 메시지가 포함된다
And 카카오 소셜 계정 연결은 유지된다
```

### ACC-16: 소셜 계정 API 엔드포인트

```gherkin
Given OAuth API 엔드포인트가 구현되어 있다
When API 문서를 확인한다
Then 다음 엔드포인트가 존재한다:
  | Method | Path | 설명 |
  | GET | /api/v1/auth/oauth/{provider}/authorize | 인증 URL 리다이렉트 |
  | GET | /api/v1/auth/oauth/{provider}/callback | 콜백 처리 |
  | GET | /api/v1/auth/social-accounts | 연결된 소셜 계정 목록 |
  | DELETE | /api/v1/auth/social-accounts/{provider} | 소셜 계정 해제 |
And 지원되지 않는 provider 값에 대해 HTTP 400 응답을 반환한다
```

---

## 모듈 5: 기존 이메일 계정과 소셜 계정 병합

### ACC-17: 이메일 중복 시 병합 안내

```gherkin
Given 이메일 user@example.com으로 이메일/비밀번호 계정이 존재한다
When 사용자가 동일한 이메일의 카카오 계정으로 소셜 로그인을 시도한다
Then 서버는 HTTP 409 응답을 반환한다
And 응답에 action="merge", provider="kakao" 정보가 포함된다
And 프론트엔드는 "이미 등록된 이메일입니다. 기존 계정에 소셜 로그인을 연결하시겠습니까?" 다이얼로그를 표시한다
And 자동 병합은 수행되지 않는다
```

### ACC-18: 계정 병합 승인 및 비밀번호 확인

```gherkin
Given 사용자가 계정 병합 다이얼로그에서 "연결" 버튼을 클릭했다
When 사용자가 기존 계정의 비밀번호를 입력하고 제출한다
Then 서버는 POST /api/v1/auth/oauth/merge 를 처리한다
And 서버는 입력된 비밀번호가 기존 계정의 해시와 일치하는지 확인한다
And 비밀번호가 올바르면 social_accounts 테이블에 소셜 계정을 추가한다
And 자체 JWT access token을 발급하여 로그인 상태로 전환한다
```

### ACC-19: 자동 병합 금지

```gherkin
Given 이메일 user@example.com으로 이메일/비밀번호 계정이 존재한다
When 동일 이메일의 소셜 계정으로 로그인을 시도한다
Then 시스템은 자동으로 계정을 병합하지 않는다
And 반드시 사용자의 명시적 동의와 비밀번호 확인을 거쳐야 한다
And 비밀번호가 틀리면 HTTP 401 응답을 반환한다
```

### ACC-20: 소셜 로그인으로 신규 사용자 생성

```gherkin
Given 이메일 newuser@example.com에 해당하는 기존 계정이 없다
When 사용자가 구글 계정으로 소셜 로그인을 시도한다
Then 서버는 새로운 User 레코드를 생성한다 (hashed_password는 NULL)
And 서버는 SocialAccount 레코드를 생성한다 (provider='google')
And 서버는 자체 JWT access token을 발급한다
And 응답에 is_new_user=true가 포함된다
```

### ACC-21: 소셜 전용 계정 이메일/비밀번호 로그인 시도

```gherkin
Given 사용자가 구글 소셜 로그인으로만 가입했다 (비밀번호 없음)
When 사용자가 POST /api/v1/auth/login 에 이메일과 임의의 비밀번호로 로그인을 시도한다
Then 서버는 HTTP 401 응답을 반환한다
And 응답 메시지에 "소셜 로그인으로 가입된 계정입니다. 구글로 로그인해주세요." 안내가 포함된다
```

---

## 공통 요구사항

### ACC-22: CSRF 방지를 위한 state 파라미터 검증

```gherkin
Given 사용자가 소셜 로그인을 시작하여 state 파라미터가 생성되었다
When 공격자가 위조된 state 값으로 콜백 URL에 접근한다
Then 서버는 Redis에서 state 값을 조회한다
And 일치하는 state가 없으므로 HTTP 400 응답을 반환한다
And 응답 메시지에 "유효하지 않은 state 값입니다" 가 포함된다
And 인가 코드 교환은 수행되지 않는다
```

### ACC-23: 소셜 Access Token 클라이언트 비노출

```gherkin
Given 사용자가 카카오 소셜 로그인에 성공했다
When 서버가 콜백 처리를 완료한다
Then 프론트엔드에 반환되는 응답에 카카오 access token이 포함되지 않는다
And 프론트엔드에는 자체 JWT access token만 전달된다
And 카카오 access token은 서버 DB에 암호화되어 저장된다
```

### ACC-24: 소셜 로그인 콜백 응답 시간

```gherkin
Given 소셜 제공자 API가 정상 동작 중이다
When 사용자가 소셜 로그인 콜백을 수신한다
Then 전체 콜백 처리 시간 (state 검증 + 토큰 교환 + 사용자 정보 조회 + JWT 발급)이 3초 이내에 완료된다
```

### ACC-25: 소셜 제공자 API 오류 처리

```gherkin
Given 카카오 토큰 서버가 일시적으로 응답하지 않는다
When 사용자가 카카오 소셜 로그인 콜백을 수신한다
Then 서버는 HTTP 502 응답을 반환한다
And 응답 메시지에 "소셜 로그인 서비스에 일시적 오류가 발생했습니다" 가 포함된다
And 오류 상세 정보가 구조화된 로그로 기록된다 (provider, error_type, timestamp)
And 사용자의 기존 데이터에는 영향이 없다
```

### ACC-26: Rate Limiting 적용

```gherkin
Given 소셜 로그인 API 엔드포인트가 구현되어 있다
When 동일 IP에서 단시간에 다수의 소셜 로그인 요청이 발생한다
Then 기존 SPEC-SEC-001의 Rate Limiting 정책이 적용된다
And 제한 초과 시 HTTP 429 Too Many Requests 응답을 반환한다
```

---

## Definition of Done

- [ ] 모든 수락 기준 (ACC-01 ~ ACC-26) 통과
- [ ] 백엔드 테스트 커버리지 85% 이상
- [ ] 프론트엔드 컴포넌트 테스트 작성 완료
- [ ] Alembic 마이그레이션 정상 실행 및 롤백 확인
- [ ] 카카오, 네이버, 구글 각 제공자별 로그인 흐름 정상 동작
- [ ] 계정 병합 시나리오 정상 동작
- [ ] 소셜 계정 연결/해제 정상 동작
- [ ] 마지막 인증 수단 삭제 방지 동작 확인
- [ ] CSRF state 파라미터 검증 동작 확인
- [ ] 소셜 access token 암호화 저장 확인
- [ ] API 문서 (OpenAPI) 자동 생성 확인
- [ ] 환경 변수 미설정 시 해당 제공자 비활성화 확인
