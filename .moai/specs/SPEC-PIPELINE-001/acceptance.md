# SPEC-PIPELINE-001: 인수 기준

## 관련 SPEC

- SPEC-PIPELINE-001

---

## 1. Phase 1: 크롤러 안정성

### AC-01: 크롤러 Config 검증 (REQ-01)

```gherkin
Scenario: 크롤러 Config 검증 실행
  Given 30개의 보험사 YAML config 파일이 존재하고
  And ConfigValidator 서비스가 초기화되어 있을 때
  When 전체 config 검증을 실행하면
  Then 각 config에 대해 웹사이트 접속 가능 여부가 확인되고
  And 상품 목록 페이지 로드 성공 여부가 확인되고
  And PDF 다운로드 링크 존재 여부가 확인되고
  And 검증 결과 리포트가 JSON 형식으로 생성된다

Scenario: 개별 Config 검증
  Given 특정 보험사 YAML config가 존재할 때
  When 해당 config에 대해 단일 검증을 실행하면
  Then 검증 결과에 company_code, url_accessible, page_loaded, pdf_links_found 필드가 포함되고
  And 실패 시 상세 오류 메시지가 포함된다
```

### AC-02: 크롤러 오류 처리 강화 (REQ-02)

```gherkin
Scenario: 네트워크 타임아웃 시 재시도
  Given 크롤러가 특정 보험사 웹사이트를 크롤링 중이고
  When 네트워크 타임아웃이 발생하면
  Then 시스템은 exponential backoff로 최대 3회 재시도를 수행하고
  And 모든 시도가 실패하면 CrawlResult에 "FAILED" 상태와 상세 오류 메시지를 기록한다

Scenario: 페이지 구조 변경 감지
  Given 크롤러가 기존 CSS selector로 페이지를 파싱 중이고
  When 예상된 HTML 요소를 찾지 못하면
  Then CrawlResult에 "STRUCTURE_CHANGED" 오류 유형과 함께 기록되고
  And 해당 보험사의 health_status가 "DEGRADED"로 업데이트된다
```

### AC-03: 크롤링 건강 모니터링 (REQ-03)

```gherkin
Scenario: 보험사별 크롤링 건강 상태 조회
  Given 여러 크롤링 실행 이력이 존재할 때
  When GET /api/v1/crawler/health를 호출하면
  Then 각 보험사별로 다음 정보가 반환된다:
    | 필드 | 설명 |
    | success_rate | 최근 10회 성공률 (%) |
    | last_success_at | 마지막 성공 크롤링 일시 |
    | total_pdfs | 수집된 PDF 수 |
    | status | HEALTHY / DEGRADED / FAILED |
```

---

## 2. Phase 2: End-to-End 파이프라인

### AC-04: 통합 파이프라인 실행 (REQ-05, REQ-06)

```gherkin
Scenario: 수동 파이프라인 트리거
  Given 활성화된 보험사 config가 존재하고
  And Celery worker가 실행 중일 때
  When POST /api/v1/pipeline/trigger를 호출하면
  Then PipelineRun이 "RUNNING" 상태로 생성되고
  And 크롤링 -> PDF 다운로드 -> 텍스트 추출 -> 청킹 -> 임베딩 -> DB 저장 순서로 실행되고
  And 각 단계 완료 시 PipelineRun.stats에 진행 상황이 업데이트되고
  And 전체 완료 시 PipelineRun.status가 "COMPLETED"로 변경된다

Scenario: 파이프라인 부분 실패 처리
  Given 파이프라인이 실행 중이고
  When 특정 보험사의 크롤링이 실패하면
  Then 해당 보험사는 건너뛰고 나머지 보험사의 파이프라인은 계속 진행되고
  And PipelineRun.status는 "PARTIAL"로 설정되고
  And PipelineRun.error_details에 실패한 보험사 목록과 오류 원인이 기록된다
```

### AC-05: 파이프라인 상태 조회 (REQ-08)

```gherkin
Scenario: 실행 중인 파이프라인 상태 조회
  Given 파이프라인이 현재 실행 중일 때
  When GET /api/v1/pipeline/status를 호출하면
  Then 응답에 다음 정보가 포함된다:
    | 필드 | 설명 |
    | run_id | 현재 실행 ID |
    | status | RUNNING |
    | current_step | 현재 진행 단계명 |
    | progress | 전체 진행률 (0-100%) |
    | processed_documents | 처리된 문서 수 |
    | errors | 발생한 오류 목록 |
    | started_at | 시작 시각 |

Scenario: 파이프라인 실행 이력 조회
  Given 여러 파이프라인 실행 이력이 존재할 때
  When GET /api/v1/pipeline/history?limit=10을 호출하면
  Then 최근 10개의 실행 이력이 시간 역순으로 반환되고
  And 각 이력에 run_id, status, trigger_type, started_at, completed_at, stats가 포함된다
```

### AC-06: 파이프라인 스케줄링 (REQ-07)

```gherkin
Scenario: 주간 자동 파이프라인 실행
  Given Celery Beat 스케줄이 설정되어 있을 때
  When 일요일 02:00 KST가 되면
  Then 파이프라인이 자동으로 트리거되고
  And PipelineRun.trigger_type이 "SCHEDULED"로 기록된다
```

