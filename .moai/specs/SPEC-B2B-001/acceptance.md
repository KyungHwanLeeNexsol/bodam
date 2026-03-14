---
id: SPEC-B2B-001
type: acceptance
version: 1.0.0
created: 2026-03-15
updated: 2026-03-15
author: zuge3
---

# SPEC-B2B-001 수용 기준: 보험 설계사 B2B 대시보드

## 1. Module 1: B2B 에이전트 계정 및 역할 관리

### AC-001: 설계사 B2B 계정 등록

```gherkin
Feature: B2B 에이전트 계정 등록

  Scenario: 보험 설계사가 B2B 계정을 등록한다
    Given 유효한 이메일, 비밀번호, 사업자등록번호를 가진 설계사
    When 설계사가 B2B 계정 등록 API를 호출한다
    Then 시스템은 계정을 "PENDING_APPROVAL" 상태로 생성한다
    And 시스템은 역할을 "B2C_USER"로 설정한다 (승인 전)
    And 관리자에게 계정 승인 요청 알림이 발송된다

  Scenario: 관리자가 B2B 계정을 승인한다
    Given "PENDING_APPROVAL" 상태의 B2B 계정 등록 요청
    And SYSTEM_ADMIN 역할의 관리자가 로그인한 상태
    When 관리자가 계정 승인 API를 호출한다
    Then 해당 사용자의 역할이 "AGENT"로 변경된다
    And 지정된 조직에 OrganizationMember로 연결된다
    And 사용자에게 승인 완료 알림이 발송된다

  Scenario: 승인되지 않은 사용자가 B2B 기능에 접근을 시도한다
    Given "B2C_USER" 역할의 사용자
    When 사용자가 /api/v1/b2b/clients API를 호출한다
    Then 시스템은 403 Forbidden을 반환한다
    And 응답 본문에 "B2B 기능에 접근 권한이 없습니다" 메시지가 포함된다
```

### AC-002: 조직 생성 및 관리

```gherkin
Feature: 조직(Organization) 생성 및 관리

  Scenario: 조직을 생성한다
    Given SYSTEM_ADMIN 역할의 관리자가 로그인한 상태
    When 관리자가 조직 생성 API를 호출한다
      | field           | value                  |
      | name            | 테스트 GA              |
      | business_number | 123-45-67890           |
      | org_type        | GA                     |
      | plan_type       | PROFESSIONAL           |
    Then 시스템은 201 Created를 반환한다
    And 고유 organization_id가 할당된다
    And 요청한 사용자가 ORG_OWNER로 등록된다

  Scenario: 조직에 팀원을 초대한다
    Given ORG_OWNER 역할의 사용자가 조직에 로그인한 상태
    When ORG_OWNER가 팀원 초대 API를 호출한다
      | field  | value              |
      | email  | agent@example.com  |
      | role   | AGENT              |
    Then 시스템은 초대 이메일을 발송한다
    And 초대 상태가 "PENDING"으로 생성된다

  Scenario: 초대받은 사용자가 조직에 가입한다
    Given 유효한 초대 토큰을 가진 사용자
    When 사용자가 초대 수락 API를 호출한다
    Then 사용자가 해당 조직의 AGENT로 등록된다
    And 초대 상태가 "ACCEPTED"로 변경된다

  Scenario: 3단계를 초과하는 하위 조직 생성을 거부한다
    Given 이미 3단계 깊이의 조직 계층이 존재하는 상태
      | level | organization     |
      | 1     | GA 본사          |
      | 2     | 서울 지점        |
      | 3     | 강남 사무소      |
    When ORG_OWNER가 "강남 사무소" 하위에 새 조직을 생성하려 한다
    Then 시스템은 400 Bad Request를 반환한다
    And 응답에 "조직 계층은 최대 3단계까지 허용됩니다" 메시지가 포함된다
```

---

## 2. Module 2: 고객 관리 CRM 기능

### AC-003: 고객 등록 및 대리 질의

