---
id: SPEC-SEC-001
document: acceptance
version: 1.0.0
status: draft
created: 2026-03-14
updated: 2026-03-14
author: zuge3
tags: [security, compliance, rate-limiting, PIPA, OWASP]
---

# SPEC-SEC-001: 인수 기준 (Acceptance Criteria)

## 1. API Rate Limiting 시나리오

### SC-001: IP 기반 일반 API Rate Limiting

```gherkin
Scenario: 일반 API 엔드포인트의 IP 기반 속도 제한
  Given 클라이언트 IP "192.168.1.100"이 일반 API 엔드포인트에 접근할 때
  When 1분 이내에 60회의 요청을 전송하면
  Then 처음 60회 요청은 정상 응답(200)을 반환해야 한다
  And 61번째 요청은 HTTP 429 (Too Many Requests)를 반환해야 한다
  And 429 응답에는 "Retry-After" 헤더가 포함되어야 한다
```

### SC-002: 인증 엔드포인트 Rate Limiting

```gherkin
Scenario: 인증 엔드포인트의 강화된 속도 제한
  Given 클라이언트 IP "192.168.1.100"이 "/api/v1/auth/login"에 접근할 때
  When 1분 이내에 10회의 로그인 요청을 전송하면
  Then 처음 10회 요청은 정상 처리되어야 한다
  And 11번째 요청은 HTTP 429를 반환해야 한다
  And 응답 본문에 "요청이 너무 많습니다" 메시지가 포함되어야 한다
```

### SC-003: Rate Limit 응답 헤더

```gherkin
Scenario: 모든 API 응답에 Rate Limit 헤더 포함
  Given 인증된 사용자가 API 요청을 전송할 때
  When 정상 응답을 받으면
  Then 응답에 "X-RateLimit-Limit" 헤더가 포함되어야 한다
  And 응답에 "X-RateLimit-Remaining" 헤더가 포함되어야 한다
  And 응답에 "X-RateLimit-Reset" 헤더가 포함되어야 한다
  And "X-RateLimit-Remaining" 값은 0 이상이어야 한다
```

### SC-004: Free Tier 사용자 일일 채팅 제한

```gherkin
Scenario: Free Tier 사용자의 일일 채팅 요청 제한
  Given Free Tier 인증된 사용자가 채팅 엔드포인트에 접근할 때
  When 하루에 100회의 채팅 요청을 전송하면
  Then 처음 100회 요청은 정상 처리되어야 한다
  And 101번째 요청은 HTTP 429를 반환해야 한다
  And 응답에 "일일 채팅 한도를 초과했습니다" 메시지가 포함되어야 한다
  And 다음 날 00:00 KST에 카운터가 초기화되어야 한다
```

### SC-005: Rate Limit 초과 후 복구

```gherkin
Scenario: Rate Limit 초과 후 시간 경과에 따른 복구
  Given 클라이언트가 일반 API rate limit(60/분)을 초과했을 때
  When 1분이 경과하면
  Then 새로운 요청이 정상 처리되어야 한다
  And "X-RateLimit-Remaining" 값이 다시 60에서 시작해야 한다
```

### SC-006: Redis 장애 시 Fail-Open

```gherkin
Scenario: Redis 연결 실패 시 Rate Limiting 비활성화
  Given Redis 서버가 응답하지 않을 때
  When 클라이언트가 API 요청을 전송하면
  Then 요청이 정상 처리되어야 한다 (fail-open)
  And 경고 로그가 기록되어야 한다
  And Rate Limit 헤더는 포함되지 않아야 한다
```

---

## 2. PIPA 컴플라이언스 시나리오

### SC-010: 사용자 계정 삭제 (정상)

```gherkin
Scenario: 인증된 사용자의 계정 및 전체 데이터 삭제
  Given 인증된 사용자 "user@example.com"이 존재하고
  And 해당 사용자에게 5개의 대화와 50개의 메시지가 있을 때
  When "DELETE /api/v1/users/me" 엔드포인트를 올바른 비밀번호와 함께 호출하면
  Then HTTP 200 응답을 반환해야 한다
  And 사용자 레코드가 데이터베이스에서 삭제되어야 한다
  And 관련된 모든 대화가 삭제되어야 한다
  And 관련된 모든 메시지가 삭제되어야 한다
  And Redis에 저장된 세션 데이터가 삭제되어야 한다
```

