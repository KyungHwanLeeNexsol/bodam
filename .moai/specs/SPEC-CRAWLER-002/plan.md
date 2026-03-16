---
id: SPEC-CRAWLER-002
type: plan
version: 1.0.0
created: 2026-03-16
author: zuge3
---

# SPEC-CRAWLER-002 구현 계획: 전체 보험사 개별 홈페이지 약관 크롤러

## 개요

SPEC-CRAWLER-001에서 구축된 크롤러 프레임워크를 확장하여 34개 한국 보험사(생명 22개 + 손해 12개)의 개별 홈페이지 공시실에서 약관 PDF를 수집하는 시스템을 구현한다. 판매중/판매중지 상품을 모두 포함하며, YAML 설정 기반의 유연한 크롤러 아키텍처를 채택한다.

---

## Phase 1: 기반 확장 및 셀렉터 탐색 (Primary Goal)

### 목표

- PolicyListing 확장 (sale_status, effective_date, expiry_date)
- YAML 설정 로더 + Pydantic 검증 시스템 구축
- Generic Crawler 기반 아키텍처 구현
- KLIA SPA 문제 수정
- 주요 8개 생명보험사 사이트 탐색 및 YAML 설정 작성

### 세부 작업

1. **PolicyListing 데이터클래스 확장**
   - `SaleStatus` enum 정의 (ON_SALE, DISCONTINUED, UNKNOWN)
   - `sale_status`, `effective_date`, `expiry_date` 필드 추가
   - 기존 KNIA/KLIA 크롤러 호환성 유지 (기본값 UNKNOWN)

2. **YAML 설정 시스템 구축**
   - `config/companies/` 디렉터리 생성
   - `CompanyCrawlerConfig` Pydantic 모델 정의
   - `config_loader.py` 구현 (YAML 파싱 + 검증 + 캐싱)
   - 설정 스키마 문서화

3. **Generic Crawler 구현**
   - `GenericLifeCrawler` 클래스 (YAML 설정 기반)
   - `GenericNonLifeCrawler` 클래스 (YAML 설정 기반)
   - 페이지네이션 핸들러 (numbered, infinite_scroll, load_more)
   - sale_status 매핑 로직

4. **KLIA SPA 수정**
   - `waitForSelector` 명시적 대기 추가
   - `networkidle` 대기 전략 적용
   - 타임아웃 30초로 상향
   - JavaScript 실행을 통한 동적 콘텐츠 로딩

5. **주요 생명보험사 사이트 탐색**
   - 8개 보험사 공시실 페이지 구조 분석
   - CSS 셀렉터 식별 및 YAML 설정 작성
   - PDF 다운로드 URL 패턴 파악

### 산출물

- `base.py` 수정 (PolicyListing 확장)
- `config_loader.py` 신규
- `config/companies/` 디렉터리 + 8개 YAML 파일
- `companies/life/generic_life.py` 신규
- `companies/klia_crawler.py` 수정
- 단위 테스트

---

## Phase 2: 주요 생명보험사 전용 크롤러 (Secondary Goal)

### 목표

- 8개 주요 생명보험사 전용 크롤러 구현
- CrawlerRegistry 확장
- 통합 테스트

### 세부 작업

1. **전용 크롤러 구현** (사이트별 고유 로직이 필요한 경우)
   - `samsung_life.py` - 삼성생명 (JSP/Spring, .do 패턴)
   - `hanwha_life.py` - 한화생명 (Spring)
   - `kyobo_life.py` - 교보생명 (JSP)
   - `shinhan_life.py` - 신한라이프 (Spring)
   - `nh_life.py` - NH농협생명 (Spring)
   - `heungkuk_life.py` - 흥국생명 (Spring)
   - `dongyang_life.py` - 동양생명 (Spring)
   - `mirae_life.py` - 미래에셋생명 (Spring)
   - 참고: YAML Generic Crawler로 충분한 보험사는 전용 크롤러 생략

2. **CrawlerRegistry 확장**
   - YAML 설정 자동 스캔 + 크롤러 인스턴스 자동 생성
   - `crawl_all()` 메서드에 개별 보험사 크롤러 통합
   - 크롤러 실행 순서: 협회 크롤러 -> 개별 크롤러

3. **통합 테스트**
   - 각 크롤러의 parse_listing 모킹 테스트
   - CrawlerRegistry 전체 크롤링 플로우 테스트
   - 델타 크롤링 (기존 KNIA 데이터와 중복 제거)

### 산출물

- `companies/life/*.py` (최대 8개 전용 크롤러)
- `registry.py` 수정
- 통합 테스트

---

## Phase 3: 손해보험사 크롤러 + 나머지 생명보험사 (Final Goal)

### 목표

- 12개 손해보험사 크롤러 (KNIA 보완)
- 나머지 14개 생명보험사 YAML 설정 탐색 및 크롤링
- Generic NonLife Crawler 구현
- 전체 시스템 통합 테스트

### 세부 작업

1. **손해보험사 크롤러**
   - 12개 손해보험사 사이트 탐색 + YAML 설정 작성
   - `GenericNonLifeCrawler` 구현
   - KNIA 중복 제거 로직 (content_hash 비교)
   - 필요 시 전용 크롤러 구현

