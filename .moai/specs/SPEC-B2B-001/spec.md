---
id: SPEC-B2B-001
version: "1.0.0"
status: draft
created: "2026-03-21"
updated: "2026-03-21"
author: zuge3
priority: high
issue_number: 0
---

## HISTORY

| 버전 | 날짜 | 작성자 | 변경 내용 |
|------|------|--------|-----------|
| 1.0.0 | 2026-03-21 | zuge3 | 최초 작성 |

---

## 1. 개요

**SPEC-B2B-001: B2B 조직 관리 (B2B Organization Management)**

Bodam 보험 AI 플랫폼의 B2B 파트너(보험 설계사, GA, 법인 대리점)를 위한 조직 관리 시스템을 구현한다. 조직 생성/관리, RBAC 기반 멤버 관리, API 키 인증, 에이전트 클라이언트(고객) CRM, 사용량 추적 및 청구, 대시보드 기능을 포함한다.

**목적:**
- B2B 파트너가 Bodam 플랫폼을 API 기반으로 활용할 수 있도록 한다
- 조직 단위의 멀티 테넌시를 지원하여 데이터 격리를 보장한다
- PII(개인식별정보) 암호화를 통해 고객 데이터를 보호한다
- 사용량 기반 과금 체계의 기반을 마련한다

**대상 사용자:**
- ORG_OWNER: 조직 소유자 (GA 대표, 법인 대표)
- AGENT_ADMIN: 조직 관리자 (지점장, 팀장)
- AGENT: 보험 설계사 (개인 에이전트)

---

## 2. EARS 요구사항

### REQ-001: 조직 관리 (Organization Management)

#### UBIQUITOUS

- **REQ-001-U1**: 시스템은 항상 Organization 엔티티에 대해 UUID PK, name, business_number, org_type(GA/INDEPENDENT/CORPORATE), plan_type(FREE_TRIAL/BASIC/PROFESSIONAL/ENTERPRISE), monthly_api_limit, is_active 필드를 유지해야 한다.
- **REQ-001-U2**: 시스템은 항상 business_number에 대해 UNIQUE 제약을 적용해야 한다.

#### EVENT-DRIVEN

- **REQ-001-E1**: WHEN 사용자가 POST /api/v1/b2b/organizations 요청을 보내면 THEN 시스템은 Organization을 생성하고, 요청자를 ORG_OWNER로 OrganizationMember에 등록해야 한다.
- **REQ-001-E2**: WHEN ORG_OWNER 또는 AGENT_ADMIN이 POST /api/v1/b2b/organizations/{org_id}/invite 요청을 보내면 THEN 시스템은 해당 이메일의 User를 찾아 OrganizationMember로 등록해야 한다.
- **REQ-001-E3**: WHEN 조직 정보 수정 요청(PUT /api/v1/b2b/organizations/{org_id})이 발생하면 THEN ORG_OWNER 또는 AGENT_ADMIN만 수정할 수 있어야 한다.

#### UNWANTED-BEHAVIOR

- **REQ-001-UB1**: IF 이미 존재하는 business_number로 조직 생성을 시도하면 THEN 시스템은 409 Conflict를 반환해야 한다.
- **REQ-001-UB2**: IF 조직 계층이 3단계를 초과하는 parent_org_id가 지정되면 THEN 시스템은 400 Bad Request를 반환해야 한다.

#### STATE-DRIVEN

- **REQ-001-S1**: IF Organization.is_active가 False이면 THEN 해당 조직의 모든 API 요청은 거부되어야 한다.

#### OPTIONAL

- **REQ-001-O1**: 가능하면 조직 계층 구조(parent_org_id를 통한 self-referential FK)를 제공하여 GA-지점-팀 구조를 지원해야 한다.

---

### REQ-002: API 키 인증 (API Key Authentication)

#### UBIQUITOUS

