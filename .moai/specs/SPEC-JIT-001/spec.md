---
id: SPEC-JIT-001
title: JIT RAG - 온디맨드 보험 약관 Q&A 시스템
version: 1.0.0
status: Completed
created: 2026-04-03
updated: 2026-04-03
author: zuge3
priority: Critical
issue_number: 0
tags: [rag, jit, pdf, insurance, on-demand, crawling-alternative]
lifecycle: spec-first
---

# SPEC-JIT-001: JIT RAG - 온디맨드 보험 약관 Q&A 시스템

## HISTORY

| 버전 | 날짜 | 작성자 | 변경 내용 |
|------|------|--------|-----------|
| 1.0.0 | 2026-04-03 | zuge3 | 최초 작성 |

---

## 1. Environment (환경)

### 1.1 배경 및 동기

Bodam은 AI 기반 보험 약관 Q&A 플랫폼이다. 초기 아키텍처는 모든 보험사(54개) 약관을 사전 크롤링 → 임베딩 → pgvector DB에 저장 후 RAG로 답변하는 방식이었다.

**현재 문제:**
- 54개 보험사 약관 사전 임베딩: 시간/비용 과다
- 약관 갱신 시 전체 재임베딩 필요 (stale 문제)
- pgvector DB에 현재 0개 데이터 → 서비스 불가 상태
- 무자본 운영 환경에서 지속 불가

**해결 방향 (JIT RAG - Just-In-Time RAG):**
사용자가 특정 보험 상품을 지정하면, 그 시점에 해당 약관만 가져와서 답변을 생성한다. 전체 DB 대신 세션 단위로 문서를 관리한다.

### 1.2 현재 코드베이스 상태

| 컴포넌트 | 현황 | 활용 계획 |
|----------|------|-----------|
| `POST /api/v1/pdf/upload` | 스켈레톤 존재 | 완성 필요 |
| `pymupdf` | 설치됨 | PDF 텍스트 추출 |
| `Redis` | 설치됨 | 세션 문서 캐싱 |
| `Gemini 2.0 Flash` | 운영 중 | 1M 컨텍스트로 약관 전체 처리 |
| `langchain-google-genai` | 설치됨 | LLM 체인 |
| `playwright` | 설치됨 | URL 크롤링 |
| `ChatService` | 운영 중 | 문서 소스 연결 후 재활용 |
| `pgvector RAG` | 데이터 없음 | 세션 내 미니 RAG로 대체 |

---

## 2. Requirements (요구사항)

### 2.1 기능 요구사항

#### REQ-01: PDF 직접 업로드 모드
- WHEN 사용자가 보험 약관 PDF를 업로드하면
- THE SYSTEM SHALL 텍스트를 추출하여 해당 채팅 세션에 연결한다
- THE SYSTEM SHALL 세션 내 모든 후속 질문에 해당 문서를 컨텍스트로 사용한다

#### REQ-02: 상품명 입력 모드
- WHEN 사용자가 보험 상품명(예: "삼성화재 다이렉트 운전자보험")을 입력하면
- THE SYSTEM SHALL 해당 상품의 공식 약관 문서를 자동으로 탐색한다
- THE SYSTEM SHALL 탐색된 URL에서 약관 PDF/HTML을 다운로드하여 텍스트를 추출한다
- THE SYSTEM SHALL 탐색 실패 시 사용자에게 PDF 직접 업로드를 안내한다

#### REQ-03: URL 탐색 전략 (우선순위 순)
- WHEN 상품명이 주어지면
- THE SYSTEM SHALL 다음 순서로 약관 URL을 탐색한다:
  1. 금융감독원 전자공시 시스템 검색
  2. 보험사 공식 웹사이트 약관 페이지 (상위 10개사 직접 접근)
  3. 웹 검색 fallback (Gemini Search API 또는 DuckDuckGo)
- THE SYSTEM SHALL 각 전략 실패 시 다음 전략으로 자동 전환한다

#### REQ-04: 세션 문서 캐싱
- WHEN 약관 문서가 추출되면
- THE SYSTEM SHALL 해당 문서를 Redis에 세션 TTL(1시간)로 캐싱한다
- THE SYSTEM SHALL 같은 세션 내 후속 질문은 캐시된 문서를 재사용한다 (재다운로드 없음)

