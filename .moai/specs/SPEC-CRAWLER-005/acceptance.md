---
spec_id: SPEC-CRAWLER-005
version: 1.0.0
created: 2026-03-23
updated: 2026-03-23
author: zuge3
---

# SPEC-CRAWLER-005: 인수 기준 (Acceptance Criteria)

## AC-01: 손해보험 크롤러 완성

### AC-01-1: 흥국화재 판매중지 버그 수정

```gherkin
Scenario: 흥국화재 판매중지 상품 PDF 다운로드
  Given 흥국화재 크롤러가 실행된다
  When 판매중지(DISCONTINUED) 상품 목록을 조회한다
  Then 판매중지 상품의 PDF 다운로드 링크가 올바르게 추출된다
  And 모든 판매중지 상품의 PDF가 다운로드된다
  And 다운로드된 PDF 수가 기존 대비 44건 이상 증가한다
  And 각 상품의 sale_status가 DISCONTINUED로 기록된다
```

### AC-01-2: 한화손해보험 크롤러

```gherkin
Scenario: 한화손해보험 최초 수집
  Given 한화손해보험 크롤러가 구현되어 있다
  When 한화손해보험 크롤러를 실행한다
  Then hanwha_general 보험사에 Policy 레코드가 생성된다
  And 판매중(ON_SALE) 상품이 1건 이상 존재한다
  And 판매중지(DISCONTINUED) 상품이 1건 이상 존재한다
  And CrawlRun 레코드가 SUCCESS 상태로 기록된다
```

### AC-01-3: 손해보험 판매중지 포함 검증

```gherkin
Scenario: 기존 손해보험사 수집 완전성 검증
  Given AXA, MG, NH, 롯데 손해보험사의 크롤링이 완료되었다
  When 각 보험사의 수집 결과를 조회한다
  Then 각 보험사의 Policy 레코드에 ON_SALE 상태가 존재한다
  And 각 보험사의 Policy 레코드에 DISCONTINUED 상태가 존재한다
  And 각 보험사의 총 Policy 수가 합리적인 범위 내에 있다
```

---

## AC-02: 생명보험 크롤러 완성

### AC-02-1: 생명보험 수집 상태 점검

```gherkin
Scenario: 22개 생명보험사 수집 현황 조회
  Given 생명보험 수집 현황 점검이 요청된다
  When 각 생명보험사의 Policy 레코드를 집계한다
  Then 22개 생명보험사 각각의 수집 상태(완료/부분/미수집)가 확인된다
  And 미수집 보험사 목록이 식별된다
```

### AC-02-2: 판매중/판매중지 수집

```gherkin
Scenario: 생명보험 판매 상태 정확 기록
  Given 생명보험 크롤러가 상품을 수집한다
  When 수집된 상품의 sale_status를 조회한다
  Then ON_SALE 상태의 상품이 존재한다
  And DISCONTINUED 상태의 상품이 존재한다
  And sale_status가 UNKNOWN인 상품이 최소화된다
```

### AC-02-3: 미수집 보험사 수집 완료

```gherkin
Scenario: 미수집 생명보험사 크롤링 실행
  Given 미수집 상태인 생명보험사가 식별되었다
  When 해당 보험사의 크롤러를 실행한다
  Then 각 보험사에 Policy 레코드가 1건 이상 생성된다
  And CrawlRun 레코드가 기록된다
  And 수집 불가능한 보험사는 사유와 함께 EXCLUDED로 표시된다
```

---

## AC-03: 인제스트 파이프라인 자동화

### AC-03-1: 자동 인제스트 트리거

```gherkin
Scenario: 크롤링 완료 시 자동 인제스트
  Given 특정 보험사의 크롤링이 성공적으로 완료된다
  When CrawlRun 상태가 SUCCESS로 변경된다
  Then PolicyIngestor가 자동으로 실행된다
  And 수집된 PDF의 텍스트가 추출되어 Policy.raw_text에 저장된다
  And PolicyChunk 레코드가 생성된다
```

### AC-03-2: 자동 임베딩 생성

