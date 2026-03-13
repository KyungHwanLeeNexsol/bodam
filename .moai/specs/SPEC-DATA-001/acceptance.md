---
spec_id: SPEC-DATA-001
type: acceptance
version: 0.1.0
created: 2026-03-13
updated: 2026-03-13
---

# SPEC-DATA-001 인수 기준

## 모듈 1: 데이터베이스 스키마

### AC-1.1: 보험사 모델 CRUD 동작

```gherkin
Given 데이터베이스에 보험사 테이블이 존재할 때
When 이름 "삼성생명", 코드 "samsung-life"인 보험사를 생성하면
Then 보험사 레코드가 UUID id와 함께 저장된다
And created_at, updated_at 타임스탬프가 자동 설정된다
And is_active 기본값이 True이다
```

### AC-1.2: 보험 상품 코드 중복 방지

```gherkin
Given 보험사 "삼성생명"에 상품코드 "SL-2024-001"인 상품이 존재할 때
When 동일 보험사에 같은 상품코드 "SL-2024-001"로 새 상품을 등록하면
Then IntegrityError가 발생한다
And 상품은 생성되지 않는다
```

### AC-1.3: 보험 상품-보험사 외래 키 관계

```gherkin
Given 보험사 "삼성생명"이 등록되어 있을 때
When 해당 보험사에 보험 상품 "무배당 삼성 건강보험"을 등록하면
Then 상품의 company_id가 삼성생명의 id로 설정된다
And policy.company 관계를 통해 보험사 정보에 접근 가능하다
```

### AC-1.4: 보험사 삭제 시 연쇄 삭제

```gherkin
Given 보험사 "삼성생명"에 2개의 상품과 각 상품에 3개의 담보가 존재할 때
When 보험사 "삼성생명"을 삭제하면
Then 연관된 모든 상품이 함께 삭제된다
And 연관된 모든 담보가 함께 삭제된다
And 연관된 모든 약관 청크가 함께 삭제된다
```

### AC-1.5: InsuranceCategory enum 검증

```gherkin
Given InsuranceCategory enum이 정의되어 있을 때
When 상품을 카테고리 "life"로 생성하면
Then InsuranceCategory.LIFE로 저장된다
And 카테고리 "invalid_category"로 생성을 시도하면 검증 에러가 발생한다
```

---

## 모듈 2: 벡터 임베딩 및 저장

### AC-2.1: 텍스트 임베딩 생성

```gherkin
Given OpenAI API 키가 설정되어 있을 때
When "인공관절 수술은 실손보험에서 보상됩니다"라는 텍스트로 임베딩을 요청하면
Then 1536차원의 float 배열이 반환된다
And 배열의 모든 값은 -1.0에서 1.0 사이이다
```

### AC-2.2: 배치 임베딩 처리

```gherkin
Given 100개의 텍스트 청크가 준비되어 있을 때
When 배치 임베딩 생성을 실행하면
Then 100개의 임베딩 벡터가 모두 생성된다
And API 호출은 최적화된 배치 크기(최대 2048개)로 처리된다
```

### AC-2.3: 임베딩 API 재시도

```gherkin
Given OpenAI API가 일시적으로 RateLimitError를 반환할 때
When 임베딩 생성을 요청하면
Then 시스템은 지수 백오프로 최대 3회 재시도한다
And 3회 모두 실패하면 예외를 발생시킨다
```

### AC-2.4: 빈 텍스트 필터링

```gherkin
Given 빈 문자열 또는 50자 미만의 텍스트 청크가 전달될 때
When 임베딩 생성을 시도하면
Then 해당 청크는 임베딩되지 않고 건너뛴다
And 유효한 청크만 처리된다
```

---

## 모듈 3: 데이터 수집 파이프라인

### AC-3.1: PDF 텍스트 추출

```gherkin
Given 10페이지 분량의 한국어 보험 약관 PDF 파일이 업로드될 때
When PDF 파서가 텍스트를 추출하면
Then 모든 페이지의 본문 텍스트가 추출된다
And 페이지 번호, 머리글, 꼬리글은 제거된다
And 한국어 텍스트가 깨지지 않고 정상 출력된다
```

### AC-3.2: 텍스트 청킹 (토큰 기반)

```gherkin
Given 5000 토큰 분량의 약관 텍스트가 준비되어 있을 때
When 500 토큰 단위, 100 토큰 오버랩으로 청킹하면
Then 약 12개의 청크가 생성된다 (오버랩 고려)
And 각 청크는 400~550 토큰 범위 내이다
And 연속된 청크 간 100 토큰의 텍스트가 중복된다
And 50자 미만의 마지막 청크는 이전 청크에 병합되거나 폐기된다
```

