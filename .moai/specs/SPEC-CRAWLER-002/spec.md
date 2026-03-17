---
id: SPEC-CRAWLER-002
version: 1.1.0
status: planned
created: 2026-03-16
updated: 2026-03-17
author: zuge3
priority: high
issue_number: 0
tags: [crawler, insurance, individual-company, playwright, yaml-config]
dependencies: [SPEC-CRAWLER-001]
blocks: [SPEC-EMBED-001]
---

# SPEC-CRAWLER-002: 전체 보험사 개별 홈페이지 약관 크롤러

## HISTORY

| 버전 | 날짜 | 작성자 | 변경 내용 |
|------|------|--------|-----------|
| 1.0.0 | 2026-03-16 | zuge3 | 초안 작성 |
| 1.1.0 | 2026-03-17 | zuge3 | REQ-06(미탐색 14개 생보사 YAML 탐색), REQ-07(OCI DB 자동 저장) 추가 |

---

## 1. Environment (환경)

### 1.1 시스템 컨텍스트

Bodam 플랫폼의 보험 약관 지식 베이스는 현재 협회 포털(KNIA, KLIA)을 통해 약관 PDF를 수집하고 있다. SPEC-CRAWLER-001에서 구현된 협회 크롤러는 다음과 같은 성과와 한계를 보인다:

- **KNIA 크롤러 (손해보험협회)**: 607개 손해보험 약관 PDF 수집 성공 - 협회 포털 정상 작동
- **KLIA 크롤러 (생명보험협회)**: 3개 생명보험 약관 PDF만 수집 - SPA 구조로 인한 콘텐츠 추출 제한
- **개별 보험사 홈페이지**: 미수집 상태

한국 보험 약관 공시는 두 가지 소스에서 이루어진다:
1. **협회 포털** (KNIA/KLIA) - 전체 보험사 약관의 집합적 뷰
2. **개별 보험사 홈페이지 공시실** - 각 보험사가 직접 운영하는 공시실로, 판매중(ON_SALE) 및 판매중지(DISCONTINUED) 상품을 모두 포함

개별 보험사 공시실은 판매중지 상품을 포함한 전체 상품 목록을 제공하므로, 협회 포털로만은 확보할 수 없는 폭넓은 약관 데이터를 수집할 수 있다.

### 1.2 기존 시스템 구성요소 (SPEC-CRAWLER-001 산출물)

- **BaseCrawler**: 추상 클래스 (`backend/app/services/crawler/base.py`)
  - 메서드: `crawl()`, `parse_listing()`, `download_pdf()`, `detect_changes()`
  - 기능: 지수 백오프 재시도 (최대 3회), rate limiting (기본 2초), SHA-256 델타 크롤링
- **PolicyListing**: 크롤링 결과 데이터클래스
  - 필드: `company_name`, `product_name`, `product_code`, `category`, `pdf_url`, `company_code`
- **CrawlerRegistry**: 크롤러 동적 등록/조회 시스템
- **FileStorage**: 로컬/S3 저장소 추상화 (`storage.py`)
- **CrawlRun / CrawlResult**: 크롤링 실행 이력 데이터베이스 모델
- **Celery Beat**: 주간 스케줄링 (일요일 02:00 KST)
- **KNIA Crawler**: 손해보험협회 크롤러 (정상 동작)
- **KLIA Crawler**: 생명보험협회 크롤러 (SPA 제한으로 3건만 수집)

### 1.3 대상 보험사

#### 생명보험사 (22개사)

