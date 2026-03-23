---
id: SPEC-PIPELINE-001
title: "End-to-End Insurance Data Pipeline Redesign"
version: 1.0.0
status: draft
created: 2026-03-17
updated: 2026-03-17
author: zuge3
priority: high
issue_number: 0
dependencies:
  - SPEC-CRAWLER-001
  - SPEC-CRAWLER-002
  - SPEC-EMBED-001
---

# SPEC-PIPELINE-001: 보험 데이터 End-to-End 파이프라인 재설계

## HISTORY

| 버전 | 날짜 | 작성자 | 변경 사항 |
|------|------|--------|-----------|
| 1.0.0 | 2026-03-17 | zuge3 | 최초 작성 |

---

## 1. Environment (환경)

### 1.1 기존 시스템 현황

현재 Bodam 플랫폼은 다음과 같은 데이터 파이프라인 구성 요소를 보유하고 있다:

**크롤러 계층 (SPEC-CRAWLER-001, SPEC-CRAWLER-002)**
- BaseCrawler 추상 클래스 기반 크롤러 프레임워크
- 협회 크롤러: KNIA (손해보험협회, 607 PDFs), KLIA (생명보험협회, 3 PDFs)
- 개별 회사 크롤러: 30개 YAML config 파일, Playwright 기반
- GenericLifeCrawler / GenericNonlifeCrawler 구현체
- CrawlerRegistry 동적 등록, FileStorage 추상화
- CrawlRun / CrawlResult DB 모델로 실행 추적

**임베딩 계층 (SPEC-EMBED-001)**
- OpenAI text-embedding-3-small (1536 dims) 사용
- TextChunker: 문서 토큰화 + 메타데이터 (token_count, quality_score)
- DocumentProcessor: clean -> chunk -> embed -> store 워크플로우
- EmbeddingService: 배치 처리, 실패 추적, 복구
- EmbeddingMonitor: 통계 수집, 누락 임베딩 감지
- Celery 비동기 벌크 임베딩 + Redis 브로커

**데이터 모델**
- InsuranceCompany: 보험사 마스터 데이터
- Policy: 상품 정보 (sale_status: ON_SALE/DISCONTINUED/UNKNOWN)
- PolicyChunk: Vector(1536) 임베딩 청크
- Coverage: 보장 항목

**인프라**
- Backend: Python 3.13, FastAPI, SQLAlchemy 2.x async
- DB: CockroachDB + pgvector 0.8.2
- Deployment: Fly.io (1GB RAM), Vercel (frontend), Upstash Redis
- Task Queue: Celery 5.x + Redis broker

### 1.2 현재 문제점

1. **크롤러 안정성 미검증**: 30개 YAML config가 실제 보험사 웹사이트에서 정상 동작하는지 end-to-end 검증 부재
2. **파이프라인 단절**: 크롤링, PDF 파싱, 임베딩이 독립적으로 동작하며 통합 워크플로우 부재
3. **검색 한계**: pgvector 의미론적 검색만 가능, 키워드 기반 정확 매칭 미지원
4. **모니터링 부재**: 크롤링 성공률, 임베딩 커버리지, 파이프라인 건강 상태 추적 없음
5. **오류 복구 취약**: 파이프라인 실패 시 알림 및 자동 재시도 전략 미흡

---

## 2. Assumptions (가정)

- A1: 30개 보험사 YAML config 중 일부는 웹사이트 구조 변경으로 동작하지 않을 수 있다
- A2: Fly.io 1GB RAM 환경에서 Playwright 크롤러 동시 실행은 2-3개로 제한된다
- A3: CockroachDB은 tsvector 및 GIN 인덱스를 지원한다
- A4: Upstash Redis는 Celery Beat 스케줄러로 사용 가능하다
- A5: OpenAI Embedding API는 rate limit (3000 RPM) 내에서 운영 가능하다
- A6: 기존 EmbeddingService, DocumentProcessor, TextChunker 코드는 유지하되 파이프라인으로 통합한다

---

## 3. Requirements (요구사항)

### Phase 1: 크롤러 안정성 (Crawler Reliability)

**REQ-01: 크롤러 Config 검증 시스템** [HARD]
WHEN 크롤러 Config 검증이 실행되면 THEN 시스템은 각 YAML config에 대해 실제 웹사이트 접속, 상품 목록 페이지 로드, PDF 다운로드 링크 존재 여부를 검증하고 결과를 리포트로 생성해야 한다.

**REQ-02: 크롤러 오류 처리 강화** [HARD]
WHEN 크롤링 중 네트워크 오류, 타임아웃, 페이지 구조 변경이 발생하면 THEN 시스템은 exponential backoff 재시도 (최대 3회)를 수행하고, 모든 실패를 CrawlResult에 상세 오류 메시지와 함께 기록해야 한다.

