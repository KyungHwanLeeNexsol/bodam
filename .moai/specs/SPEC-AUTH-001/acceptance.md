---
id: SPEC-AUTH-001
document: acceptance
version: 1.0.0
---

# SPEC-AUTH-001: 인수 기준 - 사용자 인증 시스템

> TAG: `[SPEC-AUTH-001]`

---

## 1. UserModel 인수 기준

### ACC-01: User 테이블 생성

```gherkin
Given 데이터베이스에 users 테이블이 존재하지 않을 때
When Alembic 마이그레이션을 실행하면
Then users 테이블이 생성된다
  And id (UUID, PK), email (VARCHAR UNIQUE), hashed_password (VARCHAR),
      full_name (VARCHAR), is_active (BOOLEAN DEFAULT TRUE),
      created_at (TIMESTAMPTZ), updated_at (TIMESTAMPTZ) 컬럼이 존재한다
```

### ACC-02: User 모델 CRUD

```gherkin
Given User SQLAlchemy 모델이 정의되어 있을 때
When 유효한 데이터로 User 인스턴스를 생성하고 DB에 저장하면
Then id가 자동 생성된 UUID이다
  And created_at, updated_at이 자동 설정된다
```

### ACC-03: 이메일 대소문자 무시 고유성

```gherkin
Given "user@example.com"으로 등록된 사용자가 있을 때
When "User@Example.COM"으로 회원가입을 시도하면
Then HTTP 409 Conflict가 반환된다
  And "이미 등록된 이메일입니다" 메시지가 포함된다
```

### ACC-04: ChatSession user_id FK 마이그레이션

```gherkin
Given ChatSession.user_id가 TEXT 타입으로 존재할 때
When FK 마이그레이션을 실행하면
Then user_id가 UUID 타입으로 변경된다
  And users.id에 대한 Foreign Key가 추가된다
  And 기존 user_id 값이 NULL로 보존된다 (유효하지 않은 UUID인 경우)
  And nullable은 유지된다
```

### ACC-05: 비밀번호 해싱 검증

```gherkin
Given 사용자가 "MyP@ssw0rd"로 회원가입할 때
When DB에 저장된 hashed_password를 조회하면
Then 평문 비밀번호 "MyP@ssw0rd"와 일치하지 않는다
  And bcrypt 해시 형식 ("$2b$" 접두사)이다
  And passlib.verify("MyP@ssw0rd", hashed_password)가 True를 반환한다
```

---

## 2. AuthService 인수 기준

### ACC-06: 회원가입 성공 (Happy Path)

```gherkin
Given 유효한 이메일 "newuser@example.com", 비밀번호 "SecureP@ss1", 이름 "홍길동"
When POST /api/v1/auth/register를 호출하면
Then HTTP 201 Created가 반환된다
  And 응답에 id, email, full_name, is_active가 포함된다
  And hashed_password는 응답에 포함되지 않는다
  And is_active는 True이다
```

### ACC-07: 비밀번호 해싱 확인

```gherkin
Given 회원가입이 성공한 후
When DB에서 해당 사용자를 조회하면
Then hashed_password가 bcrypt 해시 형식이다
  And 원문 비밀번호와 동일하지 않다
```

### ACC-08: 로그인 성공 (Happy Path)

```gherkin
Given "user@example.com" / "SecureP@ss1"로 등록된 활성 사용자가 있을 때
When POST /api/v1/auth/login에 올바른 자격 증명을 보내면
Then HTTP 200 OK가 반환된다
  And 응답에 access_token (string)과 token_type ("bearer")이 포함된다
  And access_token은 유효한 JWT 형식이다
```

### ACC-09: JWT 토큰 클레임 검증

```gherkin
Given 로그인으로 발급된 JWT access_token이 있을 때
When 토큰을 디코딩하면
Then sub 클레임에 사용자 ID (UUID 문자열)가 포함된다
  And exp 클레임이 현재 시각 + 30분 이내이다
```

### ACC-10: 중복 이메일 회원가입 차단

```gherkin
Given "existing@example.com"으로 등록된 사용자가 있을 때
When 동일한 이메일로 회원가입을 시도하면
Then HTTP 409 Conflict가 반환된다
  And "이미 등록된 이메일입니다" 메시지가 반환된다
```

### ACC-11: 비활성 사용자 로그인 차단

```gherkin
Given is_active=False인 사용자 "inactive@example.com"이 있을 때
When 올바른 비밀번호로 로그인을 시도하면
Then HTTP 403 Forbidden이 반환된다
  And "비활성화된 계정입니다" 메시지가 반환된다
```

