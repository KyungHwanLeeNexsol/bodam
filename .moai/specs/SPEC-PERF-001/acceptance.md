---
id: SPEC-PERF-001
type: acceptance
version: 1.0.0
status: draft
created: 2026-03-14
updated: 2026-03-14
author: zuge3
tags: [SPEC-PERF-001, acceptance-criteria, gherkin]
---

# SPEC-PERF-001: 인수 기준

## 1. k6 부하 테스트 스위트

### AC-PERF-001: Baseline 테스트 실행

```gherkin
Feature: Baseline 부하 테스트
  시스템이 정상 부하(10 VU)에서 SLO를 충족하는지 검증한다.

  Scenario: Baseline 테스트 실행 및 SLO 검증
    Given Docker Compose로 테스트 환경이 구동 중이다
    And 테스트용 시드 데이터가 로드되어 있다
    When k6 baseline 테스트를 10 VU, 1분간 실행한다
    Then API p50 응답 시간이 200ms 미만이다
    And API p95 응답 시간이 1s 미만이다
    And API p99 응답 시간이 3s 미만이다
    And 전체 error rate가 0.1% 미만이다

  Scenario: Baseline 테스트 결과 리포트 생성
    Given baseline 테스트가 완료되었다
    When 테스트 결과를 처리한다
    Then HTML 리포트가 생성된다
    And JSON 요약 데이터가 저장된다
    And 각 엔드포인트별 p50, p95, p99 메트릭이 포함된다
```

### AC-PERF-002: Stress 테스트 실행

```gherkin
Feature: Stress 부하 테스트
  시스템이 점진적 부하 증가(100 VU)를 처리하는지 검증한다.

  Scenario: Stress 테스트 실행
    Given Docker Compose로 테스트 환경이 구동 중이다
    When k6 stress 테스트를 5분에 걸쳐 100 VU까지 점진 증가시킨다
    Then error rate가 1% 미만이다
    And 서비스가 중단 없이 모든 요청을 처리한다
    And 응답 시간 증가 추이가 리포트에 기록된다

  Scenario: Stress 테스트 중 병목 지점 식별
    Given stress 테스트가 완료되었다
    When 엔드포인트별 응답 시간을 분석한다
    Then VU 증가에 따른 응답 시간 변화를 확인할 수 있다
    And 가장 먼저 성능이 저하되는 엔드포인트를 식별할 수 있다
```

### AC-PERF-003: Spike 테스트 실행

```gherkin
Feature: Spike 부하 테스트
  시스템이 급격한 트래픽 증가(200 VU)를 처리하고 복구하는지 검증한다.

  Scenario: Spike 테스트 실행 및 복구 검증
    Given Docker Compose로 테스트 환경이 구동 중이다
    When 200 VU가 동시에 요청을 시작한다
    Then 서비스가 완전히 중단되지 않는다
    And 부하 감소 후 정상 응답 시간으로 복구된다
    And 복구까지 소요 시간이 리포트에 기록된다
```

### AC-PERF-004: Soak 테스트 실행

```gherkin
Feature: Soak 내구성 테스트
  시스템이 장시간 부하(50 VU, 30분)에서 안정적인지 검증한다.

  Scenario: Soak 테스트 메모리 안정성 검증
    Given Docker Compose로 테스트 환경이 구동 중이다
    When k6 soak 테스트를 50 VU, 30분간 실행한다
    Then 시작 시점 대비 메모리 사용량이 20% 이상 증가하지 않는다
    And error rate가 0.1% 미만을 유지한다
    And 응답 시간이 테스트 시작 시점 대비 50% 이상 증가하지 않는다

  Scenario: Soak 테스트 커넥션 풀 안정성 검증
    Given soak 테스트가 30분간 실행된다
    When 데이터베이스 커넥션 수를 모니터링한다
    Then 커넥션 풀이 고갈되지 않는다
    And 커넥션 대기 시간이 100ms를 초과하지 않는다
```

