---
id: SPEC-CRAWLER-001
type: plan
version: 1.0.0
---

# SPEC-CRAWLER-001: 구현 계획

## 1. 마일스톤 구성

### Primary Goal: 크롤러 프레임워크 및 Celery 인프라

**범위**: BaseCrawler 추상 클래스, FileStorage, Celery 앱 구성, CrawlRun/CrawlResult 모델

**태스크 분해**:

1. **Celery 앱 구성** (REQ-05)
   - `backend/app/tasks/celery_app.py`: Celery 앱 생성, Redis 브로커 연결
   - `backend/app/tasks/__init__.py`: 태스크 모듈 초기화
   - 환경변수: `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`

2. **CrawlRun / CrawlResult 모델** (REQ-05)
   - `backend/app/models/crawler.py`: SQLAlchemy 모델 정의
   - `CrawlStatus`, `CrawlResultStatus` enum 정의
   - Alembic 마이그레이션 생성

3. **BaseCrawler 추상 클래스** (REQ-01)
   - `backend/app/services/crawler/base.py`: ABC 정의
   - 재시도 로직 (tenacity 또는 자체 구현, 지수 백오프)
   - Rate limiting (asyncio.Semaphore + sleep 기반)
   - User-Agent 설정 및 robots.txt 확인
   - 구조화된 에러 로깅

4. **FileStorage 추상화** (REQ-03)
   - `backend/app/services/crawler/storage.py`: 로컬/S3 통합 스토리지
   - 환경변수 `CRAWLER_STORAGE_BACKEND` (local / s3)
   - 경로 규칙: `{company_code}/{product_code}/{version}.pdf`

5. **CrawlerRegistry** (REQ-01)
   - `backend/app/services/crawler/registry.py`: 크롤러 등록/조회
   - 크롤러 이름으로 인스턴스 생성

**의존성**: 없음 (기반 인프라)

### Secondary Goal: 보험협회 크롤러 구현

**범위**: 생명보험협회(KLIA) 크롤러, 손해보험협회(KNIA) 크롤러

**태스크 분해**:

1. **KLIA 크롤러** (REQ-02)
   - `backend/app/services/crawler/companies/klia_crawler.py`
   - Playwright로 klia.or.kr 약관 공시 페이지 접근
   - 약관 목록 파싱 (보험사명, 상품명, 상품코드, 카테고리, PDF URL)
   - PDF 다운로드 및 FileStorage 저장
   - 변경 감지 (SHA-256 해시 비교)

2. **KNIA 크롤러** (REQ-02)
   - `backend/app/services/crawler/companies/knia_crawler.py`
   - 손해보험협회 공시 페이지 구조 분석 및 파싱
   - KLIA 크롤러와 동일한 출력 형식

3. **변경 감지 로직** (REQ-04)
   - `detect_changes()` 구현: DB 기존 데이터와 크롤링 결과 비교
   - `content_hash` 기반 변경 판단
   - DeltaResult: new, updated, unchanged, deleted 분류

**의존성**: Primary Goal 완료 필요

### Tertiary Goal: 자동 인제스션 파이프라인

**범위**: 크롤링 -> DocumentProcessor -> Admin API 연동, Celery 태스크

**태스크 분해**:

1. **크롤링 Celery 태스크** (REQ-05)
   - `backend/app/tasks/crawler_tasks.py`
   - `crawl_all()`: 등록된 모든 크롤러 실행
   - `crawl_single(crawler_name)`: 특정 크롤러 실행
   - `ingest_policy(policy_id, pdf_path)`: 개별 약관 인제스션

2. **자동 인제스션 연동** (REQ-03)
   - PDF 다운로드 -> `DocumentProcessor.process_pdf()`
   - 결과를 Policy 모델에 저장 (raw_text, chunks, metadata_)
   - 중복 탐지: `company_id` + `product_code` UniqueConstraint 활용
   - 인제스션 실패 시 재시도 큐 (최대 3회)

3. **Policy 메타데이터 확장** (REQ-04)
   - `metadata_` 필드에 crawler_source, source_url, last_crawled_at, content_hash 추가
   - Alembic 데이터 마이그레이션 (기존 Policy에 기본값 설정)

**의존성**: Primary Goal + Secondary Goal 완료 필요

### Optional Goal: 스케줄링 및 모니터링

**범위**: Celery Beat 스케줄, 크롤링 이력 API, 관리자 대시보드 데이터

**태스크 분해**:

1. **Celery Beat 스케줄 설정** (REQ-05)
   - 주 1회 전체 크롤링 (일요일 02:00 KST)
   - 보험사별 개별 스케줄 지원
   - 수동 트리거 API 엔드포인트

2. **크롤링 이력 API** (REQ-05)
   - `GET /admin/crawl-runs`: 크롤링 실행 이력 조회
   - `GET /admin/crawl-runs/{id}`: 특정 실행의 상세 결과
   - `POST /admin/crawl-runs/trigger`: 수동 크롤링 트리거

---

## 2. 기술 스택 상세

