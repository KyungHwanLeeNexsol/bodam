---
id: SPEC-PDF-001
title: 온디맨드 보험 약관 PDF 분석 시스템
version: 1.0.0
status: completed
created: 2026-03-15
updated: 2026-03-15
author: zuge3
priority: high
issue_number: 0
tags: [pdf-analysis, gemini, on-demand, phase-2]
related_specs: [SPEC-LLM-001, SPEC-AUTH-001, SPEC-CHAT-001, SPEC-EMBED-001]
lifecycle: spec-first
---

# SPEC-PDF-001: 온디맨드 보험 약관 PDF 분석 시스템

## HISTORY

| 버전 | 날짜 | 작성자 | 변경 내용 |
|------|------|--------|-----------|
| 1.0.0 | 2026-03-15 | zuge3 | 초기 SPEC 작성 |

---

## 문제 정의

### 배경

현재 Bodam 플랫폼은 사전 인덱싱된 보험 약관 데이터베이스를 기반으로 RAG 파이프라인을 통해 보험 보상 안내를 제공한다. 그러나 다음과 같은 한계가 존재한다:

1. **데이터베이스 미등록 약관**: 단종 상품, 지역 특화 상품, 단체보험 등 데이터베이스에 없는 약관에 대해 분석이 불가능하다
2. **신규 상품 지연**: 크롤러가 주 1회(일요일 02:00 KST) 실행되므로 신규 출시 상품의 분석이 최대 7일 지연된다
3. **맞춤형 약관 미지원**: 기업 단체보험, 맞춤형 설계 상품 등 공개 약관과 내용이 다른 개인 약관을 분석할 수 없다
4. **사용자 이탈**: 자신의 약관을 직접 확인하고 싶은 사용자가 플랫폼을 떠나 수동으로 약관을 읽어야 한다

### 해결 방안

Gemini 2.0 Flash의 1M 컨텍스트 윈도우를 활용하여 사용자가 업로드한 PDF 약관을 실시간으로 분석하는 온디맨드 시스템을 구축한다. 사용자는 약관 PDF를 업로드하고 자연어로 질문하면 즉시 분석 결과를 받을 수 있다.

---

## Environment (환경)

- **Backend**: Python 3.13 / FastAPI 0.135.x
- **Frontend**: Next.js 16.1.x / React 19.2.x / TypeScript 5.x
- **LLM**: Gemini 2.0 Flash (1M context window) - 기존 `GeminiProvider` 활용
- **Database**: PostgreSQL 18.x + SQLAlchemy 2.x + Alembic
- **Cache**: Redis 7.x
- **파일 저장소**: 로컬 파일시스템 (MVP), S3 (후속)
- **인증**: JWT 기반 (SPEC-AUTH-001)
- **기존 서비스**: `LLMRouter`, `GeminiProvider`, `BaseLLMProvider` (SPEC-LLM-001)

---

## Assumptions (가정)

- [A-1] Gemini 2.0 Flash API가 PDF 파일을 직접 수신하여 분석할 수 있다 (Files API 활용)
- [A-2] 대부분의 보험 약관 PDF는 50MB 이하이다
- [A-3] 200페이지 이하의 약관 PDF를 Gemini 2.0 Flash가 30초 이내에 분석할 수 있다
- [A-4] 사용자는 인증된 상태에서만 PDF 업로드 기능을 사용할 수 있다
- [A-5] 한 사용자당 동시에 유지할 수 있는 분석 세션 수는 제한된다 (최대 5개)
- [A-6] 업로드된 PDF는 일정 기간(기본 24시간) 후 자동 삭제된다
- [A-7] Gemini API 키가 이미 구성되어 있다

---

## Requirements (요구사항)

### Module 1: PDF 업로드 API

#### REQ-PDF-101: PDF 파일 업로드

**WHEN** 인증된 사용자가 PDF 파일을 업로드 **THEN** 시스템은 파일을 검증하고 저장한 후 업로드 ID를 반환해야 한다.

#### REQ-PDF-102: 파일 유형 검증

시스템은 **항상** 업로드된 파일의 MIME 타입이 `application/pdf`인지 검증해야 한다.