**REQ-03: 크롤링 건강 모니터링** [HARD]
시스템은 항상 각 보험사별 크롤링 성공/실패 비율, 마지막 성공 크롤링 일시, 수집된 PDF 수를 추적해야 한다.

**REQ-04: Config 자동 비활성화** [SOFT]
IF 특정 보험사 크롤러가 3회 연속 실패하면 THEN 시스템은 해당 config를 자동으로 비활성화하고 관리자에게 알림을 보내야 한다.

### Phase 2: End-to-End 파이프라인 자동화

**REQ-05: 통합 파이프라인 워크플로우** [HARD]
WHEN 파이프라인이 트리거되면 THEN 시스템은 다음 단계를 순차적으로 실행해야 한다: (1) 크롤링 -> (2) PDF 다운로드 -> (3) 텍스트 추출 및 클리닝 -> (4) 청킹 -> (5) 임베딩 생성 -> (6) DB 저장. 각 단계의 성공/실패는 파이프라인 상태로 추적되어야 한다.

**REQ-06: Celery Chain 기반 파이프라인** [HARD]
시스템은 항상 Celery chain/chord를 사용하여 파이프라인 단계를 연결하고, 각 단계의 결과를 다음 단계로 전달해야 한다.

**REQ-07: 파이프라인 스케줄링** [HARD]
시스템은 항상 Celery Beat를 통해 주간 자동 파이프라인 실행 (일요일 02:00 KST)을 지원하고, 수동 트리거 API 엔드포인트도 제공해야 한다.

**REQ-08: 파이프라인 상태 API** [HARD]
WHEN 관리자가 파이프라인 상태를 조회하면 THEN 시스템은 현재 실행 중인 파이프라인의 단계별 진행률, 처리된 문서 수, 오류 목록을 JSON으로 반환해야 한다.

**REQ-09: 파이프라인 Delta 처리** [SOFT]
WHEN 파이프라인이 실행되면 THEN 시스템은 SHA-256 해시를 사용하여 변경된 문서만 재처리하고, 미변경 문서는 건너뛰어야 한다.

### Phase 3: 검색 향상 (Search Enhancement)

**REQ-10: tsvector Full-Text Search 추가** [HARD]
시스템은 항상 PolicyChunk.chunk_text에 대해 PostgreSQL tsvector 컬럼과 GIN 인덱스를 유지하여 한국어 키워드 기반 전문 검색을 지원해야 한다.

**REQ-11: 하이브리드 검색** [HARD]
WHEN 사용자가 검색 쿼리를 입력하면 THEN 시스템은 pgvector 의미론적 검색 결과와 tsvector 키워드 검색 결과를 Reciprocal Rank Fusion (RRF) 알고리즘으로 결합하여 최종 결과를 반환해야 한다.

**REQ-12: 메타데이터 필터링** [HARD]
WHEN 검색 시 필터 조건이 지정되면 THEN 시스템은 보험사(company), 보험 분류(category), 판매 상태(sale_status) 기준으로 검색 결과를 필터링해야 한다.

**REQ-13: 검색 결과 스코어링** [SOFT]
가능하면 각 검색 결과에 vector_score, keyword_score, combined_score를 포함하여 결과 품질을 사용자에게 제공해야 한다.

### Phase 4: 모니터링 및 가시성 (Monitoring & Observability)

**REQ-14: 임베딩 커버리지 추적** [HARD]
시스템은 항상 전체 Policy 수 대비 임베딩이 생성된 Policy 수, 임베딩이 없는 PolicyChunk 수를 추적하고 API로 노출해야 한다.

**REQ-15: 파이프라인 건강 메트릭** [HARD]
시스템은 항상 다음 메트릭을 수집해야 한다: 파이프라인 실행 횟수, 단계별 소요 시간, 성공/실패 비율, 처리된 문서 수, 생성된 청크 수, 생성된 임베딩 수.

**REQ-16: 파이프라인 실패 알림** [HARD]
IF 파이프라인 단계에서 치명적 오류가 발생하면 THEN 시스템은 structlog를 통해 ERROR 레벨 로그를 기록하고, 설정된 알림 채널 (webhook)로 알림을 발송해야 한다.

**REQ-17: 대시보드 API** [SOFT]
가능하면 파이프라인 현황을 요약하는 대시보드 API 엔드포인트를 제공하여 크롤링 현황, 임베딩 현황, 검색 품질 지표를 한눈에 확인할 수 있어야 한다.

---

## 4. Specifications (명세)

### 4.1 기술 스택