- **REQ-002-U1**: 시스템은 항상 API 키를 `bdk_` 접두사 + 32자 랜덤 hex 형식으로 생성해야 한다.
- **REQ-002-U2**: 시스템은 항상 API 키를 SHA-256 해시로 변환하여 DB에 저장해야 한다 (평문 저장 금지).
- **REQ-002-U3**: 시스템은 항상 API 키 목록 조회 시 `key_prefix` + `***` + `key_last4` 형식으로 마스킹하여 반환해야 한다.

#### EVENT-DRIVEN

- **REQ-002-E1**: WHEN ORG_OWNER 또는 AGENT_ADMIN이 POST /api/v1/b2b/api-keys 요청을 보내면 THEN 시스템은 API 키를 생성하고 full_key를 1회 반환해야 한다 (이후 조회 불가).
- **REQ-002-E2**: WHEN 클라이언트가 X-API-Key 헤더로 API 요청을 보내면 THEN 시스템은 SHA-256 해시 비교로 키를 검증해야 한다.
- **REQ-002-E3**: WHEN ORG_OWNER 또는 AGENT_ADMIN이 DELETE /api/v1/b2b/api-keys/{key_id} 요청을 보내면 THEN 시스템은 해당 키를 비활성화(is_active=False)해야 한다.

#### UNWANTED-BEHAVIOR

- **REQ-002-UB1**: IF API 키에 필요한 scope가 없는 상태에서 해당 scope가 필요한 엔드포인트에 접근하면 THEN 시스템은 403 Forbidden을 반환해야 한다.
- **REQ-002-UB2**: IF 만료된(expires_at < now) 또는 비활성화된(is_active=False) API 키로 요청하면 THEN 시스템은 401 Unauthorized를 반환해야 한다.

#### STATE-DRIVEN

- **REQ-002-S1**: IF API 키가 사용될 때마다 THEN 시스템은 last_used_at 타임스탬프를 갱신해야 한다.

---

### REQ-003: 에이전트 클라이언트 CRM (Agent Client CRM)

#### UBIQUITOUS

- **REQ-003-U1**: 시스템은 항상 AgentClient의 client_name, client_phone, client_email 필드를 Fernet 대칭 암호화로 저장해야 한다.
- **REQ-003-U2**: 시스템은 항상 PII 복호화는 조회 시점(응답 직전)에만 수행해야 한다.

#### EVENT-DRIVEN

- **REQ-003-E1**: WHEN AGENT 이상 역할의 사용자가 POST /api/v1/b2b/clients 요청을 보내면 THEN 시스템은 PII를 암호화하여 AgentClient를 생성해야 한다.
- **REQ-003-E2**: WHEN 동의 상태 변경 요청(PUT /api/v1/b2b/clients/{client_id}/consent)이 발생하면 THEN 시스템은 consent_status를 업데이트하고, ACTIVE로 변경 시 consent_date를 기록해야 한다.
- **REQ-003-E3**: WHEN AGENT가 POST /api/v1/b2b/clients/{client_id}/analyze 요청을 보내면 THEN 시스템은 해당 클라이언트의 consent_status가 ACTIVE인지 확인 후 분석을 수행해야 한다.

#### UNWANTED-BEHAVIOR

- **REQ-003-UB1**: IF consent_status가 ACTIVE가 아닌 클라이언트에 대해 분석 요청이 발생하면 THEN 시스템은 403 Forbidden을 반환해야 한다.
- **REQ-003-UB2**: IF AGENT가 다른 AGENT의 클라이언트에 접근을 시도하면 THEN 시스템은 404 Not Found를 반환해야 한다 (정보 노출 방지).
- **REQ-003-UB3**: IF Fernet 복호화가 실패하면 THEN 시스템은 DecryptionError를 발생시키고 원본 암호문을 노출하지 않아야 한다.

#### STATE-DRIVEN

- **REQ-003-S1**: IF 현재 사용자의 역할이 AGENT이면 THEN 클라이언트 목록 조회 시 본인이 등록한 클라이언트만 반환해야 한다.
- **REQ-003-S2**: IF 현재 사용자의 역할이 AGENT_ADMIN 이상이면 THEN 조직 전체 클라이언트를 조회할 수 있어야 한다.

