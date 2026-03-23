---
id: SPEC-CRAWLER-004
version: 1.0.0
status: planned
created: 2026-03-23
updated: 2026-03-23
author: zuge3
priority: high
issue_number: 0
tags: [crawler, nonlife-insurance, playwright, data-collection, pdf]
dependencies: [SPEC-CRAWLER-001, SPEC-DATA-002]
blocks: [SPEC-PIPELINE-001, SPEC-EMBED-001]
---

# SPEC-CRAWLER-004: 손해보험 약관 PDF 수집 완료

## HISTORY

| 버전 | 날짜 | 작성자 | 변경 내용 |
|------|------|--------|-----------|
| 1.0.0 | 2026-03-23 | zuge3 | 초안 작성 - 손해보험 미수집/불완전 회사 크롤링 완료 SPEC |

---

## 1. Environment (환경)

### 1.1 시스템 컨텍스트

Bodam 플랫폼의 보험 약관 지식 베이스는 손해보험 12개사 중 5개사만 수집이 완료된 상태이다. 나머지 6개사는 크롤러 코드가 존재하나 미실행이거나 불완전한 상태이며, 1개사(하나손해보험)는 사이트 다운으로 제외된다.

**현재 수집 현황:**

| 보험사 | company_id | PDF 수 | 상태 | 판매중지 포함 |
|--------|-----------|--------|------|-------------|
| 삼성화재 | samsung_fire | 8,132 | 완료 | O (MIN_SALE_END_DT="19000101") |
| 현대해상 | hyundai_marine | 3,575 | 완료 | O (slNProdList API) |
| DB손해보험 | db_insurance | 2,110 | 완료 | O (sl_yn=0) |
| 메리츠화재 | meritz_fire | 542 | 완료 | O (Playwright tab) |
| KB손해보험 | kb_insurance | 488 | 완료 | O (Playwright tab) |
| 흥국화재 | heungkuk_fire | 9 | **불완전** | X (판매중 일부만) |
| 한화손해보험 | hanwha_general | 0 | **미실행** | - |
| AXA손해보험 | axa_general | 0 | **미실행** | - |
| MG손해보험 | mg_insurance | 0 | **미실행** | - |
| NH농협손해보험 | nh_fire | 0 | **미실행** | - |
| 롯데손해보험 | lotte_insurance | 0 | **미실행** | - |
| 하나손해보험 | hana_insurance | - | **제외** | - (사이트 다운) |

**목표 상태:** 11개 손해보험사(하나손해보험 제외) 전체에서 질병/상해 관련 약관 PDF를 판매중 + 판매중지 상품 모두 포함하여 수집 완료

### 1.2 기존 크롤러 인프라

- **메인 크롤러 스크립트**: `backend/scripts/crawl_nonlife_playwright.py` (96KB)
  - 10개 회사별 Playwright 기반 크롤링 메서드 구현
  - `save_pdf()` 공통 함수로 PDF 저장 + JSON 메타데이터 생성
  - `is_disease_injury()` 함수로 질병/상해 상품 필터링
  - SHA-256 해시 기반 중복 방지
- **대체 구현**: `backend/scripts/crawl_nonlife.py` (29KB)
- **공통 상수**: `backend/scripts/crawl_constants.py`
  - `NONLIFE_COMPANY_IDS`: 12개 손해보험사 ID 목록
  - `DISEASE_INJURY_INCLUDE` / `DISEASE_INJURY_EXCLUDE`: 필터링 키워드
  - `save_pdf_with_metadata()`: 공통 PDF 저장 + 메타데이터 함수
- **데이터 저장 경로**: `backend/data/{company_id}/` 하위에 PDF + JSON 메타데이터

### 1.3 기술 스택

- **Playwright**: 비동기 브라우저 자동화 (Chromium)
- **Python 3.13+**: asyncio 기반 비동기 크롤링
- **CockroachDB**: 크롤링 결과 및 Policy 메타데이터 저장 (Neon 대체 완료)
- **로컬 파일시스템**: PDF 저장 (S3 전환 예정)

---

## 2. Assumptions (가정)

### 2.1 기술적 가정

- A1: `crawl_nonlife_playwright.py`에 구현된 각 회사별 크롤링 메서드가 기본적으로 동작 가능하다
- A2: 흥국화재 크롤러는 로직 결함(페이지네이션 미처리 또는 카테고리 누락)으로 9개만 수집되었다
- A3: 한화/AXA/MG/NH/롯데 크롤러는 코드가 존재하나 실행되지 않았을 뿐이다
- A4: 각 보험사 웹사이트가 현재 접속 가능하다 (하나손해보험 제외)
- A5: 보험사 웹사이트 구조가 크롤러 작성 시점 대비 크게 변경되지 않았다