---

## 2. 테스트 시나리오

### AC-PERF-005: Auth Flow 시나리오

```gherkin
Feature: Auth Flow 성능 테스트
  인증 흐름의 응답 시간이 SLO를 충족하는지 검증한다.

  Scenario: 회원가입 + 로그인 + 프로필 조회 흐름
    Given k6 테스트 환경이 준비되어 있다
    When 가상 사용자가 회원가입을 요청한다 (POST /api/v1/auth/register)
    And 로그인을 요청한다 (POST /api/v1/auth/login)
    And JWT 토큰으로 프로필을 조회한다 (GET /api/v1/auth/me)
    Then 전체 Auth Flow p95 응답 시간이 500ms 미만이다
    And 각 단계의 HTTP status가 200 또는 201이다
    And JWT 토큰이 유효한 형식으로 반환된다
```

### AC-PERF-006: Chat Session 시나리오

```gherkin
Feature: Chat Session 성능 테스트
  채팅 세션 생성 및 메시지 전송의 응답 시간이 SLO를 충족하는지 검증한다.

  Scenario: 세션 생성 + 5개 메시지 전송
    Given 인증된 사용자가 JWT 토큰을 보유하고 있다
    When 채팅 세션을 생성한다 (POST /api/v1/chat/sessions)
    And 5개의 보험 관련 질문 메시지를 순차적으로 전송한다
    Then 세션 생성 p95 응답 시간이 500ms 미만이다
    And 메시지 전송 (RAG 포함) p95 응답 시간이 3s 미만이다
    And 모든 응답에 관련 보험 약관 출처가 포함된다

  Scenario: 대화 컨텍스트 유지 성능
    Given 5개 메시지가 전송된 채팅 세션이 있다
    When 후속 질문 메시지를 전송한다
    Then 이전 대화 컨텍스트가 유지된 응답이 반환된다
    And 컨텍스트 로딩으로 인한 추가 레이턴시가 500ms 미만이다
```

### AC-PERF-007: Vector Search 시나리오

```gherkin
Feature: Vector Search 성능 테스트
  pgvector 유사도 검색의 응답 시간이 SLO를 충족하는지 검증한다.

  Scenario: 벡터 유사도 검색
    Given pgvector에 100K 이상의 벡터가 인덱싱되어 있다
    And HNSW 인덱스가 구성되어 있다
    When 보험 관련 쿼리로 유사도 검색을 요청한다
    Then p99 응답 시간이 200ms 미만이다
    And 상위 5개 결과의 유사도 점수가 반환된다
    And 결과에 문서 ID와 청크 메타데이터가 포함된다

  Scenario: 동시 검색 요청 처리
    Given pgvector에 100K 이상의 벡터가 인덱싱되어 있다
    When 50개의 동시 검색 요청을 전송한다
    Then 모든 요청이 200ms 이내에 응답한다
    And error rate가 0%이다
```

### AC-PERF-008: Health Check 시나리오

```gherkin
Feature: Health Check 성능 테스트
  시스템 상태 확인 엔드포인트의 응답 시간을 검증한다.

  Scenario: Health Check 응답 시간
    Given 테스트 환경이 구동 중이다
    When GET /health 엔드포인트를 호출한다
    Then p99 응답 시간이 50ms 미만이다
    And HTTP status 200이 반환된다
    And 응답에 데이터베이스, Redis 연결 상태가 포함된다
```

---

## 3. 성능 테스트 자동화

### AC-PERF-009: CI/CD 통합

