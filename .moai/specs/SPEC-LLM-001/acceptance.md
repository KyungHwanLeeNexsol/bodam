---
id: SPEC-LLM-001
type: acceptance
version: 1.0.0
created: 2026-03-14
updated: 2026-03-14
author: zuge3
tags: [llm, rag, router, prompt, ai-core]
---

# SPEC-LLM-001: 인수 기준

## 1. Intent Classification (의도 분류)

### AC-LLM-001: 정상적인 약관 조회 쿼리 분류

```gherkin
Given 사용자가 "실손보험에서 MRI 비용이 보상되나요?" 라고 질문하면
When IntentClassifier가 쿼리를 분석하면
Then intent는 "policy_lookup"으로 분류되어야 한다
And confidence는 0.8 이상이어야 한다
And 분류에 사용된 모델은 "gpt-4o-mini"여야 한다
```

### AC-LLM-002: 보상 안내 쿼리 분류

```gherkin
Given 사용자가 "교통사고로 입원했는데 어떤 보상을 받을 수 있나요?" 라고 질문하면
When IntentClassifier가 쿼리를 분석하면
Then intent는 "claim_guidance"로 분류되어야 한다
And confidence는 0.8 이상이어야 한다
```

### AC-LLM-003: 일반 질의 분류

```gherkin
Given 사용자가 "보험 가입 시 주의할 점이 뭔가요?" 라고 질문하면
When IntentClassifier가 쿼리를 분석하면
Then intent는 "general_qa"로 분류되어야 한다
```

### AC-LLM-004: Intent 분류 정확도 기준

```gherkin
Given 한국어 보험 도메인 쿼리 100개의 골든 셋이 준비되어 있으면
When IntentClassifier가 모든 쿼리를 분류하면
Then 전체 정확도는 90% 이상이어야 한다
And 각 카테고리별 정확도는 85% 이상이어야 한다
```

---

## 2. LLM Router (모델 라우팅)

### AC-LLM-005: Primary 모델 선택 (Gemini 2.0 Flash)

```gherkin
Given intent가 "policy_lookup"으로 분류되었으면
When LLMRouter가 모델을 선택하면
Then Gemini 2.0 Flash가 primary 모델로 선택되어야 한다
And 응답에 사용된 모델명이 "gemini-2.0-flash"로 기록되어야 한다
```

### AC-LLM-006: Low Confidence Fallback

```gherkin
Given intent가 "claim_guidance"이고 Gemini 2.0 Flash가 응답을 생성했으나
When 응답의 confidence_score가 0.7 미만이면
Then GPT-4o로 재처리해야 한다
And 최종 응답의 model_used는 "gpt-4o"여야 한다
And 두 모델의 비용이 모두 기록되어야 한다
```

### AC-LLM-007: API 실패 시 Fallback Chain

```gherkin
Given Gemini 2.0 Flash API가 타임아웃(30초 초과) 또는 500 에러를 반환하면
When FallbackChain이 작동하면
Then GPT-4o로 자동 전환하여 재시도해야 한다
And GPT-4o도 실패하면 GPT-4o-mini로 최종 시도해야 한다
And 모든 시도의 에러 로그가 기록되어야 한다
And 사용자에게는 최종 성공 응답만 전달되어야 한다
```

### AC-LLM-008: 전체 Fallback 실패

```gherkin
Given 모든 LLM Provider가 실패(Gemini, GPT-4o, GPT-4o-mini 모두)하면
When FallbackChain이 모든 시도를 소진하면
Then "AI 서비스에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요." 메시지를 반환해야 한다
And 에러 메트릭이 기록되어야 한다
```

---

## 3. Prompt Management (프롬프트 관리)

### AC-LLM-009: 카테고리별 프롬프트 로드

```gherkin
Given intent가 "policy_lookup"으로 결정되었으면
When PromptManager가 시스템 프롬프트를 로드하면
Then "insurance_policy_expert" 템플릿이 적용되어야 한다
And 프롬프트에 약관 분석 전문가 페르소나가 포함되어야 한다
And 프롬프트 버전이 기록되어야 한다
```

### AC-LLM-010: 컨텍스트 윈도우 초과 시 압축

```gherkin
Given 대화 히스토리(10개 메시지)와 검색 결과(5개 chunk)의 합산 토큰이
  모델의 컨텍스트 윈도우 80%를 초과하면
When ContextBuilder가 컨텍스트를 구성하면
Then 오래된 대화 히스토리부터 요약/압축하여 80% 이내로 맞춰야 한다
And 최근 3개 메시지는 원본 유지해야 한다
And 검색 결과는 압축 없이 전체 포함해야 한다
```

---

## 4. RAG Chain (검색 증강 생성)

### AC-LLM-011: Query Rewriting