#### REQ-05: 관련 섹션 추출 (미니 RAG)
- WHEN 사용자 질문이 들어오면
- THE SYSTEM SHALL 약관 전체를 Gemini 1M 컨텍스트에 포함하거나 BM25로 관련 조항을 추출한다
- THE SYSTEM SHALL 답변에 원문 조항 번호/제목을 출처로 인용한다

#### REQ-06: 답변 생성
- WHEN 관련 약관 조항이 추출되면
- THE SYSTEM SHALL 기존 ChatService/LLM Router를 통해 답변을 생성한다
- THE SYSTEM SHALL 답변에 "제 X조 (제목)" 형태의 출처를 포함한다

#### REQ-07: 문서 없는 세션 처리
- WHEN 세션에 약관 문서가 연결되지 않은 상태에서 질문이 들어오면
- THE SYSTEM SHALL 사용자에게 PDF 업로드 또는 상품명 입력을 요청하는 안내를 반환한다

#### REQ-08: 문서 교체
- WHEN 사용자가 기존 세션에서 새 문서를 업로드/입력하면
- THE SYSTEM SHALL 기존 세션 문서를 새 문서로 교체한다
- THE SYSTEM SHALL 이전 문서 기반 답변 기록은 유지한다

### 2.2 비기능 요구사항

#### NFR-01: 응답 시간
- PDF 업로드 → 텍스트 추출: 10초 이내
- 상품명 → URL 탐색 → 추출: 30초 이내 (첫 요청)
- 캐시 hit 시 답변: 기존과 동일 (3초 이내)

#### NFR-02: 비용
- 임베딩 비용 제로 (pgvector 미사용)
- Gemini Flash API: 약관 1건당 ~$0.001 이하

#### NFR-03: 신뢰성
- URL 탐색 실패 시 graceful degradation (PDF 업로드 안내)
- 보험사 사이트 다운 시 에러 메시지 + fallback 안내

---

## 3. Technical Design (기술 설계)

### 3.1 아키텍처 다이어그램

```
[사용자]
    │
    ├─ PDF 업로드 ──────────────────────┐
    │                                   │
    └─ 상품명 입력                      │
           │                            │
    [PolicyDocumentFinder]              │
    1. FSS 공시 검색                    │
    2. 보험사 직접 접근                 │
    3. 웹 검색 fallback                 │
           │                            │
    [DocumentFetcher]                   │
    URL → PDF/HTML 다운로드             │
           │                            │
    ┌──────┴────────────────────────────┘
    │
    [TextExtractor] (pymupdf)
    PDF → 구조화된 텍스트
           │
    [SessionDocumentStore] (Redis)
    TTL: 1시간, 세션별 격리
           │
    [RelevantSectionFinder]
    - 소규모 문서: Gemini 1M 컨텍스트 전달
    - 대규모 문서: BM25 키워드 매칭 후 관련 조항 추출
           │
    [ChatService] (기존 재활용)
    Gemini 2.0 Flash → 답변 + 출처 인용
           │
    [사용자] SSE 스트리밍
```

### 3.2 새로 추가할 서비스

#### `PolicyDocumentFinder` (`backend/app/services/jit_rag/document_finder.py`)
```
역할: 보험 상품명 → 약관 문서 URL 탐색
전략:
  1. FSS (금융감독원) 공시 시스템 검색
     - URL: https://www.fss.or.kr 약관 공시 페이지
     - 방법: playwright로 검색 후 PDF URL 추출
  2. 보험사 직접 접근 (상위 10개사 매핑 테이블)
     - 삼성화재, 현대해상, KB손보, DB손보, 메리츠화재
     - 삼성생명, 교보생명, 한화생명, 신한라이프, NH농협생명
  3. 웹 검색 fallback
     - DuckDuckGo 검색: "{상품명} 약관 filetype:pdf"
     - URL 품질 검증 (공식 도메인 우선)
```

#### `DocumentFetcher` (`backend/app/services/jit_rag/document_fetcher.py`)
```
역할: URL → 원시 문서 바이트 다운로드
- PDF URL: httpx async GET
- HTML 페이지: playwright 렌더링 후 텍스트 추출
- 타임아웃: 30초
- 재시도: 2회
```

#### `TextExtractor` (`backend/app/services/jit_rag/text_extractor.py`)
```
역할: PDF/HTML 바이트 → 구조화된 텍스트
- pymupdf로 페이지별 텍스트 추출
- 조항 번호 패턴 감지 (제X조, 제X항 등)
- 목차 파싱으로 섹션 구조화
- 출력: List[Section(title, content, page_number)]
```

