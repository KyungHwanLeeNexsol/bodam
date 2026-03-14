---
id: SPEC-PERF-001
version: 1.1.0
status: completed
created: 2026-03-14
updated: 2026-03-14
author: zuge3
priority: medium
issue_number: 0
tags: [performance, load-testing, k6, lighthouse, slo]
---

# SPEC-PERF-001: 성능 테스트 및 부하 테스트

## 1. Environment (환경)

### 1.1 시스템 개요

Bodam 플랫폼은 AI 기반 한국 보험 청구 안내 서비스로, 다음 핵심 컴포넌트로 구성된다:

- **Backend**: FastAPI 0.135.x + Python 3.13.x
- **Database**: PostgreSQL 18.x + pgvector 0.8.2 (HNSW 인덱스)
- **Cache/Broker**: Redis 7.x (세션, 캐시, Celery 브로커)
- **Task Queue**: Celery 5.x (비동기 배치 처리)
- **Frontend**: Next.js 16.1.x + React 19.2.x
- **LLM**: Gemini 2.0 Flash (primary) + GPT-4o (fallback) + GPT-4o-mini (classification)
- **Embedding**: OpenAI text-embedding-3-small

### 1.2 성능 관련 핵심 경로

| 경로 | 설명 | 성능 민감도 |
|------|------|-------------|
| Auth Flow | 회원가입 + 로그인 + JWT 발급 | 높음 |
| Chat Session | 세션 생성 + 메시지 전송 (RAG 포함) | 매우 높음 |
| Vector Search | pgvector 유사도 검색 | 매우 높음 |
| Embedding Pipeline | 문서 청킹 + 임베딩 생성 | 중간 |
| Health Check | 시스템 상태 확인 | 낮음 |

### 1.3 현재 상태

- MVP 개발 완료 (SPEC-AUTH-001, SPEC-CRAWLER-001, SPEC-LLM-001, SPEC-EMBED-001)
- 프로덕션 런칭 준비 단계
- 성능 기준선(baseline) 미확립
- 부하 테스트 미실시

---

## 2. Assumptions (가정)

### 2.1 트래픽 가정

- Phase 1 목표: 10,000 MAU (월간 활성 사용자)
- 동시 접속자 피크: 100명 (MAU의 1%)
- 일일 평균 요청: 50,000건
- 피크 시간대: 평일 09:00-18:00 KST

### 2.2 인프라 가정

- MVP 배포: Docker Compose on EC2 t3.medium (2 vCPU, 4GB RAM)
- RDS PostgreSQL: db.t3.medium (2 vCPU, 4GB RAM)
- Redis: ElastiCache t3.micro (1 vCPU, 0.5GB RAM)
- 단일 인스턴스 구성 (수평 확장 없음)

### 2.3 외부 의존성 가정

- LLM API 응답 시간: Gemini 2.0 Flash 평균 1-2초
- OpenAI Embedding API 응답 시간: 평균 500ms
- 네트워크 레이턴시: AWS Seoul Region 내부 < 1ms

### 2.4 데이터 규모 가정

- 보험 약관 문서: 약 10,000건
- 벡터 임베딩: 약 100,000개 (문서당 평균 10 청크)
- pgvector HNSW 인덱스 크기: 약 600MB (1536차원 x 100K 벡터)

---

## 3. Requirements (요구사항)

### 3.1 SLO (Service Level Objectives)

#### REQ-PERF-001: API 응답 시간 SLO

시스템은 **항상** 다음 응답 시간 기준을 충족해야 한다:

| 메트릭 | 목표값 | 비고 |
|--------|--------|------|
| API p50 응답 시간 | < 200ms | 일반 API 엔드포인트 |
| API p95 응답 시간 | < 1s | 일반 API 엔드포인트 |
| API p99 응답 시간 | < 3s | 일반 API 엔드포인트 |
| Chat/RAG p95 응답 시간 | < 3s | LLM 레이턴시 포함 |
| Vector Search p99 응답 시간 | < 200ms | pgvector HNSW 검색 |

#### REQ-PERF-002: 처리량 SLO

시스템은 **항상** 다음 처리량 기준을 충족해야 한다:

- 동시 사용자 100명 지속 처리 (30분간)
- Embedding Pipeline: 100 문서/분 처리량
- Error rate: 정상 부하 < 0.1%, 스트레스 부하 < 1%

### 3.2 k6 부하 테스트 스위트

#### REQ-PERF-003: Baseline 테스트 (Event-Driven)

**WHEN** k6 baseline 테스트가 실행되면 **THEN** 시스템은 10 VU, 1분간 정상 부하를 시뮬레이션하고, 모든 SLO 기준을 통과해야 한다.

