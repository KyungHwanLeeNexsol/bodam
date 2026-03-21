---
id: SPEC-INGEST-001
title: "Multi-PC Local PDF Ingestion to Neon DB"
version: 1.0.0
status: completed
created: 2026-03-21
updated: 2026-03-21
author: zuge3
priority: high
issue_number: 0
tags: [ingestion, pdf, embedding, neon, multi-pc, pipeline]
dependencies: [SPEC-CRAWLER-001, SPEC-CRAWLER-002, SPEC-CRAWLER-003, SPEC-EMBED-001]
blocks: [SPEC-PIPELINE-001]
---

# SPEC-INGEST-001: 다중 PC 로컬 PDF 인제스트 스크립트

## HISTORY

| 버전 | 날짜 | 작성자 | 변경 내용 |
|------|------|--------|-----------|
| 1.0.0 | 2026-03-21 | zuge3 | 초안 작성 |

---

## 1. Environment (환경)

### 1.1 현재 상황

Bodam 플랫폼의 약관 PDF 수집은 3대 PC에서 분산 실행되고 있다:

**PC-1 (생명보험)**
- 크롤러: `crawl_pub_insure.py`, `crawl_life_insurance.py`, `crawl_klia.py`
- 저장: `backend/data/{상품코드}/latest.pdf` (1,113개 폴더)
- 메타데이터: 폴더명이 상품코드, JSON 메타데이터 없음

**PC-2 (손해보험 A)**
- 크롤러: `crawl_meritz_fire.py`, `crawl_hyundai_marine.py`
- 저장: `backend/data/{회사명}/{상품명}_{hash}.pdf` + `.json` 메타데이터
- JSON 구조: `{company_id, company_name, product_name, category, source_url, content_hash, file_size, crawled_at}`

**PC-3 (손해보험 B)**
- 크롤러: `crawl_kb_insurance.py`, `crawl_samsung_fire.py`, `crawl_db_insurance.py`, `crawl_heungkuk_fire.py`
- 저장: PC-2와 동일한 구조

**총 수집 현황**: 4,555개 PDF (2026-03-21 기준)

### 1.2 문제점

1. **파이프라인 단절**: 각 PC에서 PDF를 로컬에 저장만 하고, Neon DB에 Policy/PolicyChunk 레코드가 생성되지 않음
2. **임베딩 불가**: DB에 청크가 없으므로 `daily_embed.py`가 처리할 대상이 없음
3. **검색 불가**: RAG 검색에 필요한 벡터 임베딩이 없어 약관 Q&A 기능이 수집된 약관을 활용하지 못함
4. **수동 통합 부재**: 3PC에서 수집한 PDF를 통합하는 자동화된 방법이 없음

### 1.3 기존 시스템 구성요소

재활용 가능한 기존 모듈:
- `PolicyIngestor` (`app/services/crawler/policy_ingestor.py`): Policy upsert, content_hash 중복 감지
- `DocumentProcessor` (`app/services/parser/document_processor.py`): PDF 파싱 + 청킹 + 임베딩
- `EmbeddingService` (`app/services/rag/embeddings.py`): Gemini 임베딩 생성 (768차원)
- `TextCleaner`, `TextChunker`, `PDFParser`: 텍스트 처리 파이프라인
- `daily_embed.py`: 임베딩 배치 처리 (API 키 로테이션)
- `run_pipeline.py status`: DB 현황 조회

---

## 2. Assumptions (가정)

- A1: 각 PC는 Neon PostgreSQL에 직접 연결 가능하다 (공용 인터넷 접근)
- A2: 각 PC에 Python 3.13+, uv/pip, pdfplumber 등 필요 패키지가 설치되어 있다
- A3: `backend/data/` 디렉토리의 PDF 파일은 유효한 PDF 형식이다 (크롤러가 검증)
- A4: content_hash(SHA-256)로 동일 PDF의 중복 인제스트를 방지할 수 있다
- A5: 임베딩 생성은 인제스트와 분리하여 배치로 처리한다 (Gemini API 쿼터 제한)
- A6: 3PC에서 동시에 스크립트를 실행해도 DB 레벨의 유니크 제약으로 충돌이 방지된다

---

## 3. Requirements (요구사항)

### 3.1 로컬 PDF 스캔 및 발견

**REQ-01: 다중 디렉토리 형식 지원** [HARD]
WHEN 인제스트 스크립트가 실행되면 THEN 시스템은 다음 3가지 디렉토리 형식을 자동 감지하고 처리해야 한다:
- 형식 A: `data/{상품코드}/latest.pdf` (생명보험, JSON 없음)
- 형식 B: `data/{회사명}/{상품명}_{hash}.pdf` + `.json` (손해보험, JSON 메타데이터)
- 형식 C: 단일 회사 디렉토리 내 PDF 파일 (삼성화재 등)

