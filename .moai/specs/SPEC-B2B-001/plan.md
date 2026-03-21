---
id: SPEC-B2B-001
type: plan
version: "1.0.0"
created: "2026-03-21"
updated: "2026-03-21"
author: zuge3
---

## 1. 구현 계획 개요

SPEC-B2B-001은 Bodam 플랫폼의 B2B 조직 관리 시스템을 구현한다. 기존 코드베이스의 모델/서비스/라우터 패턴을 준수하며, 8개 TASK를 의존성 순서대로 구현한다.

**구현 전략:**
- Bottom-up 접근: Core 컴포넌트 -> 모델 -> 스키마 -> 서비스 -> 라우터 -> 등록 -> 마이그레이션
- 기존 패턴 재사용: TimestampMixin, UUID PK, AsyncSession 주입, JWT 의존성
- 신규 패턴 도입: Fernet 암호화, Redis 사용량 카운터, scope 기반 API 키 인증

---

## 2. Task 분해

### TASK-001: Core 컴포넌트 구현

**설명:** B2B 도메인 전용 핵심 유틸리티 구현

| 항목 | 내용 |
|------|------|
| 파일 | `backend/app/core/encryption.py`, `backend/app/core/usage_tracking.py` |
| 의존성 | 없음 (독립 모듈) |
| 복잡도 | Medium |

**세부 구현:**
- `FieldEncryptor` 클래스: Fernet 키 초기화, encrypt_field/decrypt_field 메서드
- `DecryptionError` 커스텀 예외
- `UsageTrackingMiddleware`: FastAPI Middleware, Redis 카운터 증감, 429 응답, X-Usage-Remaining 헤더

**관련 요구사항:** REQ-003-U1, REQ-004-U2, REQ-004-E1, REQ-004-UB1

---

### TASK-002: SQLAlchemy 모델 구현

**설명:** B2B 도메인의 5개 데이터 모델 구현

| 항목 | 내용 |
|------|------|
| 파일 | `backend/app/models/organization.py`, `backend/app/models/api_key.py`, `backend/app/models/agent_client.py`, `backend/app/models/usage_record.py` |
| 의존성 | TASK-001 (FieldEncryptor 참조 없음, 모델 자체는 독립) |
| 복잡도 | Medium |

**세부 구현:**
- `Organization`: OrgType/PlanType enum, self-referential FK(parent_org_id), cascade 관계
- `OrganizationMember`: OrgMemberRole enum, UniqueConstraint(org_id, user_id)
- `APIKey`: key_hash 인덱스, scopes ARRAY[TEXT], expires_at nullable
- `AgentClient`: ConsentStatus enum, PII 필드 (암호화는 서비스 레이어)
- `UsageRecord`: created_at only (TimestampMixin 미사용), 복합 인덱스

**관련 요구사항:** REQ-001-U1, REQ-001-U2, REQ-002-U1, REQ-003-U1, REQ-004-U1

---

### TASK-003: 모델 Export 업데이트

**설명:** 신규 모델을 app/models/__init__.py에 등록

| 항목 | 내용 |
|------|------|
| 파일 | `backend/app/models/__init__.py` |
| 의존성 | TASK-002 |
| 복잡도 | Low |

**세부 구현:**
- Organization, OrganizationMember, OrgType, PlanType, OrgMemberRole import 추가
- APIKey import 추가
- AgentClient, ConsentStatus import 추가
- UsageRecord import 추가

---

### TASK-004: Pydantic 스키마 구현

**설명:** B2B API용 요청/응답 스키마 전체 구현

| 항목 | 내용 |
|------|------|
| 파일 | `backend/app/schemas/b2b.py` |
| 의존성 | TASK-002 (enum 참조) |
| 복잡도 | Medium-High |

