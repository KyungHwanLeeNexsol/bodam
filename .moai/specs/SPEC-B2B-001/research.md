# B2B 조직 관리 - 딥 리서치 (SPEC-B2B-001)

## 1. 기존 코드베이스 분석

### 1.1 모델 패턴

**Base 클래스** (`backend/app/models/base.py`)
- `TimestampMixin`: `created_at`, `updated_at` (UTC, 자동 갱신 server_default)
- UUID PK: `server_default=sa.text("gen_random_uuid()")`, `postgresql.UUID(as_uuid=True)`
- Base: SQLAlchemy DeclarativeBase

**User 모델** (`backend/app/models/user.py`)
- `UserRole` enum (StrEnum): `B2C_USER`, `AGENT`, `AGENT_ADMIN`, `ORG_OWNER`, `SYSTEM_ADMIN`
- `role` 컬럼 기본값: `B2C_USER`
- `is_active` 기본값: True
- `hashed_password` nullable (소셜 로그인)

### 1.2 API 라우터 패턴

- Prefix: `/api/v1/{domain}/`
- FastAPI `APIRouter(prefix=..., tags=[...])`
- 의존성 주입: `get_db` (AsyncSession), `get_current_user` (JWT)
- 라우터를 `app/main.py`에서 `app.include_router()`로 등록

### 1.3 서비스 패턴

- 서비스 클래스에 `db: AsyncSession` 주입
- `async def` 메서드
- 예외: HTTPException (400, 403, 404, 409, 429)

### 1.4 스키마 패턴

- Pydantic v2 `BaseModel`
- `model_config = ConfigDict(from_attributes=True)`
- `field_validator` 사용 (이메일 정규화, XSS 검증)

---

## 2. B2B 테스트 분석 - 예상 구현 범위

### 2.1 Organization 모델 (테이블: `organizations`)

**필드:**
| 컬럼 | 타입 | 제약 |
|------|------|------|
| id | UUID PK | server_default gen_random_uuid() |
| name | TEXT | NOT NULL |
| business_number | TEXT | UNIQUE, NOT NULL |
| org_type | ENUM(OrgType) | NOT NULL |
| parent_org_id | UUID FK | nullable → organizations.id |
| plan_type | ENUM(PlanType) | NOT NULL |
| monthly_api_limit | INT | default 1000 |
| is_active | BOOL | default True |
| created_at | TIMESTAMP | TimestampMixin |
| updated_at | TIMESTAMP | TimestampMixin |

**열거형:**
- `OrgType` (StrEnum): `GA`, `INDEPENDENT`, `CORPORATE`
- `PlanType` (StrEnum): `FREE_TRIAL`, `BASIC`, `PROFESSIONAL`, `ENTERPRISE`

**관계:**
- `members` → OrganizationMember (cascade delete-orphan)
- `api_keys` → APIKey (cascade delete-orphan)
- `agent_clients` → AgentClient (cascade delete-orphan)
- `usage_records` → UsageRecord (cascade delete-orphan)
- `parent` → Organization (self-referential)
- `children` → Organization (self-referential, backref)

**제약:**
- `parent_org_id` FK: 3단계 계층 구조 제한 (서비스 레이어에서 검증)

### 2.2 OrganizationMember 모델 (테이블: `organization_members`)

**필드:**
| 컬럼 | 타입 | 제약 |
|------|------|------|
| id | UUID PK | server_default gen_random_uuid() |
| organization_id | UUID FK | → organizations.id, NOT NULL |
| user_id | UUID FK | → users.id, NOT NULL |
| role | ENUM(OrgMemberRole) | NOT NULL |
| is_active | BOOL | default True |
| joined_at | TIMESTAMP | server_default now() |

**열거형:**
- `OrgMemberRole` (StrEnum): `ORG_OWNER`, `AGENT_ADMIN`, `AGENT`

**제약:**
- `UniqueConstraint("organization_id", "user_id")`
- 인덱스: `(organization_id, user_id)`, `organization_id`

### 2.3 APIKey 모델 (테이블: `api_keys`)

**필드:**
| 컬럼 | 타입 | 제약 |
|------|------|------|
| id | UUID PK | server_default gen_random_uuid() |
| organization_id | UUID FK | → organizations.id, NOT NULL |
| created_by | UUID FK | → users.id, NOT NULL |
| key_prefix | TEXT | default "bdk_" |
| key_hash | TEXT | NOT NULL, 인덱스 |
| key_last4 | TEXT | NOT NULL |
| name | TEXT | NOT NULL |
| scopes | ARRAY[TEXT] | PostgreSQL, NOT NULL |
| is_active | BOOL | default True |
| last_used_at | TIMESTAMP | nullable |
| expires_at | TIMESTAMP | nullable |
| created_at | TIMESTAMP | TimestampMixin |
| updated_at | TIMESTAMP | TimestampMixin |

