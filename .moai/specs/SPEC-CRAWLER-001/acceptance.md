---
id: SPEC-CRAWLER-001
type: acceptance
version: 1.0.0
---

# SPEC-CRAWLER-001: 수락 기준

## 1. BaseCrawler 프레임워크 (REQ-01)

### AC-01.1: BaseCrawler 추상 클래스 구현

```gherkin
Given BaseCrawler를 상속한 TestCrawler 클래스가 존재할 때
When crawl(), parse_listing(), download_pdf(), detect_changes() 메서드를 구현하지 않으면
Then TypeError가 발생해야 한다
```

### AC-01.2: 재시도 로직

```gherkin
Given 크롤링 대상 페이지가 일시적으로 503 에러를 반환할 때
When 크롤러가 해당 페이지에 접근하면
Then 지수 백오프로 최대 3회 재시도해야 한다
And 3회 모두 실패하면 에러를 기록하고 다음 항목으로 진행해야 한다
```

### AC-01.3: Rate Limiting

```gherkin
Given rate limit이 2초로 설정되어 있을 때
When 크롤러가 연속으로 2개의 페이지를 요청하면
Then 두 요청 사이에 최소 2초의 간격이 있어야 한다
```

### AC-01.4: 에러 처리

```gherkin
Given 10개의 약관 목록 중 3개의 PDF 다운로드가 실패할 때
When 크롤링이 완료되면
Then 성공한 7개는 정상 처리되어야 한다
And 실패한 3개는 CrawlResult에 FAILED 상태와 에러 메시지가 기록되어야 한다
And CrawlRun의 failed_count가 3이어야 한다
```

---

## 2. 보험협회 크롤러 (REQ-02)

### AC-02.1: KLIA 크롤러 약관 목록 파싱

```gherkin
Given 생명보험협회 공시 페이지에 접근 가능할 때
When KLIA 크롤러의 parse_listing()을 실행하면
Then 각 약관에 대해 company_name, product_name, product_code, category, pdf_url이 추출되어야 한다
And category는 LIFE, NON_LIFE, THIRD_SECTOR 중 하나여야 한다
```

### AC-02.2: KNIA 크롤러 약관 목록 파싱

```gherkin
Given 손해보험협회 공시 페이지에 접근 가능할 때
When KNIA 크롤러의 parse_listing()을 실행하면
Then 각 약관에 대해 company_name, product_name, product_code, category, pdf_url이 추출되어야 한다
```

### AC-02.3: Playwright JavaScript 렌더링

```gherkin
Given 보험협회 공시 페이지가 JavaScript로 약관 목록을 렌더링할 때
When 크롤러가 Playwright를 사용하여 페이지를 로드하면
Then JavaScript 실행 후 렌더링된 약관 목록이 정상적으로 파싱되어야 한다
```

---

## 3. PDF 다운로드 및 자동 인제스션 (REQ-03)

### AC-03.1: PDF 다운로드 및 저장

```gherkin
Given 유효한 PDF URL이 주어졌을 때
When download_pdf()를 실행하면
Then PDF 파일이 {company_code}/{product_code}/{version}.pdf 경로에 저장되어야 한다
And 파일 크기가 0바이트가 아니어야 한다
```

### AC-03.2: 스토리지 전환

```gherkin
Given CRAWLER_STORAGE_BACKEND 환경변수가 "local"로 설정되어 있을 때
When PDF를 저장하면
Then 로컬 파일시스템에 저장되어야 한다

Given CRAWLER_STORAGE_BACKEND 환경변수가 "s3"로 설정되어 있을 때
When PDF를 저장하면
Then S3 버킷에 업로드되어야 한다
```

### AC-03.3: 자동 인제스션 파이프라인

```gherkin
Given 새로운 약관 PDF가 다운로드되었을 때
When 인제스션 태스크가 실행되면
Then DocumentProcessor.process_pdf()가 호출되어 텍스트 추출, 정제, 청크 분할이 수행되어야 한다
And Policy 레코드가 생성되고 raw_text 필드에 추출된 텍스트가 저장되어야 한다
And PolicyChunk 레코드들이 생성되어야 한다
```

### AC-03.4: 중복 약관 탐지

```gherkin
Given company_id="samsung-life"이고 product_code="PROD-001"인 Policy가 이미 존재할 때
When 동일한 company_id와 product_code의 약관을 인제스션하려 하면
Then 기존 Policy를 업데이트해야 한다 (신규 생성하지 않음)
And 기존 PolicyChunk를 삭제하고 새로운 청크를 생성해야 한다
```

### AC-03.5: 인제스션 실패 재시도

```gherkin
Given 인제스션 과정에서 임베딩 API 호출이 실패할 때
When 재시도 큐에 등록되면
Then 최대 3회까지 재시도해야 한다
And 3회 실패 시 CrawlResult 상태를 FAILED로 설정하고 수동 검토 표시해야 한다
```

---

## 4. 변경 감지 및 델타 크롤링 (REQ-04)

### AC-04.1: 변경 없는 약관 스킵

```gherkin
Given 이전 크롤링에서 content_hash가 "sha256:abc123"으로 저장된 약관이 있을 때
When 동일한 약관의 PDF를 다시 다운로드했는데 SHA-256 해시가 동일하면
Then 해당 약관의 인제스션을 스킵해야 한다
And CrawlResult 상태를 SKIPPED로 기록해야 한다
```