**세부 구현:**
- 요청 스키마: OrganizationCreate, OrganizationUpdate, OrganizationMemberInvite, B2BRegistrationRequest, APIKeyCreate, ClientCreate, ClientUpdate, ConsentUpdateRequest, AnalyzeRequest
- 응답 스키마: OrganizationResponse, OrganizationMemberResponse, APIKeyResponse, APIKeyFullResponse, ClientResponse, UsageSummaryResponse, UsageDetailResponse, BillingEstimateResponse, AgentDashboardResponse, OrgDashboardResponse
- ConfigDict(from_attributes=True) 적용
- field_validator로 business_number 형식, email 정규화 검증

**관련 요구사항:** 모든 REQ (API 입출력 정의)

---

### TASK-005: B2B 서비스 구현

**설명:** 비즈니스 로직을 담당하는 5개 서비스 클래스 구현

| 항목 | 내용 |
|------|------|
| 파일 | `backend/app/services/b2b/__init__.py`, `organization_service.py`, `api_key_service.py`, `client_service.py`, `usage_service.py`, `dashboard_service.py` |
| 의존성 | TASK-001, TASK-002, TASK-004 |
| 복잡도 | High |

**세부 구현:**
- `OrganizationService`: CRUD, 계층 검증(3단계), 멤버 초대, business_number 중복 체크
- `APIKeyService`: 키 생성(bdk_ + hex), SHA-256 해시 저장, 키 검증, scope 체크
- `ClientService`: PII 암호화/복호화, RBAC 기반 접근 제어, 동의 관리, 분석 요청 전 동의 확인
- `UsageService`: Redis 카운터, 월간 한도 체크, CSV 내보내기, 상세 사용량 조회
- `DashboardService`: 설계사/조직 대시보드 집계 쿼리

**관련 요구사항:** REQ-001 ~ REQ-005 전체

---

### TASK-006: API 라우터 구현

**설명:** B2B API 엔드포인트 5개 모듈 구현

| 항목 | 내용 |
|------|------|
| 파일 | `backend/app/api/v1/b2b/__init__.py`, `organizations.py`, `api_keys.py`, `clients.py`, `usage.py`, `dashboard.py` |
| 의존성 | TASK-004, TASK-005 |
| 복잡도 | High |

**세부 구현:**
- 각 라우터에 APIRouter(prefix, tags) 설정
- JWT 의존성(get_current_user) 및 역할 검증(require_role) 적용
- API 키 인증 의존성(get_current_user_or_api_key) 구현
- scope 기반 권한 검증(require_scope) 구현
- 에러 응답: 400, 401, 403, 404, 409, 429

**관련 요구사항:** REQ-001 ~ REQ-005 전체 (API 인터페이스)

---

### TASK-007: main.py 라우터 및 미들웨어 등록

**설명:** B2B 라우터와 UsageTrackingMiddleware를 FastAPI 앱에 등록

| 항목 | 내용 |
|------|------|
| 파일 | `backend/app/main.py` |
| 의존성 | TASK-001, TASK-006 |
| 복잡도 | Low |

**세부 구현:**
- `app.include_router(b2b_router, prefix="/api/v1/b2b")` 추가
- `app.add_middleware(UsageTrackingMiddleware)` 추가
- Redis 연결 설정 (환경변수 기반)

---

### TASK-008: DB 마이그레이션

**설명:** Alembic으로 B2B 테이블 마이그레이션 생성 및 적용

| 항목 | 내용 |
|------|------|
| 파일 | `backend/alembic/versions/xxxx_add_b2b_tables.py` |
| 의존성 | TASK-002, TASK-003 |
| 복잡도 | Medium |

**세부 구현:**
- organizations, organization_members, api_keys, agent_clients, usage_records 테이블 생성
- OrgType, PlanType, OrgMemberRole, ConsentStatus enum 타입 생성
- 인덱스 및 제약 조건 적용
- downgrade: 테이블 및 enum 타입 삭제

---

## 3. 구현 순서 및 의존성 그래프