### SC-011: 사용자 계정 삭제 (비밀번호 불일치)

```gherkin
Scenario: 잘못된 비밀번호로 계정 삭제 시도
  Given 인증된 사용자가 계정 삭제를 요청할 때
  When 잘못된 비밀번호를 제공하면
  Then HTTP 401 응답을 반환해야 한다
  And 응답에 "비밀번호가 일치하지 않습니다" 메시지가 포함되어야 한다
  And 사용자 데이터는 삭제되지 않아야 한다
```

### SC-012: 사용자 데이터 내보내기

```gherkin
Scenario: 인증된 사용자의 전체 데이터 내보내기
  Given 인증된 사용자 "user@example.com"이 존재하고
  And 해당 사용자에게 대화 이력과 등록 정책이 있을 때
  When "GET /api/v1/users/me/data" 엔드포인트를 호출하면
  Then HTTP 200 응답을 반환해야 한다
  And JSON 응답에 "user" 필드가 포함되어야 한다
  And JSON 응답에 "conversations" 배열이 포함되어야 한다
  And JSON 응답에 "policies" 배열이 포함되어야 한다
  And JSON 응답에 "activity_log" 배열이 포함되어야 한다
  And 응답 시간이 60초를 초과하지 않아야 한다
```

### SC-013: 채팅 이력 자동 삭제 (1년 경과)

```gherkin
Scenario: 1년 경과 채팅 이력 자동 삭제
  Given 365일 이전에 생성된 대화 이력이 존재할 때
  When 데이터 정리 Celery Beat 태스크가 실행되면
  Then 1년 이상 경과된 대화와 메시지가 삭제되어야 한다
  And 1년 미만인 대화는 유지되어야 한다
  And 삭제 건수가 로그에 기록되어야 한다
```

### SC-014: 시스템 로그 자동 삭제 (90일 경과)

```gherkin
Scenario: 90일 경과 시스템 로그 자동 삭제
  Given 90일 이전에 기록된 시스템 로그가 존재할 때
  When 로그 정리 태스크가 실행되면
  Then 90일 이상 경과된 로그가 삭제되어야 한다
  And 90일 미만인 로그는 유지되어야 한다
```

### SC-015: 회원가입 시 동의 수집

```gherkin
Scenario: 회원가입 시 개인정보 수집 동의
  Given 신규 사용자가 회원가입을 시도할 때
  When 필수 동의 항목에 동의하고 가입 요청을 전송하면
  Then 사용자 계정이 생성되어야 한다
  And 동의 기록이 ConsentRecord에 저장되어야 한다
  And 동의 일시가 기록되어야 한다

Scenario: 필수 동의 없이 회원가입 시도
  Given 신규 사용자가 회원가입을 시도할 때
  When 필수 동의 항목에 동의하지 않고 가입 요청을 전송하면
  Then HTTP 422 응답을 반환해야 한다
  And 사용자 계정이 생성되지 않아야 한다
```

---

## 3. API 보안 강화 시나리오

### SC-020: 보안 헤더 포함 확인

```gherkin
Scenario: 모든 API 응답에 보안 헤더 포함
  Given 클라이언트가 임의의 API 엔드포인트에 요청을 전송할 때
  When 응답을 받으면
  Then "Strict-Transport-Security" 헤더가 포함되어야 한다
  And "X-Content-Type-Options" 값이 "nosniff"여야 한다
  And "X-Frame-Options" 값이 "DENY"여야 한다
  And "Content-Security-Policy" 헤더가 포함되어야 한다
  And "Referrer-Policy" 헤더가 포함되어야 한다
  And "Permissions-Policy" 헤더가 포함되어야 한다
```

### SC-021: 프로덕션 CORS 정책 제한