#### REQ-PDF-103: 파일 크기 제한

**IF** 업로드된 파일의 크기가 50MB를 초과하면 **THEN** 시스템은 HTTP 413 상태 코드와 함께 파일 크기 초과 오류를 반환해야 한다.

#### REQ-PDF-104: 사용자별 저장 용량 제한

**IF** 사용자의 총 업로드 용량이 200MB를 초과하면 **THEN** 시스템은 업로드를 거부하고 기존 파일 삭제를 안내해야 한다.

#### REQ-PDF-105: 악성 파일 차단

시스템은 **항상** 업로드된 PDF의 매직 바이트(magic bytes)를 검증하여 위장된 파일을 차단해야 한다.

#### REQ-PDF-106: 파일명 살균

시스템은 **항상** 업로드된 파일명에서 경로 순회 문자 및 특수 문자를 제거(sanitize)해야 한다.

---

### Module 2: Gemini 2.0 Flash PDF 분석

#### REQ-PDF-201: PDF 내용 분석

**WHEN** 사용자가 업로드된 PDF에 대해 분석을 요청하면 **THEN** 시스템은 Gemini 2.0 Flash API를 통해 PDF 내용을 분석하고 구조화된 결과를 반환해야 한다.

#### REQ-PDF-202: 자연어 질의

**WHEN** 사용자가 업로드된 PDF에 대해 자연어로 질문하면 **THEN** 시스템은 해당 PDF의 내용을 컨텍스트로 사용하여 정확한 답변을 생성해야 한다.

#### REQ-PDF-203: 보장 분석

**WHEN** 사용자가 보장 분석을 요청하면 **THEN** 시스템은 약관에서 담보 항목, 보상 조건, 면책 사항, 보상 한도를 추출하여 구조화된 형태로 제공해야 한다.

#### REQ-PDF-204: 데이터베이스 상품 비교

**가능하면** 업로드된 약관의 보장 내용을 데이터베이스에 등록된 유사 상품과 비교 분석하여 제공한다.

#### REQ-PDF-205: Gemini API 장애 대응

**IF** Gemini 2.0 Flash API가 응답하지 않거나 오류를 반환하면 **THEN** 시스템은 최대 3회 재시도 후 사용자에게 일시적 서비스 불가 메시지를 반환해야 한다.

#### REQ-PDF-206: 스트리밍 응답

**WHEN** 분석 결과가 긴 텍스트를 포함하면 **THEN** 시스템은 Server-Sent Events(SSE)를 통해 스트리밍 방식으로 응답해야 한다.

#### REQ-PDF-207: 토큰 사용량 추적

시스템은 **항상** PDF 분석 요청마다 입력/출력 토큰 수와 예상 비용을 기록해야 한다.

---

### Module 3: 분석 결과 캐싱 및 조회

#### REQ-PDF-301: 분석 결과 캐싱

**WHEN** PDF 분석이 완료되면 **THEN** 시스템은 분석 결과를 Redis에 캐싱하여 동일 PDF에 대한 반복 질의 시 LLM 호출 없이 응답해야 한다.

#### REQ-PDF-302: 캐시 키 전략

시스템은 **항상** PDF 파일의 SHA-256 해시와 질의 내용을 조합하여 캐시 키를 생성해야 한다.

#### REQ-PDF-303: 캐시 만료

시스템은 **항상** 분석 결과 캐시를 24시간 후 자동 만료시켜야 한다.

#### REQ-PDF-304: 분석 이력 조회

**WHEN** 사용자가 분석 이력을 조회하면 **THEN** 시스템은 해당 사용자의 과거 PDF 분석 세션 목록을 최신순으로 반환해야 한다.

---

### Module 4: 프론트엔드 PDF 업로드 UI

#### REQ-PDF-401: 드래그 앤 드롭 업로드

시스템은 **항상** 드래그 앤 드롭 및 파일 선택 버튼을 통한 PDF 업로드를 지원해야 한다.

#### REQ-PDF-402: 업로드 진행률 표시

