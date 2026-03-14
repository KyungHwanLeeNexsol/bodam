---
id: SPEC-PDF-001
type: plan
version: 1.0.0
status: draft
created: 2026-03-15
updated: 2026-03-15
author: zuge3
tags: [pdf-analysis, gemini, on-demand, phase-2]
---

# SPEC-PDF-001 구현 계획: 온디맨드 보험 약관 PDF 분석 시스템

## 구현 접근 방식

### 핵심 전략

Gemini 2.0 Flash Files API를 활용하여 PDF를 직접 업로드하고, 1M 컨텍스트 윈도우를 통해 전체 약관을 한 번에 분석한다. 기존 `LLMRouter`와 `GeminiProvider`(SPEC-LLM-001)를 확장하여 PDF 분석 전용 메서드를 추가하는 방식으로 구현한다.

### 기술 아키텍처

```
사용자 ─→ Frontend (PDF Upload UI)
              │
              ▼
         FastAPI (/api/v1/pdf/*)
              │
         ┌────┴────┐
         │         │
    PDFService  PDFAnalysisService
         │         │
    FileStorage    GeminiProvider (확장)
    (Local/S3)     │
         │         Gemini 2.0 Flash API
         │         (Files API + 1M Context)
         │
    PostgreSQL (pdf_uploads, pdf_analysis_sessions, pdf_analysis_messages)
         │
       Redis (분석 결과 캐시)
```

---

## 마일스톤

### Primary Goal: 백엔드 PDF 업로드 및 분석 파이프라인

**범위**: Module 1 (PDF 업로드 API) + Module 2 (Gemini 분석) + Module 5 (세션 관리)

**구현 항목**:

1. **데이터베이스 모델 및 마이그레이션**
   - `PdfUpload` 모델 생성 (`backend/app/models/pdf.py`)
   - `PdfAnalysisSession` 모델 생성
   - `PdfAnalysisMessage` 모델 생성
   - Alembic 마이그레이션 스크립트 작성

2. **파일 저장 서비스**
   - `PDFStorageService` 구현 (`backend/app/services/pdf/storage.py`)
   - 로컬 파일시스템 저장 (MVP)
   - 파일 검증: MIME 타입, 매직 바이트, 파일 크기
   - 파일명 살균(sanitize) 처리
   - SHA-256 해시 계산
   - 사용자별 용량 관리

3. **PDF 분석 서비스**
   - `PDFAnalysisService` 구현 (`backend/app/services/pdf/analysis.py`)
   - Gemini 2.0 Flash Files API 연동
     - `google-generativeai` 패키지의 `genai.Client` 사용
     - `client.files.upload()` 로 PDF 업로드
     - `client.models.generate_content()` 로 분석 요청
   - 초기 보장 분석 프롬프트 설계 (담보, 보상 조건, 면책 사항 추출)
   - 자연어 질의 처리 프롬프트 설계
   - SSE 스트리밍 응답 지원
   - 토큰 사용량 추적 (기존 `LLMMetrics` 확장)
   - 재시도 로직 (tenacity 활용, 최대 3회)

4. **세션 관리 서비스**
   - `PDFSessionService` 구현 (`backend/app/services/pdf/session.py`)
   - 세션 CRUD 작업
   - 대화 이력 관리
   - 세션 수 제한 (사용자당 최대 5개)
   - 세션 자동 만료 (24시간)

5. **API 엔드포인트**
   - `backend/app/api/v1/pdf.py` 라우터 생성
   - `POST /api/v1/pdf/upload`
   - `POST /api/v1/pdf/{upload_id}/analyze`
   - `POST /api/v1/pdf/{upload_id}/query`
   - `GET /api/v1/pdf/sessions`
   - `GET /api/v1/pdf/sessions/{session_id}`
   - `DELETE /api/v1/pdf/sessions/{session_id}`
   - `GET /api/v1/pdf/{upload_id}/status`