### AC-04.2: 변경된 약관 감지

```gherkin
Given 이전 크롤링에서 content_hash가 "sha256:abc123"으로 저장된 약관이 있을 때
When 동일한 약관의 PDF를 다시 다운로드했는데 SHA-256 해시가 "sha256:def456"이면
Then 해당 약관을 UPDATED로 분류해야 한다
And PDF를 다시 인제스션하고 content_hash를 업데이트해야 한다
```

### AC-04.3: 신규 약관 감지

```gherkin
Given DB에 존재하지 않는 product_code를 가진 약관이 크롤링 결과에 포함될 때
When detect_changes()를 실행하면
Then 해당 약관을 NEW로 분류해야 한다
And 다운로드 및 인제스션을 수행해야 한다
```

### AC-04.4: Policy 메타데이터 업데이트

```gherkin
Given 크롤링을 통해 약관이 인제스션되었을 때
When Policy 레코드를 확인하면
Then metadata_ 필드에 crawler_source, source_url, last_crawled_at, content_hash가 포함되어야 한다
```

---

## 5. 크롤링 스케줄링 및 이력 관리 (REQ-05)

### AC-05.1: Celery Beat 스케줄

```gherkin
Given Celery Beat가 실행 중일 때
When 일요일 02:00 KST가 되면
Then crawl_all 태스크가 자동으로 트리거되어야 한다
```

### AC-05.2: CrawlRun 이력 기록

```gherkin
Given 크롤링이 완료되었을 때
When CrawlRun 레코드를 조회하면
Then started_at, finished_at, total_found, new_count, updated_count, skipped_count, failed_count가 기록되어야 한다
And status가 COMPLETED 또는 FAILED여야 한다
```

### AC-05.3: CrawlResult 개별 기록

```gherkin
Given 크롤링에서 5개의 약관이 처리되었을 때
When CrawlResult를 조회하면
Then 5개의 레코드가 존재해야 한다
And 각 레코드에 product_code, company_code, status가 기록되어야 한다
```

### AC-05.4: API 서버 독립성

```gherkin
Given 크롤링 Celery 태스크가 실행 중일 때
When FastAPI 서버에 일반 API 요청을 보내면
Then 정상적으로 응답해야 한다 (크롤링 작업에 영향 없음)
```

---

## 6. 엣지 케이스

### EC-01: 빈 약관 목록

```gherkin
Given 보험협회 공시 페이지에 약관이 없을 때
When 크롤러가 실행되면
Then CrawlRun을 total_found=0으로 기록하고 정상 완료해야 한다
```

### EC-02: PDF 다운로드 URL 만료

```gherkin
Given 약관 목록에서 추출한 PDF URL이 만료되었을 때
When download_pdf()를 실행하면
Then 404 에러를 기록하고 다음 항목으로 진행해야 한다
```

### EC-03: 대용량 PDF (500페이지 이상)

```gherkin
Given 500페이지 이상의 대용량 약관 PDF가 있을 때
When 인제스션을 시도하면
Then Celery 태스크 타임아웃 내에서 처리가 완료되어야 한다
And 타임아웃 초과 시 FAILED로 기록해야 한다
```

### EC-04: 네트워크 단절

```gherkin
Given 크롤링 진행 중 네트워크가 단절될 때
When 재시도 횟수를 초과하면
Then 현재까지의 성공 결과를 CrawlRun에 기록하고 종료해야 한다
And CrawlRun 상태를 FAILED로 설정하고 에러 로그에 네트워크 오류를 기록해야 한다
```

### EC-05: 동시 크롤링 실행 방지

```gherkin
Given 크롤링 태스크가 이미 실행 중일 때
When 동일한 크롤러에 대해 새로운 크롤링이 트리거되면
Then 중복 실행을 방지하고 기존 작업이 완료될 때까지 대기하거나 스킵해야 한다
```

---

## 7. 품질 게이트

### 성능 기준

| 메트릭 | 기준값 |
|--------|--------|
| 약관 목록 파싱 시간 | 페이지당 10초 이내 |
| PDF 다운로드 속도 | 파일당 30초 이내 |
| 단일 약관 인제스션 시간 | 2분 이내 |
| 전체 크롤링 실행 시간 (Top 10 보험사) | 2시간 이내 |

### 코드 품질

| 메트릭 | 기준값 |
|--------|--------|
| 테스트 커버리지 | 85% 이상 |
| 린트 에러 | 0건 (ruff) |
| 타입 에러 | 0건 (mypy) |
| 보안 취약점 | 0건 (bandit) |

### Definition of Done

- [ ] BaseCrawler 추상 클래스 구현 완료
- [ ] KLIA/KNIA 크롤러 구현 및 통합 테스트 통과
- [ ] FileStorage (로컬/S3) 구현 완료
- [ ] 변경 감지 (SHA-256 해시 비교) 동작 확인
- [ ] 자동 인제스션 파이프라인 (PDF -> DocumentProcessor -> DB) 동작 확인
- [ ] 중복 약관 탐지 및 업데이트 동작 확인
- [ ] Celery 앱 구성 및 태스크 등록 완료
- [ ] CrawlRun/CrawlResult 모델 및 마이그레이션 완료
- [ ] 테스트 커버리지 85% 이상
- [ ] ruff 린트 에러 0건
- [ ] 코드 리뷰 완료
