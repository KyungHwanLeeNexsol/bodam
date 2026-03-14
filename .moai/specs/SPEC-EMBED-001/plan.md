---
spec_id: SPEC-EMBED-001
type: implementation-plan
created: 2026-03-14
updated: 2026-03-14
---

# SPEC-EMBED-001: Implementation Plan

## 1. 작업 분해 (Task Decomposition)

### Milestone 1: HNSW 인덱스 마이그레이션 [Priority High]

> 검색 성능 최적화의 기반으로, 다른 작업에 선행하여 완료 필요

1. Alembic 마이그레이션 파일 생성
   - `policy_chunks.embedding` 컬럼에 HNSW 인덱스 생성
   - 파라미터: `m=16`, `ef_construction=64`, `vector_cosine_ops`
   - 롤백(downgrade) 시 인덱스 삭제
2. 로컬 환경에서 마이그레이션 실행 및 검증
3. 검색 응답 시간 벤치마크 측정 (인덱스 전후 비교)

### Milestone 2: 메타데이터 보강 [Priority High]

> 청크 품질 관리와 임베딩 버전 관리의 기반

4. TextChunker 확장
   - `chunk_text_with_metadata()` 메서드 추가
   - 반환 형식: `{"text": str, "token_count": int}` 리스트
5. 청크 품질 점수 산출 함수 구현
   - `calculate_chunk_quality(text: str) -> float`
   - 토큰 수 적정성(0.3), 한국어 비율(0.3), 특수문자 비율(0.2), 문장 완결성(0.2)
6. DocumentProcessor 변경
   - `process_text()` 반환 딕셔너리에 metadata 필드 추가
   - `token_count`, `chunk_quality_score`, `embedding_model`, `embedding_version` 포함
7. PDF 처리 시 페이지 번호 추적
   - PDFParser에서 페이지별 텍스트 추출 시 페이지 정보 전달
   - 청크-페이지 매핑 로직 구현

### Milestone 3: Celery 배치 인제스션 [Priority High]

> 대량 약관 처리를 위한 핵심 기능

8. Celery 앱 설정 및 Redis 브로커 연결 구성
   - `backend/app/core/celery_app.py` 생성
   - Redis 브로커 URL 환경변수 설정
9. `bulk_embed_policies` Celery 작업 구현
   - 입력: `policy_ids: list[UUID]`, `force: bool`
   - `force=True`: 기존 청크 삭제 후 재생성
   - `force=False`: embedding NULL인 청크만 처리
   - 진행 상태를 Redis에 실시간 기록
10. 중복 작업 방지 로직
    - Redis lock 또는 Celery task ID 기반 중복 체크
    - 동일 Policy에 대한 진행 중 작업이 있으면 거부
11. Admin API 엔드포인트 구현
    - `POST /admin/embeddings/batch`: 배치 작업 시작, task_id 반환
    - `GET /admin/embeddings/batch/{task_id}`: 진행 상태 조회

### Milestone 4: 임베딩 품질 모니터링 [Priority Medium]

> 운영 안정성을 위한 모니터링 도구

12. EmbeddingMonitorService 구현
    - `get_missing_embeddings()`: embedding NULL인 청크 조회
    - `get_embedding_stats()`: 전체 임베딩 상태 통계
    - `regenerate_missing(chunk_ids: list[UUID])`: 선택적 재생성
13. Admin API 엔드포인트 구현
    - `GET /admin/embeddings/health`: 누락 임베딩 상태
    - `POST /admin/embeddings/regenerate`: 누락 임베딩 재생성
14. 배치 작업 완료 시 요약 리포트 로깅
    - 성공 수, 실패 수, 건너뛴 수, 총 처리 시간

### Milestone 5: 오류 처리 개선 및 버전 관리 [Priority Medium]

> 운영 환경 안정성 강화

15. EmbeddingService graceful degradation 구현
    - 개별 청크 실패 시 건너뛰고 다음 진행
    - 전체 API 불가용 시 배치 작업 일시 정지 (5분 후 자동 재시도)
    - 실패 청크 ID를 별도 리스트로 기록하여 후속 재처리 지원
16. 임베딩 버전 메타데이터 기록
    - metadata_에 `embedding_model`, `embedding_version`, `embedded_at` 자동 기록
    - 향후 모델 업그레이드 시 특정 버전 청크만 필터링 가능

### Milestone 6: 유사도 분포 분석 [Priority Low / Optional]

