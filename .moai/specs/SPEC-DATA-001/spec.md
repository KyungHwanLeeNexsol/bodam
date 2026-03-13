---
id: SPEC-DATA-001
version: 0.1.0
status: draft
created: 2026-03-13
updated: 2026-03-13
author: zuge3
priority: high
issue_number: 0
tags: [data, database, rag, pgvector, insurance, policy]
---

# SPEC-DATA-001: 보험 약관 지식 베이스 데이터 레이어

## 1. 환경 (Environment)

### 1.1 프로젝트 컨텍스트

Bodam(보담)은 AI 기반 한국 보험 보상 안내 플랫폼이다. 본 SPEC은 보험 약관 지식 베이스의 **데이터 레이어**를 정의한다. 이 데이터 레이어는 보험사, 보험 상품, 담보(Coverage), 약관 텍스트를 구조화하여 저장하고, RAG 파이프라인을 위한 벡터 임베딩 및 시맨틱 검색 기능을 제공한다.

### 1.2 기존 인프라

SPEC-INFRA-001에서 구축 완료된 인프라:

- **Backend**: FastAPI 0.135.x, Python 3.13, SQLAlchemy 2.x async (asyncpg)
- **Database**: PostgreSQL 18 + pgvector 0.8.2 (extension 활성화 마이그레이션 완료)
- **Cache**: Redis 7-alpine
- **Migration**: Alembic (첫 번째 마이그레이션 `390ce6302c19` 존재)
- **Testing**: pytest + pytest-asyncio
- **패키지**: pgvector>=0.3.6 이미 pyproject.toml에 포함

### 1.3 도메인 용어 정의

| 한국어 | 영어 | 설명 |
|--------|------|------|
| 보험사 | Insurance Company | 보험 상품을 판매하는 회사 |
| 보험 상품 | Insurance Policy/Product | 특정 보험 계약의 상품 단위 |
| 담보 | Coverage/Guarantee | 보험 상품 내 개별 보장 항목 |
| 약관 | Policy Terms | 보험 계약의 법적 조건 문서 |
| 보험금 | Insurance Benefit | 보상/지급 금액 |
| 피보험자 | Insured Person | 보험의 보호 대상자 |
| 보험계약자 | Policyholder | 보험 계약의 당사자 |
| 면책조항 | Exclusion Clause | 보상하지 않는 사유 |
| 감액기간 | Reduction Period | 보험금이 감액되는 기간 |
| 보험 종류 | Insurance Category | 생명보험, 손해보험, 제3보험 |

### 1.4 보험 분류 체계

```
보험 종류 (InsuranceCategory):
  - LIFE (생명보험): 사망, 연금, 저축 등
  - NON_LIFE (손해보험): 자동차, 화재, 배상책임 등
  - THIRD_SECTOR (제3보험): 상해, 질병, 간병 등
```

---

## 2. 가정 (Assumptions)

### 2.1 기술 가정

- PostgreSQL 18 + pgvector 0.8.2가 정상 작동하며 HNSW 인덱스를 지원한다
- text-embedding-3-small 모델은 1536차원 벡터를 생성하며, API가 안정적으로 사용 가능하다
- 약관 텍스트는 ~500 토큰 단위 청킹 + 100 토큰 오버랩으로 RAG 검색 품질이 충분하다
- Phase 1 데이터 볼륨: 상위 10개 보험사, ~200개 상품, ~2,000개 담보, ~100K 벡터 청크

### 2.2 비즈니스 가정

- Phase 1에서는 수동으로 수집된 약관 PDF/텍스트를 입력한다 (자동 크롤러 미포함)
- Admin API는 내부 관리자만 사용하며, 별도의 인증은 SPEC-AUTH-001에서 처리한다
- 보험사 정보는 비교적 정적이며, 상품/담보 정보가 주로 업데이트된다

### 2.3 스코프 제한

- **포함**: 데이터베이스 스키마, 벡터 임베딩, 데이터 수집 파이프라인, Admin CRUD API, 시맨틱 검색 API
- **제외**: 챗 인터페이스(SPEC-CHAT-001), LLM 응답 생성(SPEC-CHAT-001), 사용자 인증(SPEC-AUTH-001), 웹 크롤러(향후 SPEC), 프론트엔드 UI(향후 SPEC)

