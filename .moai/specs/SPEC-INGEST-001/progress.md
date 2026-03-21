---
spec_id: SPEC-INGEST-001
phase: progress
status: completed
created: 2026-03-21
updated: 2026-03-21
---

# SPEC-INGEST-001 Progress

## Iteration Log

| # | Date | Phase | AC Met | Errors | Notes |
|---|------|-------|--------|--------|-------|
| 1 | 2026-03-21 | plan | 0/7 | 0 | SPEC created, awaiting implementation |
| 2 | 2026-03-21 | run (TDD) | 13/13 | 0 | Full TDD implementation complete |

## Implementation Summary (2026-03-21)

### Files Created/Modified

- `backend/scripts/ingest_local_pdfs.py` - 메인 구현 파일 (276 lines)
- `backend/tests/unit/test_ingest_local_pdfs.py` - 단위 테스트 파일 (66 tests)

### TDD Cycle Results

| Task | RED | GREEN | Status |
|------|-----|-------|--------|
| TASK-001: COMPANY_MAP + detect_format() | ✓ | ✓ | DONE |
| TASK-004: compute_file_hash() + check_duplicate() | ✓ | ✓ | DONE |
| TASK-008: parse_args() | ✓ | ✓ | DONE |
| TASK-010: generate_report() | ✓ | ✓ | DONE |
| TASK-011: save_failure_log() | ✓ | ✓ | DONE |
| TASK-002: scan_data_directory() | ✓ | ✓ | DONE |
| TASK-003: extract_metadata() | ✓ | ✓ | DONE |
| TASK-005: ensure_company() | ✓ | ✓ | DONE |
| TASK-006: upsert_policy() + create_chunks() | ✓ | ✓ | DONE |
| TASK-007: process_single_file() | ✓ | ✓ | DONE |
| TASK-009: dry-run mode | ✓ | ✓ | DONE |
| TASK-012: main() | ✓ | ✓ | DONE |
| TASK-013: --embed option | ✓ | ✓ | DONE |

### Quality Metrics

- 테스트 수: 66개 (모두 통과)
- 커버리지: 86% (목표 85% 초과)
- 컴파일 오류: 0
- 린트 오류: 0

### REQ 달성 현황

| REQ | 설명 | 상태 |
|-----|------|------|
| REQ-01 | 3가지 디렉터리 형식 자동 감지 | ✓ |
| REQ-02 | JSON 또는 디렉터리명에서 메타데이터 추출 | ✓ |
| REQ-03 | --company 필터 | ✓ |
| REQ-04 | SHA-256 중복 감지 | ✓ |
| REQ-05 | 파일별 트랜잭션 격리 | ✓ |
| REQ-06 | 재시작 안전성 (이미 처리된 파일 SKIP) | ✓ |
| REQ-07 | Policy upsert (company_id + product_code) | ✓ |
| REQ-08 | PolicyChunk with embedding=NULL | ✓ |
| REQ-09 | COMPANY_MAP 상수 | ✓ |
| REQ-10 | --embed 옵션 | ✓ |
| REQ-11 | 요약 리포트 | ✓ |
| REQ-12 | --dry-run 모드 | ✓ |
| REQ-13 | 실패 로그 JSON | ✓ |
