---
id: SPEC-B2B-001
version: 1.0.0
status: draft
created: 2026-03-15
updated: 2026-03-15
author: zuge3
priority: medium
issue_number: 0
---

# SPEC-B2B-001: 보험 설계사 B2B 대시보드

## 1. Environment (환경)

### 1.1 시스템 환경

- **Backend**: Python 3.13+ / FastAPI 0.135.x
- **Frontend**: Next.js 16.1.x / React 19.2.x / TypeScript 5.x
- **Database**: PostgreSQL 18.x + pgvector 0.8.2
- **Cache/Broker**: Redis 7.x
- **ORM**: SQLAlchemy 2.x / Alembic 1.x
- **인증**: JWT (python-jose) + bcrypt, 기존 SPEC-AUTH-001 확장
- **UI**: Tailwind CSS 4.2.x + shadcn/ui

### 1.2 비즈니스 환경

- **대상 사용자**: 보험 설계사, GA(General Agency) 직원, 보험 컨설턴트
- **Phase**: Phase 2+ (Enterprise Tier)
- **수익 모델**: B2B Licensing - API 및 도구 제공
- **규제 환경**: PIPA(개인정보보호법), 보험업법, 금융감독원 규정
- **기존 인증 시스템**: SPEC-AUTH-001 기반 User 모델 확장

### 1.3 기존 시스템 의존성

- `backend/app/models/user.py`: User, ConsentRecord 모델
- `backend/app/api/v1/auth.py`: 인증 엔드포인트
- `backend/app/core/security.py`: JWT 토큰 생성/검증
- `backend/app/services/auth/`: AuthService, TokenService
- SPEC-SEC-001: Rate Limiting, 보안 헤더, PIPA 컴플라이언스

---

## 2. Assumptions (가정)

### 2.1 기술적 가정

- A1: 기존 User 모델에 역할(role) 필드를 추가하여 B2B 사용자를 구분할 수 있다
- A2: 하나의 Organization(조직)에 여러 Agent(설계사)가 소속될 수 있다
- A3: API 키 기반 인증은 JWT 인증과 병행하여 사용할 수 있다
- A4: Multi-tenant 데이터 격리는 PostgreSQL RLS(Row-Level Security) 또는 organization_id 기반 필터링으로 구현한다
- A5: B2B 사용자의 고객 데이터는 기존 개인 사용자(B2C)와 동일한 보안 수준을 적용한다

### 2.2 비즈니스 가정

- A6: GA 조직 구조는 최대 3단계 계층(GA 본사 -> 지점 -> 설계사)을 지원한다
- A7: 설계사 1인당 관리 고객 수는 최대 500명을 기본 제한으로 한다
- A8: API 사용량 과금은 월 단위 정산이며, 요청 수 기반으로 과금한다
- A9: White-label 기능은 본 SPEC 범위 밖이며, 별도 SPEC으로 분리한다

### 2.3 보안 가정

- A10: B2B 사용자는 사업자등록증 또는 보험설계사 자격증 인증 후 가입이 승인된다
- A11: 고객 데이터 접근 시 고객의 명시적 동의(PIPA consent)가 필요하다
- A12: 조직 간 데이터는 완전히 격리되어야 하며, 교차 접근이 불가능하다

---

## 3. Requirements (요구사항)

### Module 1: B2B 에이전트 계정 및 역할 관리

#### REQ-B2B-001: 역할 기반 접근 제어 (RBAC)

- **[Ubiquitous]** 시스템은 **항상** 사용자 역할(B2C_USER, AGENT, AGENT_ADMIN, ORG_OWNER, SYSTEM_ADMIN)을 기반으로 접근을 제어해야 한다

- **[Event-Driven]** **WHEN** 보험 설계사가 B2B 계정 등록을 요청하면 **THEN** 시스템은 사업자등록증 또는 자격증 정보를 수집하고, 관리자 승인 대기 상태로 계정을 생성해야 한다