| 구성요소 | 기술 | 버전 | 용도 |
|----------|------|------|------|
| 웹 스크래핑 | Playwright (playwright-python) | latest | JS 렌더링 페이지 크롤링 |
| 비동기 태스크 | Celery | 5.x | 크롤링 작업 스케줄링/실행 |
| 메시지 브로커 | Redis | 7.x | Celery 브로커 및 결과 백엔드 |
| PDF 파싱 | pdfplumber | latest | PDF 텍스트 추출 (기존) |
| 파일 저장 | boto3 (S3) / pathlib (로컬) | latest | PDF 문서 저장 |
| 해시 비교 | hashlib (표준 라이브러리) | - | SHA-256 변경 감지 |
| 재시도 로직 | tenacity | latest | 지수 백오프 재시도 |

---

## 3. 아키텍처 설계 방향

### 3.1 크롤링 흐름

```
[Celery Beat] --trigger--> [crawl_all task]
    |
    v
[CrawlerRegistry] --get_crawler(name)--> [KLIACrawler / KNIACrawler]
    |
    v
[BaseCrawler.crawl()]
    |-- parse_listing()     --> 약관 목록 수집
    |-- detect_changes()    --> 델타 분석 (신규/변경/삭제)
    |-- download_pdf()      --> PDF 다운로드
    |-- FileStorage.save()  --> 로컬/S3 저장
    |
    v
[ingest_policy task]
    |-- DocumentProcessor.process_pdf()  --> 텍스트 추출 + 청크 분할
    |-- Admin API POST /policies         --> DB 저장 + 임베딩 트리거
    |
    v
[CrawlRun / CrawlResult]  --> 이력 기록
```

### 3.2 분리 원칙

- **Celery Worker**: 크롤링 및 인제스션 작업은 FastAPI 서버와 별도 프로세스에서 실행
- **스토리지 추상화**: 로컬/S3 전환이 환경변수 하나로 가능
- **크롤러 레지스트리**: 새로운 보험사 크롤러 추가 시 레지스트리에 등록만 하면 됨
- **기존 파이프라인 재사용**: DocumentProcessor, PDFParser, TextCleaner, TextChunker 변경 없음

### 3.3 동시성 관리

- 보험사별 크롤러는 순차 실행 (rate limiting 준수)
- 인제스션 작업은 Celery 워커 concurrency 설정으로 병렬 처리 가능
- Playwright 브라우저 인스턴스는 크롤러당 1개로 제한

---

## 4. 리스크 및 대응 계획

| 리스크 | 영향도 | 가능성 | 대응 |
|--------|--------|--------|------|
| 보험협회 웹사이트 구조 변경 | 높음 | 중간 | 크롤러별 독립 구현, 구조 변경 감지 알림 |
| 크롤링 IP 차단 | 중간 | 낮음 | rate limiting, User-Agent 설정, robots.txt 준수 |
| PDF 파싱 실패 (암호화/스캔본) | 중간 | 중간 | 실패 건 수동 검토 큐, OCR 폴백 고려 |
| Celery/Redis 인프라 장애 | 높음 | 낮음 | Docker Compose 헬스체크, 재시작 정책 |
| 대용량 PDF 처리 시간 초과 | 중간 | 중간 | Celery 태스크 타임아웃 설정, 청크 단위 처리 |

---

## 5. 통합 포인트

### 기존 코드 연동

| 기존 구성요소 | 연동 방식 | 변경 필요 여부 |
|---------------|-----------|----------------|
| DocumentProcessor | `process_pdf()` 호출 | 변경 없음 |
| PDFParser | DocumentProcessor 내부 사용 | 변경 없음 |
| TextCleaner | DocumentProcessor 내부 사용 | 변경 없음 |
| TextChunker | DocumentProcessor 내부 사용 | 변경 없음 |
| Policy 모델 | `metadata_` 필드 활용 | 변경 없음 (JSONB 확장) |
| Admin API | `POST /policies`, `POST /policies/{id}/ingest` 호출 | 변경 없음 |
| InsuranceCompany 모델 | 보험사 매핑 조회 | 변경 없음 |

### 신규 파일 생성 목록

| 파일 | 용도 |
|------|------|
| `backend/app/services/crawler/__init__.py` | 패키지 초기화 |
| `backend/app/services/crawler/base.py` | BaseCrawler ABC |
| `backend/app/services/crawler/registry.py` | 크롤러 레지스트리 |
| `backend/app/services/crawler/storage.py` | 파일 저장 추상화 |
| `backend/app/services/crawler/companies/__init__.py` | 패키지 초기화 |
| `backend/app/services/crawler/companies/klia_crawler.py` | KLIA 크롤러 |
| `backend/app/services/crawler/companies/knia_crawler.py` | KNIA 크롤러 |
| `backend/app/tasks/__init__.py` | 태스크 패키지 초기화 |
| `backend/app/tasks/celery_app.py` | Celery 앱 설정 |
| `backend/app/tasks/crawler_tasks.py` | 크롤링 Celery 태스크 |
| `backend/app/models/crawler.py` | CrawlRun, CrawlResult 모델 |

---

## 6. 의존성 관계

```
SPEC-DATA-001 (완료) --> SPEC-CRAWLER-001 (현재)
                              |
                              +--> SPEC-EMBED-001 (차단됨: 약관 데이터 필요)
                              +--> SPEC-LLM-001 (차단됨: 지식 베이스 필요)
```

- **상위 의존성**: SPEC-DATA-001 (보험 모델 및 파서 구현 완료)
- **하위 차단**: SPEC-EMBED-001 (약관 raw_text가 존재해야 임베딩 가능)
- **하위 차단**: SPEC-LLM-001 (지식 베이스가 채워져야 RAG 파이프라인 동작)