```gherkin
Given 사용자가 "실손 MRI" 라고 짧게 질문하면
When QueryRewriter가 쿼리를 최적화하면
Then 최적화된 쿼리는 "실손의료보험 MRI 검사 보상 관련 약관" 형태로 확장되어야 한다
And 원본 쿼리와 rewritten 쿼리가 모두 로그에 기록되어야 한다
```

### AC-LLM-012: Multi-step Retrieval

```gherkin
Given 사용자가 "인공관절 수술 보험 보상" 이라고 질문하면
When RAGChain이 multi-step retrieval을 수행하면
Then 1차 검색으로 관련 약관 chunk를 검색해야 한다
And 1차 결과 기반으로 refined query를 생성하여 2차 검색을 수행해야 한다
And 최종 결과는 중복 제거 후 relevance score 기준 정렬되어야 한다
```

### AC-LLM-013: Confidence Score 포함

```gherkin
Given RAGChain과 LLMRouter를 통해 응답이 생성되면
When 응답이 반환되면
Then confidence_score 필드가 0.0~1.0 범위로 포함되어야 한다
And score가 0.7 이상이면 "높은 신뢰도" 범주에 해당해야 한다
```

### AC-LLM-014: 출처 인용

```gherkin
Given 검색 결과에 3개의 관련 약관이 포함되면
When 최종 응답이 생성되면
Then sources 배열에 각 약관의 보험사명, 약관명이 포함되어야 한다
And chunk_text는 200자 이내로 잘려야 한다
And similarity score가 포함되어야 한다
```

---

## 5. Response Quality (응답 품질)

### AC-LLM-015: Hallucination 방지

```gherkin
Given 검색 결과에 "암 진단비"에 대한 약관만 포함되어 있으면
When 사용자가 "치과 치료도 보상되나요?" 라고 질문하면
Then 응답에 치과 치료 보상에 관한 구체적 금액이나 조건을 생성하지 않아야 한다
And "해당 내용에 대한 정확한 정보를 찾지 못했습니다" 안내가 포함되어야 한다
```

### AC-LLM-016: 컨텍스트 불충분 감지

```gherkin
Given VectorSearchService 검색 결과가 0건이거나
  최고 similarity score가 0.5 미만이면
When QualityGuard가 응답을 평가하면
Then "해당 내용에 대한 정확한 정보를 찾지 못했습니다. 보험사에 직접 문의하시는 것을 권장합니다." 안내를 포함해야 한다
And confidence_score는 0.3 이하여야 한다
```

### AC-LLM-017: 구조화 출력 (Claim Guidance)

```gherkin
Given intent가 "claim_guidance"이고 구조화된 분석이 필요한 쿼리이면
When QualityGuard가 JSON mode로 출력을 포맷팅하면
Then 응답에 다음 필드가 포함되어야 한다:
  | 필드 | 설명 |
  |------|------|
  | applicable_coverages | 적용 가능 담보 목록 |
  | estimated_amount_range | 예상 보상 금액 범위 |
  | required_documents | 필요 서류 목록 |
  | additional_notes | 유의사항 |
```

---

## 6. Monitoring and Analytics (모니터링)

### AC-LLM-018: 쿼리별 메트릭 수집

```gherkin
Given 사용자 쿼리가 처리 완료되면
When LLMMetrics가 메트릭을 기록하면
Then 다음 필드가 모두 포함되어야 한다:
  | 필드 | 타입 | 설명 |
  |------|------|------|
  | latency_ms | float | 전체 응답 지연시간 |
  | input_tokens | int | 입력 토큰 수 |
  | output_tokens | int | 출력 토큰 수 |
  | model_used | str | 최종 사용 모델명 |
  | estimated_cost_usd | float | 예상 비용 (USD) |
  | retrieval_relevance | float | 검색 결과 관련성 평균 |
```

### AC-LLM-019: 세션 비용 집계

```gherkin
Given 사용자가 한 세션에서 5개의 메시지를 주고받았으면
When 세션이 종료되면
Then 세션 메타데이터에 다음이 집계되어야 한다:
  - total_cost_usd: 5개 쿼리의 총 비용 합산
  - total_tokens: 입력+출력 토큰 합산
  - avg_latency_ms: 평균 응답 지연시간
  - models_used: 사용된 모델 목록
```

---

## 7. API 하위 호환성

### AC-LLM-020: 기존 Chat API 호환

```gherkin
Given 기존 Chat API 클라이언트가 POST /api/v1/chat/sessions/{id}/messages 로 요청하면
When 리팩토링된 ChatService가 응답하면
Then 응답 스키마는 기존과 동일해야 한다 (content, role, metadata_ 포함)
And 기존 테스트가 모두 통과해야 한다
```

### AC-LLM-021: SSE 스트리밍 호환