- **[Event-Driven]** **WHEN** 관리자가 B2B 계정을 승인하면 **THEN** 시스템은 해당 사용자의 역할을 AGENT로 변경하고, 소속 조직에 연결해야 한다

- **[Unwanted]** 시스템은 승인되지 않은 B2B 계정이 에이전트 전용 기능에 접근**하지 않아야 한다**

#### REQ-B2B-002: 조직(Organization) 관리

- **[Event-Driven]** **WHEN** ORG_OWNER가 새 조직을 생성하면 **THEN** 시스템은 조직 프로필(회사명, 사업자등록번호, GA 유형, 연락처)을 저장하고 고유 organization_id를 발급해야 한다

- **[Event-Driven]** **WHEN** ORG_OWNER 또는 AGENT_ADMIN이 팀원을 초대하면 **THEN** 시스템은 이메일 초대를 발송하고, 수락 시 해당 조직에 AGENT 역할로 연결해야 한다

- **[State-Driven]** **IF** 조직의 계층 구조가 3단계를 초과하면 **THEN** 시스템은 추가 하위 조직 생성을 거부하고 오류 메시지를 반환해야 한다

- **[Ubiquitous]** 시스템은 **항상** 조직 데이터(조직명, 소속 설계사 목록, 고객 포트폴리오)를 해당 조직 소속 사용자만 접근할 수 있도록 격리해야 한다

### Module 2: 고객 관리 CRM 기능

#### REQ-B2B-003: 고객 포트폴리오 관리

- **[Event-Driven]** **WHEN** AGENT가 새 고객을 등록하면 **THEN** 시스템은 고객 정보(이름, 연락처, 보험 계약 목록)를 저장하고 해당 AGENT의 포트폴리오에 연결해야 한다

- **[Event-Driven]** **WHEN** AGENT가 고객을 대리하여 보험 분석 질의를 요청하면 **THEN** 시스템은 해당 고객의 보험 정보를 컨텍스트로 포함하여 AI 분석을 수행해야 한다

- **[State-Driven]** **IF** 고객이 PIPA 동의를 철회한 상태이면 **THEN** 시스템은 해당 고객의 데이터에 대한 모든 접근을 차단하고 30일 이내 삭제를 예약해야 한다

- **[Unwanted]** 시스템은 다른 조직 소속 AGENT의 고객 데이터를 조회**하지 않아야 한다**

#### REQ-B2B-004: 고객 동의 관리

- **[Event-Driven]** **WHEN** AGENT가 고객을 등록하면 **THEN** 시스템은 고객의 개인정보 처리 동의서를 생성하고 서명 절차를 안내해야 한다

- **[Ubiquitous]** 시스템은 **항상** 고객 동의 이력(동의 일시, 동의 항목, 동의 방법)을 기록하고 감사 추적이 가능해야 한다

### Module 3: 고객별 분석 대시보드

#### REQ-B2B-005: 대시보드 분석 기능

- **[Event-Driven]** **WHEN** AGENT가 대시보드에 접근하면 **THEN** 시스템은 전체 고객 포트폴리오 요약(총 고객 수, 보험 계약 수, 최근 질의 이력)을 표시해야 한다

- **[Event-Driven]** **WHEN** AGENT가 특정 고객을 선택하면 **THEN** 시스템은 해당 고객의 보험 분석 이력, 보장 현황, 추천 상품 목록을 표시해야 한다

- **[Optional]** **가능하면** 시스템은 고객 포트폴리오의 보장 갭(coverage gap) 분석 결과를 시각화하여 제공한다

- **[Optional]** **가능하면** 시스템은 월별/분기별 고객 활동 추이 차트를 제공한다

#### REQ-B2B-006: 조직 관리 대시보드

- **[Event-Driven]** **WHEN** ORG_OWNER 또는 AGENT_ADMIN이 조직 대시보드에 접근하면 **THEN** 시스템은 소속 설계사별 고객 현황, 전체 조직 사용량 통계, 월별 API 호출 추이를 표시해야 한다