```gherkin
Feature: 고객 등록 및 대리 분석 질의

  Scenario: 설계사가 신규 고객을 등록한다
    Given AGENT 역할의 설계사가 로그인한 상태
    When 설계사가 고객 등록 API를 호출한다
      | field        | value           |
      | client_name  | 홍길동          |
      | client_phone | 010-1234-5678   |
      | client_email | hong@email.com  |
    Then 시스템은 201 Created를 반환한다
    And 고객이 해당 설계사의 포트폴리오에 연결된다
    And 고객의 consent_status가 "PENDING"으로 설정된다
    And 고객 PII 데이터가 AES-256으로 암호화되어 저장된다

  Scenario: 설계사가 고객을 대리하여 보험 분석을 요청한다
    Given AGENT 역할의 설계사가 로그인한 상태
    And 해당 설계사에게 등록된 고객(consent_status=ACTIVE)이 존재
    When 설계사가 고객 대리 분석 API를 호출한다
      | field    | value                                |
      | query    | 고객의 실손보험에서 MRI 검사 보상 여부 |
    Then 시스템은 고객의 보험 정보를 컨텍스트에 포함하여 AI 분석을 수행한다
    And 분석 결과가 해당 고객의 분석 이력에 저장된다
    And 응답에 분석 결과와 관련 보장 항목이 포함된다

  Scenario: 동의하지 않은 고객에 대한 대리 분석을 거부한다
    Given AGENT 역할의 설계사가 로그인한 상태
    And consent_status가 "PENDING"인 고객이 존재
    When 설계사가 해당 고객의 대리 분석 API를 호출한다
    Then 시스템은 403 Forbidden을 반환한다
    And 응답에 "고객의 개인정보 처리 동의가 필요합니다" 메시지가 포함된다
```

### AC-004: 조직 간 데이터 격리

```gherkin
Feature: 조직 간 고객 데이터 격리

  Scenario: 다른 조직의 고객 데이터에 접근을 시도한다
    Given 조직 A에 소속된 AGENT가 로그인한 상태
    And 조직 B에 등록된 고객(client_id: "xxx")이 존재
    When AGENT가 /api/v1/b2b/clients/xxx API를 호출한다
    Then 시스템은 404 Not Found를 반환한다
    And 조직 B의 고객 데이터는 노출되지 않는다

  Scenario: 설계사가 본인 담당 고객만 조회한다
    Given 조직 A에 AGENT_1과 AGENT_2가 소속된 상태
    And AGENT_1이 고객 3명, AGENT_2가 고객 2명을 등록한 상태
    When AGENT_1이 고객 목록 API를 호출한다
    Then 시스템은 AGENT_1의 고객 3명만 반환한다
    And AGENT_2의 고객 데이터는 포함되지 않는다

  Scenario: AGENT_ADMIN이 조직 전체 고객을 조회한다
    Given 조직 A에 AGENT_ADMIN이 소속된 상태
    And 조직 A에 총 5명의 고객이 등록된 상태
    When AGENT_ADMIN이 조직 전체 고객 목록 API를 호출한다
    Then 시스템은 조직 A의 전체 고객 5명을 반환한다
```

---

## 3. Module 3: 고객별 분석 대시보드

### AC-005: 에이전트 대시보드

```gherkin
Feature: 에이전트 대시보드

  Scenario: 설계사가 대시보드에 접근한다
    Given AGENT 역할의 설계사가 로그인한 상태
    And 설계사에게 10명의 고객이 등록된 상태
    When 설계사가 /api/v1/b2b/dashboard/agent API를 호출한다
    Then 응답에 다음 데이터가 포함된다:
      | field            | description       |
      | total_clients    | 총 고객 수 (10)   |
      | total_policies   | 총 보험 계약 수    |
      | recent_queries   | 최근 질의 이력     |
      | monthly_activity | 월간 활동 요약     |

  Scenario: 설계사가 특정 고객의 상세 분석 이력을 조회한다
    Given AGENT 역할의 설계사가 로그인한 상태
    And 특정 고객에 대해 5건의 분석 이력이 존재
    When 설계사가 /api/v1/b2b/clients/{client_id}/history API를 호출한다
    Then 시스템은 해당 고객의 분석 이력 5건을 최신순으로 반환한다
    And 각 이력에 질의 내용, 분석 결과, 일시가 포함된다
```

### AC-006: 조직 관리 대시보드