| # | 보험사명 | URL 패턴 | 기술 스택 |
|---|----------|----------|-----------|
| 1 | 삼성생명 | samsunglife.com/individual/support/provision/terms.do | JSP/Spring |
| 2 | 한화생명 | hanwhalifeinsurance.co.kr/cportal/comm/terms/termsList.do | Spring |
| 3 | 교보생명 | kyobolife.co.kr/consumer/term/termView.jsp | JSP |
| 4 | 신한라이프 | shinhanlife.co.kr/hpe/service/contract/termsInfo.do | Spring |
| 5 | NH농협생명 | nhlife.co.kr/customer/ctmInfm/ctmContract/terms.do | Spring |
| 6 | 흥국생명 | heungkuklife.co.kr/consumer/support/terms/termsList.do | Spring |
| 7 | 동양생명 | myangel.co.kr/consumer/contract/terms/termSearch.do | Spring |
| 8 | 미래에셋생명 | miraeassetlife.co.kr/term/listTermInfo.do | Spring |
| 9 | DB생명 | dblife.co.kr | 미확인 |
| 10 | 푸본현대생명 | fubon-hyundai.co.kr | 미확인 |
| 11 | KDB생명 | kdblife.co.kr | 미확인 |
| 12 | DGB생명 | dgblife.co.kr | 미확인 |
| 13 | 메트라이프 | metlife.co.kr | 미확인 |
| 14 | AIA생명 | aia.co.kr | 미확인 |
| 15 | 처브라이프 | chubb.com/kr | 미확인 |
| 16 | 라이나생명 | lina.co.kr | 미확인 |
| 17 | 하나생명 | hanalife.co.kr | 미확인 |
| 18 | iM라이프 | imlife.co.kr | 미확인 |
| 19 | 교보라이프플래닛 | lifeplanet.co.kr | 미확인 |
| 20 | 카카오페이생명 | kakaopayin.com | 미확인 |
| 21 | 오렌지라이프 | orangelife.co.kr | 미확인 (신한 자회사) |
| 22 | 한국생명보험 | - | 미확인 |

#### 손해보험사 (12개사)

| # | 보험사명 | 비고 |
|---|----------|------|
| 1 | 삼성화재 | KNIA 보완 |
| 2 | 현대해상 | KNIA 보완 |
| 3 | DB손해보험 | KNIA 보완 |
| 4 | KB손해보험 | KNIA 보완 |
| 5 | 메리츠화재 | KNIA 보완 |
| 6 | 한화손보 | KNIA 보완 |
| 7 | 흥국화재 | KNIA 보완 |
| 8 | AXA손보 | KNIA 보완 |
| 9 | 하나손보 | KNIA 보완 |
| 10 | MG손보 | KNIA 보완 |
| 11 | 농협손보 | KNIA 보완 |
| 12 | 롯데손보 | KNIA 보완 |

### 1.4 기술 스택

- Python 3.13+, FastAPI 0.135.x, SQLAlchemy 2.x (async)
- Playwright (JavaScript 렌더링, SPA 대응, 명시적 waitForSelector)
- Celery 5.x + Redis 7.x (스케줄링)
- YAML 기반 보험사별 설정 파일
- 기존 BaseCrawler 프레임워크 확장

### 1.5 기술적 발견 사항

1. **KLIA SPA 문제**: 하위 페이지 접근 시 1595B 셸 HTML만 반환 - Playwright의 `waitForSelector` + 장시간 타임아웃 필요
2. **FilePathDown.do 패턴**: `/FilePathDown.do?fileSe=XXXX&file=YYYY` 형태의 PDF 다운로드 URL 발견
3. **Spring MVC 패턴**: 대부분의 보험사가 `.do` URL 패턴의 Spring MVC 사용
4. **한국어 URL 인코딩**: `urllib.parse.quote(filename, safe='.()')` 필요

---

## 2. Assumptions (전제 조건)

- A1: 개별 보험사 홈페이지의 공시실(약관 공시 페이지)은 공개 웹사이트로, 약관 PDF 다운로드가 가능하다.
- A2: 약관 문서는 공시 의무 대상으로 공개 정보이며, 크롤링에 법적 제한이 없다.
- A3: 보험사 공시실은 판매중(ON_SALE)과 판매중지(DISCONTINUED) 상품을 모두 게시한다.
- A4: 각 보험사 사이트의 HTML 구조와 URL 패턴은 상이하며, YAML 설정 파일로 보험사별 셀렉터와 URL을 관리한다.
- A5: 보험사 사이트 구조는 빈번하게 변경되지 않으나 (연 1-2회), 구조 변경 시 YAML 설정 업데이트로 대응 가능하다.
- A6: URL 패턴이 확인되지 않은 보험사(9~22번)는 Phase 1에서 탐색 후 YAML 설정을 작성하거나, Generic Crawler로 대응한다.
- A7: 기존 BaseCrawler 인터페이스를 확장하여 `sale_status` 필드 등 개별 보험사 크롤링에 필요한 추가 데이터를 수용한다.
- A8: KLIA SPA 문제는 Playwright의 명시적 대기(waitForSelector) + 충분한 타임아웃(30초+)으로 해결 가능하다.
- A9: OCI PostgreSQL(pgvector)은 SPEC-DATA-001에서 구축 완료되어 있으며, Policy 모델과 DocumentProcessor 파이프라인이 존재한다.
- A10: Policy 모델에 `sale_status` 필드가 없으므로 Alembic 마이그레이션으로 추가한다.
- A11: 14개 미탐색 생명보험사의 공시실 URL 탐색은 자동화하기 어려우므로, Playwright로 직접 탐색하여 YAML 설정 파일을 작성하고 구현 범위에 포함한다. 탐색 실패 시 스킵하고 별도 보고서를 생성한다.