```gherkin
Scenario: 프로덕션 환경에서 허용되지 않은 Origin 차단
  Given 프로덕션 환경에서 CORS가 설정되어 있을 때
  When "https://malicious-site.com" Origin으로 요청을 전송하면
  Then CORS preflight 응답에 "Access-Control-Allow-Origin" 헤더가 포함되지 않아야 한다

Scenario: 프로덕션 환경에서 허용된 Origin 통과
  Given 프로덕션 환경에서 CORS가 설정되어 있을 때
  When 등록된 프론트엔드 도메인 Origin으로 요청을 전송하면
  Then CORS 응답에 올바른 "Access-Control-Allow-Origin" 헤더가 포함되어야 한다
```

### SC-022: SQL Injection 방지 검증

```gherkin
Scenario: SQL Injection 공격 시도 차단
  Given 인증된 사용자가 채팅 엔드포인트에 접근할 때
  When 메시지 내용에 SQL injection 페이로드 "'; DROP TABLE users;--"를 전송하면
  Then 요청이 정상 처리되어야 한다 (SQL이 실행되지 않음)
  And users 테이블이 정상적으로 존재해야 한다
  And 입력값이 문자열로만 처리되어야 한다
```

### SC-023: XSS 방지 검증

```gherkin
Scenario: XSS 공격 벡터 제거
  Given 사용자가 메시지를 전송할 때
  When 메시지에 "<script>alert('xss')</script>" HTML 태그가 포함되면
  Then 저장된 메시지에서 스크립트 태그가 이스케이프 처리되어야 한다
  And API 응답에서 실행 가능한 HTML이 반환되지 않아야 한다
```

### SC-024: 로그 민감 데이터 마스킹

```gherkin
Scenario: 로그에서 이메일 주소 마스킹
  Given 시스템이 사용자 활동을 로깅할 때
  When 이메일 "user@example.com"이 로그에 포함되면
  Then 로그에 "u***@example.com" 형식으로 마스킹되어 기록되어야 한다

Scenario: 로그에서 JWT 토큰 마스킹
  Given 시스템이 인증 관련 활동을 로깅할 때
  When JWT 토큰이 로그에 포함되면
  Then 토큰의 처음 10자만 표시되고 나머지는 "***"로 마스킹되어야 한다

Scenario: 로그에서 비밀번호 완전 제거
  Given 시스템이 인증 요청을 로깅할 때
  When 요청에 비밀번호 필드가 포함되면
  Then 비밀번호 값이 로그에 절대 포함되지 않아야 한다
```

---

## 4. 시크릿 관리 시나리오

### SC-030: .env.example 완전성

```gherkin
Scenario: .env.example에 모든 필수 환경변수 문서화
  Given 백엔드 프로젝트의 .env.example 파일이 존재할 때
  When 파일 내용을 확인하면
  Then 다음 환경변수가 모두 포함되어야 한다:
    | 변수명 | 카테고리 |
    | DATABASE_URL | Database |
    | REDIS_URL | Cache |
    | JWT_SECRET_KEY | Authentication |
    | JWT_ALGORITHM | Authentication |
    | OPENAI_API_KEY | LLM |
    | GOOGLE_API_KEY | LLM |
    | ALLOWED_ORIGINS | Security |
  And 각 변수에 설명 주석이 포함되어야 한다
  And 필수 여부가 명시되어야 한다
```

### SC-031: 하드코딩된 시크릿 부재 확인

```gherkin
Scenario: 소스 코드에 하드코딩된 시크릿 없음
  Given 전체 소스 코드를 검색할 때
  When API 키 패턴 (sk-, pk_, AIza 등)을 검색하면
  Then 하드코딩된 실제 API 키가 발견되지 않아야 한다
  And 테스트용 더미 키만 존재해야 한다
```

### SC-032: 시크릿 로테이션 문서 존재

```gherkin
Scenario: 시크릿 로테이션 절차 문서 확인
  Given 시크릿 관리 문서가 존재할 때
  When 문서 내용을 확인하면
  Then OpenAI API 키 로테이션 절차가 포함되어야 한다
  And Google Gemini API 키 로테이션 절차가 포함되어야 한다
  And JWT Secret 키 로테이션 절차가 포함되어야 한다
  And 데이터베이스 비밀번호 로테이션 절차가 포함되어야 한다
```

---