**WHEN** 사용자가 PDF를 업로드하면 **THEN** 프론트엔드는 업로드 진행률을 실시간으로 표시해야 한다.

#### REQ-PDF-403: 분석 결과 표시

**WHEN** PDF 분석이 완료되면 **THEN** 프론트엔드는 분석 결과를 구조화된 카드 형태로 표시해야 한다 (담보 목록, 보장 조건, 면책 사항 등).

#### REQ-PDF-404: 질의 채팅 인터페이스

**WHEN** PDF가 업로드되고 초기 분석이 완료되면 **THEN** 프론트엔드는 해당 PDF에 대한 자연어 질의 채팅 인터페이스를 제공해야 한다.

#### REQ-PDF-405: 파일 크기 초과 안내

**IF** 사용자가 50MB 초과 파일을 선택하면 **THEN** 프론트엔드는 업로드 전에 파일 크기 제한 안내 메시지를 표시해야 한다.

#### REQ-PDF-406: 모바일 반응형

시스템은 **항상** 모바일 디바이스에서도 PDF 업로드 및 분석 결과 조회가 가능하도록 반응형 UI를 제공해야 한다.

---

### Module 5: 분석 세션 관리

#### REQ-PDF-501: 세션 생성

**WHEN** PDF 업로드가 완료되면 **THEN** 시스템은 자동으로 분석 세션을 생성하고 세션 ID를 반환해야 한다.

#### REQ-PDF-502: 세션 내 대화 이력

**IF** 세션 상태가 활성 **AND WHEN** 사용자가 추가 질문을 하면 **THEN** 시스템은 이전 대화 이력을 컨텍스트에 포함하여 일관성 있는 답변을 제공해야 한다.

#### REQ-PDF-503: 세션 수 제한

**IF** 사용자의 활성 세션 수가 5개를 초과하면 **THEN** 시스템은 새 세션 생성을 거부하고 기존 세션 정리를 안내해야 한다.

#### REQ-PDF-504: 세션 자동 만료

시스템은 **항상** 24시간 동안 활동이 없는 세션을 자동으로 만료시키고 관련 임시 파일을 삭제해야 한다.

#### REQ-PDF-505: 세션 수동 삭제

**WHEN** 사용자가 분석 세션 삭제를 요청하면 **THEN** 시스템은 해당 세션과 관련된 모든 데이터(PDF 파일, 캐시, 대화 이력)를 삭제해야 한다.

#### REQ-PDF-506: 개인정보 보호

시스템은 업로드된 PDF 데이터를 다른 사용자의 분석에 **사용하지 않아야 한다**.

---

## Specifications (규격)

### API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/v1/pdf/upload` | PDF 파일 업로드 |
| POST | `/api/v1/pdf/{upload_id}/analyze` | PDF 분석 요청 (초기 보장 분석) |
| POST | `/api/v1/pdf/{upload_id}/query` | PDF에 대한 자연어 질의 |
| GET | `/api/v1/pdf/sessions` | 사용자의 분석 세션 목록 조회 |
| GET | `/api/v1/pdf/sessions/{session_id}` | 특정 분석 세션 상세 조회 |
| DELETE | `/api/v1/pdf/sessions/{session_id}` | 분석 세션 삭제 |
| GET | `/api/v1/pdf/{upload_id}/status` | 업로드 파일 상태 확인 |

### 데이터베이스 테이블

#### pdf_uploads

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID | PK |
| user_id | UUID | FK -> users.id |
| original_filename | VARCHAR(255) | 원본 파일명 |
| stored_filename | VARCHAR(255) | 저장된 파일명 (UUID 기반) |
| file_path | TEXT | 파일 저장 경로 |
| file_size | BIGINT | 파일 크기 (bytes) |
| file_hash | VARCHAR(64) | SHA-256 해시 |
| mime_type | VARCHAR(50) | MIME 타입 |
| page_count | INTEGER | 페이지 수 |
| status | VARCHAR(20) | uploaded / analyzing / completed / failed / expired |
| expires_at | TIMESTAMP | 자동 삭제 예정 시각 |
| created_at | TIMESTAMP | 생성 시각 |
| updated_at | TIMESTAMP | 수정 시각 |