### AC-3.3: 전체 수집 파이프라인

```gherkin
Given 보험 상품 "무배당 건강보험"이 등록되어 있고
And 약관 PDF 파일이 준비되어 있을 때
When 수집 파이프라인을 실행하면
Then PDF에서 텍스트가 추출되고
And 텍스트가 정제되고
And ~500 토큰 단위로 청킹되고
And 각 청크에 대해 임베딩이 생성되고
And PolicyChunk 레코드가 데이터베이스에 저장된다
And 각 청크에 policy_id와 chunk_index가 올바르게 설정된다
```

### AC-3.4: 약관 텍스트 업데이트 시 재처리

```gherkin
Given 보험 상품 "무배당 건강보험"에 기존 20개의 청크가 존재할 때
When 관리자가 새로운 약관 텍스트로 업데이트하면
Then 기존 20개의 청크가 모두 삭제되고
And 새로운 약관 텍스트에서 청크가 재생성되고
And 새로운 임베딩이 생성되어 저장된다
```

---

## 모듈 4: Admin API

### AC-4.1: 보험사 CRUD API

```gherkin
Given Admin API가 정상 작동할 때

When POST /api/v1/admin/companies 로 보험사를 생성하면
Then 201 상태코드와 생성된 보험사 정보가 반환된다

When GET /api/v1/admin/companies 로 목록을 조회하면
Then 200 상태코드와 보험사 목록이 반환된다

When GET /api/v1/admin/companies/{id} 로 상세 조회하면
Then 200 상태코드와 해당 보험사 정보가 반환된다

When PUT /api/v1/admin/companies/{id} 로 보험사를 수정하면
Then 200 상태코드와 수정된 보험사 정보가 반환된다

When DELETE /api/v1/admin/companies/{id} 로 보험사를 삭제하면
Then 204 상태코드가 반환된다
```

### AC-4.2: 보험 상품 등록 시 자동 임베딩

```gherkin
Given 보험사 "삼성생명"이 존재할 때
When POST /api/v1/admin/policies 로 raw_text를 포함하여 상품을 등록하면
Then 상품 레코드가 생성되고
And raw_text가 자동으로 청킹되고
And 각 청크에 임베딩이 생성되고
And PolicyChunk 레코드가 데이터베이스에 저장된다
And 201 상태코드와 생성된 상품 정보가 반환된다
```

### AC-4.3: 보험 상품 필터링 조회

```gherkin
Given 3개 보험사에 각 2개의 상품이 등록되어 있고
And 1개 상품은 is_discontinued=True 일 때

When GET /api/v1/admin/policies?company_id={id} 로 특정 보험사의 상품을 조회하면
Then 해당 보험사의 상품만 반환된다

When GET /api/v1/admin/policies?category=life 로 조회하면
Then 생명보험 카테고리 상품만 반환된다

When GET /api/v1/admin/policies?is_discontinued=true 로 조회하면
Then 판매 중단 상품만 반환된다
```

### AC-4.4: 담보 CRUD API

```gherkin
Given 보험 상품 "무배당 건강보험"이 존재할 때
When POST /api/v1/admin/policies/{id}/coverages 로 담보를 등록하면
Then 담보 레코드가 생성되고
And 담보명, 보장 유형, 면책사항, 보상 규칙, 최대 보상 금액이 저장된다
And 201 상태코드와 생성된 담보 정보가 반환된다
```

---

## 모듈 5: 시맨틱 검색 API

### AC-5.1: 자연어 시맨틱 검색

```gherkin
Given 여러 보험 상품의 약관 청크와 임베딩이 데이터베이스에 존재할 때
When POST /api/v1/search/semantic 으로 "인공관절 수술 보험 보상"을 검색하면
Then 코사인 거리가 가장 가까운 상위 5개 결과가 반환된다
And 각 결과에 chunk_text, distance, policy_name, company_name이 포함된다
And 결과는 distance 오름차순으로 정렬된다
```

### AC-5.2: 검색 결과 임계값 필터링

```gherkin
Given 시맨틱 검색 요청에 threshold=0.5 가 설정되어 있을 때
When 검색을 실행하면
Then 코사인 거리가 0.5 이하인 결과만 반환된다
And 0.5를 초과하는 결과는 제외된다
```

### AC-5.3: 검색 필터 적용

