---
id: SPEC-SEC-001
version: 1.1.0
status: completed
created: 2026-03-14
updated: 2026-03-14
author: zuge3
priority: high
issue_number: 0
tags: [security, compliance, rate-limiting, PIPA, OWASP]
dependencies: [SPEC-AUTH-001]
---

# SPEC-SEC-001: 보안 강화 및 컴플라이언스

## 1. 개요 (Overview)

Bodam 플랫폼의 프로덕션 런칭을 위한 보안 강화 및 개인정보보호법(PIPA) 컴플라이언스 구현 명세.
보험 관련 개인정보를 다루는 플랫폼 특성상, API 보안 강화, 속도 제한, 개인정보 처리 방침 준수,
시크릿 관리가 필수적이며, 이 SPEC은 해당 영역 전반을 다룬다.

## 2. 환경 (Environment)

- **플랫폼**: Bodam AI 보험 청구 가이던스 플랫폼
- **백엔드**: FastAPI 0.135.x + SQLAlchemy 2.x (async) + PostgreSQL 18.x + Redis 7.x + Celery 5.x
- **프론트엔드**: Next.js 16.1.x + TypeScript 5.x
- **인증**: JWT 기반 (SPEC-AUTH-001 구현 완료 - email/password, access/refresh tokens)
- **인프라**: Docker Compose (MVP), AWS Seoul Region (ap-northeast-2) 배포 예정
- **규제 환경**: 대한민국 개인정보보호법(PIPA), 금융감독원(FSS) 규정
- **대상 데이터**: 사용자 이메일, 보험 증권 번호, 채팅 이력, LLM 응답 로그

## 3. 가정 (Assumptions)

- A1: SPEC-AUTH-001의 JWT 인증 시스템이 정상 동작하고 있다.
- A2: Redis 7.x가 rate limiting 카운터 저장소로 사용 가능하다.
- A3: PostgreSQL 18.x에 사용자 데이터, 대화 이력, 정책 문서가 저장된다.
- A4: 프로덕션 환경에서는 HTTPS가 필수적으로 적용된다.
- A5: 1인 개발팀 기준으로 운영 가능한 수준의 복잡도를 유지한다.
- A6: 현재 비즈니스 모델은 Free Tier만 존재하며, 일일 채팅 제한은 Free Tier 기준이다.

## 4. 요구사항 (Requirements)

### 4.1 API Rate Limiting

**REQ-SEC-001**: 시스템은 **항상** 모든 API 요청에 대해 IP 기반 속도 제한을 적용해야 한다.

**REQ-SEC-002**: **WHEN** 일반 API 엔드포인트에 요청이 도달할 때 **THEN** 시스템은 IP당 분당 60회 요청 제한을 적용해야 한다.

**REQ-SEC-003**: **WHEN** 인증 관련 엔드포인트(`/api/v1/auth/*`)에 요청이 도달할 때 **THEN** 시스템은 IP당 분당 10회 요청 제한을 적용해야 한다.

**REQ-SEC-004**: **IF** 인증된 사용자가 Free Tier인 경우 **THEN** 시스템은 일일 채팅 요청을 100회로 제한해야 한다.

**REQ-SEC-005**: 시스템은 **항상** 모든 API 응답에 rate limit 관련 헤더를 포함해야 한다.
- `X-RateLimit-Limit`: 허용된 최대 요청 수
- `X-RateLimit-Remaining`: 남은 요청 수
- `X-RateLimit-Reset`: 제한 초기화까지 남은 시간 (Unix timestamp)

**REQ-SEC-006**: **WHEN** 클라이언트가 속도 제한을 초과할 때 **THEN** 시스템은 HTTP 429 (Too Many Requests) 응답과 함께 `Retry-After` 헤더를 반환해야 한다.

### 4.2 PIPA (개인정보보호법) 컴플라이언스

**REQ-SEC-010**: 시스템은 **항상** 수집하는 개인정보 항목을 문서화하고 관리해야 한다.
- 필수 항목: 이메일, 비밀번호 해시
- 선택 항목: 이름, 보험 증권 번호
- 자동 수집: IP 주소, 채팅 이력, 접속 로그

**REQ-SEC-011**: **IF** 채팅 이력 데이터가 생성된 지 1년이 경과한 경우 **THEN** 시스템은 해당 데이터를 자동으로 삭제해야 한다.

**REQ-SEC-012**: **IF** 시스템 로그 데이터가 생성된 지 90일이 경과한 경우 **THEN** 시스템은 해당 로그를 자동으로 삭제해야 한다.

