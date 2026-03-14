---
id: SPEC-SEC-001
document: plan
version: 1.0.0
status: draft
created: 2026-03-14
updated: 2026-03-14
author: zuge3
tags: [security, compliance, rate-limiting, PIPA, OWASP]
---

# SPEC-SEC-001: 구현 계획 (Implementation Plan)

## 1. 구현 전략 개요

보안 강화 작업을 5개 마일스톤으로 분리하여 독립적으로 구현 및 검증 가능하도록 구성한다.
각 마일스톤은 기존 시스템에 대한 영향을 최소화하면서 점진적으로 보안 수준을 높이는 방향으로 설계한다.

## 2. 마일스톤 (Milestones)

### M1: API Rate Limiting (Primary Goal)

**우선순위**: High
**의존성**: Redis 7.x 가용성, SPEC-AUTH-001 JWT 인증

**구현 항목**:

1. **Rate Limiting Middleware 구현**
   - `backend/app/core/rate_limit.py` 생성
   - Redis 기반 Sliding Window 알고리즘 구현
   - IP 추출 로직 (X-Forwarded-For 헤더 지원)
   - 엔드포인트 그룹별 제한 설정 관리

2. **응답 헤더 주입**
   - `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` 헤더 추가
   - 429 응답 시 `Retry-After` 헤더 포함

3. **사용자별 일일 채팅 제한**
   - `backend/app/api/deps.py`에 일일 채팅 카운터 의존성 추가
   - Redis key: `ratelimit:user:{user_id}:chat:{YYYY-MM-DD}`
   - Free Tier 일일 100회 제한

4. **설정 외부화**
   - `backend/app/core/config.py`에 rate limit 설정 추가
   - 환경변수로 제한값 조정 가능하도록 구현

**영향받는 파일**:
- `backend/app/core/rate_limit.py` (신규)
- `backend/app/main.py` (middleware 등록)
- `backend/app/core/config.py` (설정 추가)
- `backend/app/api/deps.py` (사용자별 제한 의존성)

**기술 접근**:
- `slowapi` 라이브러리 대신 커스텀 Redis 기반 구현 선택 (유연성, Redis 기존 인프라 활용)
- Sliding Window Counter 패턴: `INCR` + `EXPIRE` 조합
- Middleware 레벨에서 처리하여 모든 엔드포인트에 자동 적용

---

### M2: PIPA 컴플라이언스 (Primary Goal)

**우선순위**: High
**의존성**: M1 완료 불필요 (독립 구현 가능)

**구현 항목**:

1. **사용자 데이터 삭제 엔드포인트**
   - `DELETE /api/v1/users/me` 구현
   - 비밀번호 재인증 로직
   - SQLAlchemy cascade delete 설정 확인 및 보완
   - 삭제 대상: User, Conversation, Message, 관련 Policy 데이터

2. **사용자 데이터 내보내기 엔드포인트**
   - `GET /api/v1/users/me/data` 구현
   - 사용자 관련 전체 데이터 JSON 직렬화
   - 대용량 데이터 스트리밍 응답 처리

3. **데이터 보존 정책 자동화**
   - Celery Beat 태스크: `cleanup_expired_chat_history`
   - Celery Beat 태스크: `cleanup_expired_logs`
   - 매일 02:00 KST 실행 스케줄 설정
   - 배치 삭제 (1000건 단위)로 DB 부하 방지

4. **동의 관리 모델 추가**
   - `ConsentRecord` 모델 생성
   - 회원가입 시 동의 항목 기록
   - 동의 이력 조회 API

**영향받는 파일**:
- `backend/app/api/v1/users.py` (삭제, 내보내기 엔드포인트)
- `backend/app/schemas/user.py` (요청/응답 스키마 추가)
- `backend/app/services/auth/auth_service.py` (삭제 로직)
- `backend/app/models/user.py` (cascade 설정, ConsentRecord 모델)
- `backend/app/tasks/cleanup_tasks.py` (신규 - 데이터 정리 태스크)
- `backend/app/tasks/celery_app.py` (Beat 스케줄 등록)