---

## 3. Requirements (요구사항)

### REQ-01: 보험사 공시실 상품 탐색

시스템은 **항상** 각 보험사 개별 홈페이지의 공시실에서 판매중(ON_SALE) 및 판매중지(DISCONTINUED) 상품을 자동으로 탐색해야 한다.

- REQ-01.1: 시스템은 **항상** 보험사 공시실 URL에 접속하여 상품 목록을 파싱해야 한다.
- REQ-01.2: 시스템은 **항상** 페이지네이션된 목록의 전체 페이지를 순회해야 한다.
- REQ-01.3: **WHEN** 공시실 페이지가 SPA 구조일 때 **THEN** Playwright의 `waitForSelector`를 사용하여 콘텐츠 렌더링 완료 후 파싱해야 한다.
- REQ-01.4: **WHEN** 공시실 접근에 실패하면 **THEN** 구조화된 에러 로그를 기록하고 다음 보험사로 진행해야 한다.

### REQ-02: 생명보험사 개별 크롤러 (22개사)

**WHEN** 크롤링 스케줄이 트리거되면 **THEN** 각 생명보험사의 개별 홈페이지에서 약관 PDF를 수집해야 한다.

- REQ-02.1: 주요 8개 생명보험사(삼성생명, 한화생명, 교보생명, 신한라이프, NH농협생명, 흥국생명, 동양생명, 미래에셋생명)에 대해 개별 크롤러를 구현해야 한다.
- REQ-02.2: 나머지 14개 생명보험사에 대해 Generic Life Crawler를 제공하여 YAML 설정 기반으로 크롤링해야 한다.
- REQ-02.3: 각 크롤러는 보험사명, 상품명, 상품코드, 카테고리, PDF URL, 보험사코드, **판매 상태(sale_status)**를 추출해야 한다.
- REQ-02.4: 각 크롤러는 Playwright를 사용하여 JavaScript 렌더링 페이지를 처리해야 한다.
- REQ-02.5: 크롤러는 보험사별 YAML 설정 파일에서 URL, CSS 셀렉터, 페이지네이션 패턴을 읽어야 한다.

### REQ-03: 손해보험사 개별 크롤러 (12개사)

**WHEN** 크롤링 스케줄이 트리거되면 **THEN** 각 손해보험사의 개별 홈페이지에서 KNIA 데이터를 보완하는 약관 PDF를 수집해야 한다.

- REQ-03.1: 12개 손해보험사에 대해 개별 크롤러 또는 Generic NonLife Crawler를 구현해야 한다.
- REQ-03.2: KNIA에서 이미 수집된 약관과 중복되는 항목은 `content_hash` 비교를 통해 스킵해야 한다.
- REQ-03.3: KNIA에 없는 판매중지 상품 등 추가 약관을 수집해야 한다.
- REQ-03.4: 각 크롤러는 보험사별 YAML 설정 파일에서 URL, CSS 셀렉터, 페이지네이션 패턴을 읽어야 한다.

### REQ-04: 상품 판매 상태 분류

시스템은 **항상** 수집된 각 상품의 판매 상태를 분류하여 저장해야 한다.

- REQ-04.1: `PolicyListing` 데이터클래스에 `sale_status` 필드를 추가해야 한다 (`SaleStatus` enum: `ON_SALE`, `DISCONTINUED`, `UNKNOWN`).
- REQ-04.2: `PolicyListing` 데이터클래스에 `effective_date` (효력 발생일, `date | None`)와 `expiry_date` (판매 종료일, `date | None`) 필드를 추가해야 한다.
- REQ-04.3: **WHEN** 공시실 페이지에서 판매 상태 정보를 추출할 수 없으면 **THEN** `sale_status`를 `UNKNOWN`으로 설정해야 한다.
- REQ-04.4: 시스템은 상품 판매 상태 변경 이력을 추적하지 **않아야 한다** (현재 상태만 저장).

### REQ-05: 보험사별 YAML 설정

시스템은 **항상** 보험사별 크롤링 설정을 YAML 파일로 관리해야 한다.