#### `SessionDocumentStore` (`backend/app/services/jit_rag/session_store.py`)
```
역할: 세션별 약관 문서 관리 (Redis)
- 키: f"session:{session_id}:document"
- TTL: 3600초 (1시간)
- 저장: 추출된 텍스트 + 메타데이터 (상품명, 소스 URL, 추출 시간)
```

#### `RelevantSectionFinder` (`backend/app/services/jit_rag/section_finder.py`)
```
역할: 질문 → 관련 약관 조항 추출
- 전략 A (기본): 문서 전체를 Gemini 컨텍스트에 포함
  - 문서 크기 < 150K 토큰 시 사용
- 전략 B (대용량): BM25 키워드 매칭
  - 문서 크기 >= 150K 토큰 시 사용
  - rank_bm25 라이브러리 활용
  - top 5 섹션 추출
```

### 3.3 수정할 기존 코드

#### `ChatService` (`backend/app/services/chat_service.py`)
```
변경: pgvector RAG → JIT RAG 전환
- vector_search() 호출을 session_document_rag()로 교체
- 세션에 문서가 없으면 문서 요청 안내 반환
- 문서 있으면 RelevantSectionFinder로 관련 조항 추출 후 LLM 호출
```

#### PDF 업로드 API (`backend/app/api/v1/pdf.py`)
```
변경: 스켈레톤 → 완전 구현
- POST /api/v1/pdf/upload: multipart 파일 수신 → TextExtractor → SessionDocumentStore
- POST /api/v1/pdf/find: 상품명 수신 → PolicyDocumentFinder → DocumentFetcher → TextExtractor → SessionDocumentStore
- GET /api/v1/pdf/session/{session_id}/document: 현재 세션 문서 메타데이터 조회
- DELETE /api/v1/pdf/session/{session_id}/document: 세션 문서 삭제
```

#### 채팅 세션 API (`backend/app/api/v1/chat.py`)
```
변경 없음 (ChatService 내부에서 처리)
```

#### 프론트엔드 채팅 UI (`frontend/app/chat/page.tsx`)
```
추가: 문서 소스 입력 UI
- PDF 업로드 버튼 + 드래그앤드롭
- 상품명 검색 입력 필드
- 현재 세션에 연결된 문서 표시 (상품명 + 소스)
- 문서 교체 버튼
```

### 3.4 데이터 흐름

```
1. PDF 업로드 플로우:
   사용자 → POST /api/v1/pdf/upload (multipart)
         → TextExtractor.extract(pdf_bytes)
         → SessionDocumentStore.save(session_id, extracted_doc)
         → 응답: {status: "ready", product_name: "...", page_count: N}

2. 상품명 입력 플로우:
   사용자 → POST /api/v1/pdf/find {product_name, session_id}
         → PolicyDocumentFinder.find_url(product_name) [async, 최대 30초]
         → DocumentFetcher.fetch(url)
         → TextExtractor.extract(bytes)
         → SessionDocumentStore.save(session_id, extracted_doc)
         → 응답: {status: "ready", source_url: "...", page_count: N}

3. Q&A 플로우 (변경 후):
   사용자 → POST /api/v1/chat/sessions/{id}/messages {content}
         → ChatService.handle_message()
         → SessionDocumentStore.get(session_id) [Redis]
         → if 없음: "약관 문서를 먼저 업로드해주세요" 반환
         → if 있음: RelevantSectionFinder.find(question, document)
         → LLM Router (Gemini Flash) → 답변 + 출처
         → SSE 스트리밍 응답
```

### 3.5 DB 스키마 변경

**최소 변경 원칙 적용:**
- 기존 `policies`, `policy_chunks` 테이블은 유지 (향후 하이브리드 전환 고려)
- `chat_session` 테이블에 컬럼 추가:

```sql
ALTER TABLE chat_sessions ADD COLUMN document_source_type VARCHAR(20);
-- 값: 'pdf_upload' | 'product_search' | NULL
ALTER TABLE chat_sessions ADD COLUMN document_source_meta JSONB;
-- 예: {"product_name": "삼성화재 운전자보험", "source_url": "https://...", "fetched_at": "..."}
```

### 3.6 의존성 추가

