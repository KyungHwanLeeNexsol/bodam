---
id: SPEC-CRAWLER-005
version: 1.0.0
status: planned
created: 2026-03-23
updated: 2026-03-23
author: zuge3
priority: high
issue_number: 0
tags: [crawler, pipeline, api, nonlife-insurance, life-insurance, ingest, embedding, status-management]
dependencies: [SPEC-CRAWLER-001, SPEC-CRAWLER-003, SPEC-CRAWLER-004, SPEC-EMBED-001, SPEC-PIPELINE-001]
blocks: []
---

# SPEC-CRAWLER-005: 전보험사 약관 수집 파이프라인 & 수집 상태 관리 API

## HISTORY

| 버전 | 날짜 | 작성자 | 변경 내용 |
|------|------|--------|-----------|
| 1.0.0 | 2026-03-23 | zuge3 | 초안 작성 - 전보험사 수집 완성 + 상태 관리 API |

---

## 1. Environment (환경)

### 1.1 시스템 컨텍스트

Bodam 플랫폼의 보험 약관 지식 베이스는 손해보험 12개사 + 생명보험 22개사 = 총 34개 보험사를 대상으로 한다. 현재 손해보험은 5개사만 완전 수집, 생명보험은 일부만 수집된 상태이며, 수집 상태를 체계적으로 추적하는 API가 부재하다.

### 1.2 손해보험 현황 (12개사)

| 보험사 | company_id | PDF 수 | 상태 | 판매중지 포함 | 비고 |
|--------|-----------|--------|------|-------------|------|
| 삼성화재 | samsung_fire | 8,132 | 완료 | O | |
| 현대해상 | hyundai_marine | 3,575 | 완료 | O | |
| DB손해보험 | db_insurance | 2,110 | 완료 | O | |
| 메리츠화재 | meritz_fire | 542 | 완료 | O | |
| KB손해보험 | kb_insurance | 488 | 완료 | O | |
| 흥국화재 | heungkuk_fire | 63 | **불완전** | 부분 | 판매중지 44개 다운로드 버그 |
| 한화손해보험 | hanwha_general | 0 | **미실행** | - | 크롤러 미작성 |
| AXA손해보험 | axa_general | 1,525 | 실행됨 | 확인 필요 | 판매중지 포함 여부 검증 필요 |
| MG손해보험 | mg_insurance | 29 | 실행됨 | 확인 필요 | 수집량 적음, 검증 필요 |
| NH농협손해보험 | nh_fire | 365 | 실행됨 | 확인 필요 | 판매중지 포함 여부 검증 필요 |
| 롯데손해보험 | lotte_insurance | 886 | 실행됨 | 확인 필요 | 판매중지 포함 여부 검증 필요 |
| 하나손해보험 | hana_insurance | - | **제외** | - | 사이트 다운 |

### 1.3 생명보험 현황 (22개사)

| 보험사 | company_id | 상태 | 비고 |
|--------|-----------|------|------|
| 삼성생명 | samsung_life | 수집됨 | 검증 필요 |
| 한화생명 | hanwha_life | 수집됨 | 검증 필요 |
| 교보생명 | kyobo_life | 수집됨 | 검증 필요 |
| 신한생명 | shinhan_life | 수집됨 | 검증 필요 |
| 흥국생명 | heungkuk_life | 수집됨 | 검증 필요 |
| 동양생명 | dongyang_life | 수집됨 | 검증 필요 |
| 미래에셋생명 | mirae_life | 수집됨 | 검증 필요 |
| NH농협생명 | nh_life | 수집됨 | 검증 필요 |
| DB생명 | db_life | 미확인 | |
| KDB생명 | kdb_life | 미확인 | |
| DGB생명 | dgb_life | 미확인 | |
| 하나생명 | hana_life | 미확인 | |
| AIA생명 | aia_life | 미확인 | |
| 메트라이프 | metlife | 미확인 | |
| 라이나생명 | lina_life | 미확인 | |
| iM생명 | im_life | 미확인 | |
| 교보라이프플래닛 | kyobo_lifeplanet | 미확인 | |
| 푸본현대생명 | fubon_hyundai_life | 미확인 | |
| ABL생명 | abl_life | 미확인 | |
| BNP파리바카디프 | bnp_life | 미확인 | |
| IBK연금보험 | ibk_life | 미확인 | |
| KB생명 | kb_life | 미확인 | |