```gherkin
Given 3개 보험사의 약관 데이터가 존재할 때
When company_id 필터를 적용하여 시맨틱 검색을 실행하면
Then 해당 보험사의 약관 청크에서만 검색 결과가 반환된다

When category="life" 필터를 적용하여 검색하면
Then 생명보험 상품의 약관 청크에서만 검색 결과가 반환된다
```

### AC-5.4: 검색 응답 시간

```gherkin
Given 100,000개의 벡터 청크가 HNSW 인덱스와 함께 존재할 때
When 시맨틱 검색을 실행하면
Then 응답 시간이 2초 이내이다
```

---

## 엣지 케이스 테스트

### EC-1: 빈 데이터베이스에서의 검색

```gherkin
Given 데이터베이스에 아무 데이터도 없을 때
When 시맨틱 검색을 실행하면
Then 빈 결과 목록과 total_results=0이 반환된다
And 에러가 발생하지 않는다
```

### EC-2: 매우 긴 약관 텍스트 처리

```gherkin
Given 100,000자 이상의 약관 텍스트가 입력될 때
When 수집 파이프라인을 실행하면
Then 텍스트가 정상적으로 청킹되고
And 모든 청크에 임베딩이 생성되고
And 메모리 에러 없이 완료된다
```

### EC-3: 특수문자가 포함된 약관 텍스트

```gherkin
Given 약관 텍스트에 표, 괄호, 특수 기호(※, ▶, ◆)가 포함될 때
When 텍스트 정제 및 청킹을 실행하면
Then 특수문자가 정규화되거나 유지되되 파싱 에러가 발생하지 않는다
And 한국어 텍스트의 의미가 보존된다
```

### EC-4: 존재하지 않는 보험사/상품 참조

```gherkin
Given 존재하지 않는 UUID로 보험사를 조회할 때
When GET /api/v1/admin/companies/{non_existent_id} 를 요청하면
Then 404 상태코드가 반환된다
And 적절한 에러 메시지가 포함된다
```

### EC-5: 동시 약관 업데이트

```gherkin
Given 같은 상품에 대해 두 개의 약관 업데이트 요청이 동시에 발생할 때
When 두 요청이 모두 처리되면
Then 하나의 요청만 성공하거나 순차적으로 처리된다
And 데이터 정합성이 유지된다
And 청크가 중복 생성되지 않는다
```

### EC-6: OpenAI API 키 미설정

```gherkin
Given OPENAI_API_KEY 환경변수가 설정되지 않은 상태에서
When 임베딩 생성이 필요한 작업을 시도하면
Then 명확한 설정 에러 메시지가 반환된다
And 애플리케이션이 크래시하지 않는다
```

---

## 품질 게이트 기준

### 테스트 커버리지
- 전체 코드 커버리지: 85% 이상
- 모델 레이어: 95% 이상
- 서비스 레이어: 85% 이상
- API 레이어: 80% 이상

### 코드 품질
- `ruff check` 경고 0건
- `ruff format --check` 통과
- 모든 public 함수에 type hint 적용
- 모든 public 함수에 docstring 작성

### 성능 기준
- 시맨틱 검색 응답 시간: < 2초 (100K 벡터 기준)
- 단일 문서 수집 파이프라인: < 30초 (100페이지 PDF 기준)
- Admin API 응답 시간: < 500ms

### 보안 기준
- SQL injection 방지 (SQLAlchemy ORM 사용)
- 입력 검증 (Pydantic 스키마)
- API 키 환경변수 관리 (코드에 하드코딩 금지)

---

## Definition of Done

SPEC-DATA-001은 다음 조건이 모두 충족될 때 완료로 간주한다:

1. 4개 SQLAlchemy 모델이 정의되고 Alembic 마이그레이션이 생성되었다
2. HNSW 벡터 인덱스가 생성되었다
3. 임베딩 서비스가 구현되고 단위 테스트를 통과한다
4. 데이터 수집 파이프라인(PDF -> 텍스트 -> 청킹 -> 임베딩 -> 저장)이 구현되었다
5. Admin CRUD API가 구현되고 통합 테스트를 통과한다
6. 시맨틱 검색 API가 구현되고 통합 테스트를 통과한다
7. 전체 테스트 커버리지가 85% 이상이다
8. `ruff check` 및 `ruff format --check`를 통과한다
9. 모든 신규 의존성이 pyproject.toml에 추가되었다
10. Settings 클래스에 임베딩 관련 설정이 추가되었다
