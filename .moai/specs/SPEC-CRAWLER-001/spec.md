---
id: SPEC-CRAWLER-001
version: 1.1.0
status: completed
created: 2026-03-14
updated: 2026-03-14
author: zuge3
priority: high
issue_number: 0
tags: [crawler, insurance, data-pipeline, celery, playwright]
dependencies: [SPEC-DATA-001]
blocks: [SPEC-EMBED-001, SPEC-LLM-001]
---

# SPEC-CRAWLER-001: 보험 약관 크롤러 시스템

## HISTORY

| 버전 | 날짜 | 작성자 | 변경 내용 |
|------|------|--------|-----------|
| 1.0.0 | 2026-03-14 | zuge3 | 초안 작성 |

---

## 1. Environment (환경)

### 1.1 시스템 컨텍스트

Bodam 플랫폼은 한국 보험 가입자를 위한 AI 기반 보험금 청구 안내 플랫폼이다. 플랫폼의 핵심 기능은 보험 약관 지식 베이스를 기반으로 한 RAG(Retrieval-Augmented Generation) 파이프라인이며, 이를 위해 보험사 공시 페이지에서 약관 PDF 문서를 수집하여 지식 베이스에 적재해야 한다.

### 1.2 기존 시스템 구성요소

- **PDFParser**: pdfplumber 기반 PDF 텍스트 추출 (`backend/app/services/parser/pdf_parser.py`)
- **TextCleaner**: 한국어 텍스트 정규화 (`backend/app/services/parser/text_cleaner.py`)
- **TextChunker**: 토큰 기반 청크 분할 (`backend/app/services/parser/text_chunker.py`)
- **DocumentProcessor**: 전체 파이프라인 오케스트레이터 (`backend/app/services/parser/document_processor.py`)
- **Policy 모델**: name, product_code, category, raw_text, metadata_ 필드 포함
- **Admin API**: `POST /policies` (raw_text 수신, 임베딩 트리거), `POST /policies/{id}/ingest`
- **Celery**: pyproject.toml 의존성에 포함되어 있으나 미구성 상태

### 1.3 대상 보험사 (Phase 1: Top 10)

| 구분 | 보험사 |
|------|--------|
| 생명보험 | 삼성생명, 한화생명, 교보생명 |
| 손해보험 | 삼성화재, DB손해보험, 현대해상 |
| 제3보험 | AIA생명, 메리츠화재 |
| 추가 | NH농협생명, 미래에셋생명 |

### 1.4 기술 스택

- Python 3.13+, FastAPI 0.135.x, SQLAlchemy 2.x (async)
- Playwright (JavaScript 렌더링 페이지 스크래핑)
- Celery 5.x + Redis 7.x (스케줄링 및 메시지 브로커)
- pdfplumber (PDF 텍스트 추출)
- PostgreSQL 18.x + pgvector (데이터 저장 및 벡터 검색)
- S3 또는 로컬 파일시스템 (PDF 문서 저장)

---

## 2. Assumptions (전제 조건)

- A1: 한국 보험협회(생명보험협회, 손해보험협회) 공시 페이지는 공개 웹사이트로, 약관 PDF 다운로드가 가능하다.
- A2: 약관 문서는 공개 정보이며, 크롤링에 법적 제한이 없다 (개인정보 미포함).
- A3: 대부분의 보험사 공시 페이지는 JavaScript 렌더링을 사용하므로 Playwright가 필요하다.
- A4: 기존 DocumentProcessor 파이프라인 (PDFParser -> TextCleaner -> TextChunker)은 안정적으로 동작한다.
- A5: Celery와 Redis는 인프라 구성 시점에 활성화된다 (현재 미구성 상태).
- A6: 보험 약관 PDF의 평균 크기는 50-200페이지이며, 처리 시간은 문서당 30초-2분이다.
- A7: 보험사별 공시 페이지 구조는 상이하며, 각 보험사에 대해 개별 크롤러 구현이 필요하다.