**키 형식:**
- 전체: `bdk_` + 32자 랜덤 hex = 36자 (생성 시 한 번만 반환)
- DB 저장: SHA-256 해시 (`hashlib.sha256`)
- 목록 노출: `key_prefix` + `***` + `key_last4`

### 2.4 AgentClient 모델 (테이블: `agent_clients`)

**필드:**
| 컬럼 | 타입 | 제약 |
|------|------|------|
| id | UUID PK | server_default gen_random_uuid() |
| organization_id | UUID FK | → organizations.id, NOT NULL |
| agent_id | UUID FK | → users.id, NOT NULL |
| client_name | TEXT | NOT NULL, Fernet 암호화 |
| client_phone | TEXT | NOT NULL, Fernet 암호화 |
| client_email | TEXT | nullable, Fernet 암호화 |
| consent_status | ENUM(ConsentStatus) | default PENDING |
| consent_date | TIMESTAMP | nullable |
| notes | TEXT | nullable |
| created_at | TIMESTAMP | TimestampMixin |
| updated_at | TIMESTAMP | TimestampMixin |

**열거형:**
- `ConsentStatus` (StrEnum): `PENDING`, `ACTIVE`, `REVOKED`

**제약:**
- 인덱스: `(organization_id, agent_id)`, `organization_id`

**암호화:**
- `FieldEncryptor.encrypt_field()` → 저장 전
- `FieldEncryptor.decrypt_field()` → 조회 후 반환 전
- 빈 문자열은 암호화하지 않음

### 2.5 UsageRecord 모델 (테이블: `usage_records`)

**필드:**
| 컬럼 | 타입 | 제약 |
|------|------|------|
| id | UUID PK | server_default gen_random_uuid() |
| organization_id | UUID FK | → organizations.id, NOT NULL |
| api_key_id | UUID FK | → api_keys.id, nullable |
| user_id | UUID FK | → users.id, nullable |
| endpoint | TEXT | NOT NULL |
| method | TEXT | NOT NULL |
| status_code | INT | NOT NULL |
| tokens_consumed | INT | default 0 |
| response_time_ms | INT | NOT NULL |
| ip_address | TEXT | NOT NULL |
| created_at | TIMESTAMP | server_default now() |

**인덱스:**
- `(organization_id, created_at)` 복합 인덱스 (집계 쿼리 성능)

**주의:** TimestampMixin 미사용 (생성 전용, `updated_at` 없음)

---

## 3. API 엔드포인트 목록

### 3.1 Organization 엔드포인트 (`/api/v1/b2b/organizations`)

| Method | Path | 역할 | 설명 |
|--------|------|------|------|
| POST | /organizations | - | 조직 생성 (B2B 가입) |
| GET | /organizations/{org_id} | AGENT+ | 조직 조회 |
| PUT | /organizations/{org_id} | ORG_OWNER, AGENT_ADMIN | 조직 수정 |
| POST | /organizations/{org_id}/invite | ORG_OWNER, AGENT_ADMIN | 멤버 초대 |
| GET | /organizations/{org_id}/members | AGENT+ | 멤버 목록 |

### 3.2 API Key 엔드포인트 (`/api/v1/b2b/api-keys`)

| Method | Path | 역할 | 설명 |
|--------|------|------|------|
| POST | /api-keys | ORG_OWNER, AGENT_ADMIN | 키 생성 (full_key 반환) |
| GET | /api-keys | ORG_OWNER, AGENT_ADMIN | 키 목록 (마스킹) |
| DELETE | /api-keys/{key_id} | ORG_OWNER, AGENT_ADMIN | 키 폐기 |
| GET | /api-keys/{key_id}/usage | ORG_OWNER, AGENT_ADMIN | 키별 사용 통계 |

### 3.3 Client 엔드포인트 (`/api/v1/b2b/clients`)

| Method | Path | 역할 | 설명 |
|--------|------|------|------|
| POST | /clients | AGENT+ | 고객 등록 (PII 암호화) |
| GET | /clients | AGENT+ | 고객 목록 (AGENT: 본인만) |
| GET | /clients/{client_id} | AGENT+ | 고객 상세 (PII 복호화) |
| PUT | /clients/{client_id} | AGENT+ | 고객 정보 수정 |
| PUT | /clients/{client_id}/consent | AGENT+ | 동의 상태 변경 |
| POST | /clients/{client_id}/analyze | AGENT+ | 분석 요청 (ACTIVE 동의 필수) |

