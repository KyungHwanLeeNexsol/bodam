---
spec_id: SPEC-INGEST-001
phase: acceptance
status: draft
created: 2026-03-21
---

# SPEC-INGEST-001 Acceptance Criteria

## AC-01: Directory Format Detection
- [ ] 형식 A (숫자-숫자/latest.pdf) 자동 감지 및 처리
- [ ] 형식 B (회사명/상품명_hash.pdf + .json) 자동 감지 및 처리
- [ ] 형식 C (기타 디렉토리 내 PDF) 처리

## AC-02: Metadata Extraction
- [ ] JSON 메타데이터 파일에서 company, product, hash 정보 로드
- [ ] JSON 없는 경우 디렉토리명에서 상품코드 추출

## AC-03: Duplicate Prevention
- [ ] SHA-256 해시로 동일 PDF SKIP
- [ ] 중단 후 재실행 시 이미 처리된 파일 자동 SKIP

## AC-04: DB Storage
- [ ] InsuranceCompany 레코드 조회/생성
- [ ] Policy 레코드 upsert (company_id + product_code)
- [ ] PolicyChunk 레코드 생성 (embedding=NULL)
- [ ] 텍스트 추출 실패 시 Policy만 생성, 청크 미생성

## AC-05: Transaction Safety
- [ ] PDF 1개 = 1 트랜잭션
- [ ] 한 파일 실패가 다른 파일에 영향 없음
- [ ] 3PC 동시 실행 시 DB 충돌 없음

## AC-06: CLI Interface
- [ ] 옵션 없이 실행 시 전체 data/ 처리
- [ ] --company 옵션으로 특정 회사 필터링
- [ ] --dry-run 옵션으로 스캔만 수행
- [ ] --embed 옵션으로 임베딩까지 처리
- [ ] --data-dir 옵션으로 데이터 디렉토리 지정

## AC-07: Reporting
- [ ] 완료 시 통계 출력 (총/신규/업데이트/SKIP/실패/청크)
- [ ] 실패 파일 목록 JSON 저장