### 1.4 기존 인프라

**크롤러 인프라:**
- `backend/scripts/crawl_nonlife_playwright.py`: 손해보험 Playwright 기반 크롤러
- `backend/scripts/crawl_life_insurance.py`: 생명보험 크롤러 스크립트
- `backend/app/services/crawler/`: 크롤러 서비스 레이어
  - `base.py`: BaseCrawler 추상 클래스, PolicyListing, CrawlRunResult
  - `companies/nonlife/`: GenericNonLifeCrawler, KBNonLifeCrawler, DBNonLifeCrawler 등
  - `companies/life/`: GenericLifeCrawler, SamsungLifeCrawler, HanwhaLifeCrawler 등
  - `policy_ingestor.py`: PolicyIngestor (크롤링 결과 DB 저장)
  - `registry.py`: CrawlerRegistry (크롤러 등록/실행)
  - `health_monitor.py`: CrawlerHealthMonitor

**DB 모델:**
- `InsuranceCompany`: 보험사 마스터 (insurance_companies 테이블)
- `Policy`: 보험 상품 (policies 테이블, sale_status 필드 포함)
- `PolicyChunk`: 약관 청크 (policy_chunks 테이블, pgvector Vector(768))
- `CrawlRun`: 크롤링 실행 이력 (crawl_runs 테이블)
- `CrawlResult`: 개별 크롤링 결과 (crawl_results 테이블)

**기존 API 엔드포인트:**
- `GET /api/v1/admin/companies`: 보험사 목록
- `GET /api/v1/admin/policies`: 약관 목록
- `GET /api/v1/admin/embeddings`: 임베딩 관리
- 수집 상태 관리 엔드포인트: **없음**

**임베딩:**
- pgvector Vector(768), gemini-embedding-001
- PolicyChunk 테이블에 embedding 벡터 저장

---

## 2. Assumptions (가정)

### 2.1 기술적 가정

- A-01: 기존 BaseCrawler 프레임워크와 PolicyIngestor는 안정적으로 동작한다
- A-02: 각 보험사 웹사이트의 구조는 크롤러 개발 시점과 크게 변경되지 않았다
- A-03: Playwright 기반 크롤링은 JavaScript 렌더링이 필요한 사이트에 적합하다
- A-04: CockroachDB(현재 DB) 환경에서 pgvector 확장이 정상 동작한다
- A-05: 하나손해보험(hana_insurance)은 사이트 복구 전까지 수집 대상에서 제외한다

### 2.2 비즈니스 가정

- A-06: 판매중 + 판매중지 상품 모두 수집해야 RAG 지식 베이스 품질이 보장된다
- A-07: 수집 상태 API는 관리자(admin) 전용이며, 인증이 필요하다
- A-08: 수집 → 인제스트 → 임베딩 파이프라인은 순차적으로 실행된다

### 2.3 제약사항

- C-01: 크롤링은 대상 사이트 서버 부하를 최소화하도록 적절한 delay를 둔다
- C-02: PDF 다운로드 실패 시 3회 재시도 후 실패 로그를 기록한다
- C-03: 중복 수집 방지를 위해 SHA-256 해시 기반 변경 감지를 사용한다
- C-04: API 응답 시간은 P95 < 500ms를 유지한다

---

## 3. Requirements (요구사항)

### REQ-01: 손해보험 크롤러 완성

#### REQ-01-1: 흥국화재 판매중지 다운로드 버그 수정

**WHEN** 흥국화재 크롤러가 판매중지(DISCONTINUED) 상품 목록을 조회할 때
**THE SYSTEM SHALL** 판매중지 상품의 약관 PDF 다운로드 링크를 올바르게 추출하고 다운로드를 완료해야 한다.

- 현재 이슈: 판매중지 44개 상품의 PDF 링크가 미다운로드
- 수정 대상: `crawl_nonlife_playwright.py` 내 흥국화재 크롤링 로직
- 검증 기준: 판매중지 상품의 PDF 수가 44개 이상 증가

#### REQ-01-2: 한화손해보험 크롤러 구현 및 실행

**WHEN** 관리자가 한화손해보험 수집을 요청할 때
**THE SYSTEM SHALL** 한화손해보험 공시 페이지에서 판매중 + 판매중지 상품의 약관 PDF를 수집해야 한다.

