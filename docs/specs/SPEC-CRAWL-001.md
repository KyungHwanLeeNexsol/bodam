# SPEC-CRAWL-001: 전체 보험사 질병/상해 보험상품 약관 수집 완료

---
SPEC-ID: SPEC-CRAWL-001
Title: 전체 보험사 질병/상해 보험상품 약관 수집 완료
Status: Planned
Priority: High
Created: 2026-03-19
---

## 1. 환경 (Environment)

### 1.1 현재 시스템 현황

**데이터 소스:**
- 생명보험 공시실: `pub.insure.or.kr` (금융감독원 운영)
- 손해보험 공시실: `kpub.knia.or.kr` (손해보험협회 운영)
- 생명보험협회: `klia.or.kr` (상품 목록 및 약관)
- 손해보험협회: `knia.or.kr` (신상품 검토, 비교공시)

**기존 크롤러:**
- `backend/scripts/crawl_klia.py` - KLIA + pub.insure.or.kr 크롤러 (부분 동작)
- `backend/scripts/crawl_real.py` - KNIA 손해보험 크롤러 (미동작 - 데이터 미저장)
- `backend/scripts/crawl_standalone.py` - 통합 크롤러
- `backend/app/services/crawler/` - 서비스 레이어 크롤러 (BaseCrawler 프레임워크)

**기존 데이터 (backend/data/):**

