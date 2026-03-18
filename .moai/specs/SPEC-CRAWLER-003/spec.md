---
id: SPEC-CRAWLER-003
version: 1.0.0
status: planned
created: 2026-03-18
updated: 2026-03-18
author: zuge3
priority: critical
issue_number: 0
tags: [crawler, insurance, life-insurance, pub-insure, playwright, product-summary]
dependencies: [SPEC-CRAWLER-001, SPEC-CRAWLER-002]
blocks: [SPEC-PIPELINE-001, SPEC-EMBED-001]
---

# SPEC-CRAWLER-003: pub.insure.or.kr 생명보험 상품요약서 크롤러

## HISTORY

| 버전 | 날짜 | 작성자 | 변경 내용 |
|------|------|--------|-----------|
| 1.0.0 | 2026-03-18 | zuge3 | 초안 작성 - pub.insure.or.kr Playwright 테스트 결과 기반 |

---

## 1. Environment (환경)

### 1.1 시스템 컨텍스트

Bodam 플랫폼의 보험 약관 지식 베이스는 현재 다음과 같은 수집 현황과 한계를 보인다:

- **KNIA 크롤러 (손해보험협회 kpub.knia.or.kr)**: 607개 손해보험 약관 PDF 수집 성공
- **KLIA 크롤러 (생명보험협회 www.klia.or.kr)**: 3개 PDF만 수집 - SPA 구조 문제
- **SPEC-CRAWLER-002 개별 보험사 YAML 크롤러**: 생명보험사 개별 홈페이지 URL 대부분 404 또는 SPA 오류

이러한 상황에서 **pub.insure.or.kr (생명보험협회 공시실)**이 안정적인 대안 소스로 확인되었다:

- **SSR (Server-Side Rendering)**: SPA가 아닌 서버 렌더링 방식으로 봇 차단 없음
- **22개 생명보험사 전체 데이터 제공**: L01(한화생명)~L43(삼성화재생명주식보험)
- **10개 상품 카테고리**: 종신보험, 정기보험, 연금보험, 일반보험, CI보험, 저축보험, 유니버셜보험, 치아보험, 실손/치아보험, 기타
- **직접 PDF 다운로드 가능**: `GET /FileDown.do?fileNo={no}&seq={seq}` 엔드포인트 확인
- **카테고리당 100+ 상품**: pageUnit=100 POST 요청으로 대량 목록 조회 가능

본 SPEC은 pub.insure.or.kr에서 생명보험 상품요약서 PDF를 체계적으로 수집하는 크롤러를 정의한다. SPEC-CRAWLER-002의 개별 생명보험사 YAML 크롤러(18개)를 대체하는 전략적 변경이다.

### 1.2 기존 시스템 구성요소 (SPEC-CRAWLER-001/002 산출물)

- **BaseCrawler**: 추상 클래스 (`backend/app/services/crawler/base.py`)
  - 메서드: `crawl()`, `parse_listing()`, `download_pdf()`, `detect_changes()`
  - 기능: 지수 백오프 재시도 (최대 3회), rate limiting, SHA-256 델타 크롤링
- **PolicyListing**: 크롤링 결과 데이터클래스
  - 필드: `company_name`, `product_name`, `product_code`, `category`, `pdf_url`, `company_code`, `sale_status`, `effective_date`, `expiry_date`
- **CrawlerRegistry**: 크롤러 동적 등록/조회 시스템
- **FileStorage**: 로컬/S3 저장소 추상화 (`storage.py`)
- **PolicyIngestor**: PolicyListing -> Policy DB upsert + Celery 트리거
- **CrawlRun / CrawlResult**: 크롤링 실행 이력 데이터베이스 모델

### 1.3 대상 보험사 (22개 생명보험사)

| 코드 | 보험사명 |
|------|----------|
| L01 | 한화생명 |
| L02 | ABL생명 |
| L03 | 삼성생명 |
| L04 | 교보생명 |
| L05 | 동양생명 |
| L11 | 한국교직원공제회 |
| L17 | 푸본현대생명 |
| L31 | iM라이프 |
| L33 | KDB생명 |
| L34 | 미래에셋생명 |
| L41 | IBK연금보험 |
| L42 | NH농협생명 |
| L43 | 삼성화재생명주식보험 |
| L51 | 라이나생명 |
| L52 | AIA생명 |
| L61 | KB라이프생명보험 |
| L63 | 하나생명 |
| L71 | DB생명 |
| L72 | 메트라이프생명 |
| L74 | 신한라이프 |
| L77 | 처브라이프생명 |
| L78 | BNP파리바카디프생명보험 |