---

## 3. 요구사항 (Requirements)

### 모듈 1: 데이터베이스 스키마 (Database Schema)

**REQ-DATA-001** [Ubiquitous]
시스템은 **항상** 보험사(InsuranceCompany), 보험 상품(Policy), 담보(Coverage), 약관 청크(PolicyChunk) 엔티티를 관계형 데이터베이스에 저장해야 한다.

**REQ-DATA-002** [Event-Driven]
**WHEN** 새로운 보험 상품이 등록될 때, **THEN** 해당 상품은 반드시 하나의 보험사(company_id)에 연결되어야 한다.

**REQ-DATA-003** [Event-Driven]
**WHEN** 새로운 담보가 등록될 때, **THEN** 해당 담보는 반드시 하나의 보험 상품(policy_id)에 연결되어야 한다.

**REQ-DATA-004** [State-Driven]
**IF** 보험 상품의 `is_discontinued`가 True인 경우, **THEN** 해당 상품은 검색 결과에 포함되되 "판매 중단" 표시가 되어야 한다.

**REQ-DATA-005** [Unwanted]
시스템은 동일한 보험사 내에서 중복된 `product_code`를 가진 상품을 생성**하지 않아야 한다**.

### 모듈 2: 벡터 임베딩 및 저장 (Vector Embeddings)

**REQ-DATA-010** [Ubiquitous]
시스템은 **항상** 약관 텍스트 청크를 text-embedding-3-small 모델을 사용하여 1536차원 벡터로 변환해야 한다.

**REQ-DATA-011** [Event-Driven]
**WHEN** 새로운 약관 텍스트가 저장될 때, **THEN** 해당 텍스트는 ~500 토큰 청크로 분할되고 각 청크에 임베딩이 생성되어야 한다.

**REQ-DATA-012** [Ubiquitous]
시스템은 **항상** pgvector의 HNSW 인덱스를 사용하여 벡터 유사도 검색 성능을 보장해야 한다.

**REQ-DATA-013** [Event-Driven]
**WHEN** 기존 약관 텍스트가 업데이트될 때, **THEN** 해당 상품의 기존 청크는 삭제되고 새로운 청크와 임베딩이 재생성되어야 한다.

### 모듈 3: 데이터 수집 파이프라인 (Data Ingestion Pipeline)

**REQ-DATA-020** [Event-Driven]
**WHEN** PDF 또는 텍스트 형식의 약관 문서가 업로드될 때, **THEN** 시스템은 텍스트 추출, 정제, 청킹, 임베딩 생성의 파이프라인을 실행해야 한다.

**REQ-DATA-021** [State-Driven]
**IF** 업로드된 문서가 PDF 형식인 경우, **THEN** 시스템은 PDF에서 텍스트를 추출하고 불필요한 헤더/푸터/페이지 번호를 정제해야 한다.

**REQ-DATA-022** [Unwanted]
시스템은 비어있는 텍스트 또는 의미 없는 짧은 청크(50자 미만)를 임베딩**하지 않아야 한다**.

**REQ-DATA-023** [State-Driven]
**IF** 임베딩 생성 API 호출이 실패한 경우, **THEN** 시스템은 최대 3회 재시도 후 실패 상태를 기록해야 한다.

### 모듈 4: Admin API (관리자 CRUD)

**REQ-DATA-030** [Event-Driven]
**WHEN** 관리자가 보험사 정보를 생성/조회/수정/삭제 요청할 때, **THEN** 시스템은 RESTful CRUD 엔드포인트를 통해 처리해야 한다.

**REQ-DATA-031** [Event-Driven]
**WHEN** 관리자가 보험 상품을 등록할 때, **THEN** 시스템은 상품 정보를 저장하고, 약관 원문 텍스트가 포함된 경우 자동으로 청킹 및 임베딩을 생성해야 한다.

**REQ-DATA-032** [Event-Driven]
**WHEN** 관리자가 담보 정보를 등록할 때, **THEN** 시스템은 담보의 보장 범위, 면책사항, 보상 규칙을 구조화하여 저장해야 한다.