- 한화손해보험 크롤러 신규 작성 (GenericNonLifeCrawler 또는 전용 크롤러)
- `crawl_nonlife_playwright.py`에 한화손해보험 크롤링 함수 추가
- 검증 기준: hanwha_general PDF 수 > 0

#### REQ-01-3: 나머지 손해보험사 판매중지 포함 완전 수집 검증

**WHEN** AXA, MG, NH, 롯데 손해보험사의 수집 결과를 검증할 때
**THE SYSTEM SHALL** 각 보험사의 판매중 및 판매중지 상품이 모두 포함되었는지 확인하고, 누락된 경우 재수집해야 한다.

- AXA손해보험 (axa_general): 1,525건 검증, 판매중지 포함 여부 확인
- MG손해보험 (mg_insurance): 29건 - 수집량 적정성 검증
- NH농협손해보험 (nh_fire): 365건 검증
- 롯데손해보험 (lotte_insurance): 886건 검증
- 검증 기준: 각 보험사 sale_status 필드에 ON_SALE, DISCONTINUED가 모두 존재

### REQ-02: 생명보험 크롤러 완성

#### REQ-02-1: 22개 생명보험사 전체 수집 상태 점검

**WHEN** 관리자가 생명보험 수집 현황을 요청할 때
**THE SYSTEM SHALL** 22개 생명보험사 각각의 수집 상태(수집 완료, 부분 수집, 미수집)를 보고해야 한다.

- 기존 GenericLifeCrawler 기반 크롤러 점검: samsung_life, hanwha_life, kyobo_life, shinhan_life, heungkuk_life, dongyang_life, mirae_life, nh_life
- 전용 크롤러 존재 여부 확인 및 미존재 시 생성
- 각 보험사별 수집된 Policy 레코드 수 집계

#### REQ-02-2: 판매중/판매중지 모두 수집

**WHILE** 생명보험 크롤러가 실행 중일 때
**THE SYSTEM SHALL** 판매중(ON_SALE) 상품과 판매중지(DISCONTINUED) 상품을 모두 수집하고 sale_status를 정확히 기록해야 한다.

- GenericLifeCrawler의 sale_status 매핑 로직 검증
- 각 보험사 공시 페이지에서 판매중지 상품 접근 방법 확인
- 검증 기준: 각 보험사 Policy 레코드에 ON_SALE과 DISCONTINUED 모두 존재

#### REQ-02-3: 미수집 보험사 크롤러 실행

**WHEN** 미수집 상태인 생명보험사가 발견될 때
**THE SYSTEM SHALL** 해당 보험사의 크롤러를 실행하여 약관 PDF를 수집해야 한다.

- 미수집 대상: db_life, kdb_life, dgb_life, hana_life, aia_life, metlife, lina_life, im_life, kyobo_lifeplanet, fubon_hyundai_life, abl_life, bnp_life, ibk_life, kb_life
- 각 보험사별 전용 크롤러가 필요한 경우 GenericLifeCrawler 확장
- 검증 기준: 각 보험사 Policy 레코드 수 > 0

### REQ-03: 인제스트 파이프라인 자동화

#### REQ-03-1: 수집 완료 후 자동 인제스트 트리거

**WHEN** 특정 보험사의 크롤링이 성공적으로 완료될 때
**THE SYSTEM SHALL** PolicyIngestor를 통해 수집된 PDF의 텍스트 추출 및 DB 저장을 자동으로 시작해야 한다.

- CrawlRun 완료 시 PolicyIngestor.ingest_company() 자동 호출
- 기존 `policy_ingestor.py`의 (product_code, company_code) 복합 키 upsert 활용
- 검증 기준: 크롤링 완료 후 5분 이내 인제스트 시작

#### REQ-03-2: 인제스트 후 임베딩 자동 생성

**WHEN** PolicyIngestor가 새로운 PolicyChunk를 생성할 때
**THE SYSTEM SHALL** 해당 청크의 임베딩 벡터를 자동으로 생성하여 pgvector에 저장해야 한다.

- 기존 ingest_policy Celery 태스크 활용
- gemini-embedding-001 모델로 Vector(768) 임베딩 생성
- 검증 기준: 새 PolicyChunk 생성 후 embedding 컬럼이 NULL이 아님

#### REQ-03-3: 실패 시 재시도 로직

