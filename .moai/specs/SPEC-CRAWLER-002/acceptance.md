---
id: SPEC-CRAWLER-002
type: acceptance
version: 1.0.0
created: 2026-03-16
author: zuge3
---

# SPEC-CRAWLER-002 수락 기준: 전체 보험사 개별 홈페이지 약관 크롤러

---

## Scenario 1: 삼성생명 공시실에서 판매중/판매중지 상품 수집

### Given
- 삼성생명 YAML 설정 파일(`samsung_life.yaml`)이 `config/companies/`에 존재한다
- Playwright 브라우저가 사용 가능하다
- 삼성생명 공시실 페이지(samsunglife.com)가 접근 가능하다

### When
- 삼성생명 크롤러(`SamsungLifeCrawler` 또는 Generic Crawler)가 실행된다

### Then
- 공시실에서 상품 목록을 파싱하여 `PolicyListing` 리스트를 반환한다
- 각 `PolicyListing`에 `company_name`="삼성생명", `company_code`="samsung-life", `category`="LIFE"가 설정된다
- `sale_status`가 `ON_SALE` 또는 `DISCONTINUED`로 올바르게 분류된다
- 판매중 상품과 판매중지 상품이 모두 포함된다
- 유효한 `pdf_url`이 추출되고 PDF 다운로드가 성공한다
- 전체 페이지네이션을 순회하여 모든 상품이 수집된다

---

## Scenario 2: Generic Crawler로 미지원 보험사 크롤링

### Given
- 미지원 생명보험사(예: DB생명)의 YAML 설정 파일이 작성되어 있다
- YAML 설정에 공시실 URL, CSS 셀렉터, 페이지네이션 설정이 포함되어 있다
- YAML의 `crawler.class`가 "generic"으로 설정되어 있다

### When
- `GenericLifeCrawler`가 해당 YAML 설정으로 인스턴스화된다
- 크롤링이 실행된다

### Then
- YAML에 정의된 CSS 셀렉터를 사용하여 상품 목록을 파싱한다
- YAML에 정의된 페이지네이션 패턴(numbered/infinite_scroll/load_more)에 따라 페이지를 순회한다
- `sale_status_mapping`에 따라 판매 상태를 올바르게 매핑한다
- PDF 다운로드가 성공하고 기존 저장소 구조에 저장된다

---

## Scenario 3: SaleStatus 올바른 분류

### Given
- 크롤러가 보험사 공시실에서 상품 목록을 파싱하고 있다
- 공시실 페이지에 판매 상태 정보가 포함되어 있다

### When
- 상품의 판매 상태 텍스트가 "판매중" 또는 "판매"인 경우

### Then
- `sale_status`가 `SaleStatus.ON_SALE`로 설정된다

### When
- 상품의 판매 상태 텍스트가 "판매중지" 또는 "중지"인 경우

### Then
- `sale_status`가 `SaleStatus.DISCONTINUED`로 설정된다

### When
- 판매 상태 정보를 추출할 수 없거나 매핑에 없는 값인 경우

### Then
- `sale_status`가 `SaleStatus.UNKNOWN`으로 설정된다

---

## Scenario 4: 델타 크롤링 - 기존 수집 약관 중복 방지

### Given
- 이전 크롤링에서 삼성생명 상품 A의 약관이 수집되어 `content_hash`가 저장되어 있다
- 현재 크롤링에서 동일한 상품 A의 약관이 발견된다

### When
- 크롤러가 상품 A의 PDF를 다운로드하고 SHA-256 해시를 계산한다

### Then
- 해시가 기존 저장된 `content_hash`와 동일하면 PDF 재다운로드 및 인제스션을 스킵한다
- CrawlResult의 status가 `SKIPPED`로 기록된다
- 스킵된 약관 수가 CrawlRun의 `skipped_count`에 반영된다

---

## Scenario 5: KNIA와 개별 보험사 크롤러 간 교차 중복 제거

### Given
- KNIA 크롤러에서 삼성화재 상품 B 약관이 이미 수집되어 있다 (`crawler_source`="knia")
- 삼성화재 개별 크롤러에서 동일한 상품 B 약관이 발견된다

### When
- 개별 크롤러가 상품 B의 `content_hash`를 계산하여 기존 KNIA 데이터와 비교한다

### Then
- 해시가 동일하면 중복으로 판단하고 스킵한다
- 해시가 다르면 (개별 사이트 데이터가 더 최신) 기존 데이터를 업데이트한다
- `crawler_source`를 개별 크롤러 소스로 업데이트한다

---

## Scenario 6: YAML 설정 유효성 검증

### Given
- 새로운 보험사 YAML 설정 파일이 작성된다