**REQ-DATA-033** [Optional]
**가능하면** 관리자 API는 보험 상품 목록 조회 시 보험사별, 카테고리별 필터링 기능을 제공해야 한다.

### 모듈 5: 시맨틱 검색 API (Semantic Search)

**REQ-DATA-040** [Event-Driven]
**WHEN** 사용자가 자연어 검색 쿼리를 제출할 때, **THEN** 시스템은 쿼리를 임베딩으로 변환하고 pgvector 코사인 거리 연산자(`<->`)를 사용하여 유사한 약관 청크를 반환해야 한다.

**REQ-DATA-041** [State-Driven]
**IF** 검색 결과의 코사인 거리가 임계값(기본값: 0.8)을 초과하는 경우, **THEN** 해당 결과는 관련성이 낮으므로 제외해야 한다.

**REQ-DATA-042** [Optional]
**가능하면** 시맨틱 검색 결과에 보험사명, 상품명, 담보명 등의 메타데이터를 함께 반환해야 한다.

**REQ-DATA-043** [Unwanted]
시스템은 검색 API 응답 시간이 2초를 초과**하지 않아야 한다**.

---

## 4. 명세 (Specifications)

### 4.1 데이터베이스 모델 설계

#### InsuranceCompany (보험사)

```python
class InsuranceCompany(Base):
    __tablename__ = "insurance_companies"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False, comment="보험사 이름")
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, comment="고유 코드 (e.g., samsung-life)")
    logo_url: Mapped[str | None] = mapped_column(String(500), comment="로고 이미지 URL")
    website_url: Mapped[str | None] = mapped_column(String(500), comment="공식 웹사이트 URL")
    is_active: Mapped[bool] = mapped_column(default=True, comment="활성 상태")
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB, comment="추가 메타데이터")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())

    # 관계
    policies: Mapped[list["Policy"]] = relationship(back_populates="company", cascade="all, delete-orphan")
```

#### Policy (보험 상품)

```python
class InsuranceCategory(str, Enum):
    LIFE = "life"               # 생명보험
    NON_LIFE = "non_life"       # 손해보험
    THIRD_SECTOR = "third_sector"  # 제3보험

class Policy(Base):
    __tablename__ = "policies"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("insurance_companies.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(300), nullable=False, comment="상품명")
    product_code: Mapped[str] = mapped_column(String(100), nullable=False, comment="상품 코드")
    category: Mapped[InsuranceCategory] = mapped_column(comment="보험 종류")
    effective_date: Mapped[date | None] = mapped_column(comment="시행일")
    expiry_date: Mapped[date | None] = mapped_column(comment="만료일")
    is_discontinued: Mapped[bool] = mapped_column(default=False, comment="판매 중단 여부")
    raw_text: Mapped[str | None] = mapped_column(Text, comment="약관 원문 텍스트")
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB, comment="추가 메타데이터")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())

    # 유니크 제약조건: 같은 보험사 내 상품코드 중복 방지
    __table_args__ = (
        UniqueConstraint("company_id", "product_code", name="uq_company_product_code"),
    )

    # 관계
    company: Mapped["InsuranceCompany"] = relationship(back_populates="policies")
    coverages: Mapped[list["Coverage"]] = relationship(back_populates="policy", cascade="all, delete-orphan")
    chunks: Mapped[list["PolicyChunk"]] = relationship(back_populates="policy", cascade="all, delete-orphan")
```

#### Coverage (담보)

```python
class Coverage(Base):
    __tablename__ = "coverages"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    policy_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("policies.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(300), nullable=False, comment="담보명")
    coverage_type: Mapped[str | None] = mapped_column(String(100), comment="담보 유형 (e.g., 수술, 진단, 입원)")
    eligibility_criteria: Mapped[str | None] = mapped_column(Text, comment="가입 자격 조건")
    exclusions: Mapped[str | None] = mapped_column(Text, comment="면책사항")
    compensation_rules: Mapped[str | None] = mapped_column(Text, comment="보상 규칙")
    max_amount: Mapped[int | None] = mapped_column(BigInteger, comment="최대 보상 금액 (원)")
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB, comment="추가 메타데이터")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())

    # 관계
    policy: Mapped["Policy"] = relationship(back_populates="coverages")
    chunks: Mapped[list["PolicyChunk"]] = relationship(back_populates="coverage")
```

