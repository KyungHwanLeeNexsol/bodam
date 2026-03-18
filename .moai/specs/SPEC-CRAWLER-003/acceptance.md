---
id: SPEC-CRAWLER-003
type: acceptance
version: 1.0.0
created: 2026-03-18
author: zuge3
---

# SPEC-CRAWLER-003 수락 기준: pub.insure.or.kr 생명보험 상품요약서 크롤러

---

## AC-01: 22개 생명보험사 전체에서 최소 200개 상품요약서 PDF 수집

### Scenario 1: 전체 카테고리 순회 크롤링

#### Given
- PubInsureLifeCrawler가 초기화되어 있다
- pub.insure.or.kr이 접근 가능하다
- 10개 상품 카테고리 코드가 설정되어 있다

#### When
- 크롤러의 `crawl()` 메서드가 실행된다

#### Then
- 10개 카테고리 전체를 순회하여 상품 목록을 조회한다
- 22개 생명보험사의 상품을 수집한다
- 최소 200개 상품요약서 PDF가 다운로드된다
- 각 PDF가 FileStorage에 저장된다

#### Test Method
- Integration 테스트: 실제 사이트 연동 (CI 제외, 수동 실행)
- Unit 테스트: httpx mock 응답으로 HTML 파싱 및 다운로드 플로우 검증

---

## AC-02: PDF 파일 magic bytes 검증

### Scenario 2: 유효한 PDF 파일 검증

#### Given
- 크롤러가 `FileDown.do?fileNo=41658&seq=5`로 파일을 다운로드했다

#### When
- 다운로드된 파일의 첫 4바이트를 검사한다

#### Then
- `%PDF` magic bytes가 확인되면 유효한 PDF로 처리하여 저장한다
- `%PDF`가 아닌 경우 해당 파일을 스킵하고 경고 로그를 기록한다

#### Test Method
- Unit 테스트: mock 응답으로 PDF/non-PDF 바이너리 검증

---

## AC-03: CrawlerRegistry 등록

### Scenario 3: pub_insure_life 키로 레지스트리 등록

#### Given
- CrawlerRegistry가 초기화된다

#### When
- 레지스트리에서 `pub_insure_life` 키로 크롤러를 조회한다

#### Then
- `PubInsureLifeCrawler` 인스턴스가 반환된다
- `crawl_all()` 실행 시 `pub_insure_life` 크롤러가 포함된다
- API 엔드포인트 `/api/v1/crawl/run`에서 `crawler_type=pub_insure_life`로 독립 실행 가능하다

#### Test Method
- Unit 테스트: CrawlerRegistry 등록/조회 검증

---

## AC-04: 델타 크롤링 - 중복 다운로드 방지

### Scenario 4: 동일 fileNo에 대한 중복 방지

#### Given
- 이전 크롤링에서 fileNo=41658, seq=5의 PDF가 수집되어 `content_hash`가 저장되어 있다
- 현재 크롤링에서 동일한 fileNo=41658, seq=5가 발견된다

#### When
- 크롤러가 해당 파일의 SHA-256 해시를 기존 `content_hash`와 비교한다

#### Then
- 해시가 동일하면 PDF 재다운로드를 스킵한다
- `CrawlResult.status`가 `SKIPPED`로 기록된다
- 스킵된 건수가 `CrawlRun.stats`에 반영된다

### Scenario 5: 파일 변경 시 업데이트

#### Given
- 이전 크롤링에서 수집된 PDF의 `content_hash`가 저장되어 있다
- pub.insure.or.kr에서 동일 fileNo/seq의 파일이 업데이트되었다

#### When
- 크롤러가 새 파일을 다운로드하고 SHA-256 해시를 계산한다

#### Then
- 해시가 다르면 새 파일로 교체하여 저장한다
- `content_hash`를 업데이트한다
- `CrawlResult.status`가 `UPDATED`로 기록된다

#### Test Method
- Unit 테스트: mock 해시 비교 시나리오

---

## AC-05: 단위 테스트 커버리지 85% 이상

### Scenario 6: 테스트 커버리지 검증

#### Given
- `pubinsure_life_crawler.py` 구현이 완료되었다

#### When
- `pytest --cov=backend/app/services/crawler/companies/pubinsure_life_crawler --cov-report=term`을 실행한다

#### Then
- 테스트 커버리지가 85% 이상이다
- 모든 공개 메서드에 대한 테스트가 존재한다
- 정상 케이스, 에러 케이스, 경계 케이스가 모두 커버된다