17. 유사도 분포 분석 API (선택)
    - 전체 임베딩 간 코사인 유사도 샘플링
    - 평균, 표준편차, 이상치 탐지
    - `GET /admin/embeddings/analysis`

---

## 2. 기술 스택 및 의존성

### 신규 의존성

| 패키지 | 버전 | 용도 |
|--------|------|------|
| celery | 5.4.x | 비동기 배치 작업 처리 |
| redis (Python) | 5.x | Celery 브로커 및 진행 상태 저장 |

### 기존 의존성 (변경 없음)

| 패키지 | 용도 |
|--------|------|
| openai | text-embedding-3-small API 호출 |
| tiktoken | cl100k_base 토큰 카운팅 |
| sqlalchemy[asyncio] | PostgreSQL async ORM |
| pgvector | Vector(1536) 타입 및 HNSW 인덱스 |
| alembic | DB 마이그레이션 |
| pdfplumber | PDF 텍스트 추출 |

---

## 3. 리스크 분석 및 완화

### Risk 1: OpenAI API 비용 급증

- **영향**: 대량 인제스션 시 예상치 못한 비용 발생
- **확률**: 중간
- **완화**: 배치 작업에 일일 토큰 한도 설정 (기본 10M 토큰/일), 진행 중 비용 추적 로깅

### Risk 2: HNSW 인덱스 생성 시 DB 잠금

- **영향**: 인덱스 생성 중 쓰기 작업 차단 가능
- **확률**: 낮음 (100K 벡터 규모에서)
- **완화**: `CREATE INDEX CONCURRENTLY` 사용으로 비차단 생성, 저부하 시간대 실행

### Risk 3: Celery Worker 장애

- **영향**: 배치 작업 중단, 부분 완료 상태
- **확률**: 낮음
- **완화**: Celery 작업의 acks_late=True 설정, Redis 진행 상태로 재개 지점 파악, 멱등성 보장 설계

### Risk 4: 임베딩 모델 변경 시 호환성

- **영향**: 기존 벡터와 새 벡터의 유사도 비교 불가
- **확률**: 중간 (장기적)
- **완화**: metadata_에 embedding_model/version 기록, 버전별 필터링 쿼리 지원, 점진적 재임베딩 전략

---

## 4. 기존 코드와의 통합 지점

### 4.1 EmbeddingService 확장

**현재**: `embed_text()`, `embed_batch()`, `_call_with_retry()` 제공
**변경**:
- `embed_batch()`에 실패 시 skip 옵션 추가 (graceful degradation)
- 반환 타입에 실패 인덱스 정보 포함 가능하도록 확장

### 4.2 DocumentProcessor 확장

**현재**: `process_text()` -> `[{"chunk_text", "embedding", "chunk_index"}]`
**변경**:
- 반환 딕셔너리에 `metadata` 필드 추가
- `metadata`: `{"token_count", "chunk_quality_score", "embedding_model", "embedding_version", "embedded_at"}`

### 4.3 TextChunker 확장

**현재**: `chunk_text()` -> `list[str]`
**변경**:
- `chunk_text_with_metadata()` 메서드 추가
- 반환: `list[{"text": str, "token_count": int}]`
- 기존 `chunk_text()` 메서드는 하위 호환 유지

### 4.4 Admin API 확장

**현재**: `POST /policies` 생성 시 동기 임베딩 처리 (실패 무시)
**변경**:
- 기존 동기 임베딩 로직 유지 (단건 처리)
- 신규 `/admin/embeddings/*` 라우터 추가 (배치/모니터링)

### 4.5 PolicyChunk 모델

**현재**: `metadata_` JSONB 컬럼 존재 (사용 미정)
**변경**:
- 기존 스키마 변경 없음 (JSONB에 새 키 추가만 필요)
- HNSW 인덱스는 Alembic 마이그레이션으로 추가

---

## 5. 참조 구현

### 기존 코드 참조

- **배치 처리 패턴**: `EmbeddingService.embed_batch()` - MAX_BATCH_SIZE=2048 분할, 지수 백오프 재시도
- **파이프라인 패턴**: `DocumentProcessor.process_text()` - clean -> chunk -> embed 순차 실행
- **벡터 검색 패턴**: `VectorSearchService._execute_search_query()` - pgvector cosine_distance 연산자 사용
- **토큰 계산**: `TextChunker._encoder.encode()` - tiktoken cl100k_base

### Celery 설정 참조

```python
# backend/app/core/celery_app.py
from celery import Celery

celery_app = Celery(
    "bodam",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
)
```