**IF** 인제스트 또는 임베딩 생성 과정에서 오류가 발생하면
**THE SYSTEM SHALL** 최대 3회 지수 백오프(exponential backoff) 재시도를 수행하고, 최종 실패 시 에러 로그를 기록해야 한다.

- tenacity 라이브러리 활용 (기존 패턴 준수)
- 실패 시 CrawlResult.status를 FAILED로 업데이트
- 검증 기준: 3회 재시도 후 실패 시 structlog에 에러 기록 존재

### REQ-04: 수집 상태 관리 API

#### REQ-04-1: 전체 보험사 수집 상태 목록

**WHEN** 관리자가 GET /api/v1/admin/crawl/status를 호출할 때
**THE SYSTEM SHALL** 전체 보험사의 수집 상태를 생명/손해 구분하여 반환해야 한다.

응답 스키마:
```json
{
  "nonlife": [
    {
      "company_id": "samsung_fire",
      "company_name": "삼성화재",
      "insurance_type": "nonlife",
      "status": "COMPLETED",
      "total_policies": 8132,
      "on_sale_count": 3500,
      "discontinued_count": 4632,
      "last_crawl_at": "2026-03-20T14:30:00Z",
      "last_crawl_status": "SUCCESS",
      "has_embeddings": true,
      "embedding_coverage": 0.95
    }
  ],
  "life": [...],
  "summary": {
    "total_companies": 33,
    "completed": 5,
    "partial": 8,
    "pending": 19,
    "excluded": 1
  }
}
```

#### REQ-04-2: 특정 보험사 상세 상태

**WHEN** 관리자가 GET /api/v1/admin/crawl/status/{company_id}를 호출할 때
**THE SYSTEM SHALL** 해당 보험사의 상세 수집 정보(수집 현황, 최근 크롤링 결과, 인제스트 상태, 임베딩 상태)를 반환해야 한다.

응답 스키마:
```json
{
  "company_id": "samsung_fire",
  "company_name": "삼성화재",
  "insurance_type": "nonlife",
  "collection_status": "COMPLETED",
  "policies": {
    "total": 8132,
    "on_sale": 3500,
    "discontinued": 4632,
    "unknown": 0
  },
  "ingest": {
    "total_chunks": 45000,
    "ingested": 44500,
    "pending": 500
  },
  "embeddings": {
    "total_chunks": 45000,
    "embedded": 42750,
    "missing": 2250,
    "coverage": 0.95
  },
  "last_crawl": {
    "run_id": "uuid",
    "started_at": "2026-03-20T14:00:00Z",
    "completed_at": "2026-03-20T14:30:00Z",
    "status": "SUCCESS",
    "new_count": 10,
    "updated_count": 5,
    "skipped_count": 8117,
    "failed_count": 0
  }
}
```

#### REQ-04-3: 특정 보험사 수집 트리거

**WHEN** 관리자가 POST /api/v1/admin/crawl/trigger/{company_id}를 호출할 때
**THE SYSTEM SHALL** 해당 보험사의 크롤링을 비동기로 시작하고, 실행 ID를 반환해야 한다.

- Celery 태스크로 비동기 실행
- 이미 실행 중인 크롤링이 있으면 409 Conflict 반환
- 요청 바디로 옵션 전달 가능: `{"include_discontinued": true, "force_recrawl": false}`

응답 스키마:
```json
{
  "run_id": "uuid",
  "company_id": "samsung_fire",
  "status": "STARTED",
  "message": "크롤링이 시작되었습니다.",
  "options": {
    "include_discontinued": true,
    "force_recrawl": false
  }
}
```

#### REQ-04-4: 수집 이력 조회

**WHEN** 관리자가 GET /api/v1/admin/crawl/history/{company_id}를 호출할 때
**THE SYSTEM SHALL** 해당 보험사의 최근 크롤링 실행 이력을 페이지네이션하여 반환해야 한다.

- 기본 페이지 크기: 20
- 정렬: 최신순 (created_at DESC)
- CrawlRun 테이블 기반

응답 스키마:
```json
{
  "company_id": "samsung_fire",
  "total": 15,
  "page": 1,
  "page_size": 20,
  "runs": [
    {
      "run_id": "uuid",
      "started_at": "2026-03-20T14:00:00Z",
      "completed_at": "2026-03-20T14:30:00Z",
      "status": "SUCCESS",
      "total_found": 8132,
      "new_count": 10,
      "updated_count": 5,
      "skipped_count": 8117,
      "failed_count": 0,
      "error_message": null
    }
  ]
}
```