**REQ-02: 메타데이터 추출** [HARD]
WHEN PDF 파일이 발견되면 THEN 시스템은 다음 메타데이터를 추출해야 한다:
- JSON 파일이 있는 경우: company_id, company_name, product_name, category, content_hash 로드
- JSON 파일이 없는 경우: 디렉토리명에서 상품코드 추출, 회사 정보는 상위 디렉토리 또는 기본값 사용

**REQ-03: 특정 회사 필터링** [SOFT]
IF `--company` 옵션이 지정되면 THEN 시스템은 해당 회사 디렉토리만 처리해야 한다.

### 3.2 중복 방지 및 안전성

**REQ-04: content_hash 중복 확인** [HARD]
WHEN PDF 파일을 처리하기 전에 THEN 시스템은 SHA-256 해시를 계산하고, 동일 해시가 DB의 policies 테이블에 이미 존재하면 SKIP 처리해야 한다.

**REQ-05: 트랜잭션 격리** [HARD]
시스템은 항상 PDF 1개를 1 트랜잭션 단위로 처리해야 한다. 한 파일의 실패가 다른 파일의 처리에 영향을 주지 않아야 한다.

**REQ-06: 재시작 안전성** [HARD]
WHEN 스크립트가 중단 후 재실행되면 THEN 이미 처리된 파일은 content_hash 확인으로 자동 SKIP되어야 한다.

### 3.3 DB 저장

**REQ-07: Policy 레코드 생성** [HARD]
WHEN 신규 PDF가 발견되면 THEN 시스템은 InsuranceCompany 조회/생성 후 Policy 레코드를 upsert해야 한다. 복합 키: (company_id, product_code).

**REQ-08: PolicyChunk 생성** [HARD]
WHEN Policy가 생성되면 THEN 시스템은 PDF에서 텍스트를 추출하고, 정제 및 청크 분할 후 PolicyChunk 레코드를 생성해야 한다. 임베딩 벡터는 NULL로 저장하여 별도 배치에서 처리한다.

**REQ-09: 보험사 매핑 테이블** [HARD]
시스템은 항상 크롤러 디렉토리명과 보험사 정보를 매핑하는 설정을 포함해야 한다:
- 디렉토리명 → (company_code, company_name, category)
- 예: `meritz_fire` → (`meritz-fire`, `메리츠화재`, `NON_LIFE`)

### 3.4 임베딩 (선택적)

**REQ-10: 인제스트 후 임베딩 옵션** [SOFT]
IF `--embed` 옵션이 지정되면 THEN 시스템은 인제스트 직후 생성된 PolicyChunk에 대해 임베딩을 생성해야 한다.
기본 동작은 임베딩 없이 인제스트만 수행하며, `daily_embed.py`로 별도 처리한다.

### 3.5 리포트 및 CLI

**REQ-11: 실행 결과 리포트** [HARD]
WHEN 인제스트가 완료되면 THEN 시스템은 다음 통계를 출력해야 한다: 총 스캔 PDF 수, 신규 저장 수, 업데이트 수, SKIP 수, 실패 수, 생성된 청크 수.

**REQ-12: Dry-run 모드** [SOFT]
IF `--dry-run` 옵션이 지정되면 THEN 시스템은 실제 DB 저장 없이 스캔 결과만 출력해야 한다.

**REQ-13: 실패 파일 로그** [HARD]
WHEN 인제스트 중 실패가 발생하면 THEN 시스템은 실패한 파일 경로와 오류 메시지를 JSON 파일로 저장하여 재시도를 가능하게 해야 한다.

---

## 4. Specifications (명세)

### 4.1 파일 구조

```
backend/scripts/
└── ingest_local_pdfs.py    # 신규: 메인 인제스트 스크립트 (단일 파일)
```

기존 파일 수정 없음. 기존 모듈을 임포트하여 재활용.

### 4.2 보험사 매핑

```python
COMPANY_MAP = {
    # 손해보험 (디렉토리명 → 보험사 정보)
    "meritz_fire": ("meritz-fire", "메리츠화재", "NON_LIFE"),
    "hyundai_marine": ("hyundai-marine", "현대해상", "NON_LIFE"),
    "kb_insurance": ("kb-insurance", "KB손해보험", "NON_LIFE"),
    "samsung_fire": ("samsung-fire", "삼성화재", "NON_LIFE"),
    "db_insurance": ("db-insurance", "DB손해보험", "NON_LIFE"),
    "heungkuk_fire": ("heungkuk-fire", "흥국화재", "NON_LIFE"),
    # 생명보험 (숫자 디렉토리 = pub.insure.or.kr 상품코드)
    # 숫자-숫자 패턴은 자동으로 pub-insure 회사로 매핑
}
```

