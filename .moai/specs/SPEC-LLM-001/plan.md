---
id: SPEC-LLM-001
type: plan
version: 1.0.0
created: 2026-03-14
updated: 2026-03-14
author: zuge3
tags: [llm, rag, router, prompt, ai-core]
---

# SPEC-LLM-001: 구현 계획서

## 1. 구현 전략 개요

기존 ChatService의 공개 API(send_message, send_message_stream)를 유지하면서, 내부 구현을 Multi-LLM Router + RAG Chain 아키텍처로 점진적으로 교체한다. LangChain 1.2.x를 오케스트레이션 프레임워크로 활용한다.

### 핵심 원칙

- **하위 호환성 보장**: Chat API 엔드포인트와 응답 스키마 변경 없음
- **점진적 마이그레이션**: 모듈별 독립 개발 및 테스트 후 통합
- **비용 최적화**: Gemini 2.0 Flash를 primary로 사용하여 비용 90% 절감 목표
- **Adapter 패턴**: LLM 교체가 용이하도록 추상화 레이어 설계

---

## 2. 기술 스택

| 카테고리 | 기술 | 버전 | 용도 |
|---------|------|------|------|
| LLM 오케스트레이션 | LangChain | 1.2.x | Chain 구성, 프롬프트 관리 |
| Gemini 통합 | langchain-google-genai | 2.x | Gemini 2.0 Flash 연동 |
| OpenAI 통합 | langchain-openai | 1.1.x | GPT-4o, GPT-4o-mini 연동 |
| 데이터 검증 | Pydantic | 2.12.x | 입출력 스키마 정의 |
| 비동기 HTTP | httpx | 0.28.x | Gemini API 비동기 호출 |
| 메트릭 수집 | structlog | 25.x | 구조화된 로깅 및 메트릭 |

---

## 3. 마일스톤 및 태스크 분해

### Primary Goal: LLM 추상화 레이어 및 Router 구축

**M1-1: Pydantic 모델 및 인터페이스 정의**
- `backend/app/services/llm/models.py` 생성
- QueryIntent, IntentResult, LLMResponse, SourceCitation, PromptTemplate 모델 정의
- 모든 모듈이 공유하는 데이터 계약 확립
- 검증: 단위 테스트로 모델 직렬화/역직렬화 확인

**M1-2: LLM Provider Adapter 구현**
- `backend/app/services/llm/router.py` 생성
- BaseLLMProvider 추상 클래스 정의 (generate, generate_stream 메서드)
- GeminiFlashProvider: Gemini 2.0 Flash 어댑터 (langchain-google-genai 사용)
- OpenAIProvider: GPT-4o 어댑터 (langchain-openai 사용)
- OpenAIMiniProvider: GPT-4o-mini 어댑터
- 각 Provider에 토큰 카운팅 및 비용 계산 로직 내장
- 검증: 각 Provider에 대한 mock 테스트 + 실제 API 통합 테스트

**M1-3: LLMRouter 및 FallbackChain 구현**
- ModelSelector: intent + confidence 기반 모델 선택 로직
- FallbackChain: Gemini -> GPT-4o -> GPT-4o-mini 자동 전환
- 재시도 로직: 타임아웃(30초), rate limit, API 오류 처리
- 검증: fallback 시나리오별 단위 테스트

### Secondary Goal: Intent Classifier 및 Prompt Manager

**M2-1: IntentClassifier 구현**
- `backend/app/services/llm/classifier.py` 생성
- GPT-4o-mini 기반 intent 분류 (few-shot prompting)
- 분류 카테고리: policy_lookup, claim_guidance, general_qa
- 분류 결과 캐싱 (동일 쿼리 패턴 재사용)
- 검증: 한국어 보험 쿼리 100개 골든 셋으로 정확도 측정 (목표: 90%+)

**M2-2: PromptManager 구현**
- `backend/app/services/llm/prompts.py` 생성
- 프롬프트 템플릿 레지스트리 (딕셔너리 기반, 추후 DB 이관 가능)
- 카테고리별 시스템 프롬프트 3종:
  - `insurance_policy_expert`: 약관 분석 전문가 페르소나
  - `claim_advisor`: 보상 안내 전문가 페르소나
  - `general_assistant`: 일반 보험 상담 페르소나