- **[State-Driven]** **IF** 조직의 월 사용량이 플랜 제한의 80%에 도달하면 **THEN** 시스템은 ORG_OWNER에게 사용량 경고 알림을 발송해야 한다

### Module 4: B2B API 키 관리

#### REQ-B2B-007: API 키 생명주기

- **[Event-Driven]** **WHEN** AGENT_ADMIN 이상 역할의 사용자가 API 키 생성을 요청하면 **THEN** 시스템은 고유 API 키(prefix + 32자 랜덤 문자열)를 생성하고, 키의 해시값만 데이터베이스에 저장해야 한다

- **[Event-Driven]** **WHEN** API 키가 생성되면 **THEN** 시스템은 전체 키 값을 한 번만 표시하고, 이후에는 prefix와 마지막 4자만 마스킹하여 표시해야 한다

- **[Event-Driven]** **WHEN** 사용자가 API 키를 폐기(revoke)하면 **THEN** 시스템은 해당 키를 즉시 비활성화하고, 해당 키로의 모든 요청을 401 Unauthorized로 거부해야 한다

- **[State-Driven]** **IF** API 키가 90일 이상 사용되지 않았으면 **THEN** 시스템은 ORG_OWNER에게 키 갱신 또는 폐기 알림을 발송해야 한다

- **[Ubiquitous]** 시스템은 **항상** API 키 사용 로그(호출 시간, 엔드포인트, 응답 코드, IP 주소)를 기록해야 한다

#### REQ-B2B-008: API 키 권한 범위

- **[Event-Driven]** **WHEN** API 키가 생성될 때 **THEN** 시스템은 키별 권한 범위(scopes: read, write, analysis, admin)를 설정할 수 있어야 한다

- **[Unwanted]** 시스템은 API 키에 부여되지 않은 범위의 엔드포인트 호출을 허용**하지 않아야 한다**

### Module 5: 사용량 통계 및 청구

#### REQ-B2B-009: 사용량 추적

- **[Ubiquitous]** 시스템은 **항상** 조직별, API 키별, 설계사별 API 호출 수를 실시간으로 집계해야 한다

- **[Event-Driven]** **WHEN** API 요청이 수신되면 **THEN** 시스템은 요청 메타데이터(엔드포인트, 토큰 소비량, 응답 시간)를 사용량 레코드에 기록해야 한다

- **[State-Driven]** **IF** 조직의 월 사용량이 플랜 한도를 초과하면 **THEN** 시스템은 추가 요청을 429 Too Many Requests로 거부하거나 초과 과금을 적용해야 한다

#### REQ-B2B-010: 청구 및 리포트

- **[Event-Driven]** **WHEN** 월말 정산 시점이 되면 **THEN** 시스템은 조직별 사용량 리포트(총 API 호출 수, 엔드포인트별 분류, 토큰 소비량, 예상 청구 금액)를 생성해야 한다

- **[Event-Driven]** **WHEN** ORG_OWNER가 사용량 리포트를 요청하면 **THEN** 시스템은 지정된 기간의 상세 사용 내역을 CSV 또는 PDF 형식으로 다운로드할 수 있도록 제공해야 한다

- **[Optional]** **가능하면** 시스템은 사용 추이를 기반으로 다음 달 예상 비용을 추정하여 제공한다

---

## 4. Specifications (사양)

### 4.1 데이터 모델

#### Organization 모델

| 필드 | 타입 | 설명 |
|------|------|------|
| id | UUID | 기본 키 |
| name | Text | 조직명 |
| business_number | Text | 사업자등록번호 (Unique) |
| org_type | Enum | GA, INDEPENDENT, CORPORATE |
| parent_org_id | UUID (FK, nullable) | 상위 조직 (계층 구조) |
| plan_type | Enum | FREE_TRIAL, BASIC, PROFESSIONAL, ENTERPRISE |
| monthly_api_limit | Integer | 월 API 호출 제한 |
| is_active | Boolean | 활성 상태 |
| created_at | Timestamp | 생성 일시 |
| updated_at | Timestamp | 수정 일시 |