#### Test Method
- pytest-cov 리포트 확인

---

## AC-06: PolicyIngestor 연동 DB 저장

### Scenario 7: 수집 완료 후 자동 DB 저장

#### Given
- PubInsureLifeCrawler가 상품요약서 PDF를 성공적으로 다운로드했다
- PolicyIngestor 서비스가 활성화되어 있다

#### When
- 크롤러가 PolicyListing을 생성하여 PolicyIngestor에 전달한다

#### Then
- Policy 레코드가 DB에 upsert된다 (company_code + product_code 복합 키)
- `crawler_source`가 `pub_insure_life`로 설정된다
- 메타데이터 (company_code, company_name, product_name, product_category)가 정확히 저장된다

#### Test Method
- Unit 테스트: PolicyIngestor mock으로 호출 검증
- Integration 테스트: 실제 DB 연동 검증

---

## Scenario 8: 페이지네이션 전체 순회

### Given
- 종신보험 카테고리(024400010001)에 150개 상품이 있다
- pageUnit=100으로 설정되어 있다

### When
- 크롤러가 해당 카테고리를 조회한다

### Then
- pageIndex=1로 첫 100건을 조회한다
- pageIndex=2로 나머지 50건을 조회한다
- pageIndex=3 요청 시 빈 결과가 반환되면 페이지네이션을 종료한다
- 총 150개 상품이 모두 수집된다

### Test Method
- Unit 테스트: mock 페이지네이션 응답으로 전체 순회 검증

---

## Scenario 9: Rate Limiting 준수

### Given
- 크롤러가 연속 요청을 보내고 있다

### When
- 10개 카테고리를 순회하며 POST 요청을 보낸다

### Then
- 각 요청 사이에 최소 1초 간격이 유지된다
- pub.insure.or.kr에 과도한 부하가 발생하지 않는다

### Test Method
- Unit 테스트: asyncio 타이밍 검증

---

## Scenario 10: fn_fileDown 패턴 파싱

### Given
- HTML 응답에 `onclick="fn_fileDown('41658', '5')"` 패턴이 포함되어 있다

### When
- 크롤러가 HTML을 파싱한다

### Then
- fileNo=41658, seq=5가 정확히 추출된다
- 추출된 값으로 `FileDown.do?fileNo=41658&seq=5` URL이 생성된다

### Test Method
- Unit 테스트: 다양한 HTML 패턴으로 정규식 파싱 검증

---

## Scenario 11: 크롤링 실패 복원력

### Given
- 크롤러가 특정 카테고리 조회 중 네트워크 오류가 발생한다

### When
- HTTP 요청에서 예외가 발생한다

### Then
- 지수 백오프로 최대 3회 재시도한다
- 재시도 실패 시 해당 카테고리를 스킵하고 에러 로그를 기록한다
- 다음 카테고리의 크롤링으로 정상 진행된다
- 전체 CrawlRun은 COMPLETED (일부 실패 포함)로 마무리된다

### Test Method
- Unit 테스트: httpx mock으로 예외 시나리오 검증

---

## Quality Gate 기준

### 필수 통과 조건

- [ ] PubInsureLifeCrawler가 10개 카테고리 순회 가능
- [ ] fn_fileDown 패턴 파싱이 정확하게 동작
- [ ] PDF magic bytes 검증 동작
- [ ] CrawlerRegistry에 `pub_insure_life` 키로 등록
- [ ] 델타 크롤링 (SHA-256 비교) 정상 동작
- [ ] PolicyIngestor 연동 DB 저장 동작
- [ ] 크롤링 실패 시 다음 카테고리로 정상 진행 (복원력)
- [ ] 단위 테스트 커버리지 85% 이상
- [ ] 기존 KNIA/KLIA 크롤러 호환성 유지 (기존 테스트 통과)

### 선택 통과 조건

- [ ] 22개 생명보험사 전체에서 최소 200개 PDF 수집
- [ ] 총 수집 상품요약서 500건 이상
- [ ] 실행 시간 30분 이내 (전체 카테고리 순회)

### Definition of Done

1. 모든 필수 Quality Gate 통과
2. SPEC-CRAWLER-003의 REQ-01 ~ REQ-07 충족
3. 기존 SPEC-CRAWLER-001 테스트 회귀 없음
4. CrawlerRegistry에 pub_insure_life 크롤러 등록 및 crawl_all() 통합
5. 코드 리뷰 완료 및 main 브랜치 머지