## 5. 보안 감사 시나리오

### SC-040: OWASP Top 10 체크리스트 충족

```gherkin
Scenario: OWASP Top 10 각 항목에 대한 대응 구현 확인
  Given OWASP Top 10 체크리스트가 존재할 때
  When 각 항목의 구현 상태를 확인하면
  Then 모든 10개 항목에 대해 "구현 완료" 또는 "해당 없음" 상태여야 한다
  And "미구현" 항목이 0개여야 한다
```

### SC-041: 의존성 취약점 스캔 CI/CD 통합

```gherkin
Scenario: CI/CD 파이프라인에서 의존성 취약점 자동 스캔
  Given GitHub Actions 워크플로우가 실행될 때
  When 보안 스캔 단계가 실행되면
  Then pip-audit가 Python 의존성을 스캔해야 한다
  And npm audit가 Node.js 의존성을 스캔해야 한다

Scenario: High 이상 취약점 발견 시 빌드 실패
  Given pip-audit 또는 npm audit이 실행될 때
  When 심각도 "High" 이상 취약점이 발견되면
  Then CI/CD 파이프라인이 실패해야 한다
  And 취약점 상세 정보가 출력되어야 한다
```

### SC-042: 인증 우회 테스트

```gherkin
Scenario: 만료된 토큰으로 보호된 API 접근 차단
  Given 만료된 JWT 토큰이 존재할 때
  When 해당 토큰으로 보호된 API에 접근하면
  Then HTTP 401 응답을 반환해야 한다
  And "토큰이 만료되었습니다" 메시지가 포함되어야 한다

Scenario: 변조된 JWT 토큰 사용 차단
  Given JWT 페이로드가 변조된 토큰이 존재할 때
  When 해당 토큰으로 보호된 API에 접근하면
  Then HTTP 401 응답을 반환해야 한다
  And 서명 검증 실패 로그가 기록되어야 한다

Scenario: 토큰 없이 보호된 API 접근 차단
  Given 인증 헤더 없이 요청을 전송할 때
  When 보호된 API 엔드포인트에 접근하면
  Then HTTP 401 응답을 반환해야 한다
```

### SC-043: 인가 경계 테스트

```gherkin
Scenario: 다른 사용자의 대화 이력 접근 차단
  Given 사용자 A가 인증되어 있을 때
  When 사용자 B의 대화 ID로 "GET /api/v1/chat/{conversation_id}"에 접근하면
  Then HTTP 403 또는 404 응답을 반환해야 한다
  And 사용자 B의 대화 내용이 반환되지 않아야 한다

Scenario: 비인증 사용자의 채팅 기능 접근 차단
  Given 비인증 상태에서 채팅 엔드포인트에 접근할 때
  When "POST /api/v1/chat/messages"에 요청을 전송하면
  Then HTTP 401 응답을 반환해야 한다
```

---

## 6. Quality Gate 기준

### Definition of Done

- [ ] 모든 Rate Limiting 시나리오 (SC-001~SC-006) 통과
- [ ] 모든 PIPA 컴플라이언스 시나리오 (SC-010~SC-015) 통과
- [ ] 모든 API 보안 강화 시나리오 (SC-020~SC-024) 통과
- [ ] 모든 시크릿 관리 시나리오 (SC-030~SC-032) 통과
- [ ] 모든 보안 감사 시나리오 (SC-040~SC-043) 통과
- [ ] 신규 코드 테스트 커버리지 85% 이상
- [ ] Ruff 린팅 오류 0건
- [ ] pip-audit / npm audit 심각도 High 이상 취약점 0건
- [ ] 기존 테스트 스위트 전체 통과 (regression 없음)
- [ ] SPEC-AUTH-001 기능에 대한 하위 호환성 유지

### 검증 도구

| 도구 | 용도 |
|---|---|
| pytest | 단위/통합 테스트 실행 |
| httpx.AsyncClient | API 엔드포인트 테스트 |
| pip-audit | Python 의존성 취약점 스캔 |
| npm audit | Node.js 의존성 취약점 스캔 |
| ruff | Python 코드 린팅/포맷팅 |
| structlog | 로그 마스킹 검증 |
