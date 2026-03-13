---
spec_id: SPEC-DATA-001
type: plan
version: 0.1.0
created: 2026-03-13
updated: 2026-03-13
---

# SPEC-DATA-001 구현 계획

## 1. 구현 전략 개요

### 개발 방법론
- **TDD (Test-Driven Development)**: 각 모듈별 테스트 먼저 작성 후 구현
- **Bottom-Up 구축**: 데이터 모델 -> 서비스 레이어 -> API 엔드포인트 순서
- **점진적 통합**: 각 모듈 완성 후 통합 테스트 수행

### 모듈 의존성 그래프

```
[모듈 1: DB 스키마]
    |
    +---> [모듈 2: 벡터 임베딩]
    |         |
    |         +---> [모듈 3: 수집 파이프라인]
    |                    |
    +---> [모듈 4: Admin API] <---+
    |                              |
    +---> [모듈 5: 검색 API] <----+
```

- 모듈 1은 모든 모듈의 기반
- 모듈 2는 모듈 1에 의존 (PolicyChunk 모델 필요)
- 모듈 3은 모듈 1, 2에 의존 (모델 + 임베딩 서비스 필요)
- 모듈 4는 모듈 1에 의존하고, 모듈 3을 선택적으로 사용
- 모듈 5는 모듈 1, 2에 의존 (모델 + 벡터 검색 필요)

---

## 2. 마일스톤

### Primary Goal: 데이터베이스 스키마 및 마이그레이션

**태스크:**

1. **[TEST] SQLAlchemy 모델 단위 테스트 작성**
   - InsuranceCompany, Policy, Coverage, PolicyChunk 모델 테스트
   - 관계(relationship) 무결성 테스트
   - UniqueConstraint (company_id + product_code) 검증 테스트
   - InsuranceCategory enum 검증 테스트

2. **[IMPL] SQLAlchemy 모델 구현**
   - `app/models/insurance.py`: 4개 엔티티 모델 정의
   - `app/models/__init__.py`: 모델 export
   - InsuranceCategory enum 정의

3. **[IMPL] Alembic 마이그레이션 생성**
   - 4개 테이블 생성 마이그레이션
   - HNSW 벡터 인덱스 생성 마이그레이션
   - 기존 pgvector extension 마이그레이션(390ce6302c19) 이후 체이닝

4. **[IMPL] Pydantic 스키마 정의**
   - `app/schemas/insurance.py`: 요청/응답 스키마
   - Create, Update, Response 스키마 분리

**산출물:**
- `app/models/insurance.py`
- `app/schemas/insurance.py`
- `alembic/versions/xxx_create_insurance_tables.py`
- `tests/unit/test_models.py`

### Secondary Goal: 임베딩 서비스 및 시맨틱 검색

**태스크:**

5. **[TEST] 임베딩 서비스 단위 테스트 작성**
   - 텍스트 -> 벡터 변환 테스트 (OpenAI API mock)
   - 배치 임베딩 처리 테스트
   - 재시도 로직 테스트
   - 빈 텍스트/짧은 텍스트 필터링 테스트

6. **[IMPL] 임베딩 서비스 구현**
   - `app/services/rag/embeddings.py`: OpenAI 임베딩 생성 서비스
   - 배치 처리 (최대 2048개/호출)
   - 재시도 로직 (지수 백오프, 최대 3회)

7. **[TEST] 벡터 검색 서비스 단위 테스트 작성**
   - 코사인 거리 검색 테스트
   - 임계값 필터링 테스트
   - top_k 제한 테스트

8. **[IMPL] 벡터 검색 서비스 구현**
   - `app/services/rag/vector_store.py`: pgvector 기반 유사도 검색
   - 코사인 거리 연산자(`<->`) 사용
   - 메타데이터 조인 (보험사, 상품, 담보 정보)

9. **[TEST] 검색 API 통합 테스트 작성**
   - POST `/api/v1/search/semantic` 엔드포인트 테스트
   - 필터링 (company_id, category) 테스트
   - 응답 시간 검증 (< 2초)

10. **[IMPL] 검색 API 엔드포인트 구현**
    - `app/api/v1/search.py`: 시맨틱 검색 라우터

**산출물:**
- `app/services/rag/embeddings.py`
- `app/services/rag/vector_store.py`
- `app/api/v1/search.py`
- `tests/unit/test_embeddings.py`
- `tests/integration/test_vector_search.py`
- `tests/integration/test_search_api.py`

### Tertiary Goal: 데이터 수집 파이프라인

**태스크:**