**REQ-SEC-013**: **WHEN** 인증된 사용자가 `DELETE /api/v1/users/me` 엔드포인트를 호출할 때 **THEN** 시스템은 해당 사용자의 모든 데이터를 cascade 삭제해야 한다.
- 삭제 대상: 사용자 프로필, 대화 이력, 메시지, 등록 정책, 분석 결과
- 삭제 확인을 위한 비밀번호 재인증 필수

**REQ-SEC-014**: **WHEN** 인증된 사용자가 `GET /api/v1/users/me/data` 엔드포인트를 호출할 때 **THEN** 시스템은 해당 사용자의 모든 개인정보를 JSON 형식으로 내보내기 해야 한다.
- 포함 항목: 프로필 정보, 대화 이력, 등록 정책 목록, 계정 활동 로그

**REQ-SEC-015**: **WHEN** 사용자가 회원가입할 때 **THEN** 시스템은 개인정보 수집 및 이용에 대한 동의를 획득해야 한다.
- 필수 동의: 서비스 이용을 위한 개인정보 수집/이용
- 선택 동의: 마케팅 목적 개인정보 활용

### 4.3 API 보안 강화

**REQ-SEC-020**: 시스템은 **항상** 다음 보안 헤더를 모든 HTTP 응답에 포함해야 한다.
- `Strict-Transport-Security`: `max-age=31536000; includeSubDomains` (HSTS)
- `X-Content-Type-Options`: `nosniff`
- `X-Frame-Options`: `DENY`
- `Content-Security-Policy`: 적절한 CSP 정책
- `X-XSS-Protection`: `0` (CSP 사용 시 비활성화 권장)
- `Referrer-Policy`: `strict-origin-when-cross-origin`
- `Permissions-Policy`: 필요하지 않은 브라우저 기능 비활성화

**REQ-SEC-021**: **IF** 프로덕션 환경인 경우 **THEN** 시스템은 CORS 정책을 알려진 도메인으로만 제한해야 한다.
- 허용 도메인: 프론트엔드 배포 도메인, API 도메인
- 개발 환경: `localhost:3000`, `localhost:8000` 허용

**REQ-SEC-022**: 시스템은 SQL injection 공격을 **방지해야 한다**.
- SQLAlchemy ORM의 parameterized queries 사용 확인
- 원시 SQL 쿼리 사용 금지 (불가피한 경우 바인딩 파라미터 필수)

**REQ-SEC-023**: 시스템은 **항상** API 응답에서 XSS 공격 벡터를 제거해야 한다.
- JSON 응답의 HTML 이스케이프 처리
- 사용자 입력 데이터의 sanitization

**REQ-SEC-024**: 시스템은 **항상** 로그에서 민감한 데이터를 마스킹해야 한다.
- 이메일: `u***@example.com` 형식
- 전화번호: `010-****-1234` 형식
- 보험 증권 번호: 마지막 4자리만 표시
- 비밀번호: 로그에 절대 포함하지 않음
- JWT 토큰: 처음 10자만 표시

### 4.4 시크릿 관리 (Secret Management)

**REQ-SEC-030**: 시스템은 **항상** 모든 시크릿을 환경 변수로 관리해야 한다.
- 데이터베이스 접속 정보, API 키, JWT 시크릿 키 등

**REQ-SEC-031**: 시스템은 하드코딩된 자격 증명을 **포함하지 않아야 한다**.
- 소스 코드, 설정 파일, Docker 이미지에 시크릿 하드코딩 금지

**REQ-SEC-032**: 시스템은 **항상** `.env.example` 파일에 필요한 모든 환경 변수를 문서화해야 한다.
- 변수명, 설명, 기본값(민감하지 않은 경우), 필수 여부 명시

**REQ-SEC-033**: **가능하면** LLM Provider API 키에 대한 로테이션 전략 문서를 제공해야 한다.
- OpenAI API 키, Google Gemini API 키의 로테이션 절차
- 키 만료 시 알림 방안

### 4.5 보안 감사 체크리스트 (Security Audit)

**REQ-SEC-040**: 시스템은 **항상** OWASP Top 10 보안 취약점에 대한 방어 조치를 구현해야 한다.
- A01: Broken Access Control - 인가 검증
- A02: Cryptographic Failures - bcrypt, JWT 서명
- A03: Injection - SQLAlchemy parameterized queries
- A04: Insecure Design - 보안 설계 원칙
- A05: Security Misconfiguration - 보안 헤더, CORS
- A06: Vulnerable Components - 의존성 취약점 스캔
- A07: Authentication Failures - 속도 제한, 강력한 비밀번호
- A08: Data Integrity Failures - 입력 검증
- A09: Security Logging & Monitoring - 구조화된 로깅
- A10: SSRF - 외부 URL 접근 제한

