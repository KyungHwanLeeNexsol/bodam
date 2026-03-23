# SPEC-PIPELINE-002: 보험 데이터 파이프라인 개선

## 개요

| 항목 | 내용 |
|------|------|
| SPEC ID | SPEC-PIPELINE-002 |
| 상태 | DRAFT |
| 우선순위 | HIGH |
| 작성일 | 2026-03-23 |
| 관련 SPEC | SPEC-PIPELINE-001, SPEC-INGEST-001 |

## 배경 및 목적

현재 파이프라인의 3가지 핵심 문제:

1. **sale_status 미반영**: 크롤러는 판매중/판매중지 상태를 수집하지만, `ingest_local_pdfs.py`가 metadata JSON의 `sale_status` 필드를 DB에 저장하지 않음
2. **현황 추적 불가**: 34개 보험사별 크롤링 → 인제스트 → DB저장 → 임베딩 진행 상태를 추적할 수단이 없음
3. **파이프라인 비자동화**: 크롤링 → 인제스트 → 문서 업데이트가 수동으로 실행됨

## 요구사항 (EARS 형식)

### REQ-01: sale_status 인제스트 반영
- **WHEN** `ingest_local_pdfs.py`가 PDF를 처리할 때
- **THE SYSTEM SHALL** 동일 경로의 `.json` 파일에서 `sale_status` 필드를 읽어 `Policy.sale_status`에 저장한다
- **IF** JSON 파일에 `sale_status`가 없으면 `"UNKNOWN"`으로 기본 저장한다
- **Acceptance**: 인제스트 후 DB `policies.sale_status` 컬럼에 `ON_SALE`/`DISCONTINUED`/`UNKNOWN` 중 하나가 저장됨

### REQ-02: sale_status 정규화
- **WHEN** 크롤러가 sale_status를 저장할 때
- **THE SYSTEM SHALL** 다음 매핑을 적용한다:
  - `"Y"`, `"01"`, `"판매중"`, `"ON_SALE"`, `"현재판매"` → `"ON_SALE"`
  - `"N"`, `"02"`, `"판매중지"`, `"DISCONTINUED"`, `"판매종료"` → `"DISCONTINUED"`
  - 기타 / 미확인 → `"UNKNOWN"`
- **Acceptance**: crawl_constants.py에 `normalize_sale_status()` 함수 추가 및 모든 크롤러에서 사용

### REQ-03: 현황 추적 문서 자동 업데이트
- **WHEN** 인제스트 파이프라인이 보험사 1개 처리를 완료할 때
- **THE SYSTEM SHALL** `docs/insurance-pipeline-status.md`의 해당 보험사 행을 자동으로 업데이트한다
- **Acceptance**: `update_pipeline_status.py --company <code>` 실행 후 문서가 최신 DB 값으로 갱신됨

### REQ-04: 파이프라인 실행 스크립트 개선
- **WHEN** `run_crawl_pipeline.py`가 실행될 때
- **THE SYSTEM SHALL** 다음 순서로 처리한다:
  1. 해당 보험사 PDF 크롤링 (크롤러 존재 시)
  2. 로컬 PDF 인제스트 (`ingest_local_pdfs.py --company <code>`)
  3. 현황 문서 자동 업데이트 (`update_pipeline_status.py --company <code>`)
- **Acceptance**: 단일 명령으로 크롤링 → 인제스트 → 문서 업데이트 완료

### REQ-05: 보험사별 인제스트 진행률 리포트
- **WHEN** `ingest_local_pdfs.py`가 실행 완료될 때
- **THE SYSTEM SHALL** 다음 통계를 출력한다:
  - 총 PDF 수 / 성공 / 실패 / 스킵(중복)
  - sale_status 별 분포 (ON_SALE: N건, DISCONTINUED: N건, UNKNOWN: N건)
- **Acceptance**: 실행 로그에 통계 섹션 출력

---

## 구현 계획

### Phase 1: ingest_local_pdfs.py 개선 (즉시 실행 가능)

**변경 파일**: `backend/scripts/ingest_local_pdfs.py`

```
extract_metadata() 함수 수정:
  - JSON 파일에서 sale_status 읽기
  - normalize_sale_status() 적용

upsert_policy() 함수 수정:
  - Policy.sale_status = metadata.get("sale_status", "UNKNOWN") 추가
```