- REQ-05.1: 각 보험사에 대해 `backend/app/services/crawler/config/companies/` 디렉터리에 개별 YAML 파일을 생성해야 한다.
- REQ-05.2: YAML 설정에는 다음 정보를 포함해야 한다:
  - 보험사 기본 정보 (company_code, company_name, category)
  - 공시실 URL (disclosure_url)
  - CSS 셀렉터 (listing_selector, product_name_selector, pdf_link_selector, sale_status_selector)
  - 페이지네이션 설정 (pagination_type: numbered/infinite_scroll/load_more, next_page_selector)
  - rate limiting 설정 (request_delay_seconds)
  - 크롤러 타입 (crawler_class: 전용 크롤러 클래스명 또는 "generic")
- REQ-05.3: **WHEN** YAML 설정 파일이 존재하지 않는 보험사에 대해 크롤링이 시도되면 **THEN** 해당 보험사를 스킵하고 경고 로그를 기록해야 한다.
- REQ-05.4: 시스템은 YAML 설정의 유효성을 검증하기 위해 Pydantic 모델 기반 스키마 검증을 수행해야 한다.

### REQ-06: 미탐색 생명보험사 YAML 설정 탐색 및 구축

구현 단계에서 나머지 14개 생명보험사의 공시실 구조를 Playwright로 직접 탐색하여 YAML 설정 파일을 생성해야 한다.

- REQ-06.1: 미탐색 14개 생보사(DB생명, KDB생명, DGB생명, 메트라이프, AIA생명, 처브라이프, 라이나생명, 하나생명, iM라이프, 교보라이프플래닛, 카카오페이생명, 오렌지라이프, 푸본현대생명, 한국생명보험)에 대해 공시실 URL을 탐색해야 한다.
- REQ-06.2: 탐색 성공 시 `backend/app/services/crawler/config/companies/` 디렉터리에 YAML 설정 파일을 생성해야 한다.
- REQ-06.3: **WHEN** 특정 보험사 공시실 접근 또는 파싱이 불가능할 때 **THEN** 해당 보험사를 스킵하고 `backend/app/services/crawler/config/unsupported_companies.md` 보고서에 이유와 함께 기록해야 한다.
- REQ-06.4: 탐색 완료 후 최종 커버리지 요약(지원 보험사 N개 / 전체 N개)을 보고해야 한다.

### REQ-07: 수집 완료 후 OCI PostgreSQL 자동 저장

시스템은 **항상** 약관 PDF 수집 완료 후 OCI PostgreSQL에 자동으로 데이터를 저장해야 한다.

- REQ-07.1: `Policy` 모델에 `sale_status` 컬럼을 추가하는 Alembic 마이그레이션을 생성해야 한다 (기본값 `UNKNOWN`, nullable).
- REQ-07.2: 크롤러가 PDF를 성공적으로 다운로드한 후 `PolicyIngestor` 서비스가 `PolicyListing`을 `Policy` 레코드로 upsert해야 한다 (`product_code` + `company_code`를 복합 키로 중복 제거).
- REQ-07.3: **WHEN** Policy upsert 완료 시 **THEN** 기존 DocumentProcessor 파이프라인을 Celery task로 비동기 트리거하여 PDF 텍스트 추출 → 청킹 → 임베딩까지 자동 진행해야 한다.
- REQ-07.4: **WHEN** DB 저장 실패 시 **THEN** PDF 파일은 로컬/S3에 유지하고, `CrawlResult.status`를 `FAILED`로 업데이트하며, 재시도 큐에 추가해야 한다.
- REQ-07.5: 시스템은 동일한 `content_hash`를 가진 PDF가 이미 DB에 존재하면 `CrawlResult.status`를 `SKIPPED`로 처리해야 한다 (delta crawling).
- REQ-07.6: 크롤링 1회 실행 완료 시 `CrawlRun.status`를 `COMPLETED`로 업데이트하고, 전체 통계(신규/업데이트/스킵/실패 건수)를 `CrawlRun.stats` JSONB 필드에 저장해야 한다.

---

## 4. Specifications (세부 사양)

### 4.1 디렉터리 구조