**REQ-SEC-041**: **WHEN** CI/CD 파이프라인이 실행될 때 **THEN** 시스템은 의존성 취약점 스캔을 자동으로 수행해야 한다.
- Python: `pip-audit` 실행
- Node.js: `npm audit` 실행
- 심각도 High 이상 취약점 발견 시 빌드 실패 처리

**REQ-SEC-042**: 시스템은 **항상** 인증 우회 시도에 대한 테스트 케이스를 유지해야 한다.
- 만료된 토큰으로 API 접근 시도
- 변조된 JWT 토큰 사용 시도
- 다른 사용자의 리소스 접근 시도

**REQ-SEC-043**: 시스템은 **항상** 인가 경계 테스트를 포함해야 한다.
- 비인증 사용자의 보호된 리소스 접근 차단
- 다른 사용자의 대화 이력 접근 차단
- 관리자 전용 엔드포인트 접근 제어

## 5. 명세 (Specifications)

### 5.1 Rate Limiting 기술 명세

**구현 방식**: Redis 기반 Sliding Window Rate Limiting

```
Rate Limiting 아키텍처:
  Client Request
    -> FastAPI Middleware (RateLimitMiddleware)
      -> Redis INCR + EXPIRE (Sliding Window)
        -> IP-based: key = "rate:{ip}:{endpoint_group}"
        -> User-based: key = "rate:user:{user_id}:chat:daily"
      -> Pass / Reject (429)
```

**엔드포인트별 제한 설정**:

| 엔드포인트 그룹 | IP 제한 | 사용자 제한 | 윈도우 |
|---|---|---|---|
| 일반 API (`/api/v1/*`) | 60/분 | - | 1분 |
| 인증 (`/api/v1/auth/*`) | 10/분 | - | 1분 |
| 채팅 (`/api/v1/chat/*`) | 60/분 | 100/일 (Free Tier) | 1분 / 24시간 |
| 관리자 (`/api/v1/admin/*`) | 30/분 | - | 1분 |

**Redis 키 구조**:
- IP 기반: `ratelimit:{ip}:{endpoint_group}:{minute_timestamp}`
- 사용자 기반: `ratelimit:user:{user_id}:chat:{date}`

### 5.2 PIPA 컴플라이언스 기술 명세

**개인정보 인벤토리**:

| 데이터 항목 | 수집 목적 | 보관 기간 | 삭제 방법 |
|---|---|---|---|
| 이메일 | 계정 식별, 로그인 | 탈퇴 시 즉시 | CASCADE DELETE |
| 비밀번호 해시 | 인증 | 탈퇴 시 즉시 | CASCADE DELETE |
| 이름 (선택) | 개인화 | 탈퇴 시 즉시 | CASCADE DELETE |
| 채팅 이력 | 서비스 제공 | 1년 | Celery Beat 스케줄 삭제 |
| 시스템 로그 | 장애 분석 | 90일 | 로그 로테이션 |
| IP 주소 | 보안 (rate limiting) | 90일 | 로그와 함께 삭제 |

**데이터 삭제 API 명세**:

```
DELETE /api/v1/users/me
  Headers: Authorization: Bearer {access_token}
  Body: { "password": "current_password" }
  Response 200: { "message": "계정이 삭제되었습니다", "deleted_at": "ISO8601" }
  Response 401: { "detail": "비밀번호가 일치하지 않습니다" }

GET /api/v1/users/me/data
  Headers: Authorization: Bearer {access_token}
  Response 200: {
    "user": { "email": "...", "name": "...", "created_at": "..." },
    "conversations": [...],
    "policies": [...],
    "activity_log": [...]
  }
```

**데이터 보존 정책 구현**:
- Celery Beat 스케줄: 매일 02:00 KST 실행
- 채팅 이력: `created_at < NOW() - INTERVAL '1 year'` 조건으로 삭제
- 시스템 로그: `timestamp < NOW() - INTERVAL '90 days'` 조건으로 삭제

### 5.3 보안 헤더 Middleware 명세

```
SecurityHeadersMiddleware:
  모든 응답에 추가:
    Strict-Transport-Security: max-age=31536000; includeSubDomains
    X-Content-Type-Options: nosniff
    X-Frame-Options: DENY
    X-XSS-Protection: 0
    Referrer-Policy: strict-origin-when-cross-origin
    Permissions-Policy: camera=(), microphone=(), geolocation=()
    Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'
```