```
TASK-001 (Core) ─────────────────────┐
                                      ├──→ TASK-005 (Services) ──→ TASK-006 (Routers) ──→ TASK-007 (Registration)
TASK-002 (Models) ──→ TASK-003 (Export) ┤
                   ──→ TASK-004 (Schemas) ┘
                   ──→ TASK-008 (Migration)
```

**우선순위 기반 마일스톤:**

### Primary Goal (핵심 인프라)
- TASK-001: Core 컴포넌트 (encryption, usage_tracking)
- TASK-002: SQLAlchemy 모델 5개
- TASK-003: 모델 Export

### Secondary Goal (API 인터페이스)
- TASK-004: Pydantic 스키마
- TASK-005: 서비스 레이어 5개

### Final Goal (통합 및 배포)
- TASK-006: API 라우터 5개
- TASK-007: main.py 등록
- TASK-008: DB 마이그레이션

---

## 4. 기술 스택 명세

| 라이브러리 | 버전 | 용도 |
|-----------|------|------|
| FastAPI | >=0.135.0,<0.136.0 | 기존 프로젝트 버전 유지 |
| SQLAlchemy | 2.0+ (asyncio) | 비동기 ORM |
| Pydantic | v2.9+ | 스키마 검증 |
| cryptography | >=44.0.0 | Fernet 암호화 |
| redis | >=5.0.0 | 비동기 Redis (aioredis 통합) |
| Alembic | latest | DB 마이그레이션 |
| pytest | >=8.0.0 | 테스트 프레임워크 |
| pytest-asyncio | >=0.24.0 | 비동기 테스트 |

---

## 5. 리스크 분석

### High Risk

| 리스크 | 영향 | 대응 |
|--------|------|------|
| Fernet 키 분실/변경 | PII 데이터 영구 복호화 불가 | 키 로테이션 전략 수립, 백업 키 관리 |
| Redis 장애 시 사용량 추적 실패 | 한도 초과 사용 또는 서비스 거부 | Fallback: DB 직접 카운트, Redis 재연결 로직 |

### Medium Risk

| 리스크 | 영향 | 대응 |
|--------|------|------|
| 조직 계층 검증 로직 오류 | 무한 재귀 또는 깊은 계층 생성 | 서비스 레이어에서 최대 3단계 명시적 검증 |
| API 키 해시 충돌 | 인증 오류 | SHA-256 충돌 확률 극히 낮음, 키 길이 충분 |

### Low Risk

| 리스크 | 영향 | 대응 |
|--------|------|------|
| 대시보드 집계 쿼리 성능 | 느린 응답 | 복합 인덱스 적용, 필요 시 materialized view |

---

## 6. MX 태그 전략

| 대상 | MX 태그 | 사유 |
|------|---------|------|
| `FieldEncryptor.encrypt_field()` | `@MX:WARN` | PII 처리 위험 코드, 키 관리 주의 |
| `APIKeyService.validate_api_key()` | `@MX:ANCHOR` | 모든 B2B API 인증의 핵심 진입점 (fan_in >= 5) |
| `UsageTrackingMiddleware` | `@MX:ANCHOR` | 모든 B2B 요청 통과 (fan_in >= 10) |
| `ClientService.check_consent_for_analysis()` | `@MX:WARN` | 동의 없는 분석 방지, 규정 준수 핵심 |
| `OrganizationService.validate_org_hierarchy()` | `@MX:NOTE` | 3단계 제한 비즈니스 규칙 |

---

## TAG 추적성

- SPEC-B2B-001 >> TASK-001 (Core 컴포넌트)
- SPEC-B2B-001 >> TASK-002 (모델)
- SPEC-B2B-001 >> TASK-003 (모델 Export)
- SPEC-B2B-001 >> TASK-004 (스키마)
- SPEC-B2B-001 >> TASK-005 (서비스)
- SPEC-B2B-001 >> TASK-006 (라우터)
- SPEC-B2B-001 >> TASK-007 (등록)
- SPEC-B2B-001 >> TASK-008 (마이그레이션)
