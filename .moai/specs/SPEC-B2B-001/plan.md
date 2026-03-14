---
id: SPEC-B2B-001
type: plan
version: 1.0.0
created: 2026-03-15
updated: 2026-03-15
author: zuge3
---

# SPEC-B2B-001 구현 계획: 보험 설계사 B2B 대시보드

## 1. 개요

보험 설계사, GA(General Agency) 직원, 보험 컨설턴트를 위한 B2B 대시보드 플랫폼을 구현한다. 기존 SPEC-AUTH-001의 인증 시스템을 확장하여 RBAC, 조직 관리, CRM, API 키 관리, 사용량 청구 기능을 제공한다.

---

## 2. 마일스톤

### Primary Goal: 백엔드 핵심 모델 및 RBAC

SPEC-B2B-001의 기반이 되는 데이터 모델과 역할 기반 접근 제어를 구현한다.

**구현 항목:**

1. **User 모델 확장**
   - `role` 필드 추가 (Enum: B2C_USER, AGENT, AGENT_ADMIN, ORG_OWNER, SYSTEM_ADMIN)
   - `organization_id` FK 추가 (nullable, B2C 사용자는 null)
   - Alembic 마이그레이션 생성 (기존 사용자는 B2C_USER로 기본값)

2. **Organization 모델 신규 생성**
   - `backend/app/models/organization.py`
   - Organization, OrganizationMember 테이블
   - 계층 구조 지원 (parent_org_id self-referencing FK)
   - 최대 3단계 제한 로직 (서비스 레벨 검증)

3. **RBAC 미들웨어**
   - `backend/app/api/deps.py` 확장
   - `require_role(min_role)` 의존성 주입 함수
   - 조직 소속 확인 미들웨어 (`require_org_member`)
   - 기존 `get_current_user` 호환성 유지

4. **Alembic 마이그레이션**
   - organizations 테이블 생성
   - organization_members 테이블 생성
   - users 테이블에 role, organization_id 컬럼 추가

**검증 기준:**
- 역할별 엔드포인트 접근 제어 단위 테스트
- 기존 B2C 사용자 인증 흐름 회귀 테스트
- 조직 계층 구조 3단계 제한 검증

---

### Secondary Goal: 고객 CRM 및 대리 분석

설계사가 고객을 등록하고 대리하여 보험 분석을 수행하는 핵심 B2B 기능을 구현한다.

**구현 항목:**

1. **AgentClient 모델**
   - `backend/app/models/agent_client.py`
   - PII 필드 암호화 (client_name, client_phone, client_email)
   - AES-256 필드 레벨 암호화 유틸리티 (`backend/app/core/encryption.py`)
   - PIPA 동의 상태 관리 (consent_status Enum)

2. **고객 관리 API**
   - `backend/app/api/v1/b2b/clients.py`
   - CRUD 엔드포인트 (POST, GET, PUT)
   - 조직 기반 데이터 격리 필터 (`organization_id` 자동 주입)
   - 페이지네이션 및 검색 지원

3. **고객 대리 분석 기능**
   - `backend/app/api/v1/b2b/clients.py` 내 `/{client_id}/analyze` 엔드포인트
   - 기존 RAG/LLM 파이프라인 재사용 (고객 보험 정보를 컨텍스트로 주입)
   - 분석 이력 저장 및 조회

4. **PIPA 동의 관리**
   - ConsentRecord 모델 확장 (agent_client_id FK 추가)
   - 동의 생성/조회/철회 API
   - 동의 철회 시 30일 삭제 예약 (Celery task)

**검증 기준:**
- 고객 PII 암호화/복호화 단위 테스트
- 조직 간 데이터 격리 통합 테스트
- 고객 대리 분석 시 컨텍스트 주입 검증
- PIPA 동의 철회 시 데이터 삭제 예약 확인

---

### Tertiary Goal: API 키 관리 및 인증

프로그래매틱 접근을 위한 API 키 시스템을 구현한다.

**구현 항목:**

1. **APIKey 모델**
   - `backend/app/models/api_key.py`
   - 키 생성: `bdk_` prefix + 32자 랜덤 문자열 (secrets.token_urlsafe)
   - SHA-256 해시 저장, 원본 키는 생성 시 한 번만 반환
   - 스코프 기반 권한 관리 (scopes: read, write, analysis, admin)

2. **API 키 인증 미들웨어**
   - `backend/app/middleware/api_key_auth.py`
   - `X-API-Key` 헤더 파싱
   - 키 해시 비교 및 스코프 검증
   - `get_current_user_or_api_key` 통합 의존성

3. **API 키 관리 엔드포인트**
   - `backend/app/api/v1/b2b/api_keys.py`
   - 생성(POST), 목록(GET), 폐기(DELETE)
   - 키별 사용량 통계 조회

4. **API 키 Rate Limiting**
   - 기존 SPEC-SEC-001 Rate Limiting 확장
   - API 키: 1000 req/hour, JWT: 300 req/hour
   - Redis 기반 sliding window counter

