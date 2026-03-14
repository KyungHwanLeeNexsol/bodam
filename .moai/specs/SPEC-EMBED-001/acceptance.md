---
spec_id: SPEC-EMBED-001
type: acceptance-criteria
created: 2026-03-14
updated: 2026-03-14
---

# SPEC-EMBED-001: Acceptance Criteria

## 테스트 시나리오

### ACC-001: 배치 임베딩 작업 시작 및 진행 추적

```gherkin
Scenario: 관리자가 다수 Policy의 배치 임베딩을 요청한다
  Given 5개의 Policy가 raw_text와 함께 DB에 등록되어 있다
  And 각 Policy에 대한 PolicyChunk가 아직 생성되지 않았다
  When 관리자가 POST /admin/embeddings/batch 에 5개 policy_id를 전송한다
  Then 시스템은 202 Accepted와 task_id를 반환한다
  And Celery 배치 작업이 비동기로 시작된다

Scenario: 관리자가 배치 작업 진행 상태를 조회한다
  Given 5개 Policy 배치 임베딩 작업이 진행 중이다
  And 3개 Policy의 임베딩이 완료되었다
  When 관리자가 GET /admin/embeddings/batch/{task_id} 를 호출한다
  Then 시스템은 상태 "PROGRESS", total=5, completed=3, failed=0을 반환한다
```

### ACC-002: 중복 작업 방지

```gherkin
Scenario: 동일 Policy에 대한 중복 배치 작업을 거부한다
  Given Policy A에 대한 임베딩 작업이 이미 진행 중이다
  When 관리자가 Policy A를 포함한 배치 임베딩을 다시 요청한다
  Then 시스템은 Policy A를 작업 목록에서 제외하고 나머지만 처리한다
  And 응답에 제외된 Policy ID와 사유를 포함한다
```

### ACC-003: HNSW 인덱스 성능 검증

```gherkin
Scenario: HNSW 인덱스 적용 후 검색 성능이 향상된다
  Given policy_chunks 테이블에 10,000개 이상의 임베딩 벡터가 존재한다
  And HNSW 인덱스 마이그레이션이 적용되었다
  When VectorSearchService.search()로 "암 진단비 보장" 쿼리를 실행한다
  Then 검색 응답 시간이 200ms 이내이다
  And 반환된 결과의 코사인 유사도가 threshold 조건을 충족한다
```

### ACC-004: 청크 메타데이터 보강

```gherkin
Scenario: 새 Policy 인제스션 시 메타데이터가 자동 기록된다
  Given EmbeddingService와 DocumentProcessor가 정상 작동한다
  When 관리자가 raw_text가 포함된 Policy를 생성한다
  Then 생성된 모든 PolicyChunk의 metadata_에 다음이 포함된다:
    | 필드 | 타입 | 설명 |
    | token_count | int | 0 초과 정수 |
    | chunk_quality_score | float | 0.0 ~ 1.0 범위 |
    | embedding_model | str | "text-embedding-3-small" |
    | embedding_version | str | "v1" |
    | embedded_at | str | ISO 8601 타임스탬프 |
```

### ACC-005: 누락 임베딩 감지

```gherkin
Scenario: 임베딩이 누락된 청크를 감지한다
  Given 100개의 PolicyChunk 중 5개의 embedding이 NULL이다
  When 관리자가 GET /admin/embeddings/health 를 호출한다
  Then 시스템은 다음을 반환한다:
    | 필드 | 값 |
    | total_chunks | 100 |
    | embedded_chunks | 95 |
    | missing_chunks | 5 |
    | missing_chunk_ids | [5개 UUID 리스트] |
    | coverage_rate | 0.95 |
```

### ACC-006: 누락 임베딩 재생성

```gherkin
Scenario: 누락된 임베딩을 선택적으로 재생성한다
  Given 5개의 PolicyChunk에 embedding이 NULL이다
  When 관리자가 POST /admin/embeddings/regenerate 에 5개 chunk_id를 전송한다
  Then 시스템은 5개 청크의 임베딩을 재생성한다
  And 모든 청크의 embedding 컬럼이 NULL이 아니다
  And metadata_에 embedding_model, embedding_version, embedded_at이 갱신된다
```

### ACC-007: 개별 청크 실패 시 배치 계속 진행