---

## 3. Phase 3: 검색 향상

### AC-07: tsvector 전문 검색 (REQ-10)

```gherkin
Scenario: tsvector 기반 키워드 검색
  Given PolicyChunk에 search_vector 컬럼이 존재하고
  And 임베딩과 함께 tsvector가 생성되어 있을 때
  When "암 진단비" 키워드로 전문 검색을 실행하면
  Then chunk_text에 "암"과 "진단비"를 포함하는 청크가 반환되고
  And 결과는 ts_rank 점수 순으로 정렬된다
```

### AC-08: 하이브리드 검색 (REQ-11)

```gherkin
Scenario: 하이브리드 검색 결과 반환
  Given 동일한 쿼리에 대해 pgvector 검색과 tsvector 검색이 각각 결과를 반환할 때
  When HybridSearchService.search("인공관절 수술 보험")를 호출하면
  Then pgvector 의미론적 검색 결과와 tsvector 키워드 검색 결과가 RRF 알고리즘으로 결합되고
  And 최종 결과에 각 문서의 vector_score, keyword_score, combined_score가 포함되고
  And combined_score 기준 내림차순으로 정렬된 결과가 반환된다

Scenario: 키워드만 매칭되는 경우
  Given 의미론적으로는 관련 없지만 정확한 키워드를 포함하는 문서가 존재할 때
  When 해당 키워드로 하이브리드 검색을 실행하면
  Then tsvector 결과에 해당 문서가 포함되고
  And RRF를 통해 최종 결과에도 반영된다
```

### AC-09: 메타데이터 필터링 (REQ-12)

```gherkin
Scenario: 보험사 및 카테고리 필터 검색
  Given 여러 보험사의 PolicyChunk가 존재할 때
  When 검색 시 company_code="samsung-life"와 category="LIFE" 필터를 적용하면
  Then 삼성생명의 생명보험 카테고리에 해당하는 청크만 검색 결과에 포함되고
  And 다른 보험사나 카테고리의 결과는 제외된다

Scenario: 판매 상태 필터
  Given ON_SALE과 DISCONTINUED 상품이 혼재할 때
  When sale_status="ON_SALE" 필터를 적용하여 검색하면
  Then 현재 판매 중인 상품의 청크만 반환된다
```

---

## 4. Phase 4: 모니터링

### AC-10: 임베딩 커버리지 추적 (REQ-14)

```gherkin
Scenario: 임베딩 커버리지 현황 조회
  Given Policy와 PolicyChunk 데이터가 존재할 때
  When GET /api/v1/pipeline/coverage를 호출하면
  Then 응답에 다음 정보가 포함된다:
    | 필드 | 설명 |
    | total_policies | 전체 Policy 수 |
    | embedded_policies | 임베딩 완료된 Policy 수 |
    | coverage_rate | 임베딩 커버리지 비율 (%) |
    | total_chunks | 전체 PolicyChunk 수 |
    | embedded_chunks | 임베딩이 있는 PolicyChunk 수 |
    | missing_embeddings | 임베딩이 없는 PolicyChunk 수 |
```

### AC-11: 파이프라인 실패 알림 (REQ-16)

```gherkin
Scenario: 파이프라인 치명적 오류 시 알림 발송
  Given 파이프라인이 실행 중이고
  And 알림 webhook URL이 설정되어 있을 때
  When 파이프라인 단계에서 치명적 오류 (전체 크롤링 실패, DB 연결 불가 등)가 발생하면
  Then structlog ERROR 레벨 로그가 기록되고
  And 설정된 webhook URL로 알림 payload가 전송되고
  And payload에 run_id, failed_step, error_message, timestamp가 포함된다
```

---

## 5. 품질 게이트

### Definition of Done

- [ ] 모든 HARD 요구사항 (REQ-01~03, 05~08, 10~12, 14~16) 구현 완료
- [ ] 각 구현 파일에 대한 단위 테스트 작성 (커버리지 85% 이상)
- [ ] Alembic 마이그레이션 파일 생성 및 적용 가능
- [ ] 파이프라인 end-to-end 수동 테스트 통과
- [ ] 하이브리드 검색 결과가 기존 벡터 검색 대비 동등 이상의 품질
- [ ] API 엔드포인트 OpenAPI 문서 자동 생성
- [ ] structlog 기반 로깅 적용

### 검증 방법

| 검증 항목 | 방법 | 도구 |
|-----------|------|------|
| 크롤러 검증 | ConfigValidator 실행, 실제 사이트 접속 | pytest + Playwright |
| 파이프라인 통합 | end-to-end 수동 트리거 테스트 | Celery + pytest |
| 하이브리드 검색 | 사전 정의된 쿼리 세트로 결과 비교 | pytest + pgvector |
| tsvector 인덱스 | EXPLAIN ANALYZE로 쿼리 성능 확인 | PostgreSQL |
| API 엔드포인트 | HTTP 요청/응답 검증 | pytest + httpx |
| 메모리 사용량 | Fly.io 모니터링 대시보드 확인 | Fly.io metrics |
| 커버리지 | pytest --cov 실행 | pytest-cov |