**기술 접근**:
- SQLAlchemy `cascade="all, delete-orphan"` 관계 설정
- 데이터 내보내기는 `StreamingResponse`로 대용량 처리
- Celery Beat: `crontab(hour=2, minute=0)` (KST 기준)

---

### M3: API 보안 강화 (Secondary Goal)

**우선순위**: High
**의존성**: 없음 (독립 구현)

**구현 항목**:

1. **보안 헤더 Middleware**
   - `backend/app/core/security_headers.py` 생성
   - HSTS, X-Content-Type-Options, X-Frame-Options, CSP 등 헤더 주입
   - 환경별(dev/prod) CSP 정책 분리

2. **CORS 정책 강화**
   - `backend/app/main.py`의 CORS 설정 환경변수 기반으로 변경
   - 프로덕션: 허용 도메인 제한
   - 개발: localhost 허용

3. **SQL Injection 방지 감사**
   - 전체 코드베이스에서 raw SQL 사용 검색
   - 발견 시 parameterized query로 전환
   - 감사 결과 문서화

4. **로그 마스킹 프로세서**
   - `backend/app/core/log_masking.py` 생성
   - structlog 프로세서로 민감 데이터 자동 마스킹
   - 이메일, 전화번호, 증권 번호, JWT 토큰 패턴 처리

5. **XSS 방지**
   - Pydantic 모델에 입력 sanitization validator 추가
   - HTML 태그 이스케이프 유틸리티

**영향받는 파일**:
- `backend/app/core/security_headers.py` (신규)
- `backend/app/core/log_masking.py` (신규)
- `backend/app/main.py` (middleware 등록, CORS 수정)
- `backend/app/core/config.py` (CORS 도메인 설정)
- `backend/app/core/logging.py` (마스킹 프로세서 연결)

**기술 접근**:
- Starlette `BaseHTTPMiddleware` 기반 커스텀 middleware
- structlog `ProcessorPipeline`에 마스킹 프로세서 추가
- CORS 설정을 `ALLOWED_ORIGINS` 환경변수로 관리

---

### M4: 시크릿 관리 (Secondary Goal)

**우선순위**: Medium
**의존성**: 없음

**구현 항목**:

1. **.env.example 정비**
   - 백엔드 `.env.example` 업데이트
   - 프론트엔드 `.env.example` 업데이트
   - 각 변수에 설명, 기본값, 필수 여부 명시

2. **하드코딩 자격 증명 스캔**
   - 전체 코드베이스에서 하드코딩된 시크릿 검색
   - `grep` 패턴: API 키, 비밀번호, 토큰 문자열
   - 발견 시 환경변수로 전환

3. **시크릿 로테이션 문서**
   - `docs/guides/secret-rotation.md` 작성
   - OpenAI API 키 로테이션 절차
   - Google Gemini API 키 로테이션 절차
   - JWT Secret 키 로테이션 절차
   - DB 비밀번호 로테이션 절차

**영향받는 파일**:
- `backend/.env.example` (업데이트)
- `frontend/.env.example` (업데이트)
- `docs/guides/secret-rotation.md` (신규)
- 하드코딩 발견 시 관련 파일 수정

**기술 접근**:
- `.env.example`에 카테고리별 그룹핑 (DB, Auth, LLM, Redis 등)
- `trufflehog` 또는 수동 grep 패턴으로 하드코딩 스캔

---

### M5: 보안 감사 체크리스트 (Final Goal)

**우선순위**: Medium
**의존성**: M1, M2, M3 완료 후 검증

**구현 항목**:

1. **OWASP Top 10 컴플라이언스 체크리스트**
   - 각 항목별 Bodam 플랫폼 적용 현황 문서화
   - 미적용 항목에 대한 개선 계획 수립

2. **의존성 취약점 스캔 CI/CD 통합**
   - GitHub Actions 워크플로우에 `pip-audit` 추가
   - GitHub Actions 워크플로우에 `npm audit` 추가
   - 심각도 High 이상 취약점 시 빌드 실패

3. **인증 보안 테스트 케이스**
   - 만료된 토큰 접근 테스트
   - 변조된 JWT 테스트
   - 타 사용자 리소스 접근 테스트

