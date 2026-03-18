# SPEC-PIPELINE-001: 구현 계획

## 관련 SPEC

- SPEC-PIPELINE-001 (본 문서)
- 의존: SPEC-CRAWLER-001, SPEC-CRAWLER-002, SPEC-EMBED-001

---

## 1. 구현 전략

### 1.1 핵심 원칙

- **기존 코드 최대 활용**: BaseCrawler, EmbeddingService, DocumentProcessor, TextChunker 등 기존 구현체를 재사용하고 파이프라인으로 통합
- **점진적 구현**: Phase 1 (크롤러 안정성) -> Phase 2 (파이프라인 자동화) -> Phase 3 (검색 향상) -> Phase 4 (모니터링) 순서로 진행
- **직접 구현 유지**: LangChain/LlamaIndex 마이그레이션 없이 현재 아키텍처 개선
- **1GB RAM 제약 준수**: Fly.io 환경 특성을 고려한 메모리 효율적 설계

### 1.2 아키텍처 설계 방향

```
[Celery Beat Schedule]
        |
        v
[PipelineOrchestrator]
        |
        v
[Celery Chain]
  |-> crawl_task (BaseCrawler 활용)
  |-> download_task (PDF 다운로드)
  |-> parse_task (DocumentProcessor 활용)
  |-> chunk_task (TextChunker 활용)
  |-> embed_task (EmbeddingService 활용)
  |-> store_task (DB 저장 + tsvector 생성)
        |
        v
[PipelineStatus] -> [HealthChecker] -> [API Endpoints]
```

---

## 2. 마일스톤

### Primary Goal: Phase 1 - 크롤러 안정성 확보

**목표**: 30개 YAML config의 실제 동작 여부 검증 및 오류 처리 강화

| 태스크 | 설명 | 우선순위 |
|--------|------|----------|
| P1-1 | ConfigValidator 구현: YAML config별 실제 웹사이트 접속 검증 | High |
| P1-2 | 30개 config에 대한 검증 실행 및 결과 리포트 생성 | High |
| P1-3 | 실패 config 수정 또는 비활성화 처리 | High |
| P1-4 | BaseCrawler 오류 처리 강화: exponential backoff 개선, 상세 오류 로깅 | High |
| P1-5 | CrawlerHealthMonitor 구현: 보험사별 성공/실패 추적 | Medium |
| P1-6 | 크롤러 건강 API 엔드포인트 추가 | Medium |

**완료 기준**: 활성화된 모든 config가 실제 웹사이트에서 PDF 다운로드 가능

### Secondary Goal: Phase 2 - End-to-End 파이프라인 자동화

**목표**: 크롤링부터 DB 저장까지 단일 자동화 워크플로우 구축

| 태스크 | 설명 | 우선순위 |
|--------|------|----------|
| P2-1 | PipelineOrchestrator 구현: Celery chain/chord 기반 단계 연결 | High |
| P2-2 | pipeline_tasks.py: 각 단계별 Celery task 정의 | High |
| P2-3 | PipelineRun DB 모델 및 Alembic 마이그레이션 | High |
| P2-4 | PipelineStatus: 실행 상태 추적 및 단계별 진행률 관리 | High |
| P2-5 | Celery Beat 스케줄 설정: 주간 자동 실행 | Medium |
| P2-6 | 파이프라인 API 엔드포인트 (trigger, status, history) | Medium |
| P2-7 | Delta 처리: SHA-256 해시 기반 변경 감지 | Medium |

**완료 기준**: 수동 트리거로 전체 파이프라인이 end-to-end 실행 가능

### Tertiary Goal: Phase 3 - 검색 향상

**목표**: 하이브리드 검색 (의미론적 + 키워드) 구현

| 태스크 | 설명 | 우선순위 |
|--------|------|----------|
| P3-1 | PolicyChunk에 tsvector 컬럼 + GIN 인덱스 추가 (Alembic) | High |
| P3-2 | tsvector 자동 업데이트 트리거 함수 작성 | High |
| P3-3 | FulltextSearchService 구현: tsvector 기반 검색 | High |
| P3-4 | HybridSearchService 구현: RRF 알고리즘으로 결과 결합 | High |
| P3-5 | VectorSearchService 변경: 메타데이터 필터링 추가 | Medium |
| P3-6 | 기존 RAG chain에서 HybridSearchService 사용하도록 변경 | Medium |

**완료 기준**: 동일 쿼리에 대해 벡터 + 키워드 하이브리드 결과 반환

### Optional Goal: Phase 4 - 모니터링 및 가시성

**목표**: 파이프라인 운영 가시성 확보

| 태스크 | 설명 | 우선순위 |
|--------|------|----------|
| P4-1 | HealthChecker: 임베딩 커버리지 추적 (Policy/Chunk 기준) | Medium |
| P4-2 | 파이프라인 메트릭 수집: structlog + Prometheus counter/histogram | Medium |
| P4-3 | 실패 알림: webhook 기반 알림 발송 | Low |
| P4-4 | 대시보드 API: 크롤링/임베딩/검색 현황 요약 | Low |