#### REQ-04-5: 전체 현황 요약

**WHEN** 관리자가 GET /api/v1/admin/crawl/summary를 호출할 때
**THE SYSTEM SHALL** 생명/손해 구분별 전체 수집 현황 요약 통계를 반환해야 한다.

응답 스키마:
```json
{
  "overall": {
    "total_companies": 33,
    "total_policies": 25000,
    "total_chunks": 150000,
    "total_embeddings": 142500,
    "embedding_coverage": 0.95
  },
  "nonlife": {
    "companies": 11,
    "completed": 5,
    "partial": 5,
    "pending": 1,
    "excluded": 1,
    "total_policies": 17655,
    "on_sale_policies": 8000,
    "discontinued_policies": 9655
  },
  "life": {
    "companies": 22,
    "completed": 0,
    "partial": 8,
    "pending": 14,
    "excluded": 0,
    "total_policies": 7345,
    "on_sale_policies": 3000,
    "discontinued_policies": 4345
  },
  "last_updated": "2026-03-23T10:00:00Z"
}
```

### REQ-05: 데이터 무결성

#### REQ-05-1: 중복 수집 방지

시스템은 **항상** SHA-256 해시를 기반으로 이미 수집된 PDF의 중복 다운로드를 방지해야 한다.

- Policy 테이블의 (company_id, product_code) 복합 유니크 제약
- PDF 파일 해시 비교를 통한 변경 감지
- 변경 없는 상품은 CrawlResult.status = SKIPPED 처리

#### REQ-05-2: 판매 상태 정확 기록

**WHEN** 크롤러가 보험 상품을 수집할 때
**THE SYSTEM SHALL** 각 상품의 판매 상태를 원본 사이트 정보에 기반하여 ON_SALE, DISCONTINUED, UNKNOWN 중 하나로 정확히 기록해야 한다.

- Policy.sale_status 필드 활용
- Policy.is_discontinued 필드와 일관성 유지
- 크롤러별 판매 상태 매핑 로직 검증

#### REQ-05-3: 수집 실패 에러 로그

**IF** PDF 다운로드, 텍스트 추출, 또는 DB 저장 중 오류가 발생하면
**THE SYSTEM SHALL** structlog를 통해 구조화된 에러 로그를 기록하고, CrawlResult에 실패 상태와 에러 메시지를 저장해야 한다.

- 에러 로그 필드: company_id, product_code, error_type, error_message, timestamp
- CrawlResult.status = FAILED, CrawlResult.error_message에 상세 기록
- 시스템은 실패한 상품에 대해 다음 크롤링 시 **재시도하지 않아야 한다** (force_recrawl 옵션 사용 시에만 재시도)

---

## 4. Specifications (명세)

### 4.1 기술 접근 방식

**크롤러 아키텍처:**
- 기존 BaseCrawler + GenericNonLifeCrawler/GenericLifeCrawler 프레임워크 활용
- 보험사별 특수 로직은 전용 크롤러 클래스로 확장
- CrawlerRegistry를 통한 중앙 크롤러 관리

**파이프라인 흐름:**
```
크롤링(Crawl) → 인제스트(Ingest) → 임베딩(Embed)
     │                │                │
     ├─ CrawlRun     ├─ Policy        ├─ PolicyChunk.embedding
     ├─ CrawlResult  ├─ PolicyChunk   └─ pgvector Vector(768)
     └─ PDF 파일     └─ raw_text
```

**API 아키텍처:**
- FastAPI Router: `backend/app/api/v1/admin/crawl.py`
- Service Layer: `backend/app/services/crawler/status_service.py`
- Pydantic Schemas: `backend/app/schemas/crawl.py`
- 인증: 기존 admin 인증 미들웨어 재사용

### 4.2 수집 상태 정의

| 상태 | 의미 | 판단 기준 |
|------|------|-----------|
| COMPLETED | 수집 완료 | 크롤링 성공 + sale_status 다양성 확인 |
| PARTIAL | 부분 수집 | 크롤링 실행됨 + 일부 상품만 수집 또는 판매중지 누락 |
| RUNNING | 수집 중 | 현재 크롤링 태스크 실행 중 |
| PENDING | 대기 중 | 크롤러 존재하나 미실행 |
| FAILED | 실패 | 마지막 크롤링이 실패 상태 |
| EXCLUDED | 제외 | 사이트 다운 등으로 수집 불가 |