**영향 받는 기존 파일**:
- `backend/app/models/__init__.py` - 새 모델 등록
- `backend/app/api/v1/__init__.py` - 새 라우터 등록
- `backend/app/services/llm/router.py` - PDF 분석 메서드 추가 (선택적)
- `backend/app/services/llm/metrics.py` - PDF 분석 메트릭 추가

---

### Secondary Goal: 프론트엔드 PDF 업로드 UI

**범위**: Module 4 (프론트엔드 UI)

**구현 항목**:

1. **PDF 업로드 컴포넌트**
   - `frontend/components/pdf/PDFUploader.tsx` - 드래그 앤 드롭 업로드 컴포넌트
   - 파일 크기 클라이언트 측 사전 검증 (50MB)
   - 업로드 진행률 표시 (XMLHttpRequest 또는 fetch + ReadableStream)
   - 파일 유형 필터링 (accept="application/pdf")

2. **분석 결과 표시 컴포넌트**
   - `frontend/components/pdf/AnalysisResult.tsx` - 구조화된 분석 결과 카드
   - 담보 목록, 보장 조건, 면책 사항 시각화
   - 접을 수 있는 섹션(accordion) UI

3. **PDF 질의 채팅 인터페이스**
   - `frontend/components/pdf/PDFChat.tsx` - PDF 전용 채팅 UI
   - Vercel AI SDK `useChat` 훅 활용 (SSE 스트리밍)
   - 대화 이력 표시

4. **페이지 라우팅**
   - `frontend/app/pdf/page.tsx` - PDF 분석 메인 페이지
   - `frontend/app/pdf/[sessionId]/page.tsx` - 세션 상세 페이지
   - 반응형 레이아웃 (모바일 지원)

5. **세션 관리 UI**
   - `frontend/components/pdf/SessionList.tsx` - 분석 세션 목록
   - 세션 삭제 기능
   - 세션 상태 표시 (active/expired)

**영향 받는 기존 파일**:
- `frontend/app/layout.tsx` 또는 사이드바 네비게이션 - PDF 분석 메뉴 추가

---

### Final Goal: 캐싱 및 최적화

**범위**: Module 3 (캐싱)

**구현 항목**:

1. **Redis 캐싱 계층**
   - SHA-256 해시 + 질의 조합 캐시 키 전략
   - 분석 결과 24시간 TTL 설정
   - 캐시 적중 시 LLM 호출 생략

2. **토큰 최적화**
   - 대화 이력 자동 압축 (긴 대화 시 이전 메시지 요약)
   - Gemini Files API 활용으로 토큰 절약 (PDF를 텍스트 변환 없이 직접 전송)

3. **정리 작업**
   - Celery Beat 스케줄 작업: 만료된 세션/파일 정리
   - 사용자별 스토리지 사용량 모니터링

---

### Optional Goal: 데이터베이스 상품 비교

**범위**: REQ-PDF-204

**구현 항목**:
- 업로드된 약관에서 보험사/상품명 추출
- 기존 데이터베이스의 유사 상품과 보장 내용 비교
- 비교 결과 시각화

---

## 기술 접근

### Gemini 2.0 Flash Files API 연동

```
# 연동 흐름 (개념)
1. google-generativeai 클라이언트 초기화
2. client.files.upload(file_path) 로 PDF 업로드
3. 업로드된 file 객체의 URI 획득
4. client.models.generate_content(
     model="gemini-2.0-flash",
     contents=[file_uri, prompt]
   ) 로 분석 요청
5. 스트리밍 응답 처리
```

### 프롬프트 설계 방향

1. **초기 보장 분석 프롬프트**: 약관에서 담보 항목, 보상 조건, 면책 사항, 보상 한도를 구조화된 JSON으로 추출
2. **자연어 질의 프롬프트**: 사용자 질문에 대해 약관 근거를 인용하며 답변
3. **비교 분석 프롬프트**: 업로드 약관과 데이터베이스 상품 간 보장 차이 분석

### 기존 서비스 통합

- `GeminiProvider` 클래스에 `analyze_pdf()` 메서드 추가 또는 별도 `GeminiPDFProvider` 생성
- `LLMMetrics` 에 PDF 분석 카테고리 추가
- 기존 `ChatSession` 과 별도로 `PdfAnalysisSession` 을 독립적으로 운영

