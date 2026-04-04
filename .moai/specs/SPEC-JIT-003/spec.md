---
id: SPEC-JIT-003
title: SearXNG 기반 JIT 약관 검색 시스템
version: 1.0.0
status: Completed
created: 2026-04-04
updated: 2026-04-04
author: zuge3
priority: Critical
issue_number: 0
tags: [jit, searxng, search, insurance, policy, self-hosted]
lifecycle: spec-first
---

# SPEC-JIT-003: SearXNG 기반 JIT 약관 검색 시스템

## HISTORY

| 버전 | 날짜 | 작성자 | 변경 내용 |
|------|------|--------|-----------|
| 1.0.0 | 2026-04-04 | zuge3 | 최초 작성 |

---

## 1. Environment (환경)

### 1.1 배경 및 동기

Bodam의 JIT RAG 파이프라인은 사용자 질문에서 보험 상품명을 추출하고 실시간으로 약관 문서를 검색하여 AI 답변에 컨텍스트로 제공한다. 현재 DuckDuckGo HTML 스크래핑 방식은 다음 한계가 있다:

- `filetype:pdf` 연산자 미지원 (Google 전용)
- 한국어 보험 약관 검색 정확도 매우 낮음
- Rate limiting 및 불안정한 HTML 파싱

약관 DB(벡터 검색)는 비용 문제로 운영하지 않으므로, JIT 검색이 유일한 약관 데이터 소스이다.

### 1.2 현재 시스템

- **ProductNameExtractor**: 사용자 메시지에서 보험사명 + 상품명 추출 (25개 보험사)
- **DocumentFinder**: DuckDuckGo 기반 3단계 검색 (보험사 사이트 → 협회 → 일반)
- **DocumentFetcher**: URL에서 HTML/PDF 콘텐츠 다운로드
- **TextExtractor**: PDF/HTML에서 텍스트 추출 (Tesseract OCR 포함)
- **SectionFinder**: 추출된 텍스트에서 관련 섹션 검색
- **Redis 캐시**: 세션별 JIT 문서 1시간 TTL 캐싱

### 1.3 제약 조건

- **무자본 운영**: 유료 API (Google CSE, Serper) 사용 불가
- **인프라**: Fly.io shared-cpu-1x 1GB, Fly Postgres, Upstash Redis
- **보험사 공시실**: JavaScript 렌더링 기반으로 직접 크롤링 불가 (Playwright 필요)

---

## 2. Requirements (요구사항, EARS 형식)

### REQ-001: SearXNG 인스턴스 배포 (인프라)

**When** Bodam 백엔드가 약관 검색을 요청하면,
**the system shall** SearXNG 자체 호스팅 인스턴스로 검색 쿼리를 전달하고 JSON 형식 결과를 수신한다.

**Acceptance Criteria:**
- AC-001: SearXNG Docker 인스턴스가 Fly.io에 독립 앱으로 배포됨
- AC-002: SearXNG JSON API (`/search?q=...&format=json`)가 Fly 내부 네트워크에서 접근 가능
- AC-003: 외부 인터넷에서는 SearXNG 인스턴스에 접근 불가 (내부 전용)
- AC-004: SearXNG 설정에 Google, Bing 검색 엔진이 활성화됨

### REQ-002: DocumentFinder SearXNG 통합 (백엔드)

**When** DocumentFinder가 약관 문서 URL을 검색할 때,
**the system shall** DuckDuckGo 대신 SearXNG JSON API를 사용하여 검색한다.

**Acceptance Criteria:**
- AC-005: DocumentFinder가 SearXNG API 클라이언트를 사용하여 검색 실행
- AC-006: 검색 쿼리 구성: `site:{보험사도메인} {상품명} 약관 filetype:pdf`
- AC-007: SearXNG 결과에서 PDF URL을 우선 추출하고, 없으면 HTML 페이지 URL 반환
- AC-008: SearXNG 연결 실패 시 기존 DuckDuckGo 폴백 유지
- AC-009: 검색 타임아웃 10초 설정

### REQ-003: 검색 전략 개선 (백엔드)

**When** 보험사 사이트 내 검색이 결과를 반환하지 않으면,
**the system shall** 단계적으로 범위를 넓혀 검색한다.

**Acceptance Criteria:**
- AC-010: 전략 1 - `site:{보험사도메인} {상품명} 약관 filetype:pdf`
- AC-011: 전략 2 - `site:kpub.knia.or.kr OR site:pub.insure.or.kr {상품명} 약관`
- AC-012: 전략 3 - `{상품명} 약관 filetype:pdf` (전체 웹 검색)
- AC-013: 전략 4 - `{상품명} 약관` (PDF 없으면 일반 페이지)
- AC-014: 각 전략 결과를 로깅 (전략번호, 쿼리, 결과 URL)

### REQ-004: 검색 실패 시 사용자 안내 (프론트엔드)

**When** 모든 검색 전략이 약관을 찾지 못하면,
**the system shall** 사용자에게 PDF 업로드를 권유하는 메시지를 표시한다.

**Acceptance Criteria:**
- AC-015: 검색 실패 시 SSE 이벤트 `document_not_found` 전송
- AC-016: 프론트엔드에서 "약관 PDF를 업로드하시면 더 정확한 답변이 가능합니다" 안내 표시
- AC-017: 안내 메시지에 PDF 업로드 버튼/링크 포함

---

## 3. Technical Approach (기술 접근)

### 3.1 SearXNG 배포 (Fly.io)