---

### REQ-004: 사용량 추적 및 청구 (Usage Tracking & Billing)

#### UBIQUITOUS

- **REQ-004-U1**: 시스템은 항상 B2B API 요청 시 UsageRecord를 생성하여 organization_id, endpoint, method, status_code, tokens_consumed, response_time_ms, ip_address를 기록해야 한다.
- **REQ-004-U2**: 시스템은 항상 Redis 카운터(`b2b:usage:{org_id}:{YYYY-MM}`)로 월간 사용량을 실시간 추적해야 한다.

#### EVENT-DRIVEN

- **REQ-004-E1**: WHEN B2B API 요청이 `/api/v1/b2b/` 경로로 들어오면(usage, billing 경로 제외) THEN UsageTrackingMiddleware가 자동으로 사용량을 기록해야 한다.
- **REQ-004-E2**: WHEN ORG_OWNER가 GET /api/v1/b2b/usage/export 요청을 보내면 THEN 시스템은 지정 기간의 사용량 데이터를 CSV 형식으로 반환해야 한다.

#### UNWANTED-BEHAVIOR

- **REQ-004-UB1**: IF 조직의 월간 API 사용량이 monthly_api_limit을 초과하면 THEN 시스템은 429 Too Many Requests를 반환해야 한다.

#### STATE-DRIVEN

- **REQ-004-S1**: IF B2B API 응답 시 THEN 시스템은 X-Usage-Remaining 헤더에 남은 사용량을 포함해야 한다.

#### OPTIONAL

- **REQ-004-O1**: 가능하면 사용량이 월간 한도의 80%에 도달할 때 경고를 제공해야 한다.

---

### REQ-005: 대시보드 (Dashboard)

#### EVENT-DRIVEN

- **REQ-005-E1**: WHEN AGENT 이상 역할의 사용자가 GET /api/v1/b2b/dashboard/agent 요청을 보내면 THEN 시스템은 해당 설계사의 총 고객 수, 활성 고객 수, 최근 분석 이력, 월간 활동 데이터를 반환해야 한다.
- **REQ-005-E2**: WHEN ORG_OWNER 또는 AGENT_ADMIN이 GET /api/v1/b2b/dashboard/organization 요청을 보내면 THEN 시스템은 총 설계사 수, 총 고객 수, 월간 API 호출 수, 설계사별 통계, 6개월 사용량 추이, 플랜 정보를 반환해야 한다.

#### STATE-DRIVEN

- **REQ-005-S1**: IF 조직 대시보드의 사용량이 월간 한도의 80%를 초과하면 THEN 시스템은 경고 플래그를 포함하여 반환해야 한다.

---

## 3. 비기능 요구사항

### 보안

- PII 필드(client_name, client_phone, client_email)는 반드시 Fernet 대칭 암호화를 적용한다
- API 키는 SHA-256 해시로만 DB에 저장하며, 평문은 생성 시 1회만 반환한다
- AGENT 역할은 본인 클라이언트만 접근 가능하며, 타인 접근 시 404 반환으로 존재 여부도 노출하지 않는다
- Fernet 암호화 키는 환경변수(`B2B_ENCRYPTION_KEY`)로 관리한다

### 성능

- Redis 기반 사용량 카운터로 월간 사용량 조회를 O(1)로 처리한다
- UsageRecord 테이블에 `(organization_id, created_at)` 복합 인덱스를 적용한다
- API 키 검증은 `key_hash` 인덱스를 통해 O(1) 조회한다

### 확장성

- 조직 계층은 최대 3단계(GA - 지점 - 팀)로 제한하여 재귀 쿼리 깊이를 통제한다
- PlanType enum으로 향후 과금 체계 확장을 지원한다
- API 키 scopes 배열로 세분화된 권한 제어를 지원한다