### 파일 저장 전략

- **MVP (로컬)**: `uploads/pdf/{user_id}/{upload_id}.pdf` 경로에 저장
- **후속 (S3)**: `AbstractStorageService` 인터페이스로 추상화하여 S3 전환 용이하게 설계
- 크롤러의 `StorageService` 패턴(SPEC-CRAWLER-001) 참조

---

## 리스크 분석

| 리스크 | 심각도 | 대응 방안 |
|--------|--------|-----------|
| Gemini API 속도 제한 (RPM/TPM) | High | 사용자당 분석 요청 속도 제한 적용, 큐잉 시스템 도입 |
| 대용량 PDF 처리 시간 초과 | High | 타임아웃 설정 (60초), 비동기 처리 후 결과 폴링 |
| Gemini Files API 비용 증가 | Medium | 토큰 사용량 모니터링 및 일일 한도 설정 |
| PDF 내 이미지/스캔 문서 | Medium | Gemini의 멀티모달 기능으로 이미지 텍스트 추출 가능 |
| 악성 PDF 업로드 | High | 매직 바이트 검증, 파일 크기 제한, 바이러스 스캔(후속) |
| 동시 사용자 증가 시 파일 I/O 병목 | Medium | S3 전환으로 파일 I/O 분산, CDN 활용 |
| 사용자 개인정보 유출 위험 | High | 사용자 격리, 24시간 자동 삭제, PIPA 준수 |

---

## 의존성

| 의존 대상 | 유형 | 설명 |
|-----------|------|------|
| SPEC-AUTH-001 | 필수 | JWT 인증 (구현 완료) |
| SPEC-LLM-001 | 필수 | GeminiProvider, LLMMetrics (구현 완료) |
| SPEC-CHAT-001 | 참조 | 채팅 UI 패턴 참조 (구현 완료) |
| google-generativeai | 신규 패키지 | Gemini Files API 클라이언트 |
| Gemini API Key | 환경 변수 | 이미 구성됨 |

---

## 신규 파일 목록

### Backend

| 파일 | 설명 |
|------|------|
| `backend/app/models/pdf.py` | PdfUpload, PdfAnalysisSession, PdfAnalysisMessage 모델 |
| `backend/app/services/pdf/__init__.py` | PDF 서비스 패키지 |
| `backend/app/services/pdf/storage.py` | PDF 파일 저장/검증 서비스 |
| `backend/app/services/pdf/analysis.py` | Gemini PDF 분석 서비스 |
| `backend/app/services/pdf/session.py` | 분석 세션 관리 서비스 |
| `backend/app/services/pdf/schemas.py` | Pydantic 스키마 (요청/응답 모델) |
| `backend/app/api/v1/pdf.py` | PDF API 라우터 |
| `backend/alembic/versions/xxx_add_pdf_tables.py` | 마이그레이션 스크립트 |

### Frontend

| 파일 | 설명 |
|------|------|
| `frontend/components/pdf/PDFUploader.tsx` | 드래그 앤 드롭 업로드 컴포넌트 |
| `frontend/components/pdf/AnalysisResult.tsx` | 분석 결과 표시 컴포넌트 |
| `frontend/components/pdf/PDFChat.tsx` | PDF 전용 채팅 인터페이스 |
| `frontend/components/pdf/SessionList.tsx` | 세션 목록 컴포넌트 |
| `frontend/app/pdf/page.tsx` | PDF 분석 메인 페이지 |
| `frontend/app/pdf/[sessionId]/page.tsx` | 세션 상세 페이지 |

### Tests

| 파일 | 설명 |
|------|------|
| `backend/tests/services/pdf/test_storage.py` | 파일 저장 서비스 테스트 |
| `backend/tests/services/pdf/test_analysis.py` | PDF 분석 서비스 테스트 |
| `backend/tests/services/pdf/test_session.py` | 세션 관리 테스트 |
| `backend/tests/api/v1/test_pdf.py` | PDF API 엔드포인트 테스트 |