```gherkin
Scenario: 인제스트 완료 시 자동 임베딩
  Given PolicyIngestor가 새로운 PolicyChunk를 생성한다
  When 인제스트가 완료된다
  Then 각 PolicyChunk의 embedding 컬럼에 벡터가 저장된다
  And 벡터 차원이 768이다
  And embedding이 NULL인 PolicyChunk가 존재하지 않는다
```

### AC-03-3: 재시도 및 에러 처리

```gherkin
Scenario: 인제스트 실패 시 재시도
  Given 인제스트 과정에서 일시적 오류가 발생한다
  When 첫 번째 시도가 실패한다
  Then 지수 백오프로 최대 3회 재시도한다
  And 3회 모두 실패하면 CrawlResult.status가 FAILED로 기록된다
  And structlog에 에러 로그가 기록된다(company_id, product_code, error_type, error_message)
```

---

## AC-04: 수집 상태 관리 API

### AC-04-1: 전체 수집 상태 조회

```gherkin
Scenario: GET /api/v1/admin/crawl/status 호출
  Given 관리자 인증이 완료된 상태이다
  When GET /api/v1/admin/crawl/status를 호출한다
  Then 200 OK 응답을 받는다
  And 응답에 nonlife 배열이 포함된다
  And 응답에 life 배열이 포함된다
  And 응답에 summary 객체가 포함된다
  And 각 보험사 항목에 company_id, status, total_policies 필드가 존재한다
  And 응답 시간이 500ms 이내이다

Scenario: 비인증 사용자 접근 거부
  Given 인증되지 않은 상태이다
  When GET /api/v1/admin/crawl/status를 호출한다
  Then 401 Unauthorized 응답을 받는다
```

### AC-04-2: 특정 보험사 상세 조회

```gherkin
Scenario: GET /api/v1/admin/crawl/status/{company_id} 호출
  Given 관리자 인증이 완료된 상태이다
  And samsung_fire 보험사가 존재한다
  When GET /api/v1/admin/crawl/status/samsung_fire를 호출한다
  Then 200 OK 응답을 받는다
  And 응답에 policies 객체(total, on_sale, discontinued)가 포함된다
  And 응답에 ingest 객체(total_chunks, ingested, pending)가 포함된다
  And 응답에 embeddings 객체(total_chunks, embedded, missing, coverage)가 포함된다
  And 응답에 last_crawl 객체가 포함된다

Scenario: 존재하지 않는 보험사 조회
  Given 관리자 인증이 완료된 상태이다
  When GET /api/v1/admin/crawl/status/nonexistent_company를 호출한다
  Then 404 Not Found 응답을 받는다
  And 에러 메시지에 company_id가 포함된다
```

### AC-04-3: 크롤링 트리거

```gherkin
Scenario: POST /api/v1/admin/crawl/trigger/{company_id} 호출
  Given 관리자 인증이 완료된 상태이다
  And samsung_fire에 실행 중인 크롤링이 없다
  When POST /api/v1/admin/crawl/trigger/samsung_fire를 호출한다
  Then 202 Accepted 응답을 받는다
  And 응답에 run_id가 포함된다
  And CrawlRun 레코드가 RUNNING 상태로 생성된다
  And Celery 태스크가 큐에 등록된다

Scenario: 중복 크롤링 트리거 방지
  Given 관리자 인증이 완료된 상태이다
  And samsung_fire에 이미 실행 중인 크롤링이 있다
  When POST /api/v1/admin/crawl/trigger/samsung_fire를 호출한다
  Then 409 Conflict 응답을 받는다
  And 에러 메시지에 현재 실행 중인 run_id가 포함된다
```

### AC-04-4: 수집 이력 조회