### 4.3 CLI 인터페이스

```bash
# 전체 data/ 디렉토리 처리
python scripts/ingest_local_pdfs.py

# 특정 회사만
python scripts/ingest_local_pdfs.py --company meritz_fire

# dry-run
python scripts/ingest_local_pdfs.py --dry-run

# 임베딩까지
python scripts/ingest_local_pdfs.py --embed

# 데이터 디렉토리 지정
python scripts/ingest_local_pdfs.py --data-dir /path/to/data
```

### 4.4 처리 흐름 상세

```
1. CLI 파싱 → Settings 로드 → DB 연결 초기화
2. data/ 디렉토리 스캔
   ├── 숫자-숫자 패턴 디렉토리 → 형식 A (생명보험)
   ├── 알파벳 디렉토리 + .json 파일 → 형식 B (손해보험)
   └── 기타 → 형식 C (일반)
3. 파일별 처리 루프:
   a. PDF 파일 SHA-256 해시 계산
   b. DB에서 동일 해시 존재 확인 → 있으면 SKIP
   c. 메타데이터 추출 (JSON 또는 디렉토리명)
   d. InsuranceCompany 조회/생성
   e. Policy upsert (company_id + product_code)
   f. PDF → 텍스트 추출 (pdfplumber)
   g. 텍스트 정제 (TextCleaner)
   h. 청크 분할 (TextChunker)
   i. PolicyChunk 레코드 생성 (embedding=NULL)
   j. 트랜잭션 커밋
4. 결과 리포트 출력
5. (--embed) daily_embed 로직 실행
```

### 4.5 에러 처리

| 상황 | 처리 |
|------|------|
| PDF 파싱 실패 (손상된 파일) | FAILED 로그 기록, 다음 파일로 진행 |
| DB 연결 실패 | 즉시 종료, 에러 메시지 출력 |
| 텍스트 추출 실패 (빈 PDF) | WARNING 로그, Policy는 생성하되 청크는 생성하지 않음 |
| 중복 해시 | SKIP, 정상 동작 |
| 트랜잭션 충돌 (3PC 동시 실행) | 롤백 후 다음 파일로 진행 |

### 4.6 Traceability (추적성)

| 요구사항 | 구현 위치 | 테스트 |
|----------|-----------|--------|
| REQ-01 | `scan_data_directory()` | `test_scan_formats.py` |
| REQ-02 | `extract_metadata()` | `test_metadata_extraction.py` |
| REQ-03 | `--company` CLI arg | `test_company_filter.py` |
| REQ-04 | `check_duplicate()` | `test_duplicate_check.py` |
| REQ-05 | per-file async with session | `test_transaction_isolation.py` |
| REQ-06 | REQ-04 동일 메커니즘 | `test_restart_safety.py` |
| REQ-07 | `PolicyIngestor.ingest()` 재활용 | `test_policy_upsert.py` |
| REQ-08 | `DocumentProcessor.process_pdf()` 재활용 | `test_chunk_creation.py` |
| REQ-09 | `COMPANY_MAP` 상수 | `test_company_mapping.py` |
| REQ-10 | `--embed` flag + EmbeddingService | `test_embed_option.py` |
| REQ-11 | `print_report()` | `test_report_output.py` |
| REQ-12 | `--dry-run` flag | `test_dry_run.py` |
| REQ-13 | `save_failure_log()` | `test_failure_log.py` |

---

## 5. 운영 가이드

### 5.1 각 PC 설정

```bash
# 1. .env 파일 생성 (backend/ 디렉토리)
cat > backend/.env << 'EOF'
DATABASE_URL=postgresql+asyncpg://<user>:<pass>@<neon-host>/bodam
GEMINI_API_KEY=AIza...  # --embed 사용 시에만 필요
EOF

# 2. 의존성 설치 (이미 크롤러 실행 중이면 설치 완료)
cd backend && uv sync

# 3. 인제스트 실행
cd backend && PYTHONPATH=. python scripts/ingest_local_pdfs.py
```

### 5.2 실행 순서 (3PC 운영)

```
1. 각 PC에서 크롤링 완료 확인
2. 각 PC에 .env 설정 (Neon DB URL)
3. 각 PC에서 ingest_local_pdfs.py 실행 (동시 실행 가능)
4. 아무 PC에서 daily_embed.py 실행 (임베딩 배치)
5. run_pipeline.py status로 현황 확인
```