#### PolicyChunk (약관 텍스트 청크 + 벡터)

```python
from pgvector.sqlalchemy import Vector

class PolicyChunk(Base):
    __tablename__ = "policy_chunks"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    policy_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("policies.id"), nullable=False)
    coverage_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("coverages.id"), nullable=True)
    chunk_text: Mapped[str] = mapped_column(Text, nullable=False, comment="청크 텍스트")
    chunk_index: Mapped[int] = mapped_column(nullable=False, comment="청크 순서 인덱스")
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1536), comment="벡터 임베딩 (1536차원)")
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB, comment="추가 메타데이터")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
```

#### HNSW 인덱스 (Alembic 마이그레이션)

```sql
-- HNSW 인덱스 생성 (코사인 거리 기반)
CREATE INDEX idx_policy_chunks_embedding
ON policy_chunks
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

### 4.2 API 엔드포인트 설계

#### Admin API (`/api/v1/admin/`)

| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/admin/companies` | 보험사 생성 |
| GET | `/admin/companies` | 보험사 목록 조회 |
| GET | `/admin/companies/{id}` | 보험사 상세 조회 |
| PUT | `/admin/companies/{id}` | 보험사 수정 |
| DELETE | `/admin/companies/{id}` | 보험사 삭제 |
| POST | `/admin/policies` | 보험 상품 등록 (약관 텍스트 포함 시 자동 임베딩) |
| GET | `/admin/policies` | 상품 목록 조회 (필터: company_id, category, is_discontinued) |
| GET | `/admin/policies/{id}` | 상품 상세 조회 (담보 포함) |
| PUT | `/admin/policies/{id}` | 상품 수정 |
| DELETE | `/admin/policies/{id}` | 상품 삭제 (관련 청크 연쇄 삭제) |
| POST | `/admin/policies/{id}/coverages` | 담보 등록 |
| GET | `/admin/policies/{id}/coverages` | 담보 목록 조회 |
| PUT | `/admin/coverages/{id}` | 담보 수정 |
| DELETE | `/admin/coverages/{id}` | 담보 삭제 |
| POST | `/admin/policies/{id}/ingest` | 약관 문서 수집 (PDF/텍스트 업로드 후 파이프라인 실행) |

#### Search API (`/api/v1/search/`)

| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/search/semantic` | 시맨틱 검색 (자연어 쿼리 -> 벡터 유사도 검색) |

#### 시맨틱 검색 요청/응답 스키마

```python
# 요청
class SemanticSearchRequest(BaseModel):
    query: str = Field(..., min_length=2, max_length=500, description="검색 쿼리")
    top_k: int = Field(default=5, ge=1, le=20, description="반환할 결과 수")
    threshold: float = Field(default=0.8, ge=0.0, le=1.0, description="최대 코사인 거리 임계값")
    company_id: uuid.UUID | None = Field(default=None, description="보험사 필터")
    category: InsuranceCategory | None = Field(default=None, description="보험 종류 필터")

# 응답
class SearchResult(BaseModel):
    chunk_id: uuid.UUID
    chunk_text: str
    distance: float
    policy_name: str
    company_name: str
    coverage_name: str | None
    policy_id: uuid.UUID
    is_discontinued: bool

class SemanticSearchResponse(BaseModel):
    results: list[SearchResult]
    query: str
    total_results: int
```

### 4.3 데이터 수집 파이프라인 설계

```
[PDF/Text 입력]
    |
    v
[1. 텍스트 추출] -- PDF: PyPDF2/pdfplumber, Text: 직접 사용
    |
    v
[2. 텍스트 정제] -- 헤더/푸터 제거, 특수문자 정규화, 빈 줄 정리
    |
    v
[3. 텍스트 청킹] -- ~500 토큰, 100 토큰 오버랩, tiktoken으로 토큰 카운팅
    |
    v
[4. 임베딩 생성] -- OpenAI text-embedding-3-small API (배치 처리)
    |
    v