### ACC-12: 약한 비밀번호 거부

```gherkin
Given 비밀번호가 "1234567"(8자 미만)일 때
When 회원가입을 시도하면
Then HTTP 422 Unprocessable Entity가 반환된다
  And 비밀번호 정책 위반 메시지가 포함된다

Given 비밀번호가 "abcdefgh"(숫자 없음)일 때
When 회원가입을 시도하면
Then HTTP 422 Unprocessable Entity가 반환된다

Given 비밀번호가 "12345678"(영문 없음)일 때
When 회원가입을 시도하면
Then HTTP 422 Unprocessable Entity가 반환된다
```

---

## 3. AuthAPI 인수 기준

### ACC-13: /auth/me 엔드포인트

```gherkin
Given 유효한 JWT 토큰을 가진 인증된 사용자가 있을 때
When GET /api/v1/auth/me를 Authorization: Bearer <token> 헤더와 함께 호출하면
Then HTTP 200 OK가 반환된다
  And 응답에 id, email, full_name, is_active가 포함된다
  And hashed_password는 응답에 포함되지 않는다
```

### ACC-14: 잘못된 자격 증명 - 보안 메시지

```gherkin
Given "user@example.com"으로 등록된 사용자가 있을 때
When 잘못된 비밀번호 "WrongP@ss1"로 로그인을 시도하면
Then HTTP 401 Unauthorized가 반환된다
  And "이메일 또는 비밀번호가 올바르지 않습니다" 메시지가 반환된다
  And 이메일 존재 여부를 구분할 수 없는 동일한 메시지이다

Given 등록되지 않은 "nobody@example.com"으로 로그인을 시도하면
Then HTTP 401 Unauthorized가 반환된다
  And 동일한 "이메일 또는 비밀번호가 올바르지 않습니다" 메시지가 반환된다
```

### ACC-15: 로그인 응답 시간

```gherkin
Given 정상 부하 조건에서
When POST /api/v1/auth/login을 호출하면
Then 응답 시간이 500ms 이내이다
```

---

## 4. AuthMiddleware 인수 기준

### ACC-16: get_current_user 유효 토큰

```gherkin
Given 유효한 JWT 토큰이 Authorization 헤더에 있을 때
When get_current_user Dependency가 실행되면
Then 현재 사용자 User 객체가 반환된다
  And user.id, user.email이 토큰의 sub 클레임과 일치한다
```

### ACC-17: 만료된 JWT 토큰 거부

```gherkin
Given 만료된(exp < 현재 시각) JWT 토큰이 있을 때
When 보호된 엔드포인트를 호출하면
Then HTTP 401 Unauthorized가 반환된다
  And "인증 정보가 유효하지 않습니다" 메시지가 반환된다
```

### ACC-18: 유효하지 않은 JWT 토큰 거부

```gherkin
Given 변조된 JWT 토큰 "invalid.token.here"가 있을 때
When 보호된 엔드포인트를 호출하면
Then HTTP 401 Unauthorized가 반환된다

Given Authorization 헤더가 없을 때
When 보호된 엔드포인트를 호출하면
Then HTTP 401 Unauthorized가 반환된다
```

### ACC-19: 채팅 세션 사용자 연결

```gherkin
Given 인증된 사용자 A가 있을 때
When POST /api/v1/chat/sessions로 새 채팅 세션을 생성하면
Then 생성된 ChatSession.user_id가 사용자 A의 id와 일치한다
```

### ACC-20: 채팅 세션 격리

```gherkin
Given 사용자 A의 채팅 세션 2개와 사용자 B의 채팅 세션 3개가 있을 때
When 사용자 A가 GET /api/v1/chat/sessions를 호출하면
Then 사용자 A의 세션 2개만 반환된다
  And 사용자 B의 세션은 포함되지 않는다
```

### ACC-21: JWT 검증 성능

```gherkin
Given 유효한 JWT 토큰이 있을 때
When get_current_user Dependency를 실행하면
Then 처리 시간이 50ms 이내이다
```

---

## 5. AuthFrontend 인수 기준

### ACC-22: 로그인 페이지 렌더링 및 유효성 검사

```gherkin
Given 사용자가 /login 페이지에 접속했을 때
When 페이지가 로드되면
Then 이메일 입력 필드, 비밀번호 입력 필드, 로그인 버튼이 표시된다
  And "회원가입" 링크가 /register로 연결된다

When 빈 폼으로 로그인 버튼을 클릭하면
Then "이메일을 입력해주세요", "비밀번호를 입력해주세요" 유효성 검사 메시지가 표시된다

When 잘못된 이메일 형식 "not-email"을 입력하면
Then "올바른 이메일 형식이 아닙니다" 메시지가 표시된다
```