- 버전 관리: 프롬프트 변경 시 버전 증가, 이전 버전 보관
- 컨텍스트 윈도우 관리: 히스토리 요약/압축 로직
- 검증: 각 프롬프트 템플릿의 변수 치환 테스트

### Secondary Goal: RAG Chain 고도화

**M3-1: QueryRewriter 구현**
- `backend/app/services/rag/rewriter.py` 생성
- LLM 기반 쿼리 최적화 (GPT-4o-mini 사용, 저비용)
- 보험 약어 사전: "실손" -> "실손의료보험", "통원" -> "통원치료비"
- 의미 확장: "교통사고 입원" -> "교통사고로 인한 입원치료 보상 관련 약관"
- 검증: 쿼리 변환 전/후 검색 결과 relevance 비교

**M3-2: RAGChain 및 ResultRefiner 구현**
- `backend/app/services/rag/chain.py` 생성
- Multi-step retrieval: 1차 검색 -> 결과 기반 refined query -> 2차 검색
- 결과 re-ranking: LLM 기반 relevance 재평가
- ContextBuilder: 검색 결과 + 대화 히스토리 조합 및 토큰 제한 관리
- 검증: 기존 검색 대비 precision/recall 향상 측정

### Final Goal: Quality Guard 및 Metrics

**M4-1: QualityGuard 구현**
- `backend/app/services/llm/quality.py` 생성
- ConfidenceScorer: LLM 응답의 자기 평가 confidence score 추출
- HallucinationDetector: 응답 내용이 제공된 컨텍스트에 근거하는지 검증
- "모르겠다" 감지: 컨텍스트 불충분 시 안전한 안내 메시지 생성
- 구조화 출력: JSON mode를 통한 보상 분석 결과 포맷팅
- 검증: hallucination 테스트 케이스 20개, false positive/negative 측정

**M4-2: LLMMetrics 구현**
- `backend/app/services/llm/metrics.py` 생성
- 쿼리별 메트릭: latency, tokens, model, cost, relevance_score
- 세션별 집계: 총 비용, 총 토큰, 평균 응답시간
- structlog 기반 구조화 로깅
- 검증: 메트릭 정확성 단위 테스트

### Final Goal: ChatService 리팩토링 및 통합

**M5-1: ChatService 통합**
- 기존 `chat_service.py`의 `send_message()` 내부 로직을 RAGChain + LLMRouter로 교체
- `send_message_stream()` SSE 스트리밍 유지 (LLM Provider의 stream 인터페이스 활용)
- 응답 metadata에 confidence_score, cost_metadata 추가 (기존 sources 유지)
- 검증: 기존 API 테스트 전부 통과 + 신규 기능 테스트

**M5-2: Config 확장**
- `config.py`에 Gemini API 키, 라우팅 설정, 프롬프트 설정 추가
- 환경변수 기반 모델 전환 (GEMINI_API_KEY, LLM_PRIMARY_MODEL 등)
- 검증: 설정 로딩 테스트

---

## 4. 리팩토링 대상 기존 코드

### ChatService (`backend/app/services/chat_service.py`)

**현재 문제점:**
- OpenAI client 직접 사용 (단일 모델 고정)
- 하드코딩된 시스템 프롬프트 (`_SYSTEM_PROMPT` 상수)
- RAG 검색과 LLM 호출이 하나의 메서드에 결합
- 에러 처리가 OpenAI 전용 (다른 LLM 미지원)
- 비용/메트릭 추적 없음

**리팩토링 방향:**
- `_openai_client` -> `LLMRouter` 인스턴스로 교체
- `_SYSTEM_PROMPT` -> `PromptManager`에서 동적 로드
- `send_message()` 내 RAG 로직 -> `RAGChain` 위임
- 에러 처리를 LLM Provider 추상화 레이어로 이동
- 응답 metadata에 비용/모델 정보 추가

### Config (`backend/app/core/config.py`)