### 1.4 상품 카테고리 (10개)

| 코드 | 카테고리명 |
|------|------------|
| 024400010001 | 종신보험 |
| 024400010002 | 정기보험 |
| 024400010003 | 연금보험 |
| 024400010004 | 일반보험 |
| 024400010005 | CI보험 |
| 024400010006 | 저축보험 |
| 024400010007 | 유니버셜보험 |
| 024400010009 | 치아보험 |
| 024400010010 | 실손/치아보험 |
| 024400010011 | 기타 |

### 1.5 기술 스택

- Python 3.13+, FastAPI 0.135.x, SQLAlchemy 2.x (async)
- **httpx** (async HTTP 클라이언트) - SSR 사이트이므로 Playwright 불필요
- 기존 BaseCrawler 프레임워크 확장
- Celery 5.x + Redis 7.x (스케줄링)

### 1.6 기술적 발견 사항 (Playwright 테스트 2026-03-18)

1. **SSR 확인**: pub.insure.or.kr은 완전한 서버 사이드 렌더링, SPA 없음
2. **봇 차단 없음**: 직접 HTTP 접근 가능, JavaScript 렌더링 불필요
3. **목록 조회 API**: POST `https://pub.insure.or.kr/compareDis/prodCompare/assurance/listNew.do`
   - 파라미터: `pageIndex`, `pageUnit`, `search_columnArea=simple`, `all_search_memberCd=all`, `search_prodGroup={code}`
4. **파일 다운로드**: `GET https://pub.insure.or.kr/FileDown.do?fileNo={no}&seq={seq}`
   - 실제 PDF 반환 확인 (200 OK, `%PDF` magic bytes)
5. **JS 함수 패턴**: `fn_fileDown('41658', '5')` -> `fileNo=41658&seq=5`
6. **페이지당 최대 100건**: `pageUnit=100` 설정 가능

---

## 2. Assumptions (전제 조건)

- A1: pub.insure.or.kr은 생명보험협회 공식 공시 포털로, 상품요약서 PDF 다운로드가 합법적이다.
- A2: pub.insure.or.kr의 SSR 구조와 API 엔드포인트는 안정적이며, 빈번하게 변경되지 않는다.
- A3: 22개 생명보험사 코드(L01~L78)와 10개 상품 카테고리 코드는 고정적이며, 신규 보험사/카테고리 추가 시 설정 업데이트로 대응 가능하다.
- A4: `FileDown.do` 엔드포인트는 인증 없이 직접 접근 가능하며, fileNo/seq 파라미터로 정확한 PDF를 반환한다.
- A5: 기존 BaseCrawler, CrawlerRegistry, FileStorage, PolicyIngestor 인터페이스를 그대로 사용할 수 있다.
- A6: `fn_fileDown('no', 'seq')` JavaScript 함수 호출 패턴은 HTML 내에서 정규식으로 추출 가능하다.
- A7: 각 카테고리의 전체 상품 수는 pageUnit=100과 페이지네이션으로 충분히 조회 가능하다.

---

## 3. Requirements (요구사항)

### REQ-01: 상품 카테고리별 목록 탐색 (Discovery)

**WHEN** 크롤러가 실행되면 **THEN** 시스템은 10개 상품 카테고리(024400010001~024400010011) 전체에 대해 22개 생명보험사의 상품 목록을 조회하고, 각 상품의 fileNo/seq를 추출해야 한다.

- REQ-01.1: 시스템은 **항상** POST 요청으로 `https://pub.insure.or.kr/compareDis/prodCompare/assurance/listNew.do`에 접근하여 상품 목록을 조회해야 한다.
- REQ-01.2: 시스템은 **항상** `search_prodGroup` 파라미터로 각 카테고리 코드를 순회해야 한다.
- REQ-01.3: 시스템은 **항상** HTML 응답에서 `fn_fileDown('no', 'seq')` 패턴을 정규식으로 파싱하여 fileNo와 seq를 추출해야 한다.
- REQ-01.4: 시스템은 **항상** 각 상품의 보험사 코드, 보험사명, 상품명, 카테고리 정보를 함께 추출해야 한다.

### REQ-02: 상품요약서 PDF 다운로드 (Download)