| 구성 요소 | 기술 | 비고 |
|-----------|------|------|
| 파이프라인 오케스트레이션 | Celery 5.x chain/chord | 기존 인프라 활용 |
| 스케줄링 | Celery Beat | Upstash Redis broker |
| 크롤링 | Playwright (기존) | GenericLifeCrawler/GenericNonlifeCrawler |
| PDF 파싱 | DocumentProcessor (기존) | text_cleaner, text_chunker |
| 임베딩 | EmbeddingService (기존) | OpenAI text-embedding-3-small |
| 전문 검색 | PostgreSQL tsvector + GIN | 신규 추가 |
| 벡터 검색 | pgvector 0.8.2 (기존) | HNSW index |
| 하이브리드 검색 | RRF (Reciprocal Rank Fusion) | 신규 구현 |
| 모니터링 | structlog + Prometheus metrics | 기존 SPEC-OPS-001 연계 |
| DB | CockroachDB | 기존 인프라 |

### 4.2 신규 / 변경 파일 구조

```
backend/app/
├── services/
│   ├── pipeline/                      # 신규: 파이프라인 오케스트레이션
│   │   ├── __init__.py
│   │   ├── orchestrator.py            # PipelineOrchestrator: chain 구성
│   │   ├── pipeline_status.py         # PipelineStatus: 상태 추적
│   │   └── health_checker.py          # HealthChecker: 건강 메트릭
│   │
│   ├── crawler/
│   │   ├── config_validator.py        # 신규: Config 검증 시스템
│   │   └── health_monitor.py          # 신규: 크롤링 건강 모니터링
│   │
│   └── rag/
│       ├── hybrid_search.py           # 신규: 하이브리드 검색 (RRF)
│       ├── fulltext_search.py         # 신규: tsvector 전문 검색
│       └── vector_store.py            # 변경: 메타데이터 필터 추가
│
├── tasks/
│   └── pipeline_tasks.py              # 신규: 통합 파이프라인 Celery tasks
│
├── api/v1/
│   └── pipeline.py                    # 신규: 파이프라인 상태/트리거 API
│
├── schemas/
│   └── pipeline.py                    # 신규: 파이프라인 요청/응답 스키마
│
└── models/
    └── insurance.py                   # 변경: tsvector 컬럼 추가
```

### 4.3 데이터베이스 변경

**PolicyChunk 테이블 변경:**
- `search_vector` 컬럼 추가: `tsvector` 타입, `chunk_text` 기반 자동 생성
- GIN 인덱스 추가: `idx_policy_chunks_search_vector`
- 트리거 함수: `chunk_text` 변경 시 `search_vector` 자동 업데이트

**PipelineRun 테이블 신규:**
- `id`: UUID, PK
- `status`: ENUM (PENDING, RUNNING, COMPLETED, FAILED, PARTIAL)
- `trigger_type`: ENUM (SCHEDULED, MANUAL)
- `started_at`, `completed_at`: DateTime
- `stats`: JSONB (단계별 처리 통계)
- `error_details`: JSONB (오류 상세)

### 4.4 API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/v1/pipeline/trigger` | 수동 파이프라인 트리거 |
| GET | `/api/v1/pipeline/status` | 현재 파이프라인 상태 조회 |
| GET | `/api/v1/pipeline/status/{run_id}` | 특정 실행 상태 조회 |
| GET | `/api/v1/pipeline/history` | 파이프라인 실행 이력 |
| GET | `/api/v1/pipeline/health` | 파이프라인 건강 메트릭 |
| GET | `/api/v1/pipeline/coverage` | 임베딩 커버리지 현황 |
| POST | `/api/v1/crawler/validate` | 크롤러 Config 검증 실행 |
| GET | `/api/v1/crawler/health` | 크롤러 건강 상태 |

### 4.5 Traceability (추적성)

| 요구사항 | 구현 파일 | 테스트 |
|----------|-----------|--------|
| REQ-01 | crawler/config_validator.py | test_config_validator.py |
| REQ-02 | crawler/base.py (변경) | test_crawler_retry.py |
| REQ-03 | crawler/health_monitor.py | test_health_monitor.py |
| REQ-04 | crawler/health_monitor.py | test_auto_disable.py |
| REQ-05 | pipeline/orchestrator.py | test_pipeline_orchestrator.py |
| REQ-06 | tasks/pipeline_tasks.py | test_pipeline_tasks.py |
| REQ-07 | tasks/pipeline_tasks.py | test_pipeline_schedule.py |
| REQ-08 | api/v1/pipeline.py | test_pipeline_api.py |
| REQ-09 | pipeline/orchestrator.py | test_delta_processing.py |
| REQ-10 | models/insurance.py, migration | test_tsvector.py |
| REQ-11 | rag/hybrid_search.py | test_hybrid_search.py |
| REQ-12 | rag/vector_store.py (변경) | test_metadata_filter.py |
| REQ-13 | rag/hybrid_search.py | test_scoring.py |
| REQ-14 | pipeline/health_checker.py | test_coverage_tracking.py |
| REQ-15 | pipeline/health_checker.py | test_health_metrics.py |
| REQ-16 | pipeline/orchestrator.py | test_failure_alert.py |
| REQ-17 | api/v1/pipeline.py | test_dashboard_api.py |
