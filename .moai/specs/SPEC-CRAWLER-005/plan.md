---
spec_id: SPEC-CRAWLER-005
version: 1.0.0
created: 2026-03-23
updated: 2026-03-23
author: zuge3
---

# SPEC-CRAWLER-005: 구현 계획

## Phase 1: 손해보험 크롤러 완성 [Priority High]

### 1.1 흥국화재 판매중지 버그 수정 (REQ-01-1)

**목표:** 판매중지 44개 상품의 PDF 다운로드 실패 원인 분석 및 수정

**작업 항목:**
1. `crawl_nonlife_playwright.py` 내 흥국화재 크롤링 로직 분석
2. 판매중지 상품 목록 페이지의 PDF 링크 추출 로직 디버깅
3. PDF 다운로드 URL 패턴 확인 (상대 경로 vs 절대 경로 이슈 가능)
4. 버그 수정 및 테스트 실행
5. 수정 후 전체 흥국화재 크롤링 재실행

**예상 결과물:**
- 흥국화재 PDF 수: 63 -> 107+ (44개 이상 증가)
- sale_status에 DISCONTINUED 레코드 추가

**검증 방법:**
```sql
SELECT sale_status, COUNT(*) FROM policies
WHERE company_id = (SELECT id FROM insurance_companies WHERE code = 'heungkuk_fire')
GROUP BY sale_status;
```

### 1.2 한화손해보험 크롤러 구현 (REQ-01-2)

**목표:** 한화손해보험 전용 크롤러 작성 및 실행

**작업 항목:**
1. 한화손해보험 공시 페이지 구조 분석 (URL, 페이지네이션, 판매중지 접근법)
2. GenericNonLifeCrawler 확장 또는 전용 클래스 작성
3. `backend/app/services/crawler/companies/nonlife/hanwha_nonlife_crawler.py` 생성
4. `crawl_nonlife_playwright.py`에 한화 크롤링 함수 추가
5. CrawlerRegistry에 등록
6. 크롤링 실행 및 결과 검증

**예상 결과물:**
- hanwha_general 보험사에 Policy 레코드 생성
- 판매중 + 판매중지 상품 모두 수집

### 1.3 기존 손해보험사 수집 검증 (REQ-01-3)

**목표:** AXA, MG, NH, 롯데 4개사의 수집 완전성 검증

**작업 항목:**
1. 각 보험사별 DB 레코드 확인 (총 수, sale_status 분포)
2. 판매중지 상품 누락 여부 점검
3. 누락 발견 시 해당 크롤러 수정 후 재실행
4. 수집 결과 보고서 작성

**검증 방법:**
```sql
SELECT ic.code, p.sale_status, COUNT(*)
FROM policies p
JOIN insurance_companies ic ON p.company_id = ic.id
WHERE ic.code IN ('axa_general', 'mg_insurance', 'nh_fire', 'lotte_insurance')
GROUP BY ic.code, p.sale_status
ORDER BY ic.code, p.sale_status;
```

---

## Phase 2: 생명보험 크롤러 완성 [Priority High]

### 2.1 생명보험 수집 현황 점검 (REQ-02-1)

**목표:** 22개 생명보험사 전체의 현재 수집 상태 파악

**작업 항목:**
1. DB에서 각 생명보험사별 Policy 레코드 수 집계
2. 기존 GenericLifeCrawler 기반 전용 크롤러 존재 확인
   - 확인된 전용 크롤러: samsung_life, hanwha_life, kyobo_life, shinhan_life, heungkuk_life, dongyang_life, mirae_life, nh_life
3. 미수집 14개사 각각의 공시 페이지 접근성 확인
4. 수집 현황 테이블 업데이트

### 2.2 판매중지 포함 수집 로직 검증 (REQ-02-2)

**목표:** GenericLifeCrawler의 sale_status 매핑 정확성 검증

**작업 항목:**
1. GenericLifeCrawler의 sale_status 설정 로직 코드 리뷰
2. pub.insure.or.kr 생명보험 공시 페이지에서 판매 상태 필드 매핑 확인
3. 각 전용 크롤러의 sale_status 오버라이드 로직 검증
4. 테스트 케이스 작성

### 2.3 미수집 보험사 크롤러 실행 (REQ-02-3)

**목표:** 14개 미수집 생명보험사 크롤링 완료

**작업 항목:**
1. 각 미수집 보험사별 GenericLifeCrawler 설정 또는 전용 크롤러 작성
2. 보험사별 크롤링 실행 (순차적으로, 서버 부하 고려)
3. 수집 결과 검증 (레코드 수, sale_status 분포)
4. 실패한 보험사 원인 분석 및 재시도

**우선순위 (수집 규모 추정 기준):**
- Priority High: kb_life, hana_life, aia_life, metlife (대형 보험사)
- Priority Medium: db_life, kdb_life, lina_life, im_life
- Priority Low: dgb_life, kyobo_lifeplanet, fubon_hyundai_life, abl_life, bnp_life, ibk_life

---

## Phase 3: 수집 상태 관리 API 개발 [Priority High]

### 3.1 API 스키마 정의 (REQ-04)

**목표:** Pydantic 스키마 및 API 라우터 구현