```gherkin
Feature: GitHub Actions 성능 테스트 자동화
  main 브랜치 push 시 성능 테스트가 자동으로 실행된다.

  Scenario: main 브랜치 push 시 성능 테스트 실행
    Given GitHub Actions 워크플로우가 설정되어 있다
    When main 브랜치에 코드가 push된다
    Then Docker Compose로 테스트 환경이 자동 구성된다
    And k6 baseline 테스트가 실행된다
    And 테스트 결과 HTML 리포트가 artifact로 저장된다

  Scenario: SLO 위반 시 빌드 실패
    Given 성능 테스트가 실행 중이다
    When p95 응답 시간이 SLO 기준을 초과한다
    Then CI 빌드가 실패 상태로 표시된다
    And 실패 원인이 상세히 로그에 기록된다
    And k6 threshold 위반 목록이 출력된다
```

### AC-PERF-010: 성능 회귀 감지

```gherkin
Feature: 성능 회귀 자동 감지
  이전 baseline 대비 성능 저하를 자동으로 감지한다.

  Scenario: p95 응답 시간 20% 이상 증가 감지
    Given 이전 baseline 테스트 결과가 저장되어 있다
    When 현재 baseline 테스트 결과가 수집된다
    And p95 응답 시간이 이전 대비 20% 이상 증가한다
    Then CI 파이프라인이 실패한다
    And "성능 회귀 감지" 메시지가 출력된다
    And 이전 baseline과 현재 결과의 비교 테이블이 출력된다
```

---

## 4. 데이터베이스 쿼리 성능

### AC-PERF-011: EXPLAIN ANALYZE 검증

```gherkin
Feature: 데이터베이스 쿼리 성능 분석
  상위 10개 빈번 쿼리의 실행 계획을 검증한다.

  Scenario: 주요 쿼리 EXPLAIN ANALYZE 실행
    Given PostgreSQL에 테스트 데이터가 로드되어 있다
    When 상위 10개 빈번 쿼리에 대해 EXPLAIN ANALYZE를 실행한다
    Then 모든 쿼리의 실행 계획이 수집된다
    And Sequential Scan을 사용하는 쿼리가 없다
    And 각 쿼리의 실행 시간이 기록된다

  Scenario: 인덱스 사용 검증
    Given PostgreSQL에 인덱스가 생성되어 있다
    When 주요 쿼리를 실행한다
    Then 모든 WHERE 절에서 Index Scan 또는 Index Only Scan을 사용한다
    And JOIN 연산에서 Nested Loop 또는 Hash Join을 사용한다
```

### AC-PERF-012: pgvector HNSW 성능

```gherkin
Feature: pgvector HNSW 인덱스 성능 검증
  100K 벡터에서 HNSW 인덱스 검색 성능을 검증한다.

  Scenario: 100K 벡터 HNSW 검색 성능
    Given pgvector에 100,000개의 1536차원 벡터가 저장되어 있다
    And HNSW 인덱스가 생성되어 있다 (m=16, ef_construction=64)
    When 유사도 검색 쿼리를 100회 실행한다
    Then p99 응답 시간이 200ms 미만이다
    And 평균 응답 시간이 100ms 미만이다
    And Recall@10이 0.95 이상이다
```

### AC-PERF-013: Slow Query 로깅

```gherkin
Feature: Slow Query 로깅 설정
  1초 이상 소요되는 쿼리가 자동으로 로깅된다.

  Scenario: Slow query 감지 및 로깅
    Given PostgreSQL에 log_min_duration_statement이 1000으로 설정되어 있다
    When 의도적으로 1초 이상 소요되는 쿼리를 실행한다
    Then 해당 쿼리가 PostgreSQL 로그에 기록된다
    And 쿼리 텍스트와 실행 시간이 포함된다
```

---

## 5. 프론트엔드 성능

### AC-PERF-014: Lighthouse CI 검증