#### OrganizationMember 모델

| 필드 | 타입 | 설명 |
|------|------|------|
| id | UUID | 기본 키 |
| organization_id | UUID (FK) | 소속 조직 |
| user_id | UUID (FK) | 사용자 |
| role | Enum | ORG_OWNER, AGENT_ADMIN, AGENT |
| is_active | Boolean | 활성 상태 |
| joined_at | Timestamp | 가입 일시 |

#### AgentClient 모델

| 필드 | 타입 | 설명 |
|------|------|------|
| id | UUID | 기본 키 |
| organization_id | UUID (FK) | 소속 조직 |
| agent_id | UUID (FK) | 담당 설계사 |
| client_name | Text (encrypted) | 고객명 (암호화) |
| client_phone | Text (encrypted) | 연락처 (암호화) |
| client_email | Text (encrypted, nullable) | 이메일 (암호화) |
| consent_status | Enum | PENDING, ACTIVE, REVOKED |
| consent_date | Timestamp (nullable) | 동의 일시 |
| notes | Text (nullable) | 메모 |
| created_at | Timestamp | 생성 일시 |
| updated_at | Timestamp | 수정 일시 |

#### APIKey 모델

| 필드 | 타입 | 설명 |
|------|------|------|
| id | UUID | 기본 키 |
| organization_id | UUID (FK) | 소속 조직 |
| created_by | UUID (FK) | 생성자 |
| key_prefix | Text | 키 접두사 (예: bdk_) |
| key_hash | Text | SHA-256 해시값 |
| key_last4 | Text | 키 마지막 4자 |
| name | Text | 키 이름/설명 |
| scopes | Array[Text] | 권한 범위 |
| is_active | Boolean | 활성 상태 |
| last_used_at | Timestamp (nullable) | 마지막 사용 시점 |
| expires_at | Timestamp (nullable) | 만료 일시 |
| created_at | Timestamp | 생성 일시 |

#### UsageRecord 모델

| 필드 | 타입 | 설명 |
|------|------|------|
| id | UUID | 기본 키 |
| organization_id | UUID (FK) | 조직 |
| api_key_id | UUID (FK, nullable) | API 키 (nullable for JWT auth) |
| user_id | UUID (FK, nullable) | 사용자 |
| endpoint | Text | 호출 엔드포인트 |
| method | Text | HTTP 메서드 |
| status_code | Integer | 응답 코드 |
| tokens_consumed | Integer | 소비 토큰 수 |
| response_time_ms | Integer | 응답 시간(ms) |
| ip_address | Text | 요청 IP |
| created_at | Timestamp | 호출 일시 |

### 4.2 API 엔드포인트

#### 조직 관리 API

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|------|
| POST | /api/v1/b2b/organizations | 조직 생성 | SYSTEM_ADMIN |
| GET | /api/v1/b2b/organizations/{org_id} | 조직 정보 조회 | ORG_OWNER, AGENT_ADMIN |
| PUT | /api/v1/b2b/organizations/{org_id} | 조직 정보 수정 | ORG_OWNER |
| POST | /api/v1/b2b/organizations/{org_id}/invite | 팀원 초대 | ORG_OWNER, AGENT_ADMIN |
| GET | /api/v1/b2b/organizations/{org_id}/members | 소속 멤버 목록 | ORG_OWNER, AGENT_ADMIN |

#### 고객 관리 API

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|------|
| POST | /api/v1/b2b/clients | 고객 등록 | AGENT+ |
| GET | /api/v1/b2b/clients | 고객 목록 (본인 담당) | AGENT+ |
| GET | /api/v1/b2b/clients/{client_id} | 고객 상세 | AGENT+ (본인 담당만) |
| PUT | /api/v1/b2b/clients/{client_id} | 고객 정보 수정 | AGENT+ (본인 담당만) |
| POST | /api/v1/b2b/clients/{client_id}/analyze | 고객 대리 분석 질의 | AGENT+ |
| GET | /api/v1/b2b/clients/{client_id}/history | 고객 분석 이력 | AGENT+ |