```
bodam-search (새 Fly 앱)
├── Docker: searxng/searxng:latest
├── Region: nrt (Tokyo, bodam과 동일)
├── VM: shared-cpu-1x, 256MB
├── Port: 8080 (내부 전용)
├── 네트워크: Fly 내부 DNS (bodam-search.internal:8080)
└── 설정: settings.yml (Google + Bing 활성화, JSON API 허용)
```

### 3.2 백엔드 변경

**새 파일:**
- `backend/app/services/jit_rag/searxng_client.py`: SearXNG API 클라이언트

**수정 파일:**
- `backend/app/services/jit_rag/document_finder.py`: DuckDuckGo → SearXNG 교체
- `backend/app/core/config.py`: `SEARXNG_URL` 설정 추가

**파이프라인 흐름:**
```
사용자 질문 → ProductNameExtractor (상품명 추출)
  → SearXNG API (약관 PDF 검색, 4단계 전략)
  → DocumentFetcher (PDF/HTML 다운로드)
  → TextExtractor (텍스트 추출)
  → SectionFinder (관련 섹션 검색)
  → Redis 캐시 (1시간)
  → LLM 답변 생성 (약관 컨텍스트 포함)
```

### 3.3 SearXNG API 사용 예시

```
GET http://bodam-search.internal:8080/search?q=site:idbins.com+아이사랑보험+약관+filetype:pdf&format=json&engines=google,bing

Response:
{
  "results": [
    {
      "url": "https://www.idbins.com/.../아이사랑보험_약관.pdf",
      "title": "DB손해보험 아이사랑보험 2104 약관",
      "content": "..."
    }
  ]
}
```

### 3.4 비용 분석

| 항목 | 비용 |
|------|------|
| SearXNG Fly 앱 (shared-cpu-1x, 256MB) | ~$1.94/월 |
| 검색 API 비용 | $0 (무료, 무제한) |
| 총 추가 비용 | ~$2/월 |

---

## 4. Dependencies (의존성)

- SPEC-JIT-001: JIT RAG 기본 파이프라인 (Completed)
- SPEC-JIT-002: 자동 JIT 트리거 (Completed)
- Fly.io 계정 (기존)
- SearXNG Docker 이미지 (오픈소스)

---

## 5. Risks (위험)

| 위험 | 영향 | 완화 방안 |
|------|------|-----------|
| Google/Bing이 SearXNG IP 차단 | 검색 결과 없음 | Fly.io IP 로테이션, 요청 간격 조절 |
| SearXNG 인스턴스 다운 | JIT 검색 불가 | DuckDuckGo 폴백 유지, health check |
| 약관 PDF가 Google에 미인덱싱 | 검색 결과 없음 | 협회 공시실 도메인 타겟 검색 + PDF 업로드 안내 |
| Fly.io 256MB 부족 | OOM | 512MB로 스케일업 (~$3.88/월) |

---

## 6. Out of Scope (범위 외)

- 벡터 DB 기반 약관 검색 (비용 문제로 운영 안 함)
- Playwright 기반 보험사 공시실 직접 크롤링
- 유료 검색 API (Google CSE, Serper) 사용
- SearXNG의 외부 공개 접근

---

## 7. Implementation Notes (구현 완료)

### Completed Components

**Infrastructure (SearXNG 배포):**
- `infra/searxng/fly.toml` - Fly.io 배포 설정 (bodam-search 앱)
- `infra/searxng/Dockerfile` - SearXNG Docker 이미지
- `infra/searxng/settings.yml` - Google + Bing 엔진 활성화 설정

**Backend (JIT RAG 통합):**
- `backend/app/services/jit_rag/searxng_client.py` - SearXNG API 클라이언트 (HTTP 요청, 타임아웃, 에러 처리)
- `backend/app/services/jit_rag/document_finder.py` - 4단계 검색 전략 (SearXNG + DuckDuckGo 폴백)
- `backend/app/core/config.py` - `SEARXNG_URL` 환경 변수 추가
- `backend/app/services/chat_service.py` - SearXNG 클라이언트 DI, `document_not_found` SSE 이벤트

**Frontend (검색 실패 안내):**
- `frontend/lib/types/chat.ts` - `document_not_found` SSE 타입
- `frontend/lib/api/sse-parser.ts` - 이벤트 파싱 로직
- `frontend/app/chat/page.tsx` - "PDF 업로드 권유" UI 표시

**Tests (총 39개):**
- `backend/tests/unit/test_config_searxng.py` (4 tests)
- `backend/tests/test_jit_rag/test_searxng_client.py` (13 tests)
- `backend/tests/test_jit_rag/test_document_finder_searxng.py` (18 tests)
- `backend/tests/test_chat_service_document_not_found.py` (4 tests)
- `frontend/__tests__/lib/sse-parser-jit.test.ts` (2 tests)

### Key Achievements

- REQ-001 (SearXNG 배포): ✓ Completed
- REQ-002 (DocumentFinder 통합): ✓ Completed - SearXNG JSON API 사용
- REQ-003 (4단계 검색 전략): ✓ Completed - site 검색 → 협회 → PDF 검색 → 일반 웹 검색
- REQ-004 (검색 실패 안내): ✓ Completed - SSE 이벤트 + UI 표시

### Technical Summary

- **검색 엔진**: SearXNG (자체 호스팅, Fly.io)
- **비용**: ~$2/월 (기존 인프라에 무시할 수준)
- **성능**: 4단계 검색 전략으로 한국어 보험 약관 검색 정확도 향상
- **안정성**: DuckDuckGo 폴백으로 SearXNG 장애 시 서비스 연속성 보장