2. **나머지 생명보험사 YAML 설정**
   - 14개 미확인 보험사 사이트 탐색
   - YAML 설정 작성 (가능한 보험사만)
   - 접근 불가 또는 공시실 미제공 보험사 문서화

3. **전체 시스템 통합**
   - Celery 태스크 확장 (개별 보험사 크롤링 태스크 추가)
   - 크롤링 실행 이력 (CrawlRun) 확장
   - 전체 보험사 크롤링 end-to-end 테스트

### 산출물

- `companies/nonlife/*.py`
- `companies/life/generic_life.py` 활용 (추가 YAML 설정)
- `config/companies/` 디렉터리 (최대 34개 YAML 파일)
- Celery 태스크 수정
- 통합 테스트

---

## 기술적 접근 방식

### 아키텍처 설계 원칙

1. **설정 주도 크롤링 (Configuration-Driven Crawling)**
   - 보험사별 YAML 설정으로 크롤링 동작 정의
   - 사이트 구조 변경 시 코드 수정 없이 YAML만 업데이트
   - Pydantic 검증으로 설정 오류 조기 탐지

2. **전용/범용 크롤러 이원화**
   - 복잡한 사이트: 전용 크롤러 (코드 레벨 로직)
   - 단순한 사이트: Generic Crawler (YAML 설정만으로 구동)
   - BaseCrawler 상속으로 인터페이스 통일

3. **점진적 확장 (Progressive Expansion)**
   - Phase 1에서 기반 구조 완성
   - Phase 2/3에서 보험사별 크롤러 추가
   - 각 Phase 독립적으로 배포 가능

### Playwright 전략

- **SPA 대응**: `waitForSelector` + `networkidle` 조합
- **동적 콘텐츠**: JavaScript 실행을 통한 AJAX 트리거
- **PDF 다운로드**: `FilePathDown.do` 패턴 및 직접 링크 모두 지원
- **한국어 인코딩**: URL 내 한국어 파일명 올바른 인코딩

### 중복 제거 전략

- **동일 소스 중복**: `company_code` + `product_code` UniqueConstraint (기존)
- **교차 소스 중복**: 협회 크롤러와 개별 크롤러 간 `content_hash` 비교
- **우선순위**: 개별 보험사 크롤러 데이터가 협회 데이터보다 최신일 경우 업데이트

---

## 위험 요소 및 대응 방안

### 위험 1: 보험사 사이트 구조 다양성

- **위험**: 34개 보험사의 사이트 구조가 모두 상이하여 Generic Crawler로 대응 불가능한 경우
- **영향**: 전용 크롤러 코드 작성량 증가
- **대응**: Phase 1에서 주요 사이트 구조 패턴을 파악하고, 공통 패턴을 Generic Crawler에 반영. 3개 이상의 패턴이 확인되면 패턴별 중간 레벨 크롤러 도입 검토.

### 위험 2: Anti-scraping 메커니즘

- **위험**: 보험사 사이트에서 자동화된 접근을 차단하는 경우 (CAPTCHA, IP 차단, WAF)
- **영향**: 특정 보험사 크롤링 불가
- **대응**: rate limiting 엄격 적용 (보험사별 최소 3초), User-Agent 로테이션, 실패 시 수동 수집으로 전환

### 위험 3: KLIA SPA 구조 복잡도

- **위험**: waitForSelector만으로 SPA 콘텐츠 로딩이 해결되지 않는 경우
- **영향**: 생명보험 협회 데이터 수집 제한 지속
- **대응**: JavaScript 실행을 통한 API 직접 호출 시도. 최종적으로 KLIA 포기하고 개별 생명보험사 크롤러에 집중.

### 위험 4: 보험사 사이트 구조 변경

- **위험**: 보험사 사이트 리뉴얼로 CSS 셀렉터/URL 패턴 변경
- **영향**: 해당 보험사 크롤링 실패
- **대응**: YAML 설정 업데이트로 신속 대응. CrawlRun 에러 로그를 통한 자동 알림 설정. 크롤링 실패율 모니터링.

---

## 의존성

| 의존성 | 상태 | 영향 |
|--------|------|------|
| SPEC-CRAWLER-001 (BaseCrawler 프레임워크) | 완료 | 기반 시스템 |
| SPEC-DATA-001 (데이터 모델) | 완료 | Policy 모델 |
| SPEC-EMBED-001 (벡터 임베딩) | 완료 | 인제스션 파이프라인 |
| Playwright 브라우저 | 설치 필요 | 크롤링 실행 |

---

## 성공 지표

- Phase 1 완료 시: KLIA SPA 문제 해결 + Generic Crawler 동작 + 최소 3개 생명보험사 YAML 크롤링 성공
- Phase 2 완료 시: 8개 주요 생명보험사 크롤링 성공, 수집 약관 수 500건 이상
- Phase 3 완료 시: 전체 34개 보험사 중 28개 이상 크롤링 성공 (80%+), 총 수집 약관 수 2000건 이상