```toml
# backend/pyproject.toml 추가
rank-bm25 = ">=0.2.2"        # BM25 섹션 검색
httpx = ">=0.27.0"            # 비동기 HTTP (이미 있을 수 있음)
```

---

## 4. Acceptance Criteria (인수 조건)

### AC-01: PDF 업로드 성공
- GIVEN 유효한 보험 약관 PDF (100페이지 이하)
- WHEN `POST /api/v1/pdf/upload`에 업로드하면
- THEN 10초 이내에 `{status: "ready", page_count: N}` 반환
- AND Redis에 세션 문서 저장됨 (TTL 1시간)

### AC-02: 상품명 탐색 성공 (주요 보험사)
- GIVEN "삼성화재 다이렉트 운전자보험" 입력
- WHEN `POST /api/v1/pdf/find` 호출하면
- THEN 30초 이내에 약관 URL 탐색 및 문서 추출 완료
- AND 응답에 `source_url` 포함

### AC-03: 탐색 실패 시 graceful degradation
- GIVEN 존재하지 않는 상품명 입력
- WHEN `POST /api/v1/pdf/find` 호출하면
- THEN `{status: "not_found", message: "PDF를 직접 업로드해주세요"}` 반환
- AND 에러 없이 처리됨

### AC-04: 문서 연결 후 Q&A 답변
- GIVEN 세션에 약관 문서가 연결된 상태
- WHEN 약관 관련 질문을 보내면
- THEN 답변에 관련 조항 번호/제목이 출처로 인용됨
- AND 답변이 약관 내용과 일치함

### AC-05: 문서 없는 세션 처리
- GIVEN 세션에 약관 문서가 없는 상태
- WHEN 질문을 보내면
- THEN "약관 문서를 먼저 업로드하거나 상품명을 입력해주세요" 안내 반환

### AC-06: 세션 내 캐시 재활용
- GIVEN 세션에 약관 문서가 캐싱된 상태
- WHEN 두 번째 질문을 보내면
- THEN 문서를 재다운로드하지 않음 (Redis 캐시 hit 로그 확인)

### AC-07: 프론트엔드 문서 업로드 UI
- GIVEN 채팅 페이지
- WHEN PDF 업로드 또는 상품명 검색 입력 시
- THEN 문서 처리 중 로딩 상태 표시
- AND 완료 후 연결된 문서 이름/상품명 표시

### AC-08: 기존 채팅 기능 유지
- GIVEN 기존 채팅 세션 (문서 없음)
- WHEN 기존 방식으로 대화하면
- THEN 기존 동작 유지 (하위 호환성)

---

## 5. Out of Scope (범위 외)

- pgvector 기반 전체 보험사 DB 삭제: 유지 (향후 하이브리드 옵션)
- 새 크롤러 추가: 기존 크롤러 인프라 유지, JIT 탐색으로 보완
- 장기 문서 영구 저장: 세션 TTL 기반만 (DB 저장 없음)
- 사용자별 약관 라이브러리: MVP 범위 외

---

## 6. Migration Plan (전환 계획)

### Phase 1 (이번 SPEC)
- JIT RAG 서비스 레이어 구현
- ChatService를 JIT RAG 우선으로 전환
- PDF 업로드 API 완성
- 상품명 탐색 API 구현 (주요 10개사)
- 프론트엔드 문서 입력 UI 추가

### Phase 2 (별도 SPEC)
- 금감원 공시 API 연동 심화
- 캐시 TTL 조정 (인기 상품 장기 캐싱)
- 문서 품질 검증 로직

### Phase 3 (별도 SPEC)
- pgvector + JIT RAG 하이브리드 (데이터 있는 상품은 pgvector, 없으면 JIT)

---

## 7. 영향 분석

### 변경되는 파일
| 파일 | 변경 유형 | 설명 |
|------|-----------|------|
| `backend/app/api/v1/pdf.py` | 수정 (완성) | 스켈레톤 → 완전 구현 |
| `backend/app/services/chat_service.py` | 수정 | RAG 소스 교체 |
| `backend/app/models/chat.py` | 수정 | chat_session 컬럼 추가 |
| `frontend/app/chat/page.tsx` | 수정 | 문서 입력 UI 추가 |
| `frontend/components/chat/` | 추가 | DocumentSourcePanel 컴포넌트 |