| 디렉토리 | 파일 수 | 설명 |
|-----------|---------|------|
| abl/ | 5 | ABL생명 |
| aia/ | 3 | AIA생명 |
| bnp/ | 3 | BNP파리바카디프생명 |
| db/ | 5 | DB생명 |
| ibk/ | 1 | IBK연금보험 |
| kb/ | 8 | KB라이프생명 |
| kdb/ | 9 | KDB생명 |
| nh/ | 4 | NH농협생명 |
| **klia-unknown/** | **122** | **회사명 미분류** |
| **합계** | **160** | |

**회사별 크롤러 설정 (YAML):**
- 생명보험사 18개: `backend/app/services/crawler/config/companies/` 에 YAML 설정 존재
- 손해보험사 12개: 동일 디렉토리에 YAML 설정 존재
- 총 30개 보험사 설정 파일 존재

### 1.2 문제점

1. **생명보험 수집 불완전**: 18개사 중 9개사만 데이터 존재, 나머지 9개사 데이터 없음
2. **손해보험 수집 전무**: 12개사 전체 데이터 없음 (crawl_real.py 미동작)
3. **미분류 파일 122개**: klia-unknown/ 폴더에 회사명 매핑 실패 파일 존재
4. **질병/상해 필터링 없음**: 수집된 PDF가 질병/상해 보험 외 상품 포함 가능
5. **데이터 디렉토리 불일치**: backend/data/ 디렉토리명과 config YAML 의 company_id 불일치

### 1.3 기술 환경

- Python 3.13+, Playwright (브라우저 자동화)
- PostgreSQL + pgvector (메타데이터 및 임베딩 저장)
- 기존 BaseCrawler 프레임워크 활용 가능
- 로컬 파일 저장 (backend/data/) + DB 메타데이터 연동

---

## 2. 가정 (Assumptions)

- **ASM-01**: pub.insure.or.kr 과 kpub.knia.or.kr 의 페이지 구조는 크롤링 시점에 변경되지 않았다고 가정한다
- **ASM-02**: 각 보험사의 질병보험/상해보험 상품은 공시실에서 상품 분류 또는 상품명으로 식별 가능하다
- **ASM-03**: klia-unknown/ 폴더의 PDF 파일명에 포함된 보험사 코드 또는 상품명으로 회사를 역매핑할 수 있다
- **ASM-04**: 각 공시실 사이트는 robots.txt 를 준수하는 범위에서 크롤링이 허용된다
- **ASM-05**: 1.5초 이상의 요청 간격을 유지하면 IP 차단 없이 안정적으로 수집 가능하다
- **ASM-06**: PDF 파일 크기가 100바이트 미만인 경우 유효하지 않은 파일로 판단한다

---

## 3. 요구사항 (Requirements)

### 3.1 데이터 수집 완전성

**REQ-CRAWL-001** (Ubiquitous):
시스템은 **항상** 수집 대상 30개 보험사 전체에 대해 질병보험 및 상해보험 약관 PDF를 보유해야 한다.

**REQ-CRAWL-002** (Event-Driven):
**WHEN** 크롤러가 실행되면 **THEN** 각 보험사별로 수집된 상품 수, 신규 다운로드 수, 실패 수를 요약 리포트로 출력해야 한다.

**REQ-CRAWL-003** (State-Driven):
**IF** 특정 보험사의 수집된 상품이 0건이면 **THEN** 해당 보험사를 "미수집" 상태로 표시하고 별도 경고를 출력해야 한다.

### 3.2 손해보험 크롤러 구현

**REQ-CRAWL-010** (Event-Driven):
**WHEN** 손해보험 크롤러가 실행되면 **THEN** kpub.knia.or.kr 공시실에서 12개 손해보험사의 질병/상해 보험 약관 PDF를 다운로드하여 저장해야 한다.

**REQ-CRAWL-011** (Event-Driven):
**WHEN** kpub.knia.or.kr 에서 상품 목록을 가져오면 **THEN** 상품분류가 "질병보험", "상해보험", "장기손해보험(질병)", "장기손해보험(상해)" 에 해당하는 상품만 필터링해야 한다.

**REQ-CRAWL-012** (Unwanted):
시스템은 자동차보험, 화재보험, 보증보험 등 질병/상해와 무관한 상품의 약관을 수집**하지 않아야 한다**.

### 3.3 생명보험 크롤러 보완

**REQ-CRAWL-020** (Event-Driven):
**WHEN** 생명보험 크롤러가 실행되면 **THEN** pub.insure.or.kr 에서 18개 생명보험사 전체의 질병/상해 보험 약관 PDF를 다운로드해야 한다.

**REQ-CRAWL-021** (Event-Driven):
**WHEN** pub.insure.or.kr 에서 상품 목록을 가져오면 **THEN** 상품분류가 "질병보험", "상해보험", "건강보험" 에 해당하는 상품만 필터링해야 한다.

**REQ-CRAWL-022** (State-Driven):
**IF** 현재 수집되지 않은 9개 생명보험사(삼성생명, 한화생명, 교보생명, 신한라이프, 흥국생명, 동양생명, 미래에셋생명, 하나생명, 라이나생명)가 감지되면 **THEN** 해당 보험사를 우선적으로 크롤링해야 한다.

### 3.4 회사명 정규화 (klia-unknown 해결)

**REQ-CRAWL-030** (Event-Driven):
**WHEN** 크롤러가 PDF를 다운로드하면 **THEN** 반드시 보험사 코드(company_id)를 식별하여 해당 보험사 디렉토리에 저장해야 한다.

**REQ-CRAWL-031** (Event-Driven):
**WHEN** klia-unknown/ 폴더의 파일을 재분류하면 **THEN** PDF 내부 텍스트 또는 파일 메타데이터에서 보험사명을 추출하여 올바른 디렉토리로 이동해야 한다.

**REQ-CRAWL-032** (State-Driven):
**IF** PDF에서 보험사를 식별할 수 없으면 **THEN** 해당 파일을 klia-unknown/ 에 유지하되, 파일명과 추출 시도 결과를 로그에 기록해야 한다.

### 3.5 데이터 저장 및 디렉토리 구조

**REQ-CRAWL-040** (Ubiquitous):
시스템은 **항상** 다음 디렉토리 구조로 약관 PDF를 저장해야 한다:

```
backend/data/{company_id}/
  {product_name}_{product_code}.pdf
```

- `company_id`: YAML 설정 파일명과 동일 (예: samsung_life, samsung_fire)
- `product_name`: 상품명 (파일시스템 안전 문자열로 변환)
- `product_code`: 공시실 고유 상품코드 (있는 경우)

**REQ-CRAWL-041** (Ubiquitous):
시스템은 **항상** 수집된 PDF의 메타데이터를 JSON 파일로 관리해야 한다:

```json
{
  "company_id": "samsung_life",
  "company_name": "삼성생명",
  "product_name": "무배당 삼성생명 건강보험",
  "product_type": "질병보험",
  "source_url": "https://pub.insure.or.kr/...",
  "file_path": "samsung_life/무배당_삼성생명_건강보험_A1234.pdf",
  "file_hash": "sha256:...",
  "crawled_at": "2026-03-19T10:00:00+09:00",
  "file_size_bytes": 245678
}
```

**REQ-CRAWL-042** (Event-Driven):
**WHEN** 이미 동일한 file_hash 의 PDF가 존재하면 **THEN** 다시 다운로드하지 않고 메타데이터만 업데이트해야 한다 (델타 크롤링).

### 3.6 상품 유형 필터링

**REQ-CRAWL-050** (Ubiquitous):
시스템은 **항상** 다음 키워드를 사용하여 질병/상해 보험 상품을 식별해야 한다:

**포함 키워드 (하나 이상 매칭):**
- 질병, 상해, 건강, 암, 치아, 치매, 간병, 실손, 의료, CI, GI
- 장기손해보험(질병), 장기손해보험(상해)

**제외 키워드 (하나라도 매칭시 제외):**
- 자동차, 화재, 보증, 책임, 배상, 운전자, 해상, 항공

**REQ-CRAWL-051** (Optional):
**가능하면** 공시실 API 또는 페이지의 상품분류 필드를 우선 사용하고, 없는 경우에만 상품명 키워드 매칭으로 필터링을 제공해야 한다.

### 3.7 에러 처리 및 안정성

**REQ-CRAWL-060** (Event-Driven):
**WHEN** PDF 다운로드가 실패하면 **THEN** 최대 3회까지 지수 백오프로 재시도해야 한다 (1초, 3초, 9초).

**REQ-CRAWL-061** (Event-Driven):
**WHEN** 특정 보험사 크롤링 전체가 실패하면 **THEN** 해당 보험사를 건너뛰고 나머지 보험사 크롤링을 계속 진행해야 한다.

**REQ-CRAWL-062** (State-Driven):
**IF** HTTP 429 (Too Many Requests) 응답을 받으면 **THEN** 요청 간격을 현재의 2배로 늘리고, 최대 30초까지 대기한 후 재시도해야 한다.

**REQ-CRAWL-063** (Unwanted):
시스템은 1.5초 미만의 간격으로 동일 도메인에 연속 요청을 보내**지 않아야 한다**.

---

## 4. 명세 (Specifications)

### 4.1 보험사 매핑 테이블

#### 생명보험사 (18개)

| company_id | 회사명 | pub.insure.or.kr 매핑 | 현재 데이터 |
|---|---|---|---|
| samsung_life | 삼성생명 | 삼성생명보험(주) | 없음 |
| hanwha_life | 한화생명 | 한화생명보험(주) | 없음 |
| kyobo_life | 교보생명 | 교보생명보험(주) | 없음 |
| shinhan_life | 신한라이프 | 신한라이프생명보험(주) | 없음 |
| heungkuk_life | 흥국생명 | 흥국생명보험(주) | 없음 |
| dongyang_life | 동양생명 | 동양생명보험(주) | 없음 |
| mirae_life | 미래에셋생명 | 미래에셋생명보험(주) | 없음 |
| nh_life | NH농협생명 | 농협생명보험(주) | 4건 |
| db_life | DB생명 | DB생명보험(주) | 5건 |
| kdb_life | KDB생명 | KDB생명보험(주) | 9건 |
| dgb_life | DGB생명 | DGB생명보험(주) | 없음 |
| hana_life | 하나생명 | 하나생명보험(주) | 없음 |
| aia_life | AIA생명 | AIA생명보험(주) | 3건 |
| metlife | 메트라이프 | 메트라이프생명보험(주) | 없음 |
| lina_life | 라이나생명 | 라이나생명보험(주) | 없음 |
| im_life | iM라이프 | iM라이프생명보험(주) | 없음 |
| kyobo_lifeplanet | 교보라이프플래닛 | 교보라이프플래닛생명보험(주) | 없음 |
| fubon_hyundai_life | 푸본현대생명 | 푸본현대생명보험(주) | 없음 |

**참고**: abl(5건), bnp(3건), ibk(1건), kb(8건) 은 기존 데이터 디렉토리에 존재하나 위 18개사 목록과 매핑이 필요함.

#### 손해보험사 (12개)

| company_id | 회사명 | kpub.knia.or.kr 매핑 | 현재 데이터 |
|---|---|---|---|
| samsung_fire | 삼성화재 | 삼성화재해상보험(주) | 없음 |
| hyundai_marine | 현대해상 | 현대해상화재보험(주) | 없음 |
| db_insurance | DB손해보험 | DB손해보험(주) | 없음 |
| kb_insurance | KB손해보험 | KB손해보험(주) | 없음 |
| meritz_fire | 메리츠화재 | 메리츠화재해상보험(주) | 없음 |
| hanwha_general | 한화손해보험 | 한화손해보험(주) | 없음 |
| heungkuk_fire | 흥국화재 | 흥국화재해상보험(주) | 없음 |
| axa_general | AXA손해보험 | AXA손해보험(주) | 없음 |
| hana_insurance | 하나손해보험 | 하나손해보험(주) | 없음 |
| mg_insurance | MG손해보험 | MG손해보험(주) | 없음 |
| nh_insurance | NH농협손해보험 | NH농협손해보험(주) | 없음 |
| lotte_insurance | 롯데손해보험 | 롯데손해보험(주) | 없음 |

### 4.2 크롤러 전략

#### Phase A: 손해보험 크롤러 수리 (crawl_real.py)

1. kpub.knia.or.kr 페이지 구조 재분석 (Playwright 사용)
2. 상품 목록 API/페이지 파싱 로직 구현
3. 질병/상해 상품 필터링 적용
4. PDF 다운로드 및 company_id 별 디렉토리 저장
5. 메타데이터 JSON 생성

#### Phase B: 생명보험 크롤러 보완 (crawl_klia.py)

1. pub.insure.or.kr 에서 누락된 9개 보험사 크롤링
2. 회사명 정규화 로직 강화 (매핑 테이블 기반)
3. 상품분류 필터링 추가 (질병/상해/건강보험만)
4. 기존 파일과 중복 방지 (SHA-256 해시 비교)

#### Phase C: klia-unknown 재분류

1. 122개 파일의 PDF 텍스트 추출 (pdfplumber)
2. 첫 2페이지에서 보험사명 패턴 매칭
3. 매핑 성공시 해당 company_id 디렉토리로 이동
4. 매핑 실패시 klia-unknown/ 유지 + 로그 기록

#### Phase D: 검증 및 리포트

1. 전체 보험사별 수집 현황 리포트 생성
2. 목표 달성률 계산 (수집 완료 보험사 / 전체 30개)
3. 미수집 보험사 목록 및 실패 원인 기록

### 4.3 "완료" 기준 정의

크롤링 작업은 다음 조건을 **모두** 충족할 때 "완료"로 판정한다:

1. **생명보험 18개사 전체**에서 각 1건 이상의 질병 또는 상해 보험 약관 PDF가 존재
2. **손해보험 12개사 전체**에서 각 1건 이상의 질병 또는 상해 보험 약관 PDF가 존재
3. **klia-unknown/ 파일이 50건 이하**로 감소 (122건에서 최소 72건 재분류)
4. 모든 수집 파일에 대한 **메타데이터 JSON**이 존재
5. 수집된 모든 PDF의 파일 크기가 **100바이트 이상** (유효성 검증)

### 4.4 회사명 정규화 매핑

PDF 내부 또는 공시실 페이지에서 추출되는 회사명 변형을 company_id로 매핑하는 사전:

```python
COMPANY_NAME_MAP = {
    # 생명보험사
    "삼성생명": "samsung_life",
    "삼성생명보험": "samsung_life",
    "한화생명": "hanwha_life",
    "한화생명보험": "hanwha_life",
    "교보생명": "kyobo_life",
    "교보생명보험": "kyobo_life",
    "신한라이프": "shinhan_life",
    "신한라이프생명": "shinhan_life",
    "신한생명": "shinhan_life",  # 이전 사명
    "흥국생명": "heungkuk_life",
    "동양생명": "dongyang_life",
    "미래에셋생명": "mirae_life",
    "미래에셋대우생명": "mirae_life",  # 이전 사명
    "NH농협생명": "nh_life",
    "농협생명": "nh_life",
    "DB생명": "db_life",
    "KDB생명": "kdb_life",
    "KDB산업은행생명": "kdb_life",
    "DGB생명": "dgb_life",
    "DGB다솜생명": "dgb_life",
    "하나생명": "hana_life",
    "AIA생명": "aia_life",
    "메트라이프": "metlife",
    "메트라이프생명": "metlife",
    "라이나생명": "lina_life",
    "라이나생명보험": "lina_life",
    "iM라이프": "im_life",
    "교보라이프플래닛": "kyobo_lifeplanet",
    "푸본현대생명": "fubon_hyundai_life",
    "현대라이프": "fubon_hyundai_life",  # 이전 사명
    "ABL생명": "abl_life",
    "BNP파리바카디프": "bnp_life",
    "IBK연금보험": "ibk_life",
    "KB라이프": "kb_life",
    "KB생명": "kb_life",
    # 손해보험사
    "삼성화재": "samsung_fire",
    "삼성화재해상": "samsung_fire",
    "현대해상": "hyundai_marine",
    "현대해상화재": "hyundai_marine",
    "DB손해보험": "db_insurance",
    "DB손보": "db_insurance",
    "KB손해보험": "kb_insurance",
    "KB손보": "kb_insurance",
    "메리츠화재": "meritz_fire",
    "메리츠화재해상": "meritz_fire",
    "한화손해보험": "hanwha_general",
    "한화손보": "hanwha_general",
    "흥국화재": "heungkuk_fire",
    "흥국화재해상": "heungkuk_fire",
    "AXA손해보험": "axa_general",
    "AXA손보": "axa_general",
    "하나손해보험": "hana_insurance",
    "하나손보": "hana_insurance",
    "MG손해보험": "mg_insurance",
    "MG손보": "mg_insurance",
    "NH농협손해보험": "nh_insurance",
    "농협손보": "nh_insurance",
    "롯데손해보험": "lotte_insurance",
    "롯데손보": "lotte_insurance",
}
```

---

## 5. 구현 계획 (Implementation Plan)

### 마일스톤 1: 손해보험 크롤러 수리 (Primary Goal)

**작업 내용:**
- [ ] kpub.knia.or.kr 사이트 구조 분석 (Playwright inspect)
- [ ] 상품 목록 페이지 파싱 로직 구현
- [ ] 질병/상해 상품 필터링 구현 (REQ-CRAWL-050)
- [ ] 12개 손해보험사 PDF 다운로드 구현
- [ ] 메타데이터 JSON 생성 로직

**산출물:** 12개 손해보험사에서 각 1건 이상의 질병/상해 약관 PDF

### 마일스톤 2: 생명보험 크롤러 보완 (Primary Goal)

**작업 내용:**
- [ ] pub.insure.or.kr 에서 누락 9개사 크롤링
- [ ] 회사명 정규화 매핑 테이블 적용
- [ ] 상품분류 필터링 추가
- [ ] 델타 크롤링 (SHA-256 해시 비교)

**산출물:** 18개 생명보험사 전체에서 각 1건 이상의 질병/상해 약관 PDF

### 마일스톤 3: klia-unknown 재분류 (Secondary Goal)

**작업 내용:**
- [ ] pdfplumber로 122개 파일 텍스트 추출
- [ ] 보험사명 패턴 매칭 스크립트 작성
- [ ] 매핑 성공 파일 이동 (company_id 디렉토리)
- [ ] 매핑 실패 파일 로그 기록

**산출물:** klia-unknown/ 파일이 50건 이하로 감소

### 마일스톤 4: 검증 리포트 (Final Goal)

**작업 내용:**
- [ ] 전체 수집 현황 리포트 스크립트 작성
- [ ] 보험사별 수집 건수 집계
- [ ] "완료" 기준 충족 여부 판정
- [ ] 메타데이터 무결성 검증

**산출물:** 수집 완료 리포트 (JSON + 콘솔 출력)

---

## 6. 수용 기준 (Acceptance Criteria)

### AC-01: 손해보험 수집 완료

```gherkin
Given 손해보험 크롤러가 실행되었을 때
When 12개 손해보험사에 대해 크롤링이 완료되면
Then 각 보험사 디렉토리(samsung_fire, hyundai_marine, ...)에
     1건 이상의 질병 또는 상해 보험 약관 PDF가 존재해야 한다
And  각 PDF의 파일 크기가 100바이트 이상이어야 한다
And  각 PDF에 대한 메타데이터 JSON 레코드가 존재해야 한다
```

### AC-02: 생명보험 수집 보완 완료

```gherkin
Given 생명보험 크롤러가 실행되었을 때
When 18개 생명보험사에 대해 크롤링이 완료되면
Then 각 보험사 디렉토리에 1건 이상의 질병/상해 약관 PDF가 존재해야 한다
And  기존에 누락되었던 9개사(삼성, 한화, 교보, 신한, 흥국, 동양, 미래에셋, 하나, 라이나)
     모두 데이터가 수집되어야 한다
```

### AC-03: 상품 필터링 정확성

```gherkin
Given 수집이 완료된 상태에서
When 임의의 10개 PDF를 샘플 검증하면
Then 10개 중 8개 이상이 질병보험 또는 상해보험 관련 약관이어야 한다
And  자동차보험, 화재보험 등 무관한 상품이 포함되지 않아야 한다
```

### AC-04: klia-unknown 재분류

```gherkin
Given klia-unknown/ 폴더에 122개 파일이 존재하는 상태에서
When 재분류 스크립트를 실행하면
Then klia-unknown/ 폴더의 파일이 50건 이하로 감소해야 한다
And  재분류된 파일은 올바른 company_id 디렉토리에 이동되어야 한다
And  재분류 결과 로그가 생성되어야 한다
```

### AC-05: 델타 크롤링

```gherkin
Given 이미 수집된 PDF가 존재하는 상태에서
When 동일한 크롤러를 재실행하면
Then 이미 존재하는 동일 해시의 PDF는 다시 다운로드하지 않아야 한다
And  신규 또는 변경된 PDF만 다운로드해야 한다
```

### AC-06: 에러 복구

```gherkin
Given 크롤링 중 특정 보험사에서 네트워크 오류가 발생했을 때
When 해당 보험사 크롤링이 3회 재시도 후에도 실패하면
Then 해당 보험사를 건너뛰고 나머지 보험사 크롤링을 계속해야 한다
And  실패한 보험사와 오류 내용을 최종 리포트에 포함해야 한다
```

### AC-07: 수집 완료 리포트

```gherkin
Given 모든 크롤링이 완료된 후
When 검증 스크립트를 실행하면
Then 다음 정보를 포함한 리포트를 출력해야 한다:
     - 보험사별 수집 상품 수 (30개사 전체)
     - 총 수집 PDF 수
     - klia-unknown 잔여 파일 수
     - "완료" 기준 충족 여부 (Pass/Fail)
     - 미수집 보험사 목록 (있는 경우)
```

---

## 7. 기술적 고려사항

### 7.1 크롤링 윤리

- 각 사이트의 robots.txt 준수
- 요청 간격 최소 1.5초 유지
- User-Agent 헤더에 봇 식별 정보 포함
- 업무 시간 외(야간, 주말) 대량 크롤링 실행 권장

### 7.2 기존 코드 활용

- `backend/app/services/crawler/base.py`의 BaseCrawler 프레임워크 활용
- `backend/app/services/crawler/config/companies/*.yaml` 설정 활용
- `backend/scripts/crawl_klia.py`의 기존 로직 보존 및 확장
- `backend/scripts/crawl_real.py`의 구조 유지, 저장 로직 수정

### 7.3 데이터 디렉토리 통합

기존 `backend/data/` 하위 디렉토리와 YAML 설정의 company_id 통합:
- `abl/` -> `abl_life/` (또는 별도 매핑)
- `bnp/` -> `bnp_life/`
- `ibk/` -> `ibk_life/`
- `kb/` -> `kb_life/`
- 신규 수집분은 YAML company_id 기준 디렉토리 생성

### 7.4 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| 공시실 페이지 구조 변경 | 크롤러 동작 불가 | Playwright 사용으로 동적 페이지 대응 |
| IP 차단 | 수집 중단 | 요청 간격 준수, VPN 대비 |
| PDF 파일이 이미지 스캔본 | 텍스트 추출 불가 | OCR 파이프라인 활용 (기존 구현) |
| 상품분류 정보 부재 | 필터링 부정확 | 키워드 매칭 폴백 사용 |

---

## 8. 전문가 상담 권장

이 SPEC는 다음 도메인의 전문가 상담이 유용할 수 있습니다:

- **expert-backend**: 크롤러 구현 아키텍처 설계, Playwright 사용 패턴, 에러 처리 전략
- **expert-devops**: 자동화된 크롤링 스케줄링 (Celery Beat 또는 GitHub Actions)

---

## 9. 다음 단계

1. `/moai:2-run SPEC-CRAWL-001` 으로 구현 시작
2. 구현 완료 후 `/moai:3-sync SPEC-CRAWL-001` 으로 문서 동기화
3. 수집 완료 데이터를 기반으로 임베딩 배치 실행 (기존 `daily_embed.py`)