```gherkin
Scenario: 특정 청크 임베딩 실패 시 나머지 청크는 정상 처리된다
  Given 10개 Policy 배치 임베딩 작업이 진행 중이다
  And 3번째 Policy의 특정 청크에서 OpenAI API 오류가 발생한다
  When 시스템이 해당 청크의 재시도(최대 3회)에 모두 실패한다
  Then 시스템은 해당 청크를 건너뛰고 다음 청크로 진행한다
  And 나머지 7개 Policy는 정상적으로 임베딩이 완료된다
  And 최종 리포트에 실패한 청크 정보가 포함된다
```

### ACC-008: OpenAI API 완전 불가용 시 일시 정지

```gherkin
Scenario: OpenAI API가 완전히 불가용할 때 배치 작업이 일시 정지된다
  Given 배치 임베딩 작업이 진행 중이다
  And OpenAI API가 연속 3회 이상 모든 요청에서 실패한다
  When 시스템이 전체 API 불가용 상태를 감지한다
  Then 배치 작업은 "PAUSED" 상태로 전환된다
  And 5분 후 자동으로 재시도가 시작된다
  And 재시도 성공 시 중단된 지점부터 처리를 재개한다
```

---

## 엣지 케이스 시나리오

### EDGE-001: 빈 raw_text Policy 배치 처리

```gherkin
Scenario: raw_text가 NULL인 Policy가 배치에 포함된 경우
  Given 배치 요청에 raw_text가 NULL인 Policy가 포함되어 있다
  When 배치 작업이 해당 Policy를 처리한다
  Then 시스템은 해당 Policy를 건너뛰고 로그에 경고를 기록한다
  And 배치 작업은 정상적으로 다음 Policy로 진행한다
```

### EDGE-002: 매우 긴 약관 문서

```gherkin
Scenario: 500페이지 이상의 대용량 약관 문서 처리
  Given 약관 원문이 500,000자(약 200,000 토큰) 이상이다
  When DocumentProcessor가 해당 문서를 처리한다
  Then 시스템은 약 400개 이상의 청크를 생성한다
  And 각 청크의 임베딩이 배치 단위(2048개)로 처리된다
  And 전체 처리가 메모리 초과 없이 완료된다
```

### EDGE-003: 동시 배치 작업 경쟁

```gherkin
Scenario: 두 개의 배치 작업이 동시에 같은 Policy를 처리하려 한다
  Given 배치 작업 A가 Policy X의 임베딩을 처리 중이다
  When 배치 작업 B도 Policy X를 포함하여 시작된다
  Then 배치 작업 B는 Policy X를 제외하고 나머지 Policy만 처리한다
```

---

## 성능 기준

| 지표 | 목표값 | 측정 방법 |
|------|--------|-----------|
| 임베딩 처리 속도 | 100 청크/분 이상 | 배치 작업 완료 시간 / 처리 청크 수 |
| 벡터 검색 응답 시간 | 200ms 이내 (100K 벡터) | VectorSearchService.search() 실행 시간 |
| 배치 작업 상태 조회 | 50ms 이내 | Redis 조회 응답 시간 |
| 메모리 사용량 | Worker당 512MB 이내 | Celery worker 프로세스 RSS |
| 임베딩 성공률 | 99% 이상 | 성공 청크 / 전체 청크 |

---

## Quality Gate 기준

### 코드 품질

- [ ] 모든 신규 함수에 type hint 적용
- [ ] 공개 API에 docstring 작성 (한국어)
- [ ] ruff 린트 오류 0건
- [ ] mypy 타입 체크 통과

### 테스트 커버리지

- [ ] 신규 코드 테스트 커버리지 85% 이상
- [ ] Celery 작업에 대한 단위 테스트 (mock broker)
- [ ] EmbeddingMonitorService 단위 테스트
- [ ] Admin API 통합 테스트 (httpx AsyncClient)
- [ ] 청크 품질 점수 산출 함수 단위 테스트

### 통합 검증

- [ ] Alembic 마이그레이션 upgrade/downgrade 정상 동작
- [ ] HNSW 인덱스 적용 후 기존 VectorSearchService 테스트 통과
- [ ] 기존 Admin API(POST /policies) 동작 변경 없음
- [ ] DocumentProcessor 기존 반환 형식 하위 호환

### Definition of Done

1. 모든 ACC 시나리오 테스트 통과
2. 기존 테스트 스위트 전체 통과 (회귀 없음)
3. Alembic 마이그레이션 정방향/역방향 검증
4. 코드 리뷰 완료
5. API 문서 자동 생성 확인 (FastAPI /docs)