### Phase 2: crawl_constants.py 개선

**변경 파일**: `backend/scripts/crawl_constants.py`

```
normalize_sale_status(raw: str) -> str 함수 추가:
  ON_SALE 매핑 목록
  DISCONTINUED 매핑 목록
  기본값: UNKNOWN

save_pdf_with_metadata() 수정:
  normalize_sale_status() 적용 후 저장
```

### Phase 3: update_pipeline_status.py 신규 생성

**신규 파일**: `backend/scripts/update_pipeline_status.py`

```
기능:
  1. CockroachDB에서 보험사별 정책 수, 청크 수, 임베딩 유무 조회
  2. docs/insurance-pipeline-status.md 해당 행 업데이트
  3. --all 옵션: 전체 보험사 일괄 업데이트
  4. --company <code> 옵션: 단일 보험사 업데이트
```

### Phase 4: run_crawl_pipeline.py 개선

**변경 파일**: `backend/scripts/run_crawl_pipeline.py`

```
실행 순서:
  1. 크롤러 실행 (선택적)
  2. ingest_local_pdfs.py 실행
  3. update_pipeline_status.py 실행
  4. 결과 리포트 출력
```

---

## 인제스트 실행 우선순위

### 1순위: 손해보험 (PDF 다수, 즉시 처리)

```bash
# 순서대로 실행 (총 15,870개 PDF)
python scripts/ingest_local_pdfs.py --company samsung_fire    # 8,132개
python scripts/ingest_local_pdfs.py --company hyundai_marine  # 3,575개
python scripts/ingest_local_pdfs.py --company db_insurance    # 2,110개
python scripts/ingest_local_pdfs.py --company lotte_insurance # 1,879개
python scripts/ingest_local_pdfs.py --company axa_general     # 1,587개
python scripts/ingest_local_pdfs.py --company meritz_fire     # 542개
python scripts/ingest_local_pdfs.py --company kb_insurance    # 488개
python scripts/ingest_local_pdfs.py --company nh_fire         # 417개
python scripts/ingest_local_pdfs.py --company mg_insurance    # 107개
python scripts/ingest_local_pdfs.py --company heungkuk_fire   # 63개
```

### 2순위: 생명보험 (sale_status 지원, 데이터 정확도 높음)

```bash
# 순서대로 실행 (총 1,205개 PDF)
python scripts/ingest_local_pdfs.py --company samsung_life    # 136개
python scripts/ingest_local_pdfs.py --company lina_life       # 134개
python scripts/ingest_local_pdfs.py --company kyobo_life      # 125개
python scripts/ingest_local_pdfs.py --company shinhan_life    # 109개
# ... 나머지 생명보험사
```

### 3순위: 재크롤링 필요 보험사

다음 보험사는 sale_status 수집 후 재크롤링 → 재인제스트 필요:
- 삼성화재, 현대해상, DB손해보험 (손해보험은 sale_status 미지원)
- 교보생명, 교보라이프플래닛 (크롤러 미완성)

---

## 수용 기준 (Acceptance Criteria)

- [ ] `policies.sale_status`가 인제스트 후 UNKNOWN이 아닌 실제 값으로 저장됨 (생명보험)
- [ ] `docs/insurance-pipeline-status.md`가 인제스트 완료 후 자동 업데이트됨
- [ ] 34개 보험사 중 30개 이상 인제스트 완료
- [ ] 임베딩 없이 텍스트 청크만으로 RAG 기반 검색 가능 (임베딩은 2단계)
- [ ] `run_crawl_pipeline.py --company <code>`로 전체 파이프라인 단일 명령 실행 가능

---

## 주의사항

1. **임베딩은 나중에**: 현재 단계에서는 `--embed` 옵션 없이 텍스트 청크만 인제스트
2. **중복 체크**: `content_hash` 기반 중복 스킵 로직 활성화 유지
3. **대량 PDF 처리**: samsung_fire(8,132개)는 배치 처리, 에러 발생 시 `ingest_failures_*.json` 확인
4. **DB 연결**: CockroachDB는 asyncpg SSL 필요, `sslmode=verify-full` 유지