### 2.2 비즈니스 가정

- A6: 판매중지(DISCONTINUED) 상품의 약관도 Bodam 서비스에 필수적이다 (기존 보험 가입자 대상)
- A7: 질병/상해 관련 상품만 수집하며, 자동차/화재/보증 등은 제외한다
- A8: 각 회사별 최소 50개 이상의 질병/상해 관련 약관이 존재할 것으로 예상한다

### 2.3 위험 가정

- A9: 보험사 웹사이트 봇 차단(rate limiting, CAPTCHA)이 Playwright로 우회 가능하다
- A10: PDF 파일 용량이 개별 100MB 이하이며, 전체 저장 용량이 50GB 이내이다

---

## 3. Requirements (요구사항)

### REQ-01: 흥국화재 크롤러 수정 및 전체 수집

**WHEN** 흥국화재(heungkuk_fire) 크롤러를 실행하면 **THEN** 시스템은 질병/상해 관련 모든 상품의 약관 PDF를 수집해야 한다 (현재 9개 -> 목표 50개 이상)

- 수집 범위: 판매중(ON_SALE) + 판매중지(DISCONTINUED) 모든 상품
- 디버깅 항목: 페이지네이션, 카테고리 탭 전환, 상품 목록 로딩 대기
- 결과: `backend/data/heungkuk_fire/` 디렉토리에 PDF + JSON 메타데이터 저장

**수락 기준:**
- 흥국화재 수집 PDF 수가 50개 이상
- 판매중지 상품 PDF가 1개 이상 포함됨
- 모든 PDF에 대응하는 JSON 메타데이터 파일 존재

### REQ-02: 한화손해보험 크롤러 실행 및 수집

**WHEN** 한화손해보험(hanwha_general) 크롤러를 실행하면 **THEN** 시스템은 질병/상해 관련 모든 상품의 약관 PDF를 수집해야 한다

- 기존 코드: `crawl_nonlife_playwright.py`의 `hanwha_general` 메서드
- 수집 범위: 판매중 + 판매중지 모든 상품
- 결과: `backend/data/hanwha_general/` 디렉토리에 PDF + JSON 메타데이터 저장

**수락 기준:**
- 한화손해보험 수집 PDF 수가 1개 이상
- 크롤러 실행 시 치명적 오류(crash) 없이 완료
- 실패한 PDF 다운로드는 로그에 기록

### REQ-03: AXA손해보험 크롤러 실행 및 수집

**WHEN** AXA손해보험(axa_general) 크롤러를 실행하면 **THEN** 시스템은 질병/상해 관련 모든 상품의 약관 PDF를 수집해야 한다

- 기존 코드: `crawl_nonlife_playwright.py`의 `axa_general` 메서드
- 수집 범위: 판매중 + 판매중지 모든 상품
- 결과: `backend/data/axa_general/` 디렉토리에 PDF + JSON 메타데이터 저장

**수락 기준:**
- AXA손해보험 수집 PDF 수가 1개 이상
- 크롤러 실행 시 치명적 오류 없이 완료

### REQ-04: MG손해보험 크롤러 실행 및 수집

**WHEN** MG손해보험(mg_insurance) 크롤러를 실행하면 **THEN** 시스템은 질병/상해 관련 모든 상품의 약관 PDF를 수집해야 한다

- 기존 코드: `crawl_nonlife_playwright.py`의 `mg_insurance` 메서드
- 수집 범위: 판매중 + 판매중지 모든 상품
- 결과: `backend/data/mg_insurance/` 디렉토리에 PDF + JSON 메타데이터 저장

**수락 기준:**
- MG손해보험 수집 PDF 수가 1개 이상
- 크롤러 실행 시 치명적 오류 없이 완료

### REQ-05: NH농협손해보험 크롤러 실행 및 수집

**WHEN** NH농협손해보험(nh_fire) 크롤러를 실행하면 **THEN** 시스템은 질병/상해 관련 모든 상품의 약관 PDF를 수집해야 한다

- 기존 코드: `crawl_nonlife_playwright.py`의 `nh_fire` 메서드
- 수집 범위: 판매중 + 판매중지 모든 상품
- 결과: `backend/data/nh_fire/` (또는 `nh_insurance/`) 디렉토리에 PDF + JSON 메타데이터 저장

**수락 기준:**
- NH농협손해보험 수집 PDF 수가 1개 이상
- 크롤러 실행 시 치명적 오류 없이 완료