**WHEN** 상품 목록에서 fileNo/seq가 발견되면 **THEN** 시스템은 `GET /FileDown.do?fileNo={no}&seq={seq}`로 상품요약서 PDF를 다운로드하고 FileStorage에 저장해야 한다.

- REQ-02.1: 시스템은 **항상** 다운로드된 파일의 처음 4바이트가 `%PDF` magic bytes인지 검증해야 한다.
- REQ-02.2: **WHEN** 다운로드된 파일이 PDF가 아닌 경우 **THEN** 해당 파일을 스킵하고 경고 로그를 기록해야 한다.
- REQ-02.3: 시스템은 **항상** FileStorage 인터페이스를 사용하여 PDF를 저장해야 한다 (로컬/S3 추상화 유지).

### REQ-03: 메타데이터 추출 및 저장 (Metadata)

**WHEN** PDF가 성공적으로 다운로드되면 **THEN** 시스템은 다음 메타데이터를 추출하고 PolicyListing으로 저장해야 한다:

- REQ-03.1: `company_code` (L01~L78)
- REQ-03.2: `company_name` (한화생명, 삼성생명 등)
- REQ-03.3: `product_name` (상품명)
- REQ-03.4: `product_category` (종신보험, 정기보험 등)
- REQ-03.5: `sale_status` (판매개시일 기반 판매중/판매중지 분류)
- REQ-03.6: `file_no`, `seq` (다운로드 식별자)
- REQ-03.7: `source_url` (`https://pub.insure.or.kr/FileDown.do?fileNo={no}&seq={seq}`)

### REQ-04: 델타 크롤링 (Delta Crawling)

**WHEN** 크롤러가 이전에 실행된 적이 있을 때 **THEN** 시스템은 이미 다운로드된 상품을 SHA-256 해시 비교로 스킵해야 한다.

- REQ-04.1: 시스템은 **항상** 다운로드 전 기존 `content_hash`와 비교하여 변경 여부를 판단해야 한다.
- REQ-04.2: **WHEN** 파일이 변경되지 않았으면 **THEN** `CrawlResult.status`를 `SKIPPED`로 기록해야 한다.
- REQ-04.3: **WHEN** 파일이 변경되었으면 **THEN** 새 파일을 다운로드하고 기존 레코드를 업데이트해야 한다.

### REQ-05: CrawlerRegistry 등록 (Registration)

`PubInsureLifeCrawler`는 **항상** CrawlerRegistry에 `pub_insure_life` 키로 등록되어 기존 파이프라인 API 엔드포인트에서 호출 가능해야 한다.

- REQ-05.1: 시스템은 **항상** 기존 `crawl_all()` 메서드에서 `pub_insure_life` 크롤러를 포함해야 한다.
- REQ-05.2: 시스템은 **항상** API 엔드포인트 `/api/v1/crawl/run`에서 `pub_insure_life` 크롤러를 독립적으로 실행할 수 있어야 한다.

### REQ-06: 페이지네이션 처리 (Pagination)

**WHEN** 상품 카테고리에 1페이지 이상의 결과가 있을 때 **THEN** 시스템은 모든 페이지를 순회하여 전체 상품을 수집해야 한다.

- REQ-06.1: 시스템은 **항상** `pageIndex` 파라미터를 증가시키며 다음 페이지를 요청해야 한다.
- REQ-06.2: **WHEN** 응답 HTML에 더 이상 상품이 없으면 **THEN** 페이지네이션을 종료해야 한다.
- REQ-06.3: 시스템은 **항상** `pageUnit=100`으로 설정하여 페이지당 최대 100건을 조회해야 한다.

### REQ-07: Rate Limiting

시스템은 **항상** 요청 간 최소 1초 간격을 유지하여 pub.insure.or.kr에 과도한 부하를 주지 않아야 한다.

- REQ-07.1: 시스템은 **항상** 연속된 HTTP 요청 사이에 최소 1초의 대기 시간을 적용해야 한다.
- REQ-07.2: 시스템은 robots.txt를 준수**해야 한다**.

---

## 4. Specifications (세부 사양)

### 4.1 신규 파일

```
backend/app/services/crawler/companies/pubinsure_life_crawler.py
```

### 4.2 PubInsureLifeCrawler 클래스