11. **[TEST] PDF 파서 단위 테스트 작성**
    - PDF 텍스트 추출 테스트 (샘플 PDF fixture)
    - 헤더/푸터 제거 테스트
    - 한국어 텍스트 정규화 테스트

12. **[IMPL] PDF 파서 및 텍스트 정제 구현**
    - `app/services/parser/pdf_parser.py`: pdfplumber 기반 PDF 텍스트 추출
    - `app/services/parser/text_cleaner.py`: 텍스트 정제 (특수문자, 빈 줄, 헤더/푸터)

13. **[TEST] 텍스트 청킹 단위 테스트 작성**
    - 500 토큰 청킹 테스트 (tiktoken)
    - 100 토큰 오버랩 검증
    - 최소 청크 크기(50자) 필터링 테스트
    - 한국어 텍스트 청킹 테스트

14. **[IMPL] 텍스트 청킹 서비스 구현**
    - `app/services/parser/text_chunker.py`: tiktoken 기반 토큰 단위 청킹

15. **[TEST] 문서 처리 파이프라인 통합 테스트 작성**
    - 전체 파이프라인 (PDF -> 텍스트 -> 청킹 -> 임베딩 -> 저장) 테스트
    - 약관 업데이트 시 기존 청크 교체 테스트
    - 에러 핸들링 (API 실패, 빈 문서) 테스트

16. **[IMPL] 문서 처리 파이프라인 통합 서비스 구현**
    - `app/services/parser/document_processor.py`: 전체 파이프라인 오케스트레이션

**산출물:**
- `app/services/parser/pdf_parser.py`
- `app/services/parser/text_cleaner.py`
- `app/services/parser/text_chunker.py`
- `app/services/parser/document_processor.py`
- `tests/unit/test_pdf_parser.py`
- `tests/unit/test_text_cleaner.py`
- `tests/unit/test_text_chunker.py`
- `tests/integration/test_ingestion.py`

### Final Goal: Admin API

**태스크:**

17. **[TEST] Admin API 통합 테스트 작성**
    - 보험사 CRUD 테스트
    - 보험 상품 CRUD 테스트 (약관 텍스트 포함 등록 시 자동 임베딩)
    - 담보 CRUD 테스트
    - 필터링 (company_id, category, is_discontinued) 테스트
    - 약관 문서 수집 엔드포인트 테스트

18. **[IMPL] Admin API 엔드포인트 구현**
    - `app/api/v1/admin/companies.py`: 보험사 CRUD
    - `app/api/v1/admin/policies.py`: 상품 CRUD + 수집 트리거
    - `app/api/v1/admin/coverages.py`: 담보 CRUD

19. **[IMPL] main.py 라우터 등록**
    - Admin 라우터 및 Search 라우터를 FastAPI 앱에 등록

**산출물:**
- `app/api/v1/admin/companies.py`
- `app/api/v1/admin/policies.py`
- `app/api/v1/admin/coverages.py`
- `app/api/v1/admin/__init__.py`
- `tests/integration/test_admin_api.py`

---

## 3. 기술 제약 및 라이브러리 버전

### 기존 의존성 (변경 없음)
| 라이브러리 | 버전 | 용도 |
|-----------|------|------|
| FastAPI | >=0.135.0,<0.136.0 | 웹 프레임워크 |
| SQLAlchemy | >=2.0.0 | 비동기 ORM |
| asyncpg | >=0.30.0 | PostgreSQL 비동기 드라이버 |
| Alembic | >=1.14.0 | 마이그레이션 |
| Pydantic | >=2.12.0,<2.13.0 | 데이터 검증 |
| pgvector | >=0.3.6 | 벡터 확장 |
| pytest | >=8.3.0 | 테스팅 |

### 신규 의존성 (추가 필요)
| 라이브러리 | 버전 | 용도 |
|-----------|------|------|
| openai | >=1.60.0 | 임베딩 API 호출 |
| tiktoken | >=0.8.0 | 토큰 카운팅 (청킹용) |
| pdfplumber | >=0.11.0 | PDF 텍스트 추출 |

### 선택적 의존성 (Phase 2 이후)
| 라이브러리 | 버전 | 용도 |
|-----------|------|------|
| langchain | >=0.3.0 | RAG 체인 오케스트레이션 |
| langchain-openai | >=0.3.0 | LangChain OpenAI 통합 |

### 환경변수 (추가 필요)
| 변수명 | 설명 | 기본값 |
|--------|------|--------|
| `OPENAI_API_KEY` | OpenAI API 키 | (필수, 기본값 없음) |
| `EMBEDDING_MODEL` | 임베딩 모델명 | `text-embedding-3-small` |
| `EMBEDDING_DIMENSIONS` | 임베딩 차원 수 | `1536` |
| `CHUNK_SIZE_TOKENS` | 청크 크기 (토큰) | `500` |
| `CHUNK_OVERLAP_TOKENS` | 청크 오버랩 (토큰) | `100` |