### 3.4 Usage/Billing 엔드포인트 (`/api/v1/b2b/usage`)

| Method | Path | 역할 | 설명 |
|--------|------|------|------|
| GET | /usage | ORG_OWNER, AGENT_ADMIN | 사용량 요약 |
| GET | /usage/details | ORG_OWNER | 상세 사용량 |
| GET | /usage/export | ORG_OWNER | CSV 다운로드 |
| GET | /billing/current | ORG_OWNER | 현재 월 청구 예상 |

### 3.5 Dashboard 엔드포인트 (`/api/v1/b2b/dashboard`)

| Method | Path | 역할 | 설명 |
|--------|------|------|------|
| GET | /dashboard/agent | AGENT+ | 설계사 대시보드 |
| GET | /dashboard/organization | ORG_OWNER, AGENT_ADMIN | 조직 대시보드 |

---

## 4. 서비스 인터페이스

### OrganizationService
- `create_organization(data, user_id) → Organization`
- `get_organization(org_id) → Organization`
- `update_organization(org_id, data) → Organization`
- `invite_member(org_id, email, role) → OrganizationMember`
- `list_members(org_id) → List[OrganizationMember]`
- `validate_org_hierarchy(parent_org_id) → None` (3단계 제한)

### APIKeyService
- `create_api_key(org_id, user_id, name, scopes) → Tuple[APIKey, str]`
- `validate_api_key(raw_key) → Tuple[APIKey, Organization]`
- `list_api_keys(org_id) → List[APIKey]`
- `revoke_api_key(key_id, org_id) → None`

### ClientService
- `create_client(org_id, agent_id, data) → AgentClient`
- `get_client(client_id, org_id, user_id, role) → AgentClient`
- `list_clients(org_id, user_id, role) → List[AgentClient]`
- `update_client(client_id, org_id, agent_id, data) → AgentClient`
- `update_consent(client_id, org_id, request) → AgentClient`
- `check_consent_for_analysis(client_id, org_id, user_id, role) → AgentClient`

### UsageService
- `record_usage(org_id, endpoint, method, status_code, tokens, response_time_ms, ip) → None`
- `check_org_quota(org_id) → Tuple[int, int, bool]`
- `get_usage_summary(org_id, period_start, period_end) → dict`
- `get_usage_details(org_id, page, page_size) → UsageDetailResponse`
- `export_usage_csv(org_id, period) → str`

### DashboardService
- `get_agent_dashboard(org_id, agent_id) → AgentDashboardResponse`
- `get_org_dashboard(org_id) → OrgDashboardResponse`

---

## 5. Pydantic 스키마

### 요청 스키마
- `OrganizationCreate`: name, business_number, org_type, plan_type, parent_org_id?
- `OrganizationUpdate`: name?, plan_type?, monthly_api_limit?, is_active?
- `OrganizationMemberInvite`: email, role
- `B2BRegistrationRequest`: email, password, business_number, organization_name, org_type
- `APIKeyCreate`: name, scopes: List[str]
- `ClientCreate`: client_name, client_phone, client_email?
- `ClientUpdate`: client_name?, client_phone?, client_email?, notes?
- `ConsentUpdateRequest`: consent_status: ConsentStatus
- `AnalyzeRequest`: query

### 응답 스키마
- `OrganizationResponse`: id, name, business_number, org_type, plan_type, monthly_api_limit, is_active, created_at, updated_at
- `OrganizationMemberResponse`: id, organization_id, user_id, role, is_active, joined_at
- `APIKeyResponse`: id, key_prefix, key_last4, name, scopes, is_active, last_used_at, created_at
- `APIKeyFullResponse`: APIKeyResponse + full_key (생성 시 1회)
- `ClientResponse`: id, organization_id, agent_id, client_name(복호화), client_phone, client_email, consent_status, consent_date, notes, created_at
- `UsageSummaryResponse`: total_requests, plan_limit, usage_percentage, by_endpoint, by_agent
- `UsageDetailResponse`: items, total, page, page_size
- `BillingEstimateResponse`: period, total_requests, plan_limit, usage_percentage, estimated_cost
- `AgentDashboardResponse`: total_clients, active_clients, recent_queries, monthly_activity
- `OrgDashboardResponse`: total_agents, total_clients, monthly_api_calls, agent_statistics, usage_trend, plan_info

---

## 6. RBAC 시스템

### 역할 계층
```
SYSTEM_ADMIN > ORG_OWNER > AGENT_ADMIN > AGENT > B2C_USER
```

