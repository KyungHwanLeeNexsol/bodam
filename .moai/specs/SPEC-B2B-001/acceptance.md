---
id: SPEC-B2B-001
type: acceptance
version: "1.0.0"
created: "2026-03-21"
updated: "2026-03-21"
author: zuge3
---

## 수락 기준 (Acceptance Criteria)

본 문서는 SPEC-B2B-001의 구현 완료 여부를 검증하기 위한 수락 기준을 정의한다. 각 시나리오는 Given/When/Then 형식으로 작성되었으며, 모든 시나리오가 통과해야 SPEC 완료로 인정된다.

---

### AC-001: 조직 생성 - 사업자번호 중복 방지

**관련 요구사항:** REQ-001-UB1

#### Scenario 1: 정상 조직 생성

```gherkin
Given 인증된 사용자가 존재하고
  And 사업자번호 "123-45-67890"이 시스템에 등록되지 않은 상태일 때
When POST /api/v1/b2b/organizations 요청을 보내면
  And body에 name="테스트 GA", business_number="123-45-67890", org_type="GA", plan_type="BASIC"을 포함하면
Then 응답 상태 코드는 201이어야 하고
  And 응답 body에 생성된 Organization의 id, name, business_number가 포함되어야 하고
  And 요청자가 ORG_OWNER로 OrganizationMember에 자동 등록되어야 한다
```

#### Scenario 2: 중복 사업자번호로 조직 생성 실패

```gherkin
Given 사업자번호 "123-45-67890"으로 이미 조직이 생성된 상태일 때
When POST /api/v1/b2b/organizations 요청을 보내면
  And body에 business_number="123-45-67890"을 포함하면
Then 응답 상태 코드는 409 Conflict이어야 하고
  And 에러 메시지에 사업자번호 중복 관련 내용이 포함되어야 한다
```

---

### AC-002: 조직 계층 3단계 제한

**관련 요구사항:** REQ-001-UB2, REQ-001-O1

#### Scenario 1: 허용되는 3단계 계층 생성

```gherkin
Given Level-1 조직(GA)이 존재하고
  And Level-1의 하위로 Level-2 조직(지점)이 존재할 때
When Level-2의 하위로 Level-3 조직(팀) 생성을 요청하면
  And parent_org_id에 Level-2 조직의 id를 지정하면
Then 응답 상태 코드는 201이어야 하고
  And Level-3 조직이 정상 생성되어야 한다
```

#### Scenario 2: 4단계 계층 생성 거부

```gherkin
Given Level-1 > Level-2 > Level-3 계층 구조가 존재할 때
When Level-3의 하위로 Level-4 조직 생성을 요청하면
  And parent_org_id에 Level-3 조직의 id를 지정하면
Then 응답 상태 코드는 400 Bad Request이어야 하고
  And 에러 메시지에 "3단계" 또는 "hierarchy" 관련 내용이 포함되어야 한다
```

---

### AC-003: API 키 생성 및 인증 흐름

**관련 요구사항:** REQ-002-E1, REQ-002-E2, REQ-002-U2

#### Scenario 1: API 키 생성 및 full_key 반환

```gherkin
Given ORG_OWNER 또는 AGENT_ADMIN 역할의 인증된 사용자가 존재하고
  And 해당 사용자가 조직에 속해 있을 때
When POST /api/v1/b2b/api-keys 요청을 보내면
  And body에 name="Production Key", scopes=["read:clients", "write:clients"]를 포함하면
Then 응답 상태 코드는 201이어야 하고
  And 응답 body에 full_key가 "bdk_"로 시작하는 36자 문자열로 포함되어야 하고
  And DB의 api_keys 테이블에는 full_key가 아닌 SHA-256 해시만 저장되어야 한다
```

#### Scenario 2: API 키로 인증 성공

```gherkin
Given 생성된 API 키의 full_key 값을 보유하고 있을 때
When X-API-Key 헤더에 full_key를 설정하여 B2B API에 요청을 보내면
Then 시스템은 full_key를 SHA-256 해시로 변환하여 DB와 대조하고
  And 인증이 성공하여 요청이 정상 처리되어야 한다
```

#### Scenario 3: API 키 목록 조회 시 마스킹

```gherkin
Given 조직에 여러 API 키가 생성된 상태일 때
When GET /api/v1/b2b/api-keys 요청을 보내면
Then 응답의 각 키에 full_key는 포함되지 않아야 하고
  And key_prefix + "***" + key_last4 형식으로 마스킹되어 반환되어야 한다
```

---

### AC-004: 에이전트 클라이언트 접근 제어

**관련 요구사항:** REQ-003-UB2, REQ-003-S1, REQ-003-S2