```gherkin
Feature: 조직 관리 대시보드

  Scenario: 조직 관리자가 조직 대시보드에 접근한다
    Given ORG_OWNER 역할의 사용자가 로그인한 상태
    When 사용자가 /api/v1/b2b/dashboard/organization API를 호출한다
    Then 응답에 다음 데이터가 포함된다:
      | field               | description              |
      | total_agents        | 소속 설계사 수            |
      | total_clients       | 전체 고객 수              |
      | monthly_api_calls   | 월별 API 호출 수          |
      | agent_statistics    | 설계사별 고객/질의 통계    |
      | usage_trend         | 월별 사용량 추이           |

  Scenario: 사용량 80% 도달 시 경고 알림
    Given 조직의 월 API 제한이 10,000건인 상태
    And 현재 월 사용량이 8,000건인 상태
    When 새로운 API 요청이 수신된다
    Then 시스템은 ORG_OWNER에게 사용량 경고 알림을 발송한다
    And 알림에 현재 사용량(80%)과 남은 사용량이 포함된다
```

---

## 4. Module 4: B2B API 키 관리

### AC-007: API 키 생성 및 사용

```gherkin
Feature: API 키 생성 및 인증

  Scenario: API 키를 생성한다
    Given AGENT_ADMIN 역할의 사용자가 로그인한 상태
    When 사용자가 API 키 생성 API를 호출한다
      | field  | value                    |
      | name   | 고객관리시스템 연동 키    |
      | scopes | ["read", "analysis"]     |
    Then 시스템은 201 Created를 반환한다
    And 응답에 전체 API 키(bdk_로 시작)가 한 번 포함된다
    And 데이터베이스에는 키의 SHA-256 해시만 저장된다

  Scenario: API 키로 인증하여 API를 호출한다
    Given 유효한 API 키(scopes: ["read", "analysis"])가 존재
    When 외부 시스템이 X-API-Key 헤더에 API 키를 포함하여 GET /api/v1/b2b/clients를 호출한다
    Then 시스템은 200 OK를 반환한다
    And API 키 사용 로그가 기록된다

  Scenario: 스코프가 없는 엔드포인트 호출을 거부한다
    Given scopes가 ["read"]인 API 키가 존재
    When 외부 시스템이 해당 키로 POST /api/v1/b2b/clients (write 스코프 필요)를 호출한다
    Then 시스템은 403 Forbidden을 반환한다
    And 응답에 "해당 API 키에 'write' 권한이 없습니다" 메시지가 포함된다

  Scenario: 폐기된 API 키로 접근을 시도한다
    Given 폐기(revoke)된 API 키가 존재
    When 외부 시스템이 해당 키로 API를 호출한다
    Then 시스템은 401 Unauthorized를 반환한다
```

### AC-008: API 키 목록 및 폐기

```gherkin
Feature: API 키 관리

  Scenario: API 키 목록을 조회한다
    Given AGENT_ADMIN 역할의 사용자가 로그인한 상태
    And 조직에 3개의 API 키가 존재
    When 사용자가 API 키 목록 API를 호출한다
    Then 시스템은 3개의 키 정보를 반환한다
    And 각 키에 prefix, 마지막 4자, 이름, 스코프, 생성일, 마지막 사용일이 포함된다
    And 전체 키 값은 포함되지 않는다

  Scenario: API 키를 폐기한다
    Given AGENT_ADMIN 역할의 사용자가 로그인한 상태
    And 활성 상태의 API 키가 존재
    When 사용자가 해당 키의 폐기(DELETE) API를 호출한다
    Then 시스템은 200 OK를 반환한다
    And 해당 키의 is_active가 false로 변경된다
    And 이후 해당 키로의 모든 요청이 401로 거부된다
```

---

## 5. Module 5: 사용량 통계 및 청구

### AC-009: 사용량 추적 및 통계