**검증 기준:**
- API 키 생성/검증/폐기 단위 테스트
- 스코프 기반 접근 제어 테스트
- Rate Limiting 임계값 도달 시 429 응답 테스트
- JWT와 API 키 병행 인증 통합 테스트

---

### Quaternary Goal: 사용량 추적 및 청구

API 사용량 추적과 월별 청구 리포트를 구현한다.

**구현 항목:**

1. **UsageRecord 모델**
   - `backend/app/models/usage.py`
   - 요청 메타데이터 기록 (endpoint, method, status_code, tokens_consumed, response_time_ms)
   - 조직별/API키별/사용자별 집계 쿼리

2. **사용량 추적 미들웨어**
   - `backend/app/middleware/usage_tracker.py`
   - B2B 요청 자동 기록 (FastAPI 미들웨어)
   - 비동기 기록 (성능 영향 최소화)
   - Redis 기반 실시간 카운터 + 주기적 DB flush

3. **사용량 통계 API**
   - `backend/app/api/v1/b2b/usage.py`
   - 조직 사용량 요약 (일별/월별 집계)
   - 상세 사용량 조회 (필터링, 페이지네이션)
   - CSV/PDF 내보내기

4. **청구 서비스**
   - `backend/app/services/b2b/billing.py`
   - 월말 정산 리포트 생성 (Celery Beat task)
   - 사용량 임계값 알림 (80% 도달 시 경고)
   - 플랜 초과 시 처리 (429 응답 또는 초과 과금)

**검증 기준:**
- 사용량 기록 정확성 테스트
- 월별 집계 쿼리 성능 테스트
- CSV 내보내기 포맷 검증
- 임계값 알림 트리거 테스트

---

### Optional Goal: 프론트엔드 대시보드 UI

B2B 대시보드 프론트엔드를 구현한다.

**구현 항목:**

1. **B2B 레이아웃**
   - `frontend/app/(b2b)/layout.tsx`
   - B2B 전용 사이드바 네비게이션
   - 역할 기반 메뉴 표시/숨김

2. **대시보드 페이지**
   - `frontend/app/(b2b)/dashboard/page.tsx` - 에이전트 대시보드
   - `frontend/app/(b2b)/organization/page.tsx` - 조직 관리
   - `frontend/app/(b2b)/clients/page.tsx` - 고객 목록/관리
   - `frontend/app/(b2b)/api-keys/page.tsx` - API 키 관리
   - `frontend/app/(b2b)/usage/page.tsx` - 사용량 통계

3. **대시보드 컴포넌트**
   - 통계 카드 컴포넌트 (고객 수, API 호출, 사용량)
   - 차트 컴포넌트 (Recharts 또는 Chart.js 활용)
   - 고객 목록 테이블 (검색, 필터, 페이지네이션)
   - API 키 관리 폼 (생성, 스코프 선택, 폐기)

4. **인증 흐름 확장**
   - B2B 가입 폼 (사업자등록증 업로드)
   - 역할 기반 라우트 보호
   - 조직 초대 수락 페이지

**검증 기준:**
- 역할별 메뉴 표시 테스트
- 대시보드 데이터 로딩 및 렌더링 테스트
- 반응형 레이아웃 테스트

---

## 3. 기술 접근 방식

### 3.1 아키텍처 설계 방향

```
기존 시스템 (B2C)              B2B 확장
┌─────────────────┐           ┌─────────────────────────┐
│ User Model      │──확장────>│ User + role 필드        │
│ Auth Service    │──확장────>│ Auth + API Key 인증     │
│ RAG Pipeline    │──재사용──>│ 고객 대리 분석          │
│ Rate Limiter    │──확장────>│ B2B Rate Limiting       │
└─────────────────┘           └─────────────────────────┘
                               ┌─────────────────────────┐
                               │ 신규 모듈               │
                               │ - Organization 관리     │
                               │ - CRM (AgentClient)     │
                               │ - API Key 관리          │
                               │ - Usage Tracking        │
                               │ - Billing Service       │
                               └─────────────────────────┘
```

### 3.2 Multi-Tenant 데이터 격리 전략

**Phase 2 (본 SPEC)**: Application-Level Isolation
- 모든 B2B 쿼리에 `organization_id` WHERE 조건 자동 주입
- SQLAlchemy 쿼리 빌더에서 조직 필터 강제 적용
- API 레벨에서 조직 소속 검증 미들웨어 적용

**Phase 3 (향후)**: Database-Level Isolation
- PostgreSQL RLS(Row-Level Security) 정책 도입
- `SET app.current_org_id = 'xxx'` 세션 변수 활용
- 애플리케이션과 데이터베이스 이중 격리

### 3.3 PII 암호화 전략

- `backend/app/core/encryption.py` 신규 유틸리티
- AES-256-GCM 대칭 암호화
- 암호화 키: 환경 변수로 관리 (`B2B_ENCRYPTION_KEY`)
- SQLAlchemy Custom Type으로 투명한 암호화/복호화
- 검색 시: 해시된 인덱스 컬럼 또는 부분 문자열 매칭 제한

### 3.4 API 키 보안 설계