#### REQ-PERF-004: Stress 테스트 (Event-Driven)

**WHEN** k6 stress 테스트가 실행되면 **THEN** 시스템은 5분에 걸쳐 100 VU까지 점진적 증가를 처리하고, error rate < 1%를 유지해야 한다.

#### REQ-PERF-005: Spike 테스트 (Event-Driven)

**WHEN** k6 spike 테스트가 실행되면 **THEN** 시스템은 200 VU 급격한 증가를 처리하고, 서비스 중단 없이 복구해야 한다.

#### REQ-PERF-006: Soak 테스트 (Event-Driven)

**WHEN** k6 soak 테스트가 실행되면 **THEN** 시스템은 50 VU, 30분간 지속 부하를 처리하고, 메모리 누수 및 커넥션 풀 고갈 없이 안정적이어야 한다.

### 3.3 테스트 시나리오

#### REQ-PERF-007: Auth Flow 시나리오

**WHEN** Auth Flow 부하 테스트가 실행되면 **THEN** 시스템은 회원가입 + 로그인 + JWT 토큰 발급 흐름을 시뮬레이션하고, p95 < 500ms를 충족해야 한다.

#### REQ-PERF-008: Chat Session 시나리오

**WHEN** Chat Session 부하 테스트가 실행되면 **THEN** 시스템은 세션 생성 + 5개 메시지 전송 (RAG 쿼리 포함) 흐름을 시뮬레이션하고, p95 < 3s를 충족해야 한다.

#### REQ-PERF-009: Vector Search 시나리오

**WHEN** Vector Search 부하 테스트가 실행되면 **THEN** 시스템은 pgvector 유사도 검색 엔드포인트를 호출하고, p99 < 200ms를 충족해야 한다.

#### REQ-PERF-010: Health Check 시나리오

**WHEN** Health Check 부하 테스트가 실행되면 **THEN** 시스템은 상태 확인 엔드포인트가 p99 < 50ms를 충족해야 한다.

### 3.4 성능 테스트 자동화

#### REQ-PERF-011: CI/CD 통합 (Event-Driven)

**WHEN** main 브랜치에 코드가 푸시되면 **THEN** GitHub Actions에서 성능 테스트가 자동 실행되어야 한다.

#### REQ-PERF-012: 회귀 감지 (Conditional)

**IF** p95 응답 시간이 이전 baseline 대비 20% 이상 증가하면 **THEN** CI 파이프라인이 실패하고, 성능 회귀가 감지되었음을 알려야 한다.

#### REQ-PERF-013: 리포트 생성 (Event-Driven)

**WHEN** 성능 테스트가 완료되면 **THEN** HTML 형식의 성능 리포트가 생성되고, GitHub Actions artifact로 저장되어야 한다.

#### REQ-PERF-014: Threshold 적용 (Ubiquitous)

시스템은 **항상** k6 threshold 설정을 통해 SLO 위반 시 테스트를 자동 실패 처리해야 한다.

### 3.5 데이터베이스 쿼리 성능

#### REQ-PERF-015: 쿼리 분석 (Event-Driven)

**WHEN** 데이터베이스 성능 테스트가 실행되면 **THEN** 상위 10개 빈번 쿼리에 대해 EXPLAIN ANALYZE 결과가 수집되어야 한다.

#### REQ-PERF-016: 인덱스 검증 (Ubiquitous)

시스템은 **항상** 주요 쿼리에서 적절한 인덱스를 사용하고, Sequential Scan을 회피해야 한다.

#### REQ-PERF-017: pgvector HNSW 성능 검증 (Conditional)

**IF** pgvector에 100K 벡터가 저장된 상태라면 **THEN** HNSW 인덱스 검색이 p99 < 200ms를 충족해야 한다.

#### REQ-PERF-018: Slow Query 로깅 (Ubiquitous)

시스템은 **항상** 1초 이상 소요되는 쿼리를 slow query log에 기록해야 한다.

### 3.6 프론트엔드 성능

#### REQ-PERF-019: Lighthouse CI (Event-Driven)

**WHEN** 프론트엔드 코드가 main 브랜치에 푸시되면 **THEN** Lighthouse CI가 실행되어 Performance 점수 > 90을 충족해야 한다.

#### REQ-PERF-020: Core Web Vitals (Ubiquitous)

시스템은 **항상** 다음 Core Web Vitals 기준을 충족해야 한다:

| 메트릭 | 목표값 |
|--------|--------|
| LCP (Largest Contentful Paint) | < 2.5s |
| FID (First Input Delay) | < 100ms |
| CLS (Cumulative Layout Shift) | < 0.1 |
| INP (Interaction to Next Paint) | < 200ms |