#### Scenario 1: AGENT가 타인 고객 접근 시 404

```gherkin
Given AGENT-A가 등록한 고객 Client-X가 존재하고
  And AGENT-B가 같은 조직에 속해 있을 때
When AGENT-B가 GET /api/v1/b2b/clients/{Client-X의 id} 요청을 보내면
Then 응답 상태 코드는 404 Not Found이어야 하고
  And Client-X의 존재 여부가 노출되지 않아야 한다
```

#### Scenario 2: AGENT_ADMIN이 조직 전체 고객 조회

```gherkin
Given AGENT-A와 AGENT-B가 각각 고객을 등록한 상태이고
  And AGENT_ADMIN이 같은 조직에 속해 있을 때
When AGENT_ADMIN이 GET /api/v1/b2b/clients 요청을 보내면
Then 응답에 AGENT-A와 AGENT-B의 고객이 모두 포함되어야 한다
```

---

### AC-005: 동의 없이 분석 요청 거부

**관련 요구사항:** REQ-003-UB1, REQ-003-E3

#### Scenario 1: ACTIVE 동의가 없는 클라이언트 분석 요청 거부

```gherkin
Given AGENT가 등록한 고객 Client-Y의 consent_status가 "PENDING"일 때
When AGENT가 POST /api/v1/b2b/clients/{Client-Y의 id}/analyze 요청을 보내면
Then 응답 상태 코드는 403 Forbidden이어야 하고
  And 에러 메시지에 "consent" 또는 "동의" 관련 내용이 포함되어야 한다
```

#### Scenario 2: ACTIVE 동의 후 분석 요청 성공

```gherkin
Given AGENT가 등록한 고객 Client-Y의 consent_status를 "ACTIVE"로 변경하고
  And consent_date가 기록된 상태일 때
When AGENT가 POST /api/v1/b2b/clients/{Client-Y의 id}/analyze 요청을 보내면
Then 응답 상태 코드는 200이어야 하고
  And 분석 결과가 정상 반환되어야 한다
```

---

### AC-006: 월간 한도 초과 시 429 반환

**관련 요구사항:** REQ-004-UB1

#### Scenario 1: 한도 초과 시 요청 거부

```gherkin
Given 조직의 monthly_api_limit이 1000이고
  And 현재 월 사용량이 1000에 도달한 상태일 때
When 해당 조직의 API 키로 B2B API 요청을 보내면
Then 응답 상태 코드는 429 Too Many Requests이어야 하고
  And X-Usage-Remaining 헤더의 값이 0이어야 한다
```

#### Scenario 2: 한도 이내 요청 시 잔여량 헤더 포함

```gherkin
Given 조직의 monthly_api_limit이 1000이고
  And 현재 월 사용량이 500인 상태일 때
When 해당 조직의 API 키로 B2B API 요청을 보내면
Then 응답이 정상 처리되어야 하고
  And X-Usage-Remaining 헤더의 값이 499이어야 한다
```

---

### AC-007: 스코프 없는 API 키 접근 거부

**관련 요구사항:** REQ-002-UB1

#### Scenario 1: 필요 스코프 누락 시 403

```gherkin
Given API 키가 scopes=["read:clients"]로 생성된 상태일 때
When 해당 API 키로 POST /api/v1/b2b/clients (write:clients 스코프 필요) 요청을 보내면
Then 응답 상태 코드는 403 Forbidden이어야 하고
  And 에러 메시지에 "scope" 또는 "권한" 관련 내용이 포함되어야 한다
```

#### Scenario 2: 충분한 스코프로 접근 성공

```gherkin
Given API 키가 scopes=["read:clients", "write:clients"]로 생성된 상태일 때
When 해당 API 키로 POST /api/v1/b2b/clients 요청을 보내면
Then 요청이 정상 처리되어야 한다
```

---

### AC-008: 설계사 대시보드 데이터 정확성

**관련 요구사항:** REQ-005-E1

#### Scenario 1: 설계사 대시보드 데이터 반환

```gherkin
Given AGENT가 3명의 고객을 등록하고
  And 그 중 2명이 consent_status="ACTIVE"이고
  And 최근 5건의 분석 이력이 존재할 때
When GET /api/v1/b2b/dashboard/agent 요청을 보내면
Then 응답의 total_clients는 3이어야 하고
  And active_clients는 2이어야 하고
  And recent_queries에 최근 분석 이력이 포함되어야 하고
  And monthly_activity에 월간 활동 데이터가 포함되어야 한다
```

#### Scenario 2: 조직 대시보드 데이터 반환