### REQ-06: 롯데손해보험 크롤러 실행 및 수집

**WHEN** 롯데손해보험(lotte_insurance) 크롤러를 실행하면 **THEN** 시스템은 질병/상해 관련 모든 상품의 약관 PDF를 수집해야 한다

- 기존 코드: `crawl_nonlife_playwright.py`의 `lotte_insurance` 메서드
- 수집 범위: 판매중 + 판매중지 모든 상품
- 결과: `backend/data/lotte_insurance/` 디렉토리에 PDF + JSON 메타데이터 저장

**수락 기준:**
- 롯데손해보험 수집 PDF 수가 1개 이상
- 크롤러 실행 시 치명적 오류 없이 완료

### REQ-07: 판매중지 상품 수집 검증

시스템은 **항상** 모든 완료된 손해보험사에 대해 판매중지(DISCONTINUED) 상품 약관 PDF가 포함되어 있어야 한다

- 검증 대상: 11개 활성 손해보험사 전체
- 검증 방법: 각 회사 디렉토리의 JSON 메타데이터에서 `sale_status` 필드 확인
- 기존 완료 회사(삼성화재, 현대해상, DB손해보험, 메리츠화재, KB손해보험)도 재검증

**수락 기준:**
- 11개 회사 전체에서 `sale_status: "DISCONTINUED"` 메타데이터가 포함된 PDF 존재
- 판매중지 상품 비율이 전체의 10% 이상 (예상치 기반)
- 검증 스크립트 실행 결과가 리포트로 출력

### REQ-08: 수집 데이터 DB 인제스트

**WHEN** 크롤링이 완료되면 **THEN** 시스템은 수집된 PDF 메타데이터를 Policy 테이블에 인제스트해야 한다

- 인제스트 대상: 새로 수집된 PDF의 JSON 메타데이터
- 중복 방지: SHA-256 해시 기반 delta 인제스트 (기존 해시와 동일한 PDF는 스킵)
- DB 모델: CrawlRun, CrawlResult, Policy 테이블
- 인제스트 후 Celery 태스크를 통해 벡터 임베딩 파이프라인 트리거

**수락 기준:**
- 인제스트 실행 후 Policy 테이블에 새 레코드 추가
- 중복 PDF는 스킵되고 로그에 기록
- CrawlRun 레코드에 회사별 수집 결과 요약 기록

### REQ-09: 크롤링 실행 추적 및 결과 리포팅

시스템은 **항상** 크롤링 실행 결과를 추적하고 리포트를 생성해야 한다

- 추적 항목: 회사별 수집 PDF 수, 성공/실패/스킵 수, 소요 시간, 에러 목록
- 리포트 형식: 콘솔 출력 + JSON 파일 (`backend/data/crawl_report_{timestamp}.json`)
- CrawlRun DB 모델에 실행 이력 기록

**수락 기준:**
- 크롤링 완료 시 회사별 통계 콘솔 출력
- JSON 리포트 파일 생성
- CrawlRun 레코드에 총 수집 수, 실패 수, 소요 시간 기록

---

## 4. Specifications (세부 사양)

### 4.1 크롤링 실행 순서

각 회사 크롤러는 독립적으로 실행 가능하며, 아래 순서를 권장한다:

**Phase 1 (우선순위 High - 기존 코드 수정):**
1. 흥국화재 (REQ-01): 기존 크롤러 디버깅 및 수정

**Phase 2 (우선순위 High - 기존 코드 실행):**
2. 한화손해보험 (REQ-02)
3. AXA손해보험 (REQ-03)
4. MG손해보험 (REQ-04)
5. NH농협손해보험 (REQ-05)
6. 롯데손해보험 (REQ-06)

**Phase 3 (우선순위 Medium - 검증 및 인제스트):**
7. 판매중지 상품 검증 (REQ-07)
8. DB 인제스트 (REQ-08)
9. 리포팅 (REQ-09)

### 4.2 크롤러 실행 명령어

```bash
# 개별 회사 실행
cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python scripts/crawl_nonlife_playwright.py --company {company_id}

# 전체 실행
cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python scripts/crawl_nonlife_playwright.py
```

### 4.3 데이터 저장 구조

```
backend/data/
  {company_id}/
    {product_name}.pdf          # 약관 PDF
    {product_name}.json         # 메타데이터
```

메타데이터 JSON 스키마:
```json
{
  "company_id": "string",
  "company_name": "string (한국어)",
  "product_name": "string",
  "product_type": "string (질병보험/상해보험/...)",
  "source_url": "string (원본 URL)",
  "file_path": "string (상대 경로)",
  "file_hash": "sha256:string",
  "sale_status": "ON_SALE | DISCONTINUED",
  "crawled_at": "ISO 8601 (KST)",
  "file_size_bytes": "number"
}
```