### 4.3 파일 구조

```
backend/
├── app/
│   ├── api/v1/admin/
│   │   └── crawl.py              # 신규: 수집 상태 관리 API 라우터
│   ├── schemas/
│   │   └── crawl.py              # 신규: 수집 상태 API 스키마
│   ├── services/crawler/
│   │   ├── status_service.py     # 신규: 수집 상태 조회 서비스
│   │   ├── pipeline_service.py   # 신규: 수집 → 인제스트 → 임베딩 파이프라인 오케스트레이터
│   │   ├── companies/
│   │   │   ├── nonlife/
│   │   │   │   └── hanwha_nonlife_crawler.py  # 신규: 한화손해보험 크롤러
│   │   │   └── life/
│   │   │       └── (미수집 보험사별 크롤러 추가)
│   │   └── ...
│   └── ...
└── scripts/
    └── crawl_nonlife_playwright.py  # 수정: 흥국화재 버그 수정, 한화 추가
```

### 4.4 Traceability (추적성)

| 요구사항 | 구현 파일 | 테스트 |
|----------|----------|--------|
| REQ-01-1 | crawl_nonlife_playwright.py | test_heungkuk_discontinued |
| REQ-01-2 | hanwha_nonlife_crawler.py | test_hanwha_crawl |
| REQ-01-3 | crawl_nonlife_playwright.py | test_nonlife_verification |
| REQ-02-1 | status_service.py | test_life_status_check |
| REQ-02-2 | generic_life.py | test_life_sale_status |
| REQ-02-3 | companies/life/*.py | test_life_crawlers |
| REQ-03-1 | pipeline_service.py | test_auto_ingest |
| REQ-03-2 | pipeline_service.py | test_auto_embedding |
| REQ-03-3 | pipeline_service.py | test_retry_logic |
| REQ-04-1 | crawl.py, status_service.py | test_crawl_status_list |
| REQ-04-2 | crawl.py, status_service.py | test_crawl_status_detail |
| REQ-04-3 | crawl.py | test_crawl_trigger |
| REQ-04-4 | crawl.py | test_crawl_history |
| REQ-04-5 | crawl.py, status_service.py | test_crawl_summary |
| REQ-05-1 | policy_ingestor.py | test_duplicate_prevention |
| REQ-05-2 | 각 크롤러 | test_sale_status_mapping |
| REQ-05-3 | pipeline_service.py | test_error_logging |

---

## 5. Success Criteria (성공 기준)

### 5.1 손해보험 수집 완성도

- 11개 손해보험사(하나손해 제외) 전체에서 Policy 레코드 존재
- 각 보험사의 sale_status에 ON_SALE과 DISCONTINUED 모두 존재
- 흥국화재 판매중지 PDF 44건 이상 추가 수집

### 5.2 생명보험 수집 완성도

- 22개 생명보험사 전체에서 Policy 레코드 존재
- 각 보험사의 sale_status에 ON_SALE과 DISCONTINUED 모두 존재

### 5.3 API 완성도

- 5개 API 엔드포인트 전체 동작
- API 응답 시간 P95 < 500ms
- 에러 응답에 적절한 HTTP 상태 코드 및 메시지 포함

### 5.4 파이프라인 자동화

- 크롤링 완료 시 인제스트 자동 시작
- 인제스트 완료 시 임베딩 자동 생성
- 실패 시 3회 재시도 후 에러 기록

---

## 6. Expert Consultation (전문가 자문 권고)

### 6.1 Backend Expert 자문 필요

본 SPEC은 다음 영역에서 expert-backend 자문을 권고합니다:

- **API 설계**: 수집 상태 관리 API의 엔드포인트 구조 및 응답 스키마 최적화
- **비동기 파이프라인**: Celery 기반 크롤링 → 인제스트 → 임베딩 파이프라인 오케스트레이션
- **데이터 모델**: CrawlRun/CrawlResult와 수집 상태 서비스 간의 효율적 쿼리 설계

### 6.2 DevOps Expert 자문 필요

- **스케줄링**: Celery Beat 기반 주기적 수집 스케줄 설정
- **모니터링**: 수집 파이프라인 실패 알림 설정 (Prometheus + AlertManager)