### 5.4 CORS 설정 명세

```
프로덕션 CORS 설정:
  allow_origins: [FRONTEND_URL]  # 환경변수로 설정
  allow_methods: ["GET", "POST", "PUT", "DELETE", "PATCH"]
  allow_headers: ["Authorization", "Content-Type"]
  allow_credentials: true
  max_age: 600  # 10분 캐시

개발 CORS 설정:
  allow_origins: ["http://localhost:3000"]
  allow_methods: ["*"]
  allow_headers: ["*"]
  allow_credentials: true
```

### 5.5 로그 마스킹 명세

```
SensitiveDataFilter (structlog processor):
  패턴:
    email: r'[\w.-]+@[\w.-]+' -> mask_email()
    phone: r'01[016789]-?\d{3,4}-?\d{4}' -> mask_phone()
    policy_number: r'[A-Z]{2}\d{10,}' -> mask_policy()
    jwt_token: r'eyJ[\w-]+\.[\w-]+\.[\w-]+' -> mask_jwt()
    password 필드: 완전 제거
```

## 6. 비기능 요구사항 (Non-Functional Requirements)

**NFR-SEC-001**: Rate limiting middleware는 요청당 5ms 이내의 추가 지연만 발생해야 한다.

**NFR-SEC-002**: 보안 헤더 middleware는 요청당 1ms 이내의 추가 지연만 발생해야 한다.

**NFR-SEC-003**: 사용자 데이터 삭제(`DELETE /api/v1/users/me`)는 30초 이내에 완료해야 한다.

**NFR-SEC-004**: 사용자 데이터 내보내기(`GET /api/v1/users/me/data`)는 60초 이내에 응답해야 한다.

**NFR-SEC-005**: 데이터 보존 정책 실행(Celery Beat)은 프로덕션 서비스에 영향을 주지 않아야 한다.

## 7. 제약사항 (Constraints)

- C1: 1인 개발팀 기준으로 유지보수 가능한 복잡도 유지
- C2: 기존 SPEC-AUTH-001 인증 시스템과 호환성 유지
- C3: Docker Compose 기반 MVP 배포 환경 지원
- C4: Redis 단일 인스턴스 기반 (MVP 단계)
- C5: 한국어 로그 메시지 지원 (로그 분석 편의)

## 8. 용어 정의 (Glossary)

| 용어 | 정의 |
|---|---|
| PIPA | 개인정보보호법 (Personal Information Protection Act) |
| Rate Limiting | API 요청 빈도를 제한하여 남용을 방지하는 기술 |
| Sliding Window | 시간 윈도우가 연속적으로 이동하는 rate limiting 알고리즘 |
| HSTS | HTTP Strict Transport Security - HTTPS 강제 정책 |
| CSP | Content Security Policy - XSS 방지 브라우저 정책 |
| CORS | Cross-Origin Resource Sharing - 교차 출처 리소스 공유 정책 |
| OWASP | Open Web Application Security Project |
| Cascade Delete | 관련된 모든 하위 데이터를 함께 삭제하는 방식 |

## 9. 추적성 (Traceability)

| 요구사항 ID | plan.md 마일스톤 | acceptance.md 시나리오 |
|---|---|---|
| REQ-SEC-001~006 | M1: API Rate Limiting | SC-001~006 |
| REQ-SEC-010~015 | M2: PIPA Compliance | SC-010~015 |
| REQ-SEC-020~024 | M3: API Security Hardening | SC-020~024 |
| REQ-SEC-030~033 | M4: Secret Management | SC-030~033 |
| REQ-SEC-040~043 | M5: Security Audit | SC-040~043 |

## Implementation Notes

### 구현 완료 요약 (2026-03-14)
TDD RED-GREEN-REFACTOR 방법론으로 구현 완료. 41개 테스트 통과, ruff 0 오류.

### 신규 모듈
- `backend/app/core/rate_limit.py`: Redis 슬라이딩 윈도우 Rate Limiter (IP별/사용자별)
- `backend/app/core/security_headers.py`: SecurityHeadersMiddleware (HSTS, CSP, X-Frame-Options 등)
- `backend/app/core/log_masking.py`: 민감 데이터 마스킹 (이메일, JWT, 전화번호)
- `backend/app/services/privacy_service.py`: PIPA 데이터 삭제/내보내기
- `backend/app/tasks/cleanup_tasks.py`: 데이터 보존 정책 자동화 Celery 태스크

### 테스트 커버리지
- 단위 테스트: 41개 통과
- Rate limiting, 보안 헤더, 로그 마스킹, PIPA 엔드포인트 검증