**작업 항목:**
1. `backend/app/schemas/crawl.py` 생성
   - CrawlStatusResponse: 전체 보험사 수집 상태
   - CrawlStatusDetailResponse: 특정 보험사 상세
   - CrawlTriggerRequest / CrawlTriggerResponse
   - CrawlHistoryResponse
   - CrawlSummaryResponse
2. `backend/app/api/v1/admin/crawl.py` 라우터 생성
   - GET /api/v1/admin/crawl/status
   - GET /api/v1/admin/crawl/status/{company_id}
   - POST /api/v1/admin/crawl/trigger/{company_id}
   - GET /api/v1/admin/crawl/history/{company_id}
   - GET /api/v1/admin/crawl/summary
3. main.py에 라우터 등록

### 3.2 수집 상태 서비스 구현

**목표:** 수집 상태 조회 비즈니스 로직 구현

**작업 항목:**
1. `backend/app/services/crawler/status_service.py` 생성
   - get_all_company_status(): 전체 보험사 수집 상태
   - get_company_status_detail(company_id): 특정 보험사 상세
   - get_crawl_history(company_id, page, page_size): 이력 조회
   - get_crawl_summary(): 전체 요약
   - determine_collection_status(company): 수집 상태 판단 로직
2. SQLAlchemy 쿼리 최적화 (JOIN, 집계 쿼리)
3. 응답 캐싱 전략 (Redis, TTL 5분)

### 3.3 크롤링 트리거 구현

**목표:** 비동기 크롤링 트리거 API 구현

**작업 항목:**
1. Celery 태스크: `crawl_company_task(company_id, options)`
2. 중복 실행 방지: Redis lock 기반 (기존 패턴 활용)
3. 실행 상태 추적: CrawlRun 레코드 생성 + 상태 업데이트
4. 파이프라인 연결: 크롤링 완료 시 인제스트 자동 트리거

### 3.4 테스트 작성

**작업 항목:**
1. API 엔드포인트 통합 테스트 (5개 엔드포인트)
2. status_service 단위 테스트
3. 크롤링 트리거 태스크 테스트
4. 에러 케이스 테스트 (404, 409, 500)

---

## Phase 4: 자동화 파이프라인 통합 [Priority Medium]

### 4.1 파이프라인 오케스트레이터 구현 (REQ-03)

**목표:** 크롤링 → 인제스트 → 임베딩 자동 파이프라인

**작업 항목:**
1. `backend/app/services/crawler/pipeline_service.py` 생성
   - run_pipeline(company_id): 전체 파이프라인 실행
   - trigger_ingest(crawl_run_id): 인제스트 트리거
   - trigger_embedding(policy_ids): 임베딩 생성 트리거
2. Celery 체인: crawl -> ingest -> embed
3. 각 단계별 상태 업데이트 및 로깅
4. 실패 시 재시도 로직 (tenacity)

### 4.2 E2E 파이프라인 검증

**작업 항목:**
1. 소규모 보험사(예: mg_insurance)로 E2E 파이프라인 테스트
2. 크롤링 → 인제스트 → 임베딩 전체 흐름 검증
3. PolicyChunk.embedding이 NULL이 아닌 레코드 확인
4. 벡터 검색 테스트 (임베딩된 청크로 유사도 검색)

---

## 마일스톤 요약

| Phase | 목표 | 산출물 | 검증 방법 |
|-------|------|--------|-----------|
| Phase 1 | 손해보험 11개사 완전 수집 | 크롤러 코드 수정/추가, 수집 데이터 | DB 쿼리 검증 |
| Phase 2 | 생명보험 22개사 완전 수집 | 크롤러 코드 추가, 수집 데이터 | DB 쿼리 검증 |
| Phase 3 | 수집 상태 API 5개 엔드포인트 | API 코드, 테스트 | API 호출 테스트 |
| Phase 4 | 자동화 파이프라인 | 파이프라인 서비스, E2E 테스트 | E2E 파이프라인 실행 |

---

## 리스크 및 대응

| 리스크 | 영향도 | 대응 방안 |
|--------|--------|-----------|
| 보험사 웹사이트 구조 변경 | 높음 | Playwright 셀렉터 업데이트, 사이트 모니터링 |
| 일부 보험사 접근 차단 | 중간 | User-Agent 로테이션, 요청 간격 조정 |
| 대량 PDF 처리 시 메모리 부족 | 중간 | 배치 크기 제한, 스트리밍 처리 |
| CockroachDB pgvector 호환성 | 낮음 | PostgreSQL 직접 사용 폴백 |
| 임베딩 API 비용 초과 | 중간 | 배치 크기 최적화, 변경 감지로 재임베딩 최소화 |

---

## 의존성

| 의존 대상 | 상태 | 필요 시점 |
|----------|------|-----------|
| SPEC-CRAWLER-001 (BaseCrawler 프레임워크) | 완료 | Phase 1 |
| SPEC-CRAWLER-003 (생명보험 크롤러) | 완료 | Phase 2 |
| SPEC-CRAWLER-004 (손해보험 크롤러) | 진행 중 | Phase 1 |
| SPEC-EMBED-001 (임베딩 파이프라인) | 완료 | Phase 4 |
| SPEC-PIPELINE-001 (E2E 파이프라인) | 완료 | Phase 4 |