**추가 필드:**
```python
# Gemini API 설정
gemini_api_key: str = ""
# LLM 라우팅 설정
llm_primary_model: str = "gemini-2.0-flash"
llm_fallback_model: str = "gpt-4o"
llm_classifier_model: str = "gpt-4o-mini"
# 품질 설정
llm_confidence_threshold: float = 0.7
llm_fallback_on_low_confidence: bool = True
# 비용 추적
llm_cost_tracking_enabled: bool = True
```

---

## 5. 통합 포인트

### 기존 서비스와의 연동

| 통합 대상 | 연동 방식 | 변경 영향 |
|-----------|-----------|-----------|
| VectorSearchService | RAGChain에서 직접 호출 (기존 인터페이스 유지) | 변경 없음 |
| EmbeddingService | RAGChain의 QueryRewriter가 rewritten query 임베딩 시 사용 | 변경 없음 |
| Chat API (v1/chat.py) | ChatService 내부만 교체, API 시그니처 유지 | 변경 없음 |
| Search API (v1/search.py) | 영향 없음 | 변경 없음 |

### 의존성 설치

```toml
# pyproject.toml 추가
[project.dependencies]
langchain = ">=1.2.0,<2.0"
langchain-google-genai = ">=2.0.0,<3.0"
langchain-openai = ">=1.1.0,<2.0"
structlog = ">=25.0.0"
```

---

## 6. 리스크 및 대응

| 리스크 | 영향도 | 대응 방안 |
|--------|--------|-----------|
| Gemini 2.0 Flash가 한국어 보험 도메인에서 품질 미달 | 높음 | GPT-4o fallback 자동 전환, A/B 테스트로 품질 비교 |
| LangChain 1.2.x와 Gemini API 호환성 이슈 | 중간 | langchain-google-genai 직접 사용, 필요시 httpx로 direct API 호출 |
| Intent 분류 정확도 90% 미달 | 중간 | Few-shot 예시 확장, 보험 도메인 특화 분류 프롬프트 튜닝 |
| Query rewriting으로 인한 추가 지연시간 | 낮음 | GPT-4o-mini 사용으로 50ms 이내 유지, 캐싱 적용 |
| 멀티 LLM 호출로 인한 비용 증가 | 중간 | Intent 분류 캐싱, Gemini 우선 사용으로 비용 최소화 |
| SSE 스트리밍과 Gemini API 호환성 | 중간 | Gemini streaming API 테스트 후 미지원 시 buffer 방식 적용 |

---

## 7. 테스트 전략

### 단위 테스트

- 각 Provider (Gemini, OpenAI) mock 테스트
- IntentClassifier 분류 정확도 테스트
- PromptManager 템플릿 로딩/변수 치환 테스트
- CostTracker 비용 계산 정확성 테스트
- QualityGuard hallucination 감지 테스트

### 통합 테스트

- RAGChain 전체 파이프라인 (query -> rewrite -> search -> refine -> generate)
- FallbackChain 시나리오 (primary 실패 -> secondary 전환)
- ChatService 리팩토링 후 기존 API 호환성

### 성능 테스트

- 단일 쿼리 end-to-end 지연시간: 목표 3초 이내
- 동시 10 쿼리 처리: 평균 5초 이내
- 비용 측정: 100 쿼리 배치로 평균 비용 검증

### 골든 셋 평가

- 한국어 보험 쿼리 100개 수동 큐레이션
- Intent 분류 정확도: 90%+ 목표
- RAG 검색 relevance: precision@5 >= 0.7 목표
- Hallucination rate: < 5% 목표

---

## Traceability

| 태스크 | 관련 요구사항 | 우선순위 |
|--------|-------------|---------|
| M1-1~M1-3 | REQ-LLM-001~006 | Primary |
| M2-1~M2-2 | REQ-LLM-002, 007~009 | Secondary |
| M3-1~M3-2 | REQ-LLM-010~013 | Secondary |
| M4-1~M4-2 | REQ-LLM-014~018 | Final |
| M5-1~M5-2 | 전체 통합 | Final |