```
backend/app/services/crawler/
  config/
    companies/
      samsung_life.yaml        # 삼성생명 설정
      hanwha_life.yaml         # 한화생명 설정
      kyobo_life.yaml          # 교보생명 설정
      shinhan_life.yaml        # 신한라이프 설정
      nh_life.yaml             # NH농협생명 설정
      heungkuk_life.yaml       # 흥국생명 설정
      dongyang_life.yaml       # 동양생명 설정
      mirae_life.yaml          # 미래에셋생명 설정
      ... (추가 보험사 YAML 파일)
      samsung_fire.yaml        # 삼성화재 설정
      hyundai_marine.yaml      # 현대해상 설정
      ... (손해보험사 YAML 파일)
  companies/
    life/
      __init__.py
      samsung_life.py          # 삼성생명 전용 크롤러
      hanwha_life.py           # 한화생명 전용 크롤러
      kyobo_life.py            # 교보생명 전용 크롤러
      shinhan_life.py          # 신한라이프 전용 크롤러
      nh_life.py               # NH농협생명 전용 크롤러
      heungkuk_life.py         # 흥국생명 전용 크롤러
      dongyang_life.py         # 동양생명 전용 크롤러
      mirae_life.py            # 미래에셋생명 전용 크롤러
      generic_life.py          # 미지원 생명보험사 공통 크롤러
    nonlife/
      __init__.py
      samsung_fire.py          # 삼성화재 전용 크롤러
      hyundai_marine.py        # 현대해상 전용 크롤러
      ... (12개 손해보험사)
      generic_nonlife.py       # 미지원 손해보험사 공통 크롤러
    klia_crawler.py            # 기존 크롤러 (SPA 수정 적용)
    knia_crawler.py            # 기존 크롤러 (변경 없음)
  config_loader.py             # YAML 설정 로더 + Pydantic 검증
  policy_ingestor.py           # PolicyListing → Policy DB upsert + Celery 트리거
  config/
    unsupported_companies.md   # 탐색 불가 보험사 보고서 (REQ-06.3)
backend/alembic/versions/
  xxxx_add_sale_status_to_policy.py  # Policy.sale_status 마이그레이션 (REQ-07.1)
```

### 4.2 PolicyListing 확장

```python
from enum import Enum
from datetime import date

class SaleStatus(str, Enum):
    """상품 판매 상태"""
    ON_SALE = "ON_SALE"           # 판매중
    DISCONTINUED = "DISCONTINUED"  # 판매중지
    UNKNOWN = "UNKNOWN"            # 상태 미확인

@dataclasses.dataclass
class PolicyListing:
    """크롤링으로 발견된 보험 상품 정보 (확장)"""
    company_name: str
    product_name: str
    product_code: str
    category: str                   # LIFE, NON_LIFE, THIRD_SECTOR
    pdf_url: str
    company_code: str
    # SPEC-CRAWLER-002 확장 필드
    sale_status: SaleStatus = SaleStatus.UNKNOWN
    effective_date: date | None = None   # 효력 발생일
    expiry_date: date | None = None      # 판매 종료일
```

### 4.3 YAML 설정 스키마

```yaml
# 예시: samsung_life.yaml
company:
  code: "samsung-life"
  name: "삼성생명"
  category: "LIFE"

disclosure:
  url: "https://www.samsunglife.com/individual/support/provision/terms.do"
  wait_selector: ".terms-list-table tbody tr"  # 렌더링 대기 셀렉터
  timeout_ms: 30000

selectors:
  listing: ".terms-list-table tbody tr"
  product_name: "td:nth-child(2)"
  product_code: "td:nth-child(1)"
  pdf_link: "td:nth-child(4) a"
  sale_status: "td:nth-child(3)"   # 판매중/판매중지 텍스트
  sale_status_mapping:
    "판매중": "ON_SALE"
    "판매": "ON_SALE"
    "판매중지": "DISCONTINUED"
    "중지": "DISCONTINUED"

pagination:
  type: "numbered"                  # numbered | infinite_scroll | load_more
  next_page_selector: ".pagination .next a"
  max_pages: 100

rate_limiting:
  request_delay_seconds: 2.0

crawler:
  class: "SamsungLifeCrawler"       # 전용 크롤러 또는 "generic"
```

### 4.4 설정 로더 (Pydantic 검증)

```python
from pydantic import BaseModel, field_validator

class CompanyConfig(BaseModel):
    code: str
    name: str
    category: str  # LIFE | NON_LIFE | THIRD_SECTOR

class DisclosureConfig(BaseModel):
    url: str
    wait_selector: str
    timeout_ms: int = 30000

class SelectorsConfig(BaseModel):
    listing: str
    product_name: str
    product_code: str | None = None
    pdf_link: str
    sale_status: str | None = None
    sale_status_mapping: dict[str, str] | None = None

class PaginationConfig(BaseModel):
    type: str = "numbered"  # numbered | infinite_scroll | load_more
    next_page_selector: str | None = None
    max_pages: int = 100

class RateLimitingConfig(BaseModel):
    request_delay_seconds: float = 2.0

class CrawlerConfig(BaseModel):
    class_: str = "generic"  # 전용 크롤러 클래스명 또는 "generic"

class CompanyCrawlerConfig(BaseModel):
    """보험사 크롤러 YAML 설정의 Pydantic 검증 모델"""
    company: CompanyConfig
    disclosure: DisclosureConfig
    selectors: SelectorsConfig
    pagination: PaginationConfig = PaginationConfig()
    rate_limiting: RateLimitingConfig = RateLimitingConfig()
    crawler: CrawlerConfig = CrawlerConfig()
```