---

## 3. Requirements (요구사항)

### REQ-01: 크롤러 프레임워크 (BaseCrawler)

시스템은 **항상** 모든 크롤러가 구현해야 하는 공통 인터페이스를 제공해야 한다.

- REQ-01.1: `BaseCrawler` 추상 클래스는 `crawl()`, `parse_listing()`, `download_pdf()`, `detect_changes()` 메서드를 정의해야 한다.
- REQ-01.2: 시스템은 **항상** 재시도 로직을 제공해야 한다 (지수 백오프, 최대 3회 재시도).
- REQ-01.3: 시스템은 **항상** rate limiting을 적용해야 한다 (요청 간 최소 2초 간격, 보험사별 설정 가능).
- REQ-01.4: 시스템은 **항상** User-Agent 헤더를 설정하고, robots.txt를 준수해야 한다.
- REQ-01.5: **WHEN** 크롤링 요청 실패 시 **THEN** 구조화된 에러 로그를 기록하고 다음 항목으로 진행해야 한다.

### REQ-02: 보험사별 크롤러 구현

**WHEN** 크롤링 스케줄이 트리거되면 **THEN** 각 보험사의 공시 페이지에서 약관 목록을 수집하고 PDF를 다운로드해야 한다.

- REQ-02.1: 생명보험협회 공시 페이지 크롤러를 구현해야 한다 (klia.or.kr 약관 공시).
- REQ-02.2: 손해보험협회 공시 페이지 크롤러를 구현해야 한다 (knia.or.kr 약관 공시).
- REQ-02.3: 각 크롤러는 Playwright를 사용하여 JavaScript 렌더링 페이지를 처리해야 한다.
- REQ-02.4: 각 크롤러는 보험사명, 상품명, 상품코드, 카테고리(LIFE/NON_LIFE/THIRD_SECTOR), PDF URL을 추출해야 한다.

### REQ-03: PDF 다운로드 및 저장, 자동 인제스션

**WHEN** 새로운 약관 PDF가 발견되면 **THEN** PDF를 다운로드하고 기존 파이프라인을 통해 자동 인제스션해야 한다.

- REQ-03.1: PDF 파일은 구조화된 경로에 저장해야 한다 (`{storage_root}/{company_code}/{product_code}/{version}.pdf`).
- REQ-03.2: 저장소는 로컬 파일시스템과 S3를 모두 지원해야 한다 (환경변수로 전환 가능).
- REQ-03.3: 다운로드된 PDF는 `DocumentProcessor.process_pdf()` -> Admin API `/policies/{id}/ingest`를 통해 자동 인제스션해야 한다.
- REQ-03.4: 인제스션 실패 시 재시도 큐에 등록하고, 3회 실패 시 수동 검토 대상으로 표시해야 한다.
- REQ-03.5: 시스템은 **항상** 중복 약관을 탐지해야 한다 (`company_id` + `product_code` 기준 UniqueConstraint 활용).

### REQ-04: 변경 감지 및 델타 크롤링

**IF** 이전 크롤링 기록이 존재하는 상태에서 **WHEN** 크롤링이 실행되면 **THEN** 변경된 약관만 처리해야 한다.

- REQ-04.1: Policy 모델의 `metadata_` 필드에 `crawler_source`, `source_url`, `last_crawled_at`, `content_hash` 를 저장해야 한다.
- REQ-04.2: PDF 파일의 SHA-256 해시를 비교하여 변경 여부를 판단해야 한다.
- REQ-04.3: 변경이 감지된 경우에만 PDF 다운로드 및 인제스션을 수행해야 한다.
- REQ-04.4: 신규 약관, 변경 약관, 삭제(비활성화) 약관을 구분하여 처리해야 한다.

### REQ-05: 크롤링 스케줄링 및 이력 관리