#### REQ-PERF-021: 번들 크기 예산 (Conditional)

**IF** JavaScript 번들 크기가 설정된 예산을 초과하면 **THEN** CI 빌드가 실패해야 한다.

- 초기 로드 JS: < 150KB (gzipped)
- 페이지별 청크: < 50KB (gzipped)

### 3.7 금지 사항 (Unwanted)

#### REQ-PERF-022: 메모리 누수 금지

시스템은 장시간 운영 시 메모리 사용량이 지속적으로 증가**하지 않아야 한다**.

#### REQ-PERF-023: 커넥션 풀 고갈 금지

시스템은 부하 테스트 중 데이터베이스 커넥션 풀이 고갈**되지 않아야 한다**.

#### REQ-PERF-024: 무한 대기 금지

시스템은 LLM API 호출 시 적절한 timeout이 설정되어 무한 대기가 발생**하지 않아야 한다** (최대 30초).

---

## 4. Specifications (명세)

### 4.1 k6 테스트 구조

```
tests/
  performance/
    k6/
      scenarios/
        auth-flow.js          # Auth 시나리오
        chat-session.js       # Chat 세션 시나리오
        vector-search.js      # Vector Search 시나리오
        health-check.js       # Health Check 시나리오
      config/
        baseline.js           # 10 VU, 1분
        stress.js             # 100 VU 점진 증가, 5분
        spike.js              # 200 VU 급증
        soak.js               # 50 VU, 30분
      helpers/
        auth.js               # 인증 헬퍼 함수
        data-generators.js    # 테스트 데이터 생성
      thresholds.js           # SLO threshold 설정
      run-all.js              # 통합 실행 스크립트
```

### 4.2 GitHub Actions 워크플로우

```
.github/workflows/
  performance-test.yml        # main 브랜치 성능 테스트
  lighthouse-ci.yml           # 프론트엔드 Lighthouse CI
```

### 4.3 데이터베이스 성능 스크립트

```
scripts/
  db-performance/
    explain-analyze.sql       # 상위 10개 쿼리 EXPLAIN ANALYZE
    index-verification.sql    # 인덱스 사용 검증
    slow-query-config.sql     # Slow query 로깅 설정
    pgvector-benchmark.sql    # HNSW 인덱스 벤치마크
```

### 4.4 프론트엔드 성능 설정

```
lighthouserc.js               # Lighthouse CI 설정
next.config.js                # 번들 분석 설정 (추가)
```

### 4.5 기술 선택

| 도구 | 용도 | 선택 이유 |
|------|------|-----------|
| k6 | 부하 테스트 | JavaScript 기반, CLI 친화적, CI 통합 용이 |
| Lighthouse CI | 프론트엔드 성능 | Google 공식 도구, CWV 측정 표준 |
| EXPLAIN ANALYZE | 쿼리 분석 | PostgreSQL 내장, 실행 계획 분석 |
| k6-reporter | HTML 리포트 | k6 공식 리포터, 시각적 결과 확인 |

---

## 5. Traceability (추적성)

| 요구사항 ID | 관련 SPEC | 관련 컴포넌트 |
|-------------|-----------|---------------|
| REQ-PERF-001~002 | 전체 | SLO 정의 |
| REQ-PERF-003~006 | 전체 | k6 테스트 유형 |
| REQ-PERF-007 | SPEC-AUTH-001 | Auth Flow |
| REQ-PERF-008 | SPEC-LLM-001 | Chat/RAG |
| REQ-PERF-009 | SPEC-EMBED-001 | Vector Search |
| REQ-PERF-011~014 | 전체 | CI/CD 통합 |
| REQ-PERF-015~018 | SPEC-EMBED-001 | Database |
| REQ-PERF-019~021 | SPEC-AUTH-001 | Frontend |

## Implementation Notes

### 구현 완료 요약 (2026-03-14)
TDD RED-GREEN-REFACTOR 방법론으로 구현 완료. 31개 테스트 통과, ruff 0 오류.

### 신규 파일
- `performance/k6/scenarios/`: baseline, stress, spike, soak 테스트 시나리오
- `performance/k6/lib/helpers.js`: authenticate, createChatSession, sendChatMessage
- `performance/slo/`: SLO 정의 및 기준선 JSON
- `performance/db/`: query_analysis.py, index_validation.py
- `.github/workflows/performance.yml`: k6 CI 자동화
- `.github/workflows/lighthouse.yml`: Lighthouse CI
- `.lighthouserc.js`: Performance>90, LCP<2500ms 임계값

### SLO 목표
- API p50<200ms, p95<1s, p99<3s
- Vector search p99<200ms
- Error rate <0.1% (정상), <1% (스트레스)