### ACC-23: 회원가입 페이지 렌더링 및 유효성 검사

```gherkin
Given 사용자가 /register 페이지에 접속했을 때
When 페이지가 로드되면
Then 이름, 이메일, 비밀번호, 비밀번호 확인 입력 필드와 가입 버튼이 표시된다

When 비밀번호와 비밀번호 확인이 일치하지 않으면
Then "비밀번호가 일치하지 않습니다" 메시지가 표시된다

When 8자 미만 비밀번호를 입력하면
Then "비밀번호는 8자 이상이어야 합니다" 메시지가 표시된다
```

### ACC-24: 로그인 성공 후 리다이렉트

```gherkin
Given 유효한 자격 증명으로 로그인에 성공했을 때
When 서버에서 access_token을 받으면
Then JWT 토큰이 localStorage에 저장된다
  And AuthContext의 user 상태가 업데이트된다
  And /chat 페이지로 리다이렉트된다
```

### ACC-25: 보호된 경로 리다이렉트

```gherkin
Given 인증되지 않은 사용자 (토큰 없음)가 있을 때
When /chat 페이지에 직접 접근하면
Then /login 페이지로 리다이렉트된다

When /chat/abc-123 페이지에 직접 접근하면
Then /login 페이지로 리다이렉트된다
```

### ACC-26: 401 응답 시 자동 로그아웃

```gherkin
Given 인증된 사용자가 만료된 토큰을 가지고 있을 때
When API 요청에서 401 응답을 받으면
Then localStorage의 토큰이 삭제된다
  And AuthContext의 user 상태가 null로 설정된다
  And /login 페이지로 리다이렉트된다
```

### ACC-27: 한국어 오류 메시지 표시

```gherkin
Given 회원가입 시 중복 이메일 오류가 발생했을 때
When 서버에서 409 응답을 받으면
Then "이미 등록된 이메일입니다" 메시지가 폼 상단에 표시된다

Given 로그인 실패 시
When 서버에서 401 응답을 받으면
Then "이메일 또는 비밀번호가 올바르지 않습니다" 메시지가 표시된다
```

---

## 6. 엣지 케이스

### EC-01: 동시 회원가입

```gherkin
Given 동일한 이메일 "race@example.com"으로 두 개의 동시 회원가입 요청이 있을 때
When 두 요청이 거의 동시에 처리되면
Then 하나만 성공 (201)하고 나머지는 409를 반환한다
  And DB에는 하나의 사용자만 존재한다
```

### EC-02: 매우 긴 입력값

```gherkin
Given 이메일이 256자를 초과할 때
When 회원가입을 시도하면
Then HTTP 422 유효성 검사 오류가 반환된다
```

### EC-03: SQL Injection 방어

```gherkin
Given 이메일에 "'; DROP TABLE users; --"를 입력할 때
When 회원가입을 시도하면
Then 유효성 검사 오류가 반환된다
  And users 테이블은 영향받지 않는다
```

### EC-04: 특수 문자 이름

```gherkin
Given 이름에 한국어, 이모지, 특수 문자가 포함될 때
When 회원가입을 시도하면
Then 정상적으로 처리된다 (UTF-8 지원)
```

---

## 7. 성능 기준

| 항목 | 기준 | 측정 방법 |
|------|------|-----------|
| 로그인 응답 시간 | < 500ms (P95) | pytest + time measurement |
| JWT 검증 시간 | < 50ms (P95) | pytest + time measurement |
| 회원가입 응답 시간 | < 1000ms (P95) | pytest + time measurement |
| bcrypt 해싱 라운드 | 12 (기본값) | passlib 설정 확인 |

---

## 8. 완료 정의 (Definition of Done)

- [ ] 모든 인수 기준 (ACC-01 ~ ACC-27) 테스트 통과
- [ ] 백엔드 테스트 커버리지 85% 이상
- [ ] 프론트엔드 테스트 커버리지 80% 이상
- [ ] Alembic 마이그레이션 upgrade/downgrade 모두 성공
- [ ] 기존 채팅 기능 회귀 테스트 통과
- [ ] API 문서 (FastAPI 자동 생성 Swagger) 확인
- [ ] 환경 변수 (.env.example) 문서화
- [ ] 보안 리뷰: 비밀번호 평문 노출 없음, JWT 시크릿 하드코딩 없음
