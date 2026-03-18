---
id: SPEC-CRAWLER-003
type: plan
version: 1.0.0
created: 2026-03-18
author: zuge3
---

# SPEC-CRAWLER-003 구현 계획: pub.insure.or.kr 생명보험 상품요약서 크롤러

## 개요

pub.insure.or.kr (생명보험협회 공시실)에서 22개 생명보험사의 상품요약서 PDF를 체계적으로 수집하는 크롤러를 구현한다. SSR 방식의 안정적인 사이트로, httpx async HTTP 클라이언트만으로 구현 가능하다. SPEC-CRAWLER-002의 개별 생명보험사 YAML 크롤러(18개)를 대체하는 전략적 변경이다.

---

## Phase 1: PubInsureLifeCrawler 클래스 구현 (Primary Goal)

### 목표

- PubInsureLifeCrawler 핵심 로직 구현
- 목록 조회 (POST), PDF 다운로드 (GET), 메타데이터 추출
- fn_fileDown 정규식 파싱
- Rate limiting 및 에러 핸들링

### 세부 작업

1. **PubInsureLifeCrawler 클래스 생성**
   - `backend/app/services/crawler/companies/pubinsure_life_crawler.py` 신규 생성
   - `BaseCrawler` 상속
   - 22개 보험사 코드, 10개 카테고리 코드 상수 정의
   - httpx.AsyncClient 사용 (Playwright 불필요)

2. **목록 조회 구현 (`_fetch_listing`)**
   - POST `https://pub.insure.or.kr/compareDis/prodCompare/assurance/listNew.do`
   - 파라미터: `pageIndex`, `pageUnit=100`, `search_columnArea=simple`, `all_search_memberCd=all`, `search_prodGroup={code}`
   - HTML 응답 반환

3. **HTML 파싱 구현 (`_parse_listing`)**
   - `fn_fileDown('no', 'seq')` 정규식 패턴 추출
   - 보험사 코드, 보험사명, 상품명, 판매 상태 추출
   - `PolicyListing` 데이터클래스 생성

4. **PDF 다운로드 구현 (`_download_pdf`)**
   - `GET /FileDown.do?fileNo={no}&seq={seq}`
   - `%PDF` magic bytes 검증
   - FileStorage를 통한 저장

5. **페이지네이션 구현**
   - `pageIndex` 증가 순회
   - 빈 결과 시 종료
   - 카테고리별 전체 상품 수집

6. **Rate Limiting 구현**
   - `asyncio.sleep(1.0)` 요청 간 최소 1초 대기
   - 지수 백오프 재시도 (최대 3회)

### 산출물

- `backend/app/services/crawler/companies/pubinsure_life_crawler.py` (신규)

---

## Phase 2: CrawlerRegistry 등록 + Pipeline API 연동 (Secondary Goal)

### 목표

- CrawlerRegistry에 `pub_insure_life` 키로 등록
- 기존 파이프라인 API 엔드포인트 연동
- PolicyIngestor 연동 확인

### 세부 작업

1. **CrawlerRegistry 등록**
   - `registry.py`에 `pub_insure_life` 크롤러 등록
   - `crawl_all()` 메서드에 포함

2. **API 엔드포인트 연동**
   - `/api/v1/crawl/run` 엔드포인트에서 `crawler_type=pub_insure_life` 지원
   - 독립 실행 및 전체 실행 모두 지원

3. **PolicyIngestor 연동**
   - PolicyListing -> Policy DB upsert 플로우 확인
   - `crawler_source=pub_insure_life` 설정
   - 델타 크롤링 (SHA-256 해시 비교) 연동

### 산출물

- `registry.py` 수정
- API 라우터 수정 (필요 시)

---

## Phase 3: 단위 테스트 작성 (Final Goal)

### 목표

- httpx mock 기반 단위 테스트
- 커버리지 85% 이상
- 모든 공개 메서드 테스트

### 세부 작업

1. **HTML 파싱 테스트**
   - fn_fileDown 정규식 패턴 추출 테스트
   - 다양한 HTML 구조에 대한 파싱 테스트
   - 빈 결과, 비정상 HTML에 대한 에러 핸들링 테스트

2. **PDF 다운로드 테스트**
   - 정상 PDF 다운로드 검증
   - 비-PDF 파일 스킵 검증 (magic bytes)
   - 네트워크 오류 시 재시도 검증

3. **페이지네이션 테스트**
   - 단일 페이지 시나리오
   - 다중 페이지 순회 시나리오
   - 빈 결과 종료 시나리오