```gherkin
Given 조직에 AGENT 3명이 소속되고
  And 총 고객이 15명이고
  And 현재 월 API 호출이 800건이고
  And monthly_api_limit이 1000일 때
When ORG_OWNER가 GET /api/v1/b2b/dashboard/organization 요청을 보내면
Then 응답의 total_agents는 3이어야 하고
  And total_clients는 15이어야 하고
  And monthly_api_calls는 800이어야 하고
  And usage_percentage가 80이어야 하고
  And 80% 이상이므로 경고 플래그가 포함되어야 한다
```

---

### AC-009: PII 암호화 검증

**관련 요구사항:** REQ-003-U1, REQ-003-U2

#### Scenario 1: 저장된 PII가 암호화되어 있음

```gherkin
Given AGENT가 client_name="홍길동", client_phone="010-1234-5678"로 고객을 등록했을 때
When DB의 agent_clients 테이블에서 해당 레코드를 직접 조회하면
Then client_name 컬럼 값은 "홍길동"이 아닌 Fernet 암호문이어야 하고
  And client_phone 컬럼 값은 "010-1234-5678"이 아닌 Fernet 암호문이어야 하고
  And 동일 평문이라도 nonce로 인해 매번 다른 암호문이 생성되어야 한다
```

#### Scenario 2: API 응답에서 PII가 복호화되어 반환됨

```gherkin
Given 암호화된 PII가 저장된 고객 레코드가 존재할 때
When AGENT가 GET /api/v1/b2b/clients/{client_id} 요청을 보내면
Then 응답의 client_name은 "홍길동"이어야 하고
  And client_phone은 "010-1234-5678"이어야 한다
```

---

### AC-010: CSV 사용량 내보내기

**관련 요구사항:** REQ-004-E2

#### Scenario 1: 사용량 CSV 다운로드

```gherkin
Given 조직에 최근 30일간 100건의 API 사용 기록이 존재할 때
When ORG_OWNER가 GET /api/v1/b2b/usage/export?period=2026-03 요청을 보내면
Then 응답 Content-Type은 text/csv이어야 하고
  And CSV 파일에 endpoint, method, status_code, tokens_consumed, response_time_ms, created_at 컬럼이 포함되어야 하고
  And 행 수가 100이어야 한다
```

#### Scenario 2: 사용 기록 없는 기간 CSV 내보내기

```gherkin
Given 2025-01 기간에 API 사용 기록이 없을 때
When ORG_OWNER가 GET /api/v1/b2b/usage/export?period=2025-01 요청을 보내면
Then 응답 Content-Type은 text/csv이어야 하고
  And CSV 파일에 헤더 행만 포함되어야 하고
  And 데이터 행은 0이어야 한다
```

---

## Quality Gate 기준

### Definition of Done

- [ ] 모든 AC 시나리오(AC-001 ~ AC-010) 통과
- [ ] 테스트 커버리지 85% 이상
- [ ] 보안: PII 암호화 검증 완료
- [ ] 보안: API 키 해시 저장 검증 완료
- [ ] 보안: RBAC 접근 제어 검증 완료
- [ ] 성능: Redis 사용량 카운터 동작 검증
- [ ] 성능: 복합 인덱스 적용 확인
- [ ] Alembic 마이그레이션 정상 실행 (upgrade/downgrade)
- [ ] ruff/black 린트 통과
- [ ] MX 태그 적용 완료 (plan.md 섹션 6 참조)

### 검증 도구

| 도구 | 용도 |
|------|------|
| pytest + pytest-asyncio | 단위/통합 테스트 |
| httpx.AsyncClient | API 엔드포인트 테스트 |
| pytest-cov | 커버리지 측정 |
| ruff | 린트 검사 |
| black | 코드 포매팅 |

---

## TAG 추적성

- SPEC-B2B-001 >> AC-001 (조직 생성) >> REQ-001-UB1
- SPEC-B2B-001 >> AC-002 (계층 제한) >> REQ-001-UB2, REQ-001-O1
- SPEC-B2B-001 >> AC-003 (API 키 인증) >> REQ-002-E1, REQ-002-E2, REQ-002-U2
- SPEC-B2B-001 >> AC-004 (접근 제어) >> REQ-003-UB2, REQ-003-S1, REQ-003-S2
- SPEC-B2B-001 >> AC-005 (동의 관리) >> REQ-003-UB1, REQ-003-E3
- SPEC-B2B-001 >> AC-006 (한도 초과) >> REQ-004-UB1
- SPEC-B2B-001 >> AC-007 (스코프 제어) >> REQ-002-UB1
- SPEC-B2B-001 >> AC-008 (대시보드) >> REQ-005-E1
- SPEC-B2B-001 >> AC-009 (PII 암호화) >> REQ-003-U1, REQ-003-U2
- SPEC-B2B-001 >> AC-010 (CSV 내보내기) >> REQ-004-E2
