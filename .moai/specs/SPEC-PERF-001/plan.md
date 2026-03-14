---
id: SPEC-PERF-001
type: plan
version: 1.0.0
status: draft
created: 2026-03-14
updated: 2026-03-14
author: zuge3
tags: [SPEC-PERF-001, performance, load-testing]
---

# SPEC-PERF-001: 구현 계획

## 1. 구현 전략

### 1.1 접근 방식

성능 테스트 인프라를 **Bottom-Up** 방식으로 구축한다:

1. 개별 시나리오 스크립트 작성 (단위)
2. 테스트 구성(config) 정의 (통합)
3. CI/CD 파이프라인 연동 (자동화)
4. 데이터베이스 및 프론트엔드 성능 검증 (확장)

### 1.2 기술 스택

| 도구 | 버전 | 용도 |
|------|------|------|
| k6 | latest | 부하 테스트 엔진 |
| k6-reporter | latest | HTML 리포트 생성 |
| Lighthouse CI | latest | 프론트엔드 성능 측정 |
| GitHub Actions | - | CI/CD 통합 |
| PostgreSQL EXPLAIN | built-in | 쿼리 성능 분석 |

---

## 2. 마일스톤

### Milestone 1: k6 테스트 스위트 구축 [Priority High]

**목표**: 4개 부하 테스트 유형과 4개 시나리오 스크립트 완성

**작업 항목**:

- [ ] k6 프로젝트 구조 생성 (`tests/performance/k6/`)
- [ ] SLO threshold 설정 파일 작성 (`thresholds.js`)
- [ ] Auth Flow 시나리오 작성 (`scenarios/auth-flow.js`)
  - 회원가입 요청 (POST /api/v1/auth/register)
  - 로그인 요청 (POST /api/v1/auth/login)
  - JWT 토큰으로 프로필 조회 (GET /api/v1/auth/me)
- [ ] Chat Session 시나리오 작성 (`scenarios/chat-session.js`)
  - 세션 생성 (POST /api/v1/chat/sessions)
  - 5개 메시지 순차 전송 (POST /api/v1/chat/sessions/{id}/messages)
  - RAG 기반 응답 대기
- [ ] Vector Search 시나리오 작성 (`scenarios/vector-search.js`)
  - 벡터 검색 엔드포인트 호출
  - 다양한 쿼리 텍스트로 검색
- [ ] Health Check 시나리오 작성 (`scenarios/health-check.js`)
  - GET /health 엔드포인트 호출
- [ ] 4개 테스트 구성 작성
  - Baseline: 10 VU, 1분 (`config/baseline.js`)
  - Stress: 0-100 VU 점진 증가, 5분 (`config/stress.js`)
  - Spike: 200 VU 급증 (`config/spike.js`)
  - Soak: 50 VU, 30분 (`config/soak.js`)
- [ ] 테스트 데이터 생성 헬퍼 작성 (`helpers/data-generators.js`)
- [ ] 인증 헬퍼 작성 (`helpers/auth.js`)
- [ ] 통합 실행 스크립트 작성 (`run-all.js`)

**검증 기준**: 로컬 환경에서 모든 시나리오가 정상 실행됨

---

### Milestone 2: SLO 기준선 확립 [Priority High]

**목표**: 현재 시스템의 성능 기준선 측정 및 SLO 검증

**작업 항목**:

- [ ] 로컬 Docker 환경에서 baseline 테스트 실행
- [ ] 각 엔드포인트별 p50, p95, p99 수집
- [ ] SLO 달성 여부 확인 및 문서화
- [ ] 미달성 항목 식별 및 개선 방향 도출
- [ ] 성능 기준선 문서 작성 (`.moai/specs/SPEC-PERF-001/baseline-results.md`)

**검증 기준**: 모든 SLO 메트릭이 측정되고 기준선이 문서화됨

---

### Milestone 3: CI/CD 파이프라인 통합 [Priority High]