**완료 기준**: 파이프라인 실행 이력 및 건강 상태를 API로 조회 가능

---

## 3. 기술 접근 방식

### 3.1 Celery Chain 파이프라인 설계

기존 개별 task (crawl_all, ingest_policy, bulk_embed_policies)를 Celery chain으로 연결:

```python
# 파이프라인 체인 구조 (개념)
pipeline = chain(
    crawl_companies_task.s(),           # Phase 1: 크롤링
    chord(
        [download_pdf_task.s(url) for url in pdf_urls],  # Phase 2: PDF 다운로드
        parse_and_chunk_task.s()         # Phase 3: 파싱 + 청킹
    ),
    embed_chunks_task.s(),              # Phase 4: 임베딩
    update_search_vectors_task.s(),     # Phase 5: tsvector 업데이트
    update_pipeline_status_task.s()     # Phase 6: 상태 갱신
)
```

### 3.2 하이브리드 검색 (RRF) 알고리즘

Reciprocal Rank Fusion 공식:
```
RRF_score(d) = SUM(1 / (k + rank_i(d)))
```
- k: 상수 (기본값 60)
- rank_i(d): i번째 검색 방법에서 문서 d의 순위

두 검색 결과 (pgvector + tsvector)를 RRF로 결합하여 최종 순위 결정.

### 3.3 tsvector 한국어 처리

PostgreSQL의 기본 한국어 파서 한계를 고려하여:
- `simple` 설정으로 공백 기반 토큰화 사용
- 한국어 불용어 사전 커스텀 적용
- 향후 Korean NLP 기반 토크나이저 확장 가능성 열어둠

### 3.4 메모리 효율 전략 (Fly.io 1GB)

- Playwright 크롤러 동시 실행 제한: 최대 2개
- PDF 파싱은 스트리밍 방식으로 청크 단위 처리
- 임베딩 배치 크기 제한: 100 chunks/batch
- 파이프라인 단계 간 메모리 해제를 위한 task 분리

---

## 4. 리스크 및 대응

| 리스크 | 영향 | 대응 방안 |
|--------|------|-----------|
| 보험사 웹사이트 구조 변경으로 크롤러 대량 실패 | High | ConfigValidator 정기 실행, 자동 비활성화, 알림 체계 |
| Fly.io 1GB RAM에서 Playwright + Celery 메모리 초과 | High | 동시 실행 제한, headless 모드 최적화, 단계별 메모리 해제 |
| tsvector 한국어 토큰화 품질 한계 | Medium | simple 파서 + 불용어 사전으로 시작, 향후 커스텀 파서 검토 |
| Neon PostgreSQL cold start로 파이프라인 지연 | Medium | connection pooling, 파이프라인 시작 전 warm-up 쿼리 |
| OpenAI Embedding API rate limit 도달 | Medium | 배치 크기 조절, exponential backoff, 일일 한도 모니터링 |
| 기존 검색 로직과 하이브리드 검색 통합 시 회귀 | Medium | 기존 VectorSearchService 인터페이스 유지, feature flag로 하이브리드 전환 |

---

## 5. 의존성

### 내부 의존성
- SPEC-CRAWLER-001: BaseCrawler, CrawlRun/CrawlResult 모델
- SPEC-CRAWLER-002: 30개 YAML config, GenericLifeCrawler/GenericNonlifeCrawler
- SPEC-EMBED-001: EmbeddingService, DocumentProcessor, TextChunker
- SPEC-OPS-001: Prometheus 메트릭, structlog

### 외부 의존성
- OpenAI API: text-embedding-3-small (임베딩 생성)
- Neon PostgreSQL: pgvector 0.8.2, tsvector
- Upstash Redis: Celery broker, Celery Beat
- 보험사 웹사이트: 크롤링 대상 (30개 사이트)

---

## 6. 전문가 상담 권장

### expert-backend 상담 권장 사항

이 SPEC은 다음 영역에서 backend 전문가 상담이 유익할 수 있다:

1. **Celery chain/chord 패턴**: 복잡한 파이프라인 오케스트레이션의 오류 처리 및 재시도 전략
2. **SQLAlchemy tsvector 통합**: Alembic 마이그레이션에서의 tsvector 컬럼 + 트리거 설정
3. **하이브리드 검색 구현**: RRF 알고리즘의 PostgreSQL 쿼리 최적화
4. **메모리 최적화**: 1GB RAM 환경에서의 Celery worker 메모리 관리

### expert-devops 상담 권장 사항

1. **Fly.io 리소스 최적화**: 1GB RAM에서 Playwright + Celery worker 동시 운영 전략
2. **Celery Beat 설정**: Upstash Redis 기반 스케줄러 안정성

---

## 7. 다음 단계

1. `/moai:2-run SPEC-PIPELINE-001` 실행하여 Phase 1부터 구현 시작
2. Phase 1 완료 후 크롤러 검증 리포트를 기반으로 Phase 2 진행
3. 구현 완료 후 `/moai:3-sync SPEC-PIPELINE-001`로 문서 동기화