4. **델타 크롤링 테스트**
   - 동일 해시 스킵 시나리오
   - 변경된 해시 업데이트 시나리오

5. **CrawlerRegistry 테스트**
   - `pub_insure_life` 등록 확인
   - `crawl_all()` 포함 확인

### 산출물

- `tests/unit/test_pubinsure_life_crawler.py` (신규)
- `tests/unit/test_pubinsure_pagination.py` (신규)
- `tests/unit/test_pubinsure_delta_crawling.py` (신규)
- `tests/unit/test_pubinsure_rate_limiting.py` (신규)

---

## Phase 4: Integration 검증 (Optional Goal)

### 목표

- 실제 pub.insure.or.kr 사이트 연동 테스트
- 수집 결과 검증
- 성능 측정

### 세부 작업

1. **실제 사이트 연동 테스트**
   - 1개 카테고리 (종신보험) 제한 실행
   - PDF 다운로드 성공률 확인
   - 메타데이터 정확성 검증

2. **전체 카테고리 실행**
   - 10개 카테고리 전체 순회
   - 수집 건수 확인 (목표: 200+)
   - 실행 시간 측정

3. **DB 저장 검증**
   - PolicyIngestor 연동 확인
   - Policy 레코드 upsert 검증

### 산출물

- `tests/integration/test_pubinsure_live.py` (신규, CI 제외)
- 수집 결과 보고서

---

## 기술적 접근 방식

### 아키텍처 설계 원칙

1. **httpx 기반 경량 크롤링**
   - pub.insure.or.kr은 SSR 사이트로 Playwright 불필요
   - httpx.AsyncClient로 POST/GET 요청만으로 크롤링 가능
   - 메모리 사용량과 실행 속도 대폭 개선 (Playwright 대비)

2. **단일 크롤러로 22개 보험사 커버**
   - SPEC-CRAWLER-002의 18개 개별 YAML 크롤러를 1개 크롤러로 대체
   - 코드 유지보수 부담 대폭 감소
   - 일관된 데이터 품질 보장

3. **기존 프레임워크 재사용**
   - BaseCrawler 상속으로 인터페이스 통일
   - CrawlerRegistry, FileStorage, PolicyIngestor 그대로 사용
   - 델타 크롤링 (SHA-256) 기존 로직 활용

### 중복 제거 전략

- **fileNo + seq 기반 식별**: 동일 상품요약서 식별
- **SHA-256 해시 비교**: 파일 변경 감지
- **KNIA 교차 중복**: 손해보험 데이터와는 별도 소스이므로 충돌 없음

---

## 위험 요소 및 대응 방안

### 위험 1: pub.insure.or.kr API 변경

- **위험**: POST 엔드포인트나 파라미터가 변경되는 경우
- **영향**: 크롤러 전체 동작 불가
- **대응**: 엔드포인트, 파라미터를 상수로 분리하여 빠른 수정 가능. 크롤링 실패 시 알림 설정.

### 위험 2: IP 차단 또는 Rate Limiting 강화

- **위험**: 과도한 요청으로 인한 IP 차단
- **영향**: 크롤링 불가
- **대응**: 최소 1초 간격 유지, 재시도 시 지수 백오프 적용. 필요 시 요청 간격 증가.

### 위험 3: HTML 구조 변경

- **위험**: fn_fileDown 패턴이나 HTML 테이블 구조 변경
- **영향**: 파싱 실패
- **대응**: 정규식 패턴을 상수로 분리. 파싱 실패 시 상세 에러 로그 기록.

---

## 의존성

| 의존성 | 상태 | 영향 |
|--------|------|------|
| SPEC-CRAWLER-001 (BaseCrawler 프레임워크) | 완료 | 기반 시스템 |
| SPEC-CRAWLER-002 (PolicyListing 확장) | 완료 | sale_status 필드 |
| httpx 라이브러리 | 프로젝트 의존성 확인 필요 | HTTP 클라이언트 |
| pub.insure.or.kr 접근 가능성 | 확인됨 (2026-03-18) | 데이터 소스 |

---

## 성공 지표

- Phase 1 완료 시: PubInsureLifeCrawler 핵심 로직 구현, 1개 카테고리 크롤링 성공
- Phase 2 완료 시: CrawlerRegistry 등록, API 엔드포인트 연동 완료
- Phase 3 완료 시: 단위 테스트 커버리지 85% 이상, 모든 요구사항 테스트 커버
- Phase 4 완료 시: 실제 사이트에서 200+ PDF 수집 성공