4. **인가 경계 테스트 케이스**
   - 비인증 사용자 보호 리소스 접근 테스트
   - 타 사용자 대화 이력 접근 차단 테스트
   - 관리자 엔드포인트 접근 제어 테스트

**영향받는 파일**:
- `.github/workflows/security.yml` (신규)
- `backend/tests/security/` (신규 디렉토리)
- `backend/tests/security/test_auth_bypass.py` (신규)
- `backend/tests/security/test_authorization.py` (신규)
- `backend/tests/security/test_rate_limiting.py` (신규)
- `docs/guides/owasp-checklist.md` (신규)

**기술 접근**:
- pytest fixtures로 다양한 인증 상태 시뮬레이션
- `httpx.AsyncClient`를 활용한 엔드포인트 보안 테스트
- GitHub Actions에서 `pip-audit --strict` 실행

---

## 3. 아키텍처 설계 방향

### 3.1 Middleware 스택 구성

```
Request Flow:
  Client
    -> SecurityHeadersMiddleware (보안 헤더 주입)
    -> CORSMiddleware (CORS 처리)
    -> RateLimitMiddleware (속도 제한)
    -> AuthenticationMiddleware (JWT 인증)
    -> Route Handler
    -> Response (with rate limit headers)
```

### 3.2 데이터 삭제 흐름

```
DELETE /api/v1/users/me:
  1. JWT 토큰 검증 -> 사용자 식별
  2. 비밀번호 재인증 -> bcrypt verify
  3. Cascade Delete 시작:
     a. Messages (conversation_id FK)
     b. Conversations (user_id FK)
     c. PolicyRegistrations (user_id FK)
     d. ConsentRecords (user_id FK)
     e. User 레코드 삭제
  4. Redis 세션 키 삭제
  5. 삭제 로그 기록 (익명화)
```

### 3.3 Rate Limiting 흐름

```
Redis Sliding Window:
  1. key = f"ratelimit:{client_ip}:{endpoint_group}:{window}"
  2. count = INCR(key)
  3. IF count == 1: EXPIRE(key, window_seconds)
  4. IF count > limit: RETURN 429 + Retry-After header
  5. ELSE: SET response headers (Limit, Remaining, Reset)
```

## 4. 리스크 및 대응 방안

| 리스크 | 영향도 | 대응 방안 |
|---|---|---|
| Redis 장애 시 rate limiting 불가 | High | Redis 장애 시 rate limiting 비활성화 (fail-open) |
| Cascade delete 시 데이터 무결성 | High | 트랜잭션 내 처리, 삭제 전 백업 옵션 제공 |
| 보안 헤더가 프론트엔드 기능 차단 | Medium | CSP 정책 점진적 적용, 테스트 후 강화 |
| Rate limiting이 정상 사용자 차단 | Medium | 모니터링 대시보드, 제한값 동적 조정 |
| 의존성 취약점 스캔 오탐 | Low | allowlist 관리, 수동 검증 프로세스 |

## 5. 테스트 전략

### 단위 테스트
- Rate limiting 로직 (Redis mock 활용)
- 로그 마스킹 패턴 매칭
- 보안 헤더 생성 검증
- 데이터 삭제 cascade 동작

### 통합 테스트
- Rate limiting 엔드투엔드 (Redis 실제 연동)
- 사용자 데이터 삭제 및 검증
- 보안 헤더 응답 확인
- CORS 정책 동작 검증

### 보안 테스트
- OWASP Top 10 항목별 테스트
- 인증 우회 시도 테스트
- 인가 경계 테스트
- SQL injection 테스트

## 6. 구현 순서 권장

```
M1 (Rate Limiting)  ─┐
                      ├──> M5 (Security Audit)
M2 (PIPA)  ──────────┤
                      │
M3 (API Security) ───┘

M4 (Secret Management) ──> 독립적으로 병렬 진행 가능
```

- M1, M2, M3는 병렬 구현 가능하나, M5는 M1~M3 완료 후 검증 목적으로 최종 진행
- M4는 독립적이므로 언제든 진행 가능