```python
class PubInsureLifeCrawler(BaseCrawler):
    """pub.insure.or.kr 생명보험 상품요약서 크롤러"""

    LISTING_URL = "https://pub.insure.or.kr/compareDis/prodCompare/assurance/listNew.do"
    DOWNLOAD_URL = "https://pub.insure.or.kr/FileDown.do"

    COMPANY_CODES = {
        "L01": "한화생명", "L02": "ABL생명", "L03": "삼성생명",
        "L04": "교보생명", "L05": "동양생명", "L11": "한국교직원공제회",
        "L17": "푸본현대생명", "L31": "iM라이프", "L33": "KDB생명",
        "L34": "미래에셋생명", "L41": "IBK연금보험", "L42": "NH농협생명",
        "L43": "삼성화재생명주식보험", "L51": "라이나생명", "L52": "AIA생명",
        "L61": "KB라이프생명보험", "L63": "하나생명", "L71": "DB생명",
        "L72": "메트라이프생명", "L74": "신한라이프", "L77": "처브라이프생명",
        "L78": "BNP파리바카디프생명보험",
    }

    PRODUCT_CATEGORIES = {
        "024400010001": "종신보험", "024400010002": "정기보험",
        "024400010003": "연금보험", "024400010004": "일반보험",
        "024400010005": "CI보험", "024400010006": "저축보험",
        "024400010007": "유니버셜보험", "024400010009": "치아보험",
        "024400010010": "실손/치아보험", "024400010011": "기타",
    }

    async def crawl(self) -> list[PolicyListing]:
        """10개 카테고리 순회하여 전체 상품 목록 수집 및 PDF 다운로드"""
        ...

    async def _fetch_listing(self, category_code: str, page_index: int) -> str:
        """POST 요청으로 상품 목록 HTML 조회"""
        ...

    async def _parse_listing(self, html: str, category_code: str) -> list[dict]:
        """HTML에서 fn_fileDown 패턴 및 상품 정보 추출"""
        ...

    async def _download_pdf(self, file_no: str, seq: str) -> bytes | None:
        """FileDown.do 엔드포인트에서 PDF 다운로드 + magic bytes 검증"""
        ...
```

### 4.3 HTTP 요청 사양

**목록 조회 (POST)**:
```
URL: https://pub.insure.or.kr/compareDis/prodCompare/assurance/listNew.do
Content-Type: application/x-www-form-urlencoded
Body:
  pageIndex={page}
  pageUnit=100
  search_columnArea=simple
  all_search_memberCd=all
  search_prodGroup={category_code}
```

**파일 다운로드 (GET)**:
```
URL: https://pub.insure.or.kr/FileDown.do?fileNo={no}&seq={seq}
Expected Response: application/pdf, 200 OK
Validation: 첫 4바이트 == b'%PDF'
```

### 4.4 HTML 파싱 패턴

```python
import re

# fn_fileDown('fileNo', 'seq') 패턴 추출
FILE_DOWN_PATTERN = re.compile(r"fn_fileDown\('(\d+)',\s*'(\d+)'\)")
```

### 4.5 제약 조건

- 시스템은 개인정보를 수집하지 **않아야 한다**. 공개된 상품요약서만 크롤링 대상이다.
- 시스템은 pub.insure.or.kr에 과도한 부하를 주지 **않아야 한다** (최소 1초 간격).
- 크롤링 실패가 API 서버의 정상 동작을 방해하지 **않아야 한다** (Celery worker 분리).
- Playwright를 사용하지 **않아야 한다** - httpx async HTTP 클라이언트만 사용 (SSR 사이트).

---

## 5. Implementation Notes (구현 노트)

_미구현 상태 - `/moai:2-run SPEC-CRAWLER-003` 실행 시 구현 예정_

---

## 6. Traceability (추적성)

| 요구사항 | 관련 파일 | 테스트 |
|----------|-----------|--------|
| REQ-01 | `companies/pubinsure_life_crawler.py` | `tests/unit/test_pubinsure_life_crawler.py` |
| REQ-02 | `companies/pubinsure_life_crawler.py` | `tests/unit/test_pubinsure_life_crawler.py` |
| REQ-03 | `companies/pubinsure_life_crawler.py` | `tests/unit/test_pubinsure_life_crawler.py` |
| REQ-04 | `companies/pubinsure_life_crawler.py`, `base.py` | `tests/unit/test_pubinsure_delta_crawling.py` |
| REQ-05 | `registry.py` | `tests/unit/test_crawler_registry.py` |
| REQ-06 | `companies/pubinsure_life_crawler.py` | `tests/unit/test_pubinsure_pagination.py` |
| REQ-07 | `companies/pubinsure_life_crawler.py` | `tests/unit/test_pubinsure_rate_limiting.py` |