#### pdf_analysis_sessions

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID | PK |
| user_id | UUID | FK -> users.id |
| upload_id | UUID | FK -> pdf_uploads.id |
| title | VARCHAR(255) | 세션 제목 (파일명 기반) |
| status | VARCHAR(20) | active / expired / deleted |
| initial_analysis | JSONB | 초기 보장 분석 결과 |
| token_usage | JSONB | 누적 토큰 사용량 |
| last_activity_at | TIMESTAMP | 마지막 활동 시각 |
| expires_at | TIMESTAMP | 세션 만료 시각 |
| created_at | TIMESTAMP | 생성 시각 |
| updated_at | TIMESTAMP | 수정 시각 |

#### pdf_analysis_messages

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID | PK |
| session_id | UUID | FK -> pdf_analysis_sessions.id |
| role | VARCHAR(20) | user / assistant |
| content | TEXT | 메시지 내용 |
| token_count | INTEGER | 토큰 수 |
| created_at | TIMESTAMP | 생성 시각 |

### 파일 저장 구조

```
uploads/
  pdf/
    {user_id}/
      {upload_id}.pdf
```

### 성능 목표

| 지표 | 목표 |
|------|------|
| PDF 업로드 응답 시간 | < 3초 (50MB 기준) |
| 초기 보장 분석 응답 시간 | < 30초 (200페이지 기준) |
| 후속 질의 응답 시간 | < 15초 |
| 캐시 적중 시 응답 시간 | < 1초 |
| 동시 분석 세션 수 | >= 10 |

### 보안 요구사항

| 항목 | 규격 |
|------|------|
| 파일 크기 제한 | 최대 50MB |
| 사용자별 총 저장 용량 | 최대 200MB |
| 파일 유형 검증 | MIME 타입 + 매직 바이트 |
| 파일명 살균 | 경로 순회 차단, 특수 문자 제거 |
| 사용자 격리 | 자신의 업로드만 접근 가능 |
| 자동 삭제 | 24시간 후 만료 |
| 전송 암호화 | HTTPS 필수 |

---

## Traceability (추적성)

| 요구사항 | 모듈 | 우선순위 |
|----------|------|----------|
| REQ-PDF-101 ~ 106 | Module 1: PDF 업로드 API | High |
| REQ-PDF-201 ~ 207 | Module 2: Gemini 분석 | High |
| REQ-PDF-301 ~ 304 | Module 3: 캐싱 | Medium |
| REQ-PDF-401 ~ 406 | Module 4: 프론트엔드 UI | High |
| REQ-PDF-501 ~ 506 | Module 5: 세션 관리 | High |

---

## Implementation Notes (2026-03-15)

### 실제 구현 결과

**구현 완료된 모든 요구사항**: REQ-PDF-101~106, 201~207, 301~304, 401~406, 501~506 (22/23, REQ-PDF-204 Optional 제외)

**주요 구현 결정사항**:
- `google-generativeai>=0.8.0` 신규 패키지 활용 (Gemini Files API 직접 연동)
- 기존 `GeminiProvider`(SPEC-LLM-001)와 분리된 독립 `PDFAnalysisService` 구현 (Files API 인터페이스 상이)
- `LLMMetrics.calculate_cost()` 재사용으로 토큰 비용 계산 통일
- `fakeredis` 활용 Redis mock 테스트로 실제 Redis 연결 없이 테스트 가능
- SSE 스트리밍: `StreamingResponse` + `text/event-stream` 미디어 타입
- 파일 저장: `uploads/pdf/{user_id}/{upload_id}.pdf` 로컬 경로 (MVP)

**테스트 결과**: 42개 테스트 통과 (test_storage: 20, test_analysis: 8, test_session: 6, test_pdf: 8)

**배포 요구사항**:
- Alembic 마이그레이션 실행 필요: `alembic upgrade head` (3개 신규 테이블)
- 환경변수 추가 필요: `GEMINI_API_KEY`
- Fly.io 배포 시: `fly secrets set GEMINI_API_KEY=<키값>`