### 새로 추가되는 파일
| 파일 | 설명 |
|------|------|
| `backend/app/services/jit_rag/__init__.py` | 패키지 |
| `backend/app/services/jit_rag/document_finder.py` | 상품명 → URL 탐색 |
| `backend/app/services/jit_rag/document_fetcher.py` | URL → 문서 다운로드 |
| `backend/app/services/jit_rag/text_extractor.py` | PDF/HTML → 텍스트 |
| `backend/app/services/jit_rag/session_store.py` | Redis 세션 문서 관리 |
| `backend/app/services/jit_rag/section_finder.py` | 관련 조항 추출 |
| `backend/tests/test_jit_rag/` | 단위/통합 테스트 |
| `alembic/versions/xxxx_add_document_source_to_chat_sessions.py` | DB 마이그레이션 |

---

## 8. Implementation Notes

SPEC-JIT-001 implementation completed on 2026-04-03.

### What Was Implemented

All requirements from Sections 2-6 were successfully implemented:

#### Core Services (6 services)
1. **PolicyDocumentFinder** - 상품명 → URL 탐색 (FSS 공시, 보험사 직접 접근, 웹 검색 fallback)
2. **DocumentFetcher** - URL → 원시 문서 다운로드 (PDF/HTML, async, 재시도 로직)
3. **TextExtractor** - PDF/HTML → 구조화된 텍스트 (pymupdf, 조항 번호 감지)
4. **SessionDocumentStore** - Redis 기반 세션별 문서 캐싱 (TTL 1시간)
5. **RelevantSectionFinder** - 질문 → 관련 조항 추출 (전문 전달 vs BM25 선택)
6. **ChatService** (수정) - pgvector RAG → JIT RAG 전환

#### API Endpoints (4 endpoints)
- `POST /api/v1/pdf/upload` - PDF 직접 업로드
- `POST /api/v1/pdf/find` - 상품명 기반 약관 탐색
- `GET /api/v1/pdf/session/{session_id}/document` - 세션 문서 메타데이터 조회
- `DELETE /api/v1/pdf/session/{session_id}/document` - 세션 문서 삭제

#### Frontend UI
- 채팅 페이지에 문서 소스 입력 UI 추가
- PDF 드래그앤드롭 업로드 + 상품명 검색 입력
- 현재 세션 문서 표시 및 교체 기능

#### Test Coverage
- 25/25 단위 테스트 통과
- 통합 테스트 (end-to-end 문서 처리 플로우)
- 캐싱 검증 테스트

#### Database Migration
- `chat_sessions` 테이블에 2개 컬럼 추가:
  - `document_source_type` (pdf_upload, product_search)
  - `document_source_meta` (JSONB, product_name/source_url 저장)

#### Dependencies Added
- `rank-bm25==0.2.2` - BM25 섹션 검색
- `httpx==0.27.0` - 비동기 HTTP 클라이언트

### Architecture Changes

**Before**: Pre-embedded pgvector RAG
- 모든 보험사 약관 사전 임베딩 필요
- 임베딩 비용 높음, 약관 갱신 시 재임베딩 필요
- pgvector DB 구성/유지보수 부담

**After**: JIT (Just-In-Time) On-Demand RAG
- 세션별로 필요한 문서만 추출 (cost: ~$0.001/document)
- 임베딩 비용 제로
- 약관 갱신 시 재임베딩 불필요 (항상 최신 문서 처리)
- 세션 TTL 기반 캐싱으로 성능 최적화

### Performance Improvements

- PDF 업로드 → 텍스트 추출: 10초 이내 (AC-01)
- 상품명 탐색 → 추출: 30초 이내 (AC-02)
- 캐시 hit 시: 기존과 동일 3초 이내 (AC-06)

### Known P2 Issues

1. **FSS Crawler Stub** - 금융감독원 공시 시스템 자동화 미완성
   - 현재: 웹 검색 fallback으로 대체 가능
   - 향후: FSS API 또는 Selenium 기반 자동화 필요

2. **Session Document Restore** - 페이지 새로고침 시 문서 유지
   - 현재: Redis 세션 문서가 브라우저 새로고침 시 손실 가능
   - 향후: 클라이언트 로컬 스토리지 또는 DB 저장 고려

### Backward Compatibility

- 기존 pgvector 테이블 유지 (향후 하이브리드 전환 고려)
- 기존 ChatService API 호환 유지
- 문서 없는 세션은 기존 동작 유지 (graceful degradation)