### 4.5 Generic Crawler 아키텍처

Generic Crawler는 YAML 설정만으로 구동되는 범용 크롤러이다. URL 패턴이 확인되지 않은 보험사의 경우, 사이트 구조를 탐색하여 YAML 설정을 작성하면 별도의 크롤러 코드 없이 크롤링이 가능하다.

```python
class GenericLifeCrawler(BaseCrawler):
    """YAML 설정 기반 범용 생명보험사 크롤러"""

    def __init__(self, config: CompanyCrawlerConfig, storage: FileStorage):
        super().__init__(...)
        self.config = config

    async def parse_listing(self, page: Page) -> list[PolicyListing]:
        # config.selectors에 정의된 CSS 셀렉터를 사용하여 파싱
        ...

    async def handle_pagination(self, page: Page) -> None:
        # config.pagination에 정의된 패턴에 따라 페이지 이동
        ...
```

### 4.6 KLIA 크롤러 SPA 수정

기존 `klia_crawler.py`의 SPA 문제를 해결하기 위해 다음 수정을 적용:

- `page.goto()` 이후 `page.wait_for_selector()` 명시적 호출 (타임아웃 30초+)
- 콘텐츠 렌더링 완료 확인 후 파싱 시작
- `networkidle` 대기 전략 추가
- JavaScript 실행을 통한 동적 콘텐츠 로딩 트리거

### 4.7 CrawlerRegistry 확장

기존 CrawlerRegistry에 개별 보험사 크롤러를 등록하는 메커니즘 추가:

- YAML 설정 파일 자동 스캔 및 크롤러 인스턴스 생성
- `crawler_class` 설정에 따라 전용 크롤러 또는 Generic Crawler 할당
- `crawl_all()` 시 협회 크롤러 + 개별 보험사 크롤러 순차 실행

### 4.8 제약 조건

- 시스템은 개인정보를 수집하지 **않아야 한다**. 공개된 약관 문서만 크롤링 대상이다.
- 시스템은 대상 웹사이트에 과도한 부하를 주지 **않아야 한다** (보험사별 rate limiting 설정 준수).
- 시스템은 robots.txt를 준수**해야 한다**.
- 크롤링 실패가 API 서버의 정상 동작을 방해하지 **않아야 한다** (Celery worker 분리).
- 보험사 사이트 구조 변경 시 YAML 설정 업데이트만으로 대응 가능**해야 한다** (코드 수정 최소화).

---

## 5. Implementation Notes (구현 노트)

_미구현 상태 - `/moai:2-run SPEC-CRAWLER-002` 실행 시 구현 예정_

---

## 6. Traceability (추적성)

| 요구사항 | 관련 파일 | 테스트 |
|----------|-----------|--------|
| REQ-01 | `services/crawler/base.py` (확장), `companies/life/*.py`, `companies/nonlife/*.py` | `tests/unit/test_company_crawlers.py` |
| REQ-02 | `companies/life/samsung_life.py` 외 7개 + `generic_life.py` | `tests/unit/test_life_crawlers.py` |
| REQ-03 | `companies/nonlife/*.py`, `generic_nonlife.py` | `tests/unit/test_nonlife_crawlers.py` |
| REQ-04 | `base.py` (PolicyListing 확장), `models/crawler.py` | `tests/unit/test_sale_status.py` |
| REQ-05 | `config/companies/*.yaml`, `config_loader.py` | `tests/unit/test_config_loader.py` |
| KLIA SPA 수정 | `companies/klia_crawler.py` | `tests/integration/test_klia_spa.py` |
| REQ-06 | `config/companies/*.yaml` (14개사), `config/unsupported_companies.md` | `tests/unit/test_remaining_life_crawlers.py` |
| REQ-07 | `policy_ingestor.py`, `alembic/versions/xxxx_add_sale_status.py` | `tests/unit/test_policy_ingestor.py`, `tests/integration/test_db_auto_save.py` |