### 4.4 에러 처리 전략

- **페이지 로딩 실패**: 30초 타임아웃, 최대 3회 재시도 (지수 백오프)
- **PDF 다운로드 실패**: 개별 실패는 로그 기록 후 다음 상품으로 진행
- **봇 차단 감지**: User-Agent 랜덤화, 요청 간 랜덤 딜레이 (1-3초)
- **사이트 구조 변경**: 크롤러별 fallback 로직, 변경 감지 시 경고 로그

### 4.5 판매중지 상품 수집 전략

각 보험사별 판매중지 상품 접근 방식:

| 보험사 | 판매중지 접근 방식 |
|--------|-------------------|
| 삼성화재 | API param: MIN_SALE_END_DT="19000101" |
| 현대해상 | AJAX API: slNProdList endpoint |
| DB손해보험 | URL param: sl_yn=0 |
| 메리츠화재 | Playwright: 판매중지 탭 클릭 |
| KB손해보험 | Playwright: 판매중지 탭 클릭 |
| 흥국화재 | 조사 필요 - 판매중지 탭/파라미터 확인 |
| 한화손해보험 | 조사 필요 - 사이트 구조 분석 |
| AXA손해보험 | 조사 필요 - SPA 구조 분석 |
| MG손해보험 | 조사 필요 - 사이트 구조 분석 |
| NH농협손해보험 | 조사 필요 - 사이트 구조 분석 |
| 롯데손해보험 | 조사 필요 - 사이트 구조 분석 |

---

## 5. Constraints (제약사항)

### 5.1 기술적 제약

- C1: Playwright Chromium 브라우저 필수 (일부 사이트는 headless 모드 차단 가능)
- C2: 크롤링 속도 제한 - 요청 간 최소 1초 딜레이 (사이트 부하 방지)
- C3: 로컬 디스크 공간 충분 확보 필요 (예상 10-30GB 추가)
- C4: Windows 환경에서 실행 (경로 구분자 주의)

### 5.2 비즈니스 제약

- C5: 질병/상해 관련 상품만 수집 (자동차, 화재, 보증 등 제외)
- C6: `DISEASE_INJURY_INCLUDE` / `DISEASE_INJURY_EXCLUDE` 키워드 기반 필터링 적용
- C7: 하나손해보험은 사이트 다운 상태로 수집 불가 - 향후 재시도 대상

---

## 6. Risk Assessment (위험 평가)

| 위험 | 발생 확률 | 영향도 | 대응 전략 |
|------|----------|--------|----------|
| 보험사 사이트 구조 변경 | 중간 | 높음 | 크롤러 작성 시점 대비 변경 여부를 먼저 확인하고, 변경 시 크롤러 코드 수정 |
| 봇 차단 (CAPTCHA, IP 차단) | 중간 | 높음 | 요청 간 랜덤 딜레이, User-Agent 랜덤화, 필요 시 프록시 사용 |
| 흥국화재 9개만 수집된 근본 원인이 사이트 제한 | 낮음 | 중간 | 수동 브라우저 접속으로 실제 상품 수 확인 후 크롤러 수정 |
| 판매중지 상품 접근 방식 미확인 (6개사) | 높음 | 중간 | 각 사이트 수동 분석으로 판매중지 탭/API 파라미터 식별 |
| PDF 용량 초과로 디스크 부족 | 낮음 | 중간 | 수집 전 디스크 공간 확인, 필요 시 S3 업로드 전환 |
| 일부 회사 크롤러가 전혀 동작하지 않음 | 중간 | 중간 | 크롤러 코드를 먼저 dry-run으로 테스트, 실패 시 코드 수정 |

---

## 7. Traceability (추적성)

| 요구사항 | 관련 파일 | 의존성 |
|---------|----------|--------|
| REQ-01 | `backend/scripts/crawl_nonlife_playwright.py` (heungkuk_fire 메서드) | SPEC-CRAWLER-001 |
| REQ-02~06 | `backend/scripts/crawl_nonlife_playwright.py` (각 회사 메서드) | SPEC-CRAWLER-001 |
| REQ-07 | 검증 스크립트 (신규 작성 또는 기존 활용) | REQ-01~06 |
| REQ-08 | `backend/app/services/crawler/ingestor.py`, Policy 모델 | SPEC-PIPELINE-001 |
| REQ-09 | `backend/scripts/crawl_nonlife_playwright.py` (리포팅 로직) | REQ-01~06 |
