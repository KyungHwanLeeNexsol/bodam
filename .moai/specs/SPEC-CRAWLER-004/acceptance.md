---
id: SPEC-CRAWLER-004
type: acceptance
created: 2026-03-23
updated: 2026-03-23
author: zuge3
---

# SPEC-CRAWLER-004: 수락 기준

## AC-01: 흥국화재 전체 수집 (REQ-01)

### Scenario 1: 흥국화재 크롤러 전체 실행

```gherkin
Given 흥국화재 크롤러(heungkuk_fire)가 수정되었고
  And Playwright 브라우저가 설치되어 있을 때
When 크롤러를 실행하면
  (cd backend && PYTHONPATH=. python scripts/crawl_nonlife_playwright.py --company heungkuk_fire)
Then backend/data/heungkuk_fire/ 디렉토리에 50개 이상의 PDF 파일이 존재해야 하고
  And 각 PDF 파일마다 대응하는 .json 메타데이터 파일이 존재해야 하고
  And 최소 1개 이상의 메타데이터에 "sale_status": "DISCONTINUED"가 포함되어야 한다
```

### Scenario 2: 흥국화재 메타데이터 정합성

```gherkin
Given 흥국화재 크롤링이 완료되었을 때
When 모든 .json 메타데이터 파일을 검사하면
Then 각 파일에 company_id, company_name, product_name, file_hash, sale_status, crawled_at 필드가 존재해야 하고
  And file_hash는 "sha256:" 접두사를 가져야 하고
  And sale_status는 "ON_SALE" 또는 "DISCONTINUED" 중 하나여야 한다
```

---

## AC-02: 한화손해보험 수집 (REQ-02)

```gherkin
Given 한화손해보험 크롤러(hanwha_general)가 존재하고
  And 한화손해보험 웹사이트가 접속 가능할 때
When 크롤러를 실행하면
Then backend/data/hanwha_general/ 디렉토리에 1개 이상의 PDF 파일이 존재해야 하고
  And 크롤러 실행이 치명적 오류 없이 완료되어야 하고
  And 실패한 다운로드는 WARNING 레벨 로그에 기록되어야 한다
```

---

## AC-03: AXA손해보험 수집 (REQ-03)

```gherkin
Given AXA손해보험 크롤러(axa_general)가 존재하고
  And AXA손해보험 웹사이트가 접속 가능할 때
When 크롤러를 실행하면
Then backend/data/axa_general/ 디렉토리에 1개 이상의 PDF 파일이 존재해야 하고
  And 크롤러 실행이 치명적 오류 없이 완료되어야 한다
```

---

## AC-04: MG손해보험 수집 (REQ-04)

```gherkin
Given MG손해보험 크롤러(mg_insurance)가 존재하고
  And MG손해보험 웹사이트가 접속 가능할 때
When 크롤러를 실행하면
Then backend/data/mg_insurance/ 디렉토리에 1개 이상의 PDF 파일이 존재해야 하고
  And 크롤러 실행이 치명적 오류 없이 완료되어야 한다
```

---

## AC-05: NH농협손해보험 수집 (REQ-05)

```gherkin
Given NH농협손해보험 크롤러(nh_fire)가 존재하고
  And NH농협손해보험 웹사이트가 접속 가능할 때
When 크롤러를 실행하면
Then backend/data/nh_fire/ 디렉토리에 1개 이상의 PDF 파일이 존재해야 하고
  And 크롤러 실행이 치명적 오류 없이 완료되어야 한다
```

---

## AC-06: 롯데손해보험 수집 (REQ-06)

```gherkin
Given 롯데손해보험 크롤러(lotte_insurance)가 존재하고
  And 롯데손해보험 웹사이트가 접속 가능할 때
When 크롤러를 실행하면
Then backend/data/lotte_insurance/ 디렉토리에 1개 이상의 PDF 파일이 존재해야 하고
  And 크롤러 실행이 치명적 오류 없이 완료되어야 한다
```

---

## AC-07: 판매중지 상품 전체 검증 (REQ-07)

### Scenario 1: 전체 회사 판매중지 포함 확인

```gherkin
Given 11개 활성 손해보험사의 크롤링이 완료되었을 때
When 판매중지 검증 스크립트를 실행하면
Then 11개 회사 전체에서 sale_status가 "DISCONTINUED"인 메타데이터가 1개 이상 존재해야 하고
  And 검증 결과가 콘솔에 회사별 통계로 출력되어야 한다
```

### Scenario 2: 판매중지 비율 검증

```gherkin
Given 모든 회사의 메타데이터를 집계했을 때
When 판매중지 비율을 계산하면
Then 전체 PDF 대비 판매중지 상품의 비율이 10% 이상이어야 한다
```

---

## AC-08: DB 인제스트 (REQ-08)

### Scenario 1: 신규 PDF 인제스트

```gherkin
Given 신규 수집된 PDF 파일들이 존재하고
  And Policy 테이블이 접근 가능할 때
When 인제스트 스크립트를 실행하면
Then Policy 테이블에 새 레코드가 추가되어야 하고
  And CrawlRun 레코드에 실행 요약이 기록되어야 한다
```

### Scenario 2: 중복 PDF 스킵

```gherkin
Given 이미 인제스트된 PDF와 동일한 해시를 가진 PDF가 존재할 때
When 인제스트 스크립트를 실행하면
Then 중복 PDF는 스킵되어야 하고
  And 스킵된 파일 수가 로그에 기록되어야 한다
```

---

## AC-09: 크롤링 리포트 (REQ-09)

```gherkin
Given 크롤링 실행이 완료되었을 때
When 크롤링 결과를 확인하면
Then 콘솔에 회사별 수집 통계(PDF 수, 성공, 실패, 스킵)가 출력되어야 하고
  And backend/data/ 디렉토리에 crawl_report_{timestamp}.json 파일이 생성되어야 하고
  And 리포트에 총 수집 시간, 회사별 상세 통계가 포함되어야 한다
```

---

## Quality Gate

### Definition of Done

- [ ] 흥국화재 PDF 50개 이상 수집 완료
- [ ] 한화손해보험 PDF 1개 이상 수집 완료
- [ ] AXA손해보험 PDF 1개 이상 수집 완료
- [ ] MG손해보험 PDF 1개 이상 수집 완료
- [ ] NH농협손해보험 PDF 1개 이상 수집 완료
- [ ] 롯데손해보험 PDF 1개 이상 수집 완료
- [ ] 11개 전체 회사 판매중지 상품 포함 확인
- [ ] 수집 데이터 Policy DB 인제스트 완료
- [ ] 크롤링 결과 리포트 생성
- [ ] 모든 크롤러 실행 시 치명적 오류 없음

### 검증 도구

- `backend/scripts/crawl_nonlife_playwright.py --company {id}`: 개별 회사 크롤러 실행
- 판매중지 검증 스크립트: JSON 메타데이터 sale_status 필드 집계
- DB 인제스트 검증: Policy 테이블 레코드 수 조회