**WHEN** Celery Beat가 설정된 주기에 도달하면 **THEN** 자동으로 크롤링 작업을 실행해야 한다.

- REQ-05.1: Celery 5.x와 Redis를 브로커로 구성하고 Celery Beat로 주기적 크롤링을 스케줄링해야 한다.
- REQ-05.2: 기본 크롤링 주기는 주 1회(일요일 02:00 KST)이며, 보험사별 개별 설정이 가능해야 한다.
- REQ-05.3: `CrawlRun` 모델을 생성하여 크롤링 실행 이력을 관리해야 한다 (시작/종료 시각, 성공/실패 건수, 에러 목록).
- REQ-05.4: `CrawlResult` 모델을 생성하여 개별 약관의 크롤링 결과를 기록해야 한다 (policy_id, status, error_message).
- REQ-05.5: 시스템은 크롤링 **진행 중**에도 API 서버의 정상 동작에 영향을 주지 않아야 한다.

---

## 4. Specifications (세부 사양)

### 4.1 디렉터리 구조

```
backend/app/
  services/
    crawler/
      __init__.py
      base.py              # BaseCrawler 추상 클래스
      registry.py           # CrawlerRegistry (크롤러 등록/조회)
      storage.py            # FileStorage (로컬/S3 추상화)
      companies/
        __init__.py
        klia_crawler.py     # 생명보험협회 크롤러
        knia_crawler.py     # 손해보험협회 크롤러
  tasks/
    __init__.py
    celery_app.py           # Celery 앱 설정
    crawler_tasks.py        # 크롤링 Celery 태스크
  models/
    crawler.py              # CrawlRun, CrawlResult 모델
```

### 4.2 BaseCrawler 인터페이스

```python
class BaseCrawler(ABC):
    """보험 약관 크롤러 공통 인터페이스"""

    @abstractmethod
    async def crawl(self) -> CrawlRunResult:
        """전체 크롤링 실행"""

    @abstractmethod
    async def parse_listing(self, page: Page) -> list[PolicyListing]:
        """공시 페이지에서 약관 목록 파싱"""

    @abstractmethod
    async def download_pdf(self, listing: PolicyListing) -> Path:
        """약관 PDF 다운로드"""

    @abstractmethod
    async def detect_changes(self, listings: list[PolicyListing]) -> DeltaResult:
        """신규/변경/삭제 약관 감지"""
```

### 4.3 데이터 모델 확장

```python
class CrawlRun(Base, TimestampMixin):
    """크롤링 실행 이력"""
    id: UUID
    crawler_name: str           # 크롤러 식별자 (예: "klia", "knia")
    status: CrawlStatus         # RUNNING, COMPLETED, FAILED
    started_at: datetime
    finished_at: datetime | None
    total_found: int            # 발견된 약관 수
    new_count: int              # 신규
    updated_count: int          # 변경
    skipped_count: int          # 변경 없음 (스킵)
    failed_count: int           # 실패
    error_log: dict | None      # JSONB

class CrawlResult(Base):
    """개별 약관 크롤링 결과"""
    id: UUID
    crawl_run_id: UUID          # FK -> CrawlRun
    policy_id: UUID | None      # FK -> Policy (인제스션 완료 시)
    product_code: str
    company_code: str
    status: CrawlResultStatus   # NEW, UPDATED, SKIPPED, FAILED
    error_message: str | None
    pdf_path: str | None
    content_hash: str | None    # SHA-256
```

### 4.4 Policy 메타데이터 확장

Policy 모델의 기존 `metadata_` JSONB 필드에 다음 키를 추가:

```json
{
  "crawler_source": "klia",
  "source_url": "https://klia.or.kr/...",
  "last_crawled_at": "2026-03-14T02:00:00+09:00",
  "content_hash": "sha256:abc123...",
  "pdf_storage_path": "klia/samsung-life/product-001/v1.pdf"
}
```