**목표**: GitHub Actions에서 자동 성능 테스트 및 회귀 감지

**작업 항목**:

- [ ] `performance-test.yml` 워크플로우 작성
  - Trigger: main 브랜치 push
  - Docker Compose로 테스트 환경 구성
  - k6 baseline 테스트 실행
  - Threshold 기반 pass/fail 판정
  - HTML 리포트를 artifact로 저장
- [ ] 성능 회귀 감지 로직 구현
  - 이전 baseline과 현재 결과 비교
  - p95가 20% 이상 증가 시 fail
- [ ] k6 threshold 설정으로 SLO 위반 자동 감지
- [ ] 테스트 결과를 PR 코멘트로 게시 (선택)

**검증 기준**: main push 시 성능 테스트가 자동 실행되고, SLO 위반 시 빌드 실패

---

### Milestone 4: 데이터베이스 쿼리 성능 검증 [Priority Medium]

**목표**: 주요 쿼리 성능 분석 및 인덱스 최적화 검증

**작업 항목**:

- [ ] 상위 10개 빈번 쿼리 식별
  - 사용자 조회 (users 테이블)
  - 채팅 세션 조회 (chat_sessions 테이블)
  - 메시지 히스토리 조회 (messages 테이블)
  - 벡터 유사도 검색 (document_chunks 테이블)
  - 크롤링 결과 조회 (crawl_results 테이블)
  - 문서 메타데이터 조회 (documents 테이블)
  - 임베딩 상태 조회 (document_chunks 테이블)
  - 사용자 인증 조회 (users 테이블, email 기반)
  - 세션별 메시지 카운트 (messages 집계)
  - 최근 크롤링 실행 조회 (crawl_runs 테이블)
- [ ] EXPLAIN ANALYZE 스크립트 작성
- [ ] 인덱스 사용 검증 스크립트 작성
- [ ] pgvector HNSW 벤치마크 스크립트 작성 (100K 벡터)
- [ ] PostgreSQL slow query log 설정
  - `log_min_duration_statement = 1000` (1초)
  - `log_statement = 'none'`
  - `log_duration = off`
- [ ] 쿼리 성능 리포트 작성

**검증 기준**: 모든 주요 쿼리가 인덱스를 사용하고, pgvector 검색이 p99 < 200ms 달성

---

### Milestone 5: 프론트엔드 성능 검증 [Priority Medium]

**목표**: Lighthouse CI 통합 및 번들 크기 예산 적용

**작업 항목**:

- [ ] Lighthouse CI 설정 파일 작성 (`lighthouserc.js`)
  - Performance 점수 > 90
  - LCP < 2.5s
  - FID < 100ms
  - CLS < 0.1
  - INP < 200ms
- [ ] `lighthouse-ci.yml` GitHub Actions 워크플로우 작성
  - Next.js 빌드 후 Lighthouse 실행
  - 점수 미달 시 빌드 실패
- [ ] 번들 크기 예산 설정
  - `@next/bundle-analyzer` 연동
  - 초기 로드 JS < 150KB (gzipped)
  - 페이지별 청크 < 50KB (gzipped)
- [ ] Core Web Vitals 모니터링 설정
  - `web-vitals` 라이브러리 연동
  - Analytics 전송 (선택)

**검증 기준**: Lighthouse Performance > 90, 번들 크기 예산 준수

---

### Milestone 6: Stress/Spike/Soak 테스트 실행 [Priority Low]

**목표**: 극한 상황에서의 시스템 안정성 검증

**작업 항목**:

- [ ] Stress 테스트 실행 (100 VU)
- [ ] Spike 테스트 실행 (200 VU)
- [ ] Soak 테스트 실행 (50 VU, 30분)
- [ ] 메모리 누수 검증 (soak 테스트 중 메모리 추이)
- [ ] 커넥션 풀 안정성 검증
- [ ] 극한 테스트 결과 리포트 작성