### 의존성 함수
- `require_role(*roles: UserRole)` → 403 on fail
- `require_scope(scope: str)` → 403 on fail (AC-008)
- `get_current_user_or_api_key()` → JWT 또는 X-API-Key 헤더 (AC-007)

### 다중 테넌시 규칙
- AGENT: 본인 고객만 조회/수정
- AGENT_ADMIN: 조직 전체 고객 조회/수정
- ORG_OWNER: 조직 전체 + 설정 변경
- 다른 조직 접근 시 404 반환 (AC-004)

---

## 7. 보안 컴포넌트

### FieldEncryptor (`backend/app/core/encryption.py`)
- `__init__(key: str)` - Fernet 키 검증
- `encrypt_field(plaintext: str) → str` - 빈 문자열 pass-through
- `decrypt_field(encrypted: str) → str` - DecryptionError on invalid
- nonce 사용으로 같은 값도 다른 암호문 생성 (동일성 비교 불가)

### UsageTrackingMiddleware (`backend/app/core/usage_tracking.py`)
- 대상 경로: `/api/v1/b2b/` (usage, billing 경로 제외)
- 한도 초과: 429 반환 (AC-010)
- 헤더: `X-Usage-Remaining` 추가
- Redis 키: `b2b:usage:{org_id}:{YYYY-MM}`, TTL 35일

---

## 8. 의존성 분석

### 기존 User 모델과의 관계
- `User.role` 에 이미 `ORG_OWNER`, `AGENT_ADMIN`, `AGENT` 포함
- FK 참조: `organization_members.user_id`, `api_keys.created_by`, `agent_clients.agent_id`

### 신규 라이브러리
- `cryptography` (Fernet) - PII 암호화
- `redis` (aioredis) - 사용량 추적 카운터
- 기존: `sqlalchemy`, `fastapi`, `pydantic`, `bcrypt`

---

## 9. 구현 파일 구조

```
backend/app/
├── models/
│   └── organization.py      # Organization, OrganizationMember, OrgType, PlanType, OrgMemberRole
│   └── api_key.py           # APIKey
│   └── agent_client.py      # AgentClient, ConsentStatus
│   └── usage_record.py      # UsageRecord
├── schemas/
│   └── b2b.py               # 모든 B2B Pydantic 스키마 (443줄 예상)
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
│   ├── encryption.py        # FieldEncryptor, DecryptionError
│   └── usage_tracking.py    # UsageTrackingMiddleware
└── main.py                  # b2b 라우터 등록 추가
```

---

## 10. 주요 Acceptance Criteria

| AC | 내용 |
|----|------|
| AC-001 | 조직 생성 시 사업자번호 중복 불가 (409) |
| AC-002 | 조직 계층 3단계 초과 불가 (400) |
| AC-003 | Client 분석 요청 시 ACTIVE 동의 필수 (403) |
| AC-004 | 다른 조직 고객 접근 시 404 |
| AC-005 | 설계사 대시보드: 고객 수, 활동, 최근 분석 이력 |
| AC-006 | 조직 대시보드: 설계사별 통계, 6개월 추이, 80% 경고 |
| AC-007 | API 키 생성 시 full_key 반환, DB에는 해시만 |
| AC-008 | 스코프 없는 엔드포인트 호출 시 403 |
| AC-009 | B2B API 요청 시 자동 사용량 기록 |
| AC-010 | 월 한도 초과 시 429 반환 |

---

## 11. 기존 코드 참조

- Reference: `backend/app/models/base.py` (TimestampMixin, UUID PK 패턴)
- Reference: `backend/app/models/insurance.py` (관계 cascade 패턴)
- Reference: `backend/app/models/user.py` (UserRole enum, user 구조)
- Reference: `backend/app/api/v1/auth.py` (JWT 의존성 패턴)
- Reference: `backend/tests/unit/test_b2b_models.py` (Organization 전체 구조)
- Reference: `backend/tests/unit/test_b2b_api_key_model.py` (APIKey 구조)
- Reference: `backend/tests/unit/test_b2b_encryption.py` (FieldEncryptor 인터페이스)
- Reference: `backend/tests/unit/test_b2b_usage_middleware.py` (미들웨어 동작)

---

**연구 완료 일시**: 2026-03-21
**연구 대상**: 19개 B2B 테스트 파일, 기존 모델/API/서비스 패턴
**구현 범위**: 5개 SQLAlchemy 모델, 5개 서비스, 5개 API 라우터, Pydantic 스키마, 2개 코어 컴포넌트, 미들웨어