```gherkin
Feature: API 사용량 추적 및 통계

  Scenario: API 요청 시 사용량이 자동으로 기록된다
    Given AGENT 역할의 설계사가 로그인한 상태
    When 설계사가 /api/v1/b2b/clients API를 호출한다
    Then UsageRecord에 다음 정보가 기록된다:
      | field           | value                |
      | organization_id | 설계사 소속 조직 ID  |
      | user_id         | 설계사 사용자 ID     |
      | endpoint        | /api/v1/b2b/clients  |
      | method          | GET                  |
      | status_code     | 200                  |
      | response_time_ms| 실제 응답 시간        |

  Scenario: 조직 사용량 요약을 조회한다
    Given ORG_OWNER 역할의 사용자가 로그인한 상태
    And 해당 월에 500건의 API 호출이 발생한 상태
    When 사용자가 /api/v1/b2b/usage API를 호출한다
    Then 응답에 다음 데이터가 포함된다:
      | field               | value           |
      | total_requests      | 500             |
      | plan_limit          | 10000           |
      | usage_percentage    | 5.0             |
      | by_endpoint         | 엔드포인트별 분류 |
      | by_agent            | 설계사별 분류    |
```

### AC-010: 사용량 리포트 생성 및 다운로드

```gherkin
Feature: 사용량 리포트 생성

  Scenario: 월별 사용량 리포트를 생성한다
    Given ORG_OWNER 역할의 사용자가 로그인한 상태
    When 사용자가 /api/v1/b2b/usage/export?period=2026-03&format=csv API를 호출한다
    Then 시스템은 CSV 파일을 반환한다
    And CSV에 날짜, 엔드포인트, 메서드, 호출 수, 토큰 소비량 컬럼이 포함된다

  Scenario: 월 사용량 한도를 초과한다
    Given 조직의 월 API 제한이 1,000건인 상태
    And 현재 월 사용량이 1,000건인 상태
    When 새로운 B2B API 요청이 수신된다
    Then 시스템은 429 Too Many Requests를 반환한다
    And 응답에 "월 사용량 한도를 초과했습니다. 플랜 업그레이드를 고려해 주세요." 메시지가 포함된다
    And 응답 헤더에 Retry-After가 포함된다
```

---

## 6. 비기능 수용 기준

### NFR-001: 성능

```gherkin
  Scenario: B2B API 응답 시간
    Given B2B 대시보드 API 엔드포인트
    When 1000건의 동시 요청이 발생한다
    Then p50 응답 시간이 200ms 미만이다
    And p95 응답 시간이 1s 미만이다
    And p99 응답 시간이 3s 미만이다
```

### NFR-002: 보안

```gherkin
  Scenario: PII 암호화 검증
    Given 고객 등록 시 PII 데이터가 저장된 상태
    When 데이터베이스를 직접 조회한다
    Then client_name, client_phone, client_email 필드가 암호화되어 있다
    And 평문 데이터가 데이터베이스에 존재하지 않는다

  Scenario: API 키 보안 검증
    Given API 키가 생성된 상태
    When 데이터베이스에서 api_keys 테이블을 직접 조회한다
    Then key_hash 필드에 SHA-256 해시값이 저장되어 있다
    And 원본 키 값은 데이터베이스 어디에도 존재하지 않는다
```

### NFR-003: 데이터 격리

```gherkin
  Scenario: SQL 레벨 격리 검증
    Given 조직 A와 조직 B가 각각 고객 데이터를 보유
    When 조직 A의 AGENT가 고객 목록 쿼리를 실행한다
    Then 생성된 SQL에 WHERE organization_id = 'org_a_id'가 포함된다
    And 조직 B의 데이터가 결과에 포함되지 않는다
```

---

## 7. Definition of Done

본 SPEC의 구현이 완료되었다고 판단하기 위한 기준:

- [ ] 모든 EARS 요구사항에 대응하는 API 엔드포인트가 구현됨
- [ ] 단위 테스트 커버리지 85% 이상
- [ ] 조직 간 데이터 격리 통합 테스트 통과
- [ ] PII 암호화/복호화 테스트 통과
- [ ] API 키 인증 흐름 통합 테스트 통과
- [ ] 사용량 추적 정확성 검증 테스트 통과
- [ ] 기존 B2C 인증 흐름 회귀 테스트 통과
- [ ] Rate Limiting 임계값 테스트 통과
- [ ] Alembic 마이그레이션 up/down 검증 완료
- [ ] API 문서(OpenAPI/Swagger) 업데이트 완료
- [ ] 코드 리뷰 완료 (보안 관점 필수)