**검증 기준**: Stress error rate < 1%, Soak 메모리 안정, Spike 후 자동 복구

---

## 3. 기술적 접근

### 3.1 k6 테스트 설계 원칙

- **시나리오 분리**: 각 API 흐름을 독립 시나리오로 분리하여 병목 지점 식별
- **Threshold 기반**: 모든 SLO를 k6 threshold로 정의하여 자동 pass/fail
- **데이터 격리**: 테스트용 사용자/데이터를 생성하여 프로덕션 데이터와 분리
- **환경 변수**: `BASE_URL`, `VU_COUNT`, `DURATION` 등을 환경 변수로 관리

### 3.2 CI/CD 통합 전략

```
main push
  |
  v
Docker Compose Up (test env)
  |
  v
Database Migration + Seed Data
  |
  v
k6 Baseline Test (10 VU, 1 min)
  |
  +-- threshold pass --> Generate HTML Report --> Upload Artifact
  |
  +-- threshold fail --> CI Fail + Notification
```

### 3.3 pgvector 벤치마크 전략

- 100K 벡터 사전 삽입 (1536 차원, text-embedding-3-small)
- HNSW 인덱스 생성 (`m=16, ef_construction=64`)
- 동시 검색 쿼리 실행 (10, 50, 100 동시 요청)
- Recall@10 정확도 측정 (정확도 vs 속도 트레이드오프)

### 3.4 Lighthouse CI 전략

- Next.js 프로덕션 빌드 후 정적 서버에서 Lighthouse 실행
- 3회 실행 후 중앙값 사용 (노이즈 제거)
- 데스크톱 + 모바일 프로필 모두 측정

---

## 4. 아키텍처 설계 방향

### 4.1 테스트 인프라 구조

```
[k6 Runner]
     |
     v
[Docker Compose Test Environment]
  +-- FastAPI (port 8000)
  +-- PostgreSQL + pgvector (port 5432)
  +-- Redis (port 6379)
  +-- Celery Worker
     |
     v
[k6 Results]
  +-- JSON Summary
  +-- HTML Report (k6-reporter)
  +-- Threshold Pass/Fail
```

### 4.2 성능 데이터 흐름

```
k6 시나리오 실행
     |
     v
API 요청 (HTTP/WebSocket)
     |
     v
메트릭 수집 (p50, p95, p99, error rate, throughput)
     |
     v
Threshold 비교 (SLO 기준)
     |
     +-- Pass --> HTML Report 생성
     +-- Fail --> CI 실패 + 상세 로그
```

---

## 5. 리스크 및 대응

| 리스크 | 영향도 | 대응 방안 |
|--------|--------|-----------|
| LLM API 레이턴시 변동 | 높음 | Mock LLM 서버 사용 또는 timeout 기반 threshold 조정 |
| CI 환경과 프로덕션 환경 차이 | 중간 | Docker 기반 동일 환경 구성, 상대적 비교(%) 사용 |
| 100K 벡터 시드 데이터 생성 시간 | 중간 | 사전 생성된 벡터 데이터를 fixture로 관리 |
| Soak 테스트 CI 실행 시간 | 낮음 | Soak는 수동/야간 실행, CI에서는 baseline만 |
| 프론트엔드 Lighthouse 결과 불안정 | 낮음 | 3회 실행 중앙값, 헤드리스 Chrome 고정 버전 |

---

## 6. 의존성

| 의존성 | 상태 | 비고 |
|--------|------|------|
| SPEC-AUTH-001 | 완료 | Auth Flow 시나리오 전제 |
| SPEC-LLM-001 | 완료 | Chat/RAG 시나리오 전제 |
| SPEC-EMBED-001 | 완료 | Vector Search 시나리오 전제 |
| SPEC-CRAWLER-001 | 완료 | 데이터 시드 전제 |
| Docker Compose | 구성 필요 | 테스트 환경 구성 |
| k6 설치 | 필요 | CI 환경에 k6 설치 |