#### API 키 관리 API

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|------|
| POST | /api/v1/b2b/api-keys | API 키 생성 | AGENT_ADMIN+ |
| GET | /api/v1/b2b/api-keys | API 키 목록 | AGENT_ADMIN+ |
| DELETE | /api/v1/b2b/api-keys/{key_id} | API 키 폐기 | AGENT_ADMIN+ |
| GET | /api/v1/b2b/api-keys/{key_id}/usage | 키별 사용량 | AGENT_ADMIN+ |

#### 사용량/청구 API

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|------|
| GET | /api/v1/b2b/usage | 조직 사용량 요약 | ORG_OWNER, AGENT_ADMIN |
| GET | /api/v1/b2b/usage/details | 상세 사용량 | ORG_OWNER |
| GET | /api/v1/b2b/usage/export | 사용량 리포트 다운로드 | ORG_OWNER |
| GET | /api/v1/b2b/billing/current | 현재 월 청구 예상 | ORG_OWNER |

#### 대시보드 API

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|------|
| GET | /api/v1/b2b/dashboard/agent | 설계사 대시보드 데이터 | AGENT+ |
| GET | /api/v1/b2b/dashboard/organization | 조직 대시보드 데이터 | ORG_OWNER, AGENT_ADMIN |

### 4.3 인증 확장

기존 JWT 인증 외에 API 키 인증을 병행 지원:

- **JWT 인증**: 기존 방식 유지 (`Authorization: Bearer <token>`)
- **API 키 인증**: `X-API-Key: bdk_xxxxxxxxxxxx` 헤더
- **인증 우선순위**: JWT > API Key
- **미들웨어**: `get_current_user_or_api_key` 의존성 주입

### 4.4 Multi-Tenant 데이터 격리

- 모든 B2B 관련 쿼리에 `organization_id` 필터 필수 적용
- SQLAlchemy event listener로 자동 필터링 적용 검토
- 관리자(SYSTEM_ADMIN)는 조직 필터 우회 가능
- 데이터베이스 레벨 RLS 적용은 Phase 3에서 검토

### 4.5 보안 요구사항

- 고객 PII(개인식별정보)는 AES-256으로 필드 레벨 암호화
- API 키는 SHA-256 해시하여 저장, 원본은 생성 시 한 번만 노출
- B2B 엔드포인트에 별도 Rate Limiting 적용 (API 키: 1000/시간, JWT: 300/시간)
- 모든 B2B 관련 활동에 대한 감사 로그(audit log) 기록

---

## 5. Traceability (추적성)

| 요구사항 ID | 모듈 | 관련 파일 |
|------------|------|----------|
| REQ-B2B-001 | M1: 역할 관리 | models/user.py (확장), core/security.py |
| REQ-B2B-002 | M1: 조직 관리 | models/organization.py (신규) |
| REQ-B2B-003 | M2: 고객 CRM | models/agent_client.py (신규) |
| REQ-B2B-004 | M2: 동의 관리 | models/user.py (ConsentRecord 확장) |
| REQ-B2B-005 | M3: 에이전트 대시보드 | api/v1/b2b/dashboard.py (신규) |
| REQ-B2B-006 | M3: 조직 대시보드 | api/v1/b2b/dashboard.py (신규) |
| REQ-B2B-007 | M4: API 키 관리 | models/api_key.py (신규) |
| REQ-B2B-008 | M4: API 키 권한 | middleware/api_key_auth.py (신규) |
| REQ-B2B-009 | M5: 사용량 추적 | models/usage.py (신규) |
| REQ-B2B-010 | M5: 청구 리포트 | services/b2b/billing.py (신규) |