```
생성 시:
  raw_key = "bdk_" + secrets.token_urlsafe(32)
  key_hash = sha256(raw_key)
  key_prefix = "bdk_"
  key_last4 = raw_key[-4:]
  DB 저장: (key_hash, key_prefix, key_last4, scopes)
  사용자 반환: raw_key (한 번만 표시)

인증 시:
  request_key = headers["X-API-Key"]
  request_hash = sha256(request_key)
  DB 조회: WHERE key_hash = request_hash AND is_active = true
  스코프 검증: 요청 엔드포인트의 필요 스코프와 키 스코프 비교
```

### 3.5 사용량 추적 아키텍처

```
API 요청 → FastAPI Middleware → Redis 실시간 카운터
                                    │
                                    ├── 즉시: Rate Limit 체크
                                    ├── 1분 주기: UsageRecord batch insert
                                    └── 일 1회: 일별 집계 테이블 갱신
```

- 실시간 카운터: Redis INCR + TTL (1시간 윈도우)
- 배치 기록: Redis List → Celery worker → PostgreSQL bulk insert
- 집계: PostgreSQL materialized view 또는 summary 테이블

---

## 4. 리스크 및 대응 계획

### R1: 기존 인증 시스템 변경 영향

- **리스크**: User 모델에 role 필드 추가 시 기존 B2C 흐름에 영향
- **대응**: 기본값 B2C_USER로 설정, 기존 API 호환성 테스트 필수, Alembic 마이그레이션에 데이터 이관 포함

### R2: Multi-Tenant 데이터 유출

- **리스크**: 조직 간 데이터 격리 실패 시 심각한 보안 사고
- **대응**: 모든 B2B 쿼리에 organization_id 필터 필수, 통합 테스트에서 교차 조직 접근 시도 검증, 코드 리뷰 시 격리 필터 누락 확인

### R3: API 키 유출

- **리스크**: API 키가 외부에 노출되어 무단 접근 발생
- **대응**: 키 해시만 저장, 사용 패턴 모니터링, 비정상 접근 시 자동 비활성화, IP 화이트리스트 옵션 제공

### R4: 사용량 추적 성능 영향

- **리스크**: 매 요청마다 사용량 기록 시 API 응답 지연
- **대응**: Redis 기반 비동기 카운터, 배치 기록으로 DB 부하 분산, 미들웨어에서 async background task로 처리

---

## 5. 기술 스택 결정

본 SPEC에서 추가로 필요한 라이브러리:

| 라이브러리 | 용도 | 비고 |
|-----------|------|------|
| cryptography | AES-256 PII 암호화 | Python 표준 암호화 라이브러리 |
| secrets (stdlib) | API 키 생성 | Python 표준 라이브러리 |
| hashlib (stdlib) | SHA-256 해싱 | Python 표준 라이브러리 |
| Recharts 또는 Chart.js | 대시보드 차트 | 프론트엔드 Optional Goal |

기존 스택 활용:
- FastAPI, SQLAlchemy, Alembic, Pydantic (백엔드)
- Redis (Rate Limiting, 사용량 카운터)
- Celery (배치 작업, 알림)
- Next.js, shadcn/ui, Tailwind (프론트엔드)

---

## 6. 파일 구조 (신규 생성 예정)

```
backend/app/
├── models/
│   ├── organization.py          # Organization, OrganizationMember
│   ├── agent_client.py          # AgentClient
│   ├── api_key.py               # APIKey
│   └── usage.py                 # UsageRecord
├── schemas/
│   └── b2b.py                   # B2B Pydantic 스키마
├── api/v1/b2b/
│   ├── __init__.py
│   ├── organizations.py         # 조직 관리 API
│   ├── clients.py               # 고객 CRM API
│   ├── api_keys.py              # API 키 관리 API
│   ├── usage.py                 # 사용량/청구 API
│   └── dashboard.py             # 대시보드 데이터 API
├── services/b2b/
│   ├── __init__.py
│   ├── organization_service.py  # 조직 비즈니스 로직
│   ├── client_service.py        # 고객 관리 로직
│   ├── api_key_service.py       # API 키 관리 로직
│   ├── usage_service.py         # 사용량 추적 로직
│   └── billing_service.py       # 청구 로직
├── middleware/
│   ├── api_key_auth.py          # API 키 인증 미들웨어
│   └── usage_tracker.py         # 사용량 추적 미들웨어
└── core/
    └── encryption.py            # AES-256 암호화 유틸리티

frontend/app/
└── (b2b)/
    ├── layout.tsx               # B2B 레이아웃
    ├── dashboard/page.tsx       # 에이전트 대시보드
    ├── organization/page.tsx    # 조직 관리
    ├── clients/page.tsx         # 고객 관리
    ├── api-keys/page.tsx        # API 키 관리
    └── usage/page.tsx           # 사용량 통계
```

---

## 7. 전문가 상담 권장사항

본 SPEC은 다음 전문가 에이전트와의 상담을 권장한다:

- **expert-backend**: API 설계, 인증 시스템 확장, Multi-tenant 격리 전략 검토
- **expert-security**: API 키 보안, PII 암호화, RBAC 정책 검토
- **expert-frontend**: B2B 대시보드 UI/UX 설계, 차트 라이브러리 선정