### 4.5 Celery 구성

```python
# celery_app.py
celery_app = Celery("bodam", broker="redis://localhost:6379/0")
celery_app.conf.beat_schedule = {
    "crawl-all-weekly": {
        "task": "app.tasks.crawler_tasks.crawl_all",
        "schedule": crontab(hour=2, minute=0, day_of_week=0),  # 일요일 02:00
    },
}
```

### 4.6 제약 조건

- 시스템은 개인정보를 수집하지 **않아야 한다**. 공개된 약관 문서만 크롤링 대상이다.
- 시스템은 대상 웹사이트에 과도한 부하를 주지 **않아야 한다** (rate limiting 필수).
- 크롤링 실패가 API 서버의 정상 동작을 방해하지 **않아야 한다** (Celery worker 분리).

---

## 5. Implementation Notes (구현 노트)

### Status

✅ **Completed** - Commit 1fff430 (2026-03-14)

### Implementation Summary

The crawler system has been successfully implemented with the following components:

**BaseCrawler Framework**:
- Abstract base class `BaseCrawler` in `services/crawler/base.py` with retry and rate-limiting
- Supports exponential backoff (max 3 retries) and configurable rate limiting (default 2sec between requests)
- Includes SHA-256 delta crawling for change detection

**Crawler Implementations**:
- `services/crawler/companies/klia_crawler.py` - Life Insurance Association (생명보험협회) crawler using Playwright
- `services/crawler/companies/knia_crawler.py` - Non-Life Insurance Association (손해보험협회) crawler using Playwright
- Crawler registry system for dynamic crawler registration and lookup

**Storage Abstraction**:
- `services/crawler/storage.py` - FileStorage base class with LocalFileStorage implementation
- S3Storage stub implementation (MVP support, full implementation deferred to Phase 2)
- Structured storage paths: `{storage_root}/{company_code}/{product_code}/{version}.pdf`

**Database Models**:
- `models/crawler.py` - CrawlRun and CrawlResult SQLAlchemy models for execution tracking
- CrawlRun tracks: crawler_name, status (RUNNING/COMPLETED/FAILED), counters (new/updated/skipped/failed), error_log
- CrawlResult tracks: individual policy crawl status, PDF path, content SHA-256 hash

**Celery Integration**:
- `tasks/celery_tasks.py` - Celery task definitions for crawling
- `tasks/celery_app.py` - Celery Beat schedule: weekly Sunday 02:00 KST
- Async task execution without blocking API server

**Policy Metadata**:
- Policy model extended with crawler metadata in `metadata_` JSONB field:
  - `crawler_source`, `source_url`, `last_crawled_at`, `content_hash`, `pdf_storage_path`

**Test Coverage**:
- 84 unit and integration tests covering all requirements
- Test files: `tests/unit/test_base_crawler.py`, `tests/unit/test_delta_crawl.py`, etc.

### Known Limitations

**S3Storage Implementation**: The S3Storage class is implemented as a stub for MVP. Full S3 integration (bucket operations, signed URLs, etc.) is deferred to Phase 2 when infrastructure scaling requires cloud storage.

---

## 6. Traceability (추적성)

| 요구사항 | 관련 파일 | 테스트 |
|----------|-----------|--------|
| REQ-01 | `services/crawler/base.py` | `tests/unit/test_base_crawler.py` |
| REQ-02 | `services/crawler/companies/*.py` | `tests/integration/test_crawlers.py` |
| REQ-03 | `services/crawler/storage.py`, `services/parser/document_processor.py` | `tests/unit/test_storage.py`, `tests/integration/test_ingestion.py` |
| REQ-04 | `services/crawler/base.py` (detect_changes) | `tests/unit/test_delta_crawl.py` |
| REQ-05 | `tasks/celery_app.py`, `tasks/crawler_tasks.py`, `models/crawler.py` | `tests/unit/test_crawler_tasks.py` |