### When
- `config_loader`가 YAML 파일을 로드한다

### Then
- Pydantic `CompanyCrawlerConfig` 모델로 검증이 수행된다
- 필수 필드(`company.code`, `company.name`, `disclosure.url`, `selectors.listing`)가 누락된 경우 `ValidationError`가 발생한다
- `pagination.type`이 허용된 값(numbered/infinite_scroll/load_more) 외인 경우 에러가 발생한다
- 유효한 설정 파일은 `CompanyCrawlerConfig` 인스턴스로 반환된다

---

## Scenario 7: YAML 설정이 없는 보험사 크롤링 시도

### Given
- "한국생명보험"에 대한 YAML 설정 파일이 존재하지 않는다

### When
- CrawlerRegistry가 전체 크롤링을 실행한다

### Then
- "한국생명보험"은 크롤링 대상에서 스킵된다
- 경고 로그가 기록된다: "YAML config not found for company: 한국생명보험"
- 다른 보험사의 크롤링은 정상적으로 계속된다

---

## Scenario 8: KLIA SPA 크롤링 개선

### Given
- KLIA 크롤러가 SPA 구조의 공시 페이지에 접속한다
- 기존 방식으로는 1595B 셸 HTML만 반환되었다

### When
- 수정된 KLIA 크롤러가 `waitForSelector`와 `networkidle` 전략으로 접속한다

### Then
- 콘텐츠 렌더링이 완료된 후 상품 목록을 파싱한다
- 기존 3건 이상의 약관 PDF를 수집한다
- 수집된 약관 수가 CrawlRun에 정확히 기록된다

---

## Scenario 9: 크롤링 실패 시 복원력

### Given
- 삼성생명 크롤러가 실행 중이다
- 네트워크 오류 또는 사이트 구조 변경으로 파싱이 실패한다

### When
- 크롤러에서 예외가 발생한다

### Then
- 지수 백오프로 최대 3회 재시도한다
- 3회 재시도 후에도 실패하면 구조화된 에러 로그를 기록한다
- CrawlResult에 `status`=`FAILED`와 `error_message`가 기록된다
- 다음 보험사의 크롤링으로 정상 진행된다
- 전체 CrawlRun은 `COMPLETED` (일부 실패 포함)로 마무리된다

---

## Scenario 10: Celery 태스크를 통한 개별 보험사 크롤링

### Given
- Celery Beat 스케줄에 개별 보험사 크롤링 태스크가 등록되어 있다
- 크롤링 주기가 도래한다

### When
- Celery Beat가 크롤링 태스크를 트리거한다

### Then
- 협회 크롤러(KNIA, KLIA) 실행 후 개별 보험사 크롤러가 순차 실행된다
- 각 보험사 크롤링은 독립적으로 실행되어, 한 보험사의 실패가 다른 보험사에 영향을 주지 않는다
- API 서버의 정상 동작에 영향을 주지 않는다
- 전체 CrawlRun 결과가 데이터베이스에 기록된다

---

## Quality Gate 기준

### 필수 통과 조건

- [ ] PolicyListing 확장 필드 (sale_status, effective_date, expiry_date) 정상 동작
- [ ] YAML 설정 로더가 Pydantic 검증을 통과하는 모든 설정 파일을 올바르게 파싱
- [ ] Generic Crawler가 YAML 설정만으로 최소 1개 보험사를 성공적으로 크롤링
- [ ] SaleStatus 분류가 올바르게 동작 (ON_SALE, DISCONTINUED, UNKNOWN)
- [ ] 기존 KNIA/KLIA 크롤러와의 호환성 유지 (기존 테스트 통과)
- [ ] 크롤링 실패 시 다음 보험사로 정상 진행 (복원력)
- [ ] 교차 소스 중복 제거 (content_hash 비교) 정상 동작
- [ ] 단위 테스트 커버리지 85% 이상

### 선택 통과 조건

- [ ] KLIA SPA 문제 해결로 수집 약관 수 증가 (3건 -> 50건+)
- [ ] 8개 주요 생명보험사 크롤링 성공
- [ ] 전체 34개 보험사 중 28개(80%) 이상 크롤링 성공
- [ ] 총 수집 약관 수 2000건 이상

### Definition of Done

1. 모든 필수 Quality Gate 통과
2. SPEC-CRAWLER-002의 REQ-01 ~ REQ-05 충족
3. 기존 SPEC-CRAWLER-001 테스트 회귀 없음
4. CrawlerRegistry에 개별 보험사 크롤러 등록 및 crawl_all() 통합
5. 코드 리뷰 완료 및 main 브랜치 머지
