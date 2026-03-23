---
spec_id: SPEC-INGEST-001
phase: plan
status: approved
created: 2026-03-21
---

# SPEC-INGEST-001 Plan

## Approach

단일 Python 스크립트(`backend/scripts/ingest_local_pdfs.py`)를 작성하여 3대 PC에서 로컬에 수집된 PDF 파일을 CockroachDB에 직접 인제스트한다.

## Key Decisions

1. **신규 파일 1개만 추가**: 기존 코드 수정 없이 기존 모듈(PolicyIngestor, DocumentProcessor, EmbeddingService)을 임포트하여 재활용
2. **임베딩 분리**: 인제스트 시 embedding=NULL로 저장하고, daily_embed.py로 별도 배치 처리 (Gemini API 쿼터 관리)
3. **content_hash 기반 중복 방지**: SHA-256 해시로 동일 PDF 재처리 방지, 3PC 동시 실행 안전
4. **트랜잭션 격리**: PDF 1개 = 1 트랜잭션, 실패 시 해당 파일만 롤백

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `backend/scripts/ingest_local_pdfs.py` | CREATE | 메인 인제스트 스크립트 |

## Dependencies

- `app.services.crawler.policy_ingestor.PolicyIngestor`
- `app.services.parser.document_processor.DocumentProcessor`
- `app.services.parser.pdf_parser.PDFParser`
- `app.services.parser.text_cleaner.TextCleaner`
- `app.services.parser.text_chunker.TextChunker`
- `app.services.rag.embeddings.EmbeddingService`
- `app.core.database` (DB 연결)
- `app.core.config.Settings`
- `app.models.insurance` (Policy, PolicyChunk, InsuranceCompany)

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| CockroachDB 동시 쓰기 충돌 | Low | Low | Unique constraint + rollback per file |
| 대량 PDF 처리 시 메모리 | Medium | Medium | 파일 단위 순차 처리, 메모리 해제 |
| 손상된 PDF 파일 | Low | Low | try/except로 개별 파일 실패 처리 |
| Gemini API 쿼터 소진 | Medium | Low | --embed 옵션 분리, daily_embed.py 사용 |