```gherkin
Given 기존 SSE 스트리밍 클라이언트가 POST /api/v1/chat/sessions/{id}/messages/stream 으로 요청하면
When 리팩토링된 send_message_stream()이 응답하면
Then "token", "sources", "done" 이벤트 순서가 유지되어야 한다
And 각 토큰 이벤트의 형식이 기존과 동일해야 한다
```

### AC-LLM-022: 응답 메타데이터 확장

```gherkin
Given 리팩토링 후 응답이 생성되면
When 클라이언트가 metadata_를 조회하면
Then 기존 필드(model, sources)가 유지되어야 한다
And 신규 필드(confidence_score, cost_metadata)가 추가되어야 한다
And 기존 클라이언트는 신규 필드를 무시해도 정상 동작해야 한다
```

---

## 8. 성능 기준

### AC-LLM-023: 응답 지연시간

```gherkin
Given 일반적인 보험 질문(50자 이내)이 입력되면
When 전체 파이프라인(분류 -> RAG -> 응답 생성)이 실행되면
Then 총 end-to-end 지연시간은 다음을 만족해야 한다:
  - P50: 2초 이내
  - P95: 4초 이내
  - P99: 6초 이내
```

### AC-LLM-024: 쿼리당 비용

```gherkin
Given Gemini 2.0 Flash가 primary 모델로 사용되면
When 100개의 일반 쿼리를 처리하면
Then 평균 쿼리당 비용은 $0.005 이하여야 한다
And fallback 포함 최대 비용은 쿼리당 $0.05 이하여야 한다
```

### AC-LLM-025: 동시 처리

```gherkin
Given 10개의 동시 쿼리가 수신되면
When 모든 쿼리가 병렬 처리되면
Then 모든 응답이 10초 이내에 완료되어야 한다
And 어떤 쿼리도 타임아웃(30초) 되지 않아야 한다
```

---

## 9. Edge Cases (경계 조건)

### AC-LLM-026: 빈 쿼리 처리

```gherkin
Given 사용자가 빈 문자열 또는 공백만 포함된 쿼리를 전송하면
When ChatService가 처리하면
Then "질문을 입력해 주세요." 안내 메시지를 반환해야 한다
And LLM API를 호출하지 않아야 한다 (비용 발생 없음)
```

### AC-LLM-027: 매우 긴 쿼리 처리

```gherkin
Given 사용자가 2000자 이상의 매우 긴 쿼리를 전송하면
When ChatService가 처리하면
Then 쿼리를 1000자로 truncate하여 처리해야 한다
And 원본 쿼리가 잘렸음을 로그에 기록해야 한다
```

### AC-LLM-028: 보험 외 도메인 쿼리

```gherkin
Given 사용자가 "오늘 서울 날씨 알려줘" 라고 보험과 무관한 질문을 하면
When IntentClassifier가 분류하면
Then intent는 "general_qa"로 분류되어야 한다
And 응답은 보험 상담 범위를 벗어남을 안내하되 친절하게 대응해야 한다
```

---

## 10. Definition of Done

- [ ] 모든 Acceptance Criteria(AC-LLM-001 ~ AC-LLM-028) 통과
- [ ] 단위 테스트 커버리지 85% 이상 (`backend/app/services/llm/`, `backend/app/services/rag/chain.py`, `rewriter.py`, `refiner.py`)
- [ ] 기존 Chat API 통합 테스트 전부 통과 (하위 호환성)
- [ ] Intent 분류 골든 셋 정확도 90% 이상
- [ ] Hallucination rate 5% 미만
- [ ] 평균 응답 지연시간 P50 < 2초
- [ ] 평균 쿼리 비용 < $0.005
- [ ] SSE 스트리밍 정상 동작 확인
- [ ] 코드 리뷰 완료 및 ruff lint 통과
- [ ] structlog 기반 메트릭 로깅 동작 확인

---

## Traceability

| 인수 기준 | 관련 요구사항 | 검증 방법 |
|-----------|-------------|-----------|
| AC-LLM-001~004 | REQ-LLM-001, 002 | 골든 셋 자동 평가 |
| AC-LLM-005~008 | REQ-LLM-003~006 | Mock + 통합 테스트 |
| AC-LLM-009~010 | REQ-LLM-007~009 | 단위 테스트 |
| AC-LLM-011~014 | REQ-LLM-010~013 | 통합 테스트 |
| AC-LLM-015~017 | REQ-LLM-014~016 | 골든 셋 + 단위 테스트 |
| AC-LLM-018~019 | REQ-LLM-017~018 | 로그 검증 |
| AC-LLM-020~022 | 하위 호환성 | 기존 API 테스트 |
| AC-LLM-023~025 | 성능 요구사항 | 부하 테스트 |
| AC-LLM-026~028 | Edge Cases | 단위 테스트 |