---

## 4. 아키텍처 설계 방향

### 디렉토리 구조 (신규 파일)

```
backend/app/
├── models/
│   ├── __init__.py          # 모델 export (수정)
│   └── insurance.py         # 신규: 보험 관련 4개 모델
├── schemas/
│   └── insurance.py         # 신규: Pydantic 스키마
├── services/
│   ├── rag/
│   │   ├── __init__.py
│   │   ├── embeddings.py    # 신규: 임베딩 생성 서비스
│   │   └── vector_store.py  # 신규: 벡터 유사도 검색
│   └── parser/
│       ├── __init__.py
│       ├── pdf_parser.py    # 신규: PDF 텍스트 추출
│       ├── text_cleaner.py  # 신규: 텍스트 정제
│       ├── text_chunker.py  # 신규: 토큰 기반 청킹
│       └── document_processor.py  # 신규: 파이프라인 통합
├── api/v1/
│   ├── admin/
│   │   ├── __init__.py
│   │   ├── companies.py     # 신규: 보험사 CRUD
│   │   ├── policies.py      # 신규: 상품 CRUD + 수집
│   │   └── coverages.py     # 신규: 담보 CRUD
│   └── search.py            # 신규: 시맨틱 검색
└── core/
    └── config.py             # 수정: 임베딩 관련 설정 추가
```

### 레이어 분리 원칙

```
[API Layer] -- 요청 검증, 라우팅, 응답 포맷팅
    |
[Service Layer] -- 비즈니스 로직, 외부 API 통합
    |
[Model Layer] -- 데이터 모델, 데이터베이스 접근
```

- API 레이어는 Service를 호출하며, 직접 DB 쿼리를 실행하지 않는다
- Service 레이어는 모델을 통해 데이터에 접근하며, 외부 API(OpenAI)를 호출한다
- Model 레이어는 순수 데이터 정의와 관계만 포함한다

---

## 5. 리스크 분석

### 기술 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| OpenAI API 장애 또는 속도 제한 | 임베딩 생성 실패 | 재시도 로직(3회) + 실패 상태 기록 + 비동기 재처리 |
| 대량 임베딩 생성 시 API 비용 초과 | 예산 초과 | 배치 처리 최적화 + 사용량 모니터링 + 일일 한도 설정 |
| PDF 파서 한국어 추출 품질 | 약관 텍스트 누락/깨짐 | pdfplumber + 대안 파서(PyMuPDF) fallback 고려 |
| pgvector HNSW 인덱스 빌드 시간 | 대량 데이터 시 느린 인덱스 | 초기 데이터 로드 후 인덱스 생성, ef_construction 파라미터 조정 |
| 토큰 카운팅(tiktoken) 한국어 정확도 | 청크 크기 불균일 | 한국어 텍스트로 실측 검증 후 청크 크기 조정 |

### 비즈니스 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| 약관 데이터 저작권 문제 | 법적 분쟁 | 공개된 약관 자료만 사용, 법률 자문 확보 |
| 약관 텍스트 구조 비표준화 | 파싱 어려움 | 보험사별 파서 어댑터 패턴 적용 |
| Phase 1 데이터 수집 인력 부족 | MVP 일정 지연 | 상위 3개 보험사부터 시작, 점진적 확장 |

---

## 6. 테스트 전략

### 테스트 피라미드

```
         /  E2E (검색 API 전체 흐름)  \
        /    Integration (DB + API)    \
       /       Unit (모델, 서비스)       \
```

### 테스트 커버리지 목표
- 전체: 85% 이상
- 모델 레이어: 95% 이상
- 서비스 레이어: 85% 이상
- API 레이어: 80% 이상

### 테스트 Fixture 전략
- **보험사 Fixture**: 테스트용 보험사 3개 (삼성생명, 현대해상, DB손해보험)
- **상품 Fixture**: 보험사당 2-3개 상품
- **담보 Fixture**: 상품당 3-5개 담보
- **PDF Fixture**: 테스트용 약관 PDF 파일 (10페이지 미만)
- **임베딩 Mock**: OpenAI API mock으로 고정 벡터 반환

### 외부 API 테스트 전략
- **단위 테스트**: OpenAI API는 mock 사용 (고정 벡터 반환)
- **통합 테스트**: 실제 API 호출은 CI에서만 실행 (`@pytest.mark.external` 마커)
- **DB 테스트**: Docker PostgreSQL 사용 (pgvector 포함)