### 데이터 무결성

- OrganizationMember에 `(organization_id, user_id)` UNIQUE 제약으로 중복 가입 방지
- 모든 FK에 CASCADE delete-orphan을 적용하여 고아 레코드 방지
- TimestampMixin으로 created_at, updated_at 자동 관리 (UsageRecord 제외)

---

## 4. 기술 스택

| 구분 | 기술 | 버전 | 용도 |
|------|------|------|------|
| Framework | FastAPI | >=0.135.0 | 비동기 웹 프레임워크 |
| ORM | SQLAlchemy | 2.0+ (async) | 비동기 DB 접근 |
| Validation | Pydantic | v2.9+ | 요청/응답 스키마 검증 |
| Database | PostgreSQL | 16+ | 주 데이터베이스 |
| Cache | Redis | 7+ | 사용량 카운터, 한도 체크 |
| 암호화 | cryptography (Fernet) | latest | PII 필드 암호화 |
| Migration | Alembic | latest | DB 스키마 마이그레이션 |
| Auth | JWT (python-jose) | - | 사용자 인증 |
| Testing | pytest + pytest-asyncio | - | 비동기 테스트 |

---

## 5. 파일 구조

```
backend/app/
├── models/
│   ├── organization.py        # Organization, OrganizationMember, OrgType, PlanType, OrgMemberRole
│   ├── api_key.py             # APIKey
│   ├── agent_client.py        # AgentClient, ConsentStatus
│   ├── usage_record.py        # UsageRecord
│   └── __init__.py            # 모델 export 업데이트
├── schemas/
│   └── b2b.py                 # 모든 B2B Pydantic 스키마
├── services/b2b/
│   ├── __init__.py
│   ├── organization_service.py
│   ├── api_key_service.py
│   ├── client_service.py
│   ├── usage_service.py
│   └── dashboard_service.py
├── api/v1/b2b/
│   ├── __init__.py
│   ├── organizations.py
│   ├── api_keys.py
│   ├── clients.py
│   ├── usage.py
│   └── dashboard.py
├── core/
│   ├── encryption.py          # FieldEncryptor, DecryptionError
│   └── usage_tracking.py     # UsageTrackingMiddleware
└── main.py                    # b2b 라우터 등록, 미들웨어 추가
```

---

## 6. 의존성

### 내부 의존성

| 모듈 | 의존 대상 | 설명 |
|------|-----------|------|
| Organization | User 모델 | FK: organization_members.user_id |
| APIKey | User, Organization | FK: created_by, organization_id |
| AgentClient | User, Organization | FK: agent_id, organization_id |
| UsageRecord | Organization, APIKey, User | FK: organization_id, api_key_id, user_id |
| FieldEncryptor | B2B_ENCRYPTION_KEY 환경변수 | Fernet 키 초기화 |
| UsageTrackingMiddleware | Redis, UsageService | 사용량 카운터 및 한도 체크 |

### 외부 의존성 (신규 추가)

| 라이브러리 | 용도 |
|-----------|------|
| cryptography | Fernet 대칭 암호화 (PII 보호) |
| redis (aioredis) | 비동기 Redis 클라이언트 (사용량 카운터) |

### 기존 의존성 (재사용)

| 라이브러리 | 용도 |
|-----------|------|
| sqlalchemy[asyncio] | 비동기 ORM |
| fastapi | 웹 프레임워크 |
| pydantic | 스키마 검증 |
| python-jose | JWT 인증 |
| bcrypt | 비밀번호 해싱 |

---

## TAG 추적성

- SPEC-B2B-001 >> REQ-001 (조직 관리)
- SPEC-B2B-001 >> REQ-002 (API 키 인증)
- SPEC-B2B-001 >> REQ-003 (에이전트 클라이언트 CRM)
- SPEC-B2B-001 >> REQ-004 (사용량 추적 및 청구)
- SPEC-B2B-001 >> REQ-005 (대시보드)