```gherkin
Feature: Lighthouse CI 성능 검증
  프론트엔드 Performance 점수가 목표를 충족하는지 검증한다.

  Scenario: Lighthouse Performance 점수 검증
    Given Next.js 프로덕션 빌드가 완료되었다
    When Lighthouse CI를 3회 실행한다
    Then Performance 점수 중앙값이 90 이상이다
    And LCP가 2.5s 미만이다
    And FID가 100ms 미만이다
    And CLS가 0.1 미만이다
    And INP가 200ms 미만이다

  Scenario: Lighthouse 점수 미달 시 빌드 실패
    Given Lighthouse CI가 GitHub Actions에서 실행된다
    When Performance 점수가 90 미만이다
    Then CI 빌드가 실패한다
    And 개선이 필요한 항목이 리포트에 표시된다
```

### AC-PERF-015: 번들 크기 예산

```gherkin
Feature: JavaScript 번들 크기 예산 검증
  번들 크기가 설정된 예산을 초과하지 않는지 검증한다.

  Scenario: 초기 로드 번들 크기 검증
    Given Next.js 프로덕션 빌드가 완료되었다
    When 초기 로드 JavaScript 번들 크기를 측정한다
    Then gzipped 크기가 150KB 미만이다

  Scenario: 페이지별 청크 크기 검증
    Given Next.js 프로덕션 빌드가 완료되었다
    When 각 페이지의 JavaScript 청크 크기를 측정한다
    Then 모든 페이지별 청크의 gzipped 크기가 50KB 미만이다

  Scenario: 번들 크기 초과 시 빌드 실패
    Given 번들 크기 예산이 설정되어 있다
    When 번들 크기가 예산을 초과한다
    Then CI 빌드가 실패한다
    And 초과된 청크와 크기 차이가 출력된다
```

---

## 6. 안정성 검증

### AC-PERF-016: 메모리 누수 없음

```gherkin
Feature: 메모리 누수 검증
  장시간 운영 시 메모리가 안정적으로 유지되는지 검증한다.

  Scenario: Soak 테스트 중 메모리 안정성
    Given soak 테스트가 30분간 실행된다
    When 1분 간격으로 FastAPI 프로세스 메모리를 측정한다
    Then 메모리 사용량의 선형 증가 추세가 없다
    And 최대 메모리 사용량이 초기 대비 20% 이내이다
```

### AC-PERF-017: LLM API Timeout 처리

```gherkin
Feature: LLM API Timeout 처리
  LLM API 호출 시 적절한 timeout이 적용되는지 검증한다.

  Scenario: LLM API 응답 지연 시 timeout 처리
    Given LLM API가 30초 이상 응답하지 않는다
    When 채팅 메시지를 전송한다
    Then 30초 후 timeout 오류가 반환된다
    And 사용자에게 재시도 안내 메시지가 표시된다
    And 시스템이 정상적으로 다음 요청을 처리할 수 있다
```

---

## 7. Quality Gate 기준

### Definition of Done

- [ ] 모든 k6 시나리오(auth, chat, vector-search, health)가 구현되고 로컬에서 실행 가능하다
- [ ] 4개 테스트 유형(baseline, stress, spike, soak) 구성이 완료되었다
- [ ] SLO threshold가 k6 설정에 반영되어 자동 pass/fail이 동작한다
- [ ] GitHub Actions 워크플로우가 main push 시 자동 실행된다
- [ ] 성능 회귀 감지(20% 기준)가 구현되었다
- [ ] HTML 리포트가 CI artifact로 저장된다
- [ ] 상위 10개 쿼리의 EXPLAIN ANALYZE가 수행되고 인덱스 사용이 검증되었다
- [ ] pgvector HNSW 벤치마크에서 p99 < 200ms를 달성했다
- [ ] PostgreSQL slow query log 설정(1초 threshold)이 적용되었다
- [ ] Lighthouse CI가 Performance > 90을 달성했다
- [ ] 번들 크기 예산(초기 150KB, 청크 50KB gzipped)이 적용되었다
- [ ] Soak 테스트에서 메모리 누수가 없음이 확인되었다
- [ ] 모든 LLM API 호출에 30초 timeout이 설정되었다