```gherkin
Scenario: GET /api/v1/admin/crawl/history/{company_id} 호출
  Given 관리자 인증이 완료된 상태이다
  And samsung_fire에 크롤링 이력이 5건 존재한다
  When GET /api/v1/admin/crawl/history/samsung_fire를 호출한다
  Then 200 OK 응답을 받는다
  And 응답에 runs 배열이 포함된다
  And runs가 최신순으로 정렬되어 있다
  And 각 run에 run_id, started_at, status, new_count 필드가 존재한다

Scenario: 페이지네이션
  Given samsung_fire에 크롤링 이력이 30건 존재한다
  When GET /api/v1/admin/crawl/history/samsung_fire?page=2&page_size=10을 호출한다
  Then 응답의 runs 배열 길이가 10이다
  And total이 30이다
  And page가 2이다
```

### AC-04-5: 전체 현황 요약

```gherkin
Scenario: GET /api/v1/admin/crawl/summary 호출
  Given 관리자 인증이 완료된 상태이다
  When GET /api/v1/admin/crawl/summary를 호출한다
  Then 200 OK 응답을 받는다
  And 응답에 overall 객체가 포함된다
  And 응답에 nonlife 객체가 포함된다
  And 응답에 life 객체가 포함된다
  And overall.total_companies가 nonlife.companies + life.companies와 일치한다
  And nonlife.companies가 11이다(하나손해 제외)
  And life.companies가 22이다
```

---

## AC-05: 데이터 무결성

### AC-05-1: 중복 수집 방지

```gherkin
Scenario: 동일 상품 재수집 시 중복 방지
  Given samsung_fire의 특정 상품이 이미 수집되어 있다
  When 동일 상품을 다시 크롤링한다
  Then 기존 Policy 레코드가 업데이트된다(새 레코드 생성 안 됨)
  And CrawlResult.status가 SKIPPED 또는 UPDATED로 기록된다
  And (company_id, product_code) 유니크 제약이 유지된다
```

### AC-05-2: 판매 상태 일관성

```gherkin
Scenario: 판매 상태 필드 일관성
  Given 크롤러가 판매중지 상품을 수집한다
  When 상품이 DB에 저장된다
  Then Policy.sale_status가 DISCONTINUED이다
  And Policy.is_discontinued가 True이다
  And 두 필드 간 불일치가 존재하지 않는다
```

### AC-05-3: 에러 로그 기록

```gherkin
Scenario: 수집 실패 시 에러 추적
  Given PDF 다운로드 중 네트워크 오류가 발생한다
  When 3회 재시도 후에도 실패한다
  Then CrawlResult.status가 FAILED이다
  And CrawlResult.error_message에 오류 상세가 기록된다
  And structlog에 ERROR 레벨 로그가 기록된다
  And 로그에 company_id, product_code, error_type이 포함된다
```

---

## Quality Gate

### Definition of Done

- [ ] 손해보험 11개사(하나손해 제외) 전체에 Policy 레코드 존재
- [ ] 생명보험 22개사 전체에 Policy 레코드 존재 (수집 불가 시 EXCLUDED 표시)
- [ ] 각 보험사 sale_status에 ON_SALE, DISCONTINUED 모두 존재
- [ ] 5개 수집 상태 API 엔드포인트 정상 동작
- [ ] API 응답 시간 P95 < 500ms
- [ ] 자동 인제스트 파이프라인 동작 검증
- [ ] 자동 임베딩 생성 검증
- [ ] 실패 재시도 로직 검증 (3회 재시도)
- [ ] API 단위 테스트 + 통합 테스트 작성
- [ ] 에러 로그 기록 검증
- [ ] 중복 수집 방지 검증

### 수집 목표 수치 (최소 기준)

| 구분 | 대상 | 최소 보험사 수 | 비고 |
|------|------|---------------|------|
| 손해보험 | 11개사 | 10개사 이상 | 하나손해 제외, 1개사 불가 허용 |
| 생명보험 | 22개사 | 18개사 이상 | 최대 4개사 불가 허용 |
| 전체 | 33개사 | 28개사 이상 | |

### API 응답 형식 검증

- 모든 성공 응답: JSON 형식, Content-Type: application/json
- 에러 응답: `{"detail": "에러 메시지"}` 형식
- HTTP 상태 코드: 200 (조회), 202 (트리거), 401 (미인증), 404 (미존재), 409 (충돌), 500 (서버 에러)