[5. DB 저장] -- PolicyChunk 레코드 생성 (chunk_text + embedding)
```

### 4.4 텍스트 청킹 전략

- **청크 크기**: ~500 토큰 (tiktoken `cl100k_base` 인코더 기준)
- **오버랩**: 100 토큰 (문맥 연속성 보장)
- **최소 청크 크기**: 50자 (미만인 경우 이전 청크에 병합 또는 폐기)
- **메타데이터**: 각 청크에 `chunk_index`, `policy_id`, `coverage_id`(해당 시) 부여

### 4.5 임베딩 처리 전략

- **모델**: OpenAI text-embedding-3-small (1536차원, $0.02/MTok)
- **배치 처리**: API 호출 당 최대 2048개 텍스트 (OpenAI 제한)
- **재시도**: 실패 시 최대 3회 재시도 (지수 백오프)
- **환경변수**: `OPENAI_API_KEY`를 통해 API 키 관리

### 4.6 추가 의존성 (pyproject.toml에 추가 필요)

```toml
# 기존 의존성에 추가
"openai>=1.60.0",        # 임베딩 API
"tiktoken>=0.8.0",       # 토큰 카운팅
"pdfplumber>=0.11.0",    # PDF 텍스트 추출
"langchain>=0.3.0",      # RAG 파이프라인 오케스트레이션 (선택)
"langchain-openai>=0.3.0", # LangChain OpenAI 통합 (선택)
```

---

## 5. 추적성 매트릭스 (Traceability Matrix)

| 요구사항 ID | 모듈 | 관련 파일 | 테스트 |
|-------------|------|-----------|--------|
| REQ-DATA-001 | Schema | `models/insurance.py` | `tests/unit/test_models.py` |
| REQ-DATA-002 | Schema | `models/insurance.py` | `tests/unit/test_models.py` |
| REQ-DATA-003 | Schema | `models/insurance.py` | `tests/unit/test_models.py` |
| REQ-DATA-004 | Schema | `schemas/policy.py` | `tests/integration/test_policy_api.py` |
| REQ-DATA-005 | Schema | `models/insurance.py` | `tests/unit/test_models.py` |
| REQ-DATA-010 | Embedding | `services/rag/embeddings.py` | `tests/unit/test_embeddings.py` |
| REQ-DATA-011 | Embedding | `services/rag/embeddings.py` | `tests/unit/test_embeddings.py` |
| REQ-DATA-012 | Embedding | `alembic/versions/` | `tests/integration/test_vector_search.py` |
| REQ-DATA-013 | Embedding | `services/rag/embeddings.py` | `tests/integration/test_ingestion.py` |
| REQ-DATA-020 | Ingestion | `services/parser/document_processor.py` | `tests/integration/test_ingestion.py` |
| REQ-DATA-021 | Ingestion | `services/parser/pdf_parser.py` | `tests/unit/test_pdf_parser.py` |
| REQ-DATA-022 | Ingestion | `services/parser/text_cleaner.py` | `tests/unit/test_text_cleaner.py` |
| REQ-DATA-023 | Ingestion | `services/rag/embeddings.py` | `tests/unit/test_embeddings.py` |
| REQ-DATA-030 | Admin API | `api/v1/admin/companies.py` | `tests/integration/test_admin_api.py` |
| REQ-DATA-031 | Admin API | `api/v1/admin/policies.py` | `tests/integration/test_admin_api.py` |
| REQ-DATA-032 | Admin API | `api/v1/admin/coverages.py` | `tests/integration/test_admin_api.py` |
| REQ-DATA-033 | Admin API | `api/v1/admin/policies.py` | `tests/integration/test_admin_api.py` |
| REQ-DATA-040 | Search | `api/v1/search.py` | `tests/integration/test_search_api.py` |
| REQ-DATA-041 | Search | `services/rag/vector_store.py` | `tests/integration/test_vector_search.py` |
| REQ-DATA-042 | Search | `api/v1/search.py` | `tests/integration/test_search_api.py` |
| REQ-DATA-043 | Search | `api/v1/search.py` | `tests/integration/test_search_api.py` |
