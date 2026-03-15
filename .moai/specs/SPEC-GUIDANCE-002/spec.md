# SPEC-GUIDANCE-002: Guidance-Chat 하이브리드 통합

## Overview

기존 채팅 파이프라인에 분쟁 가이던스를 통합하여, IntentClassifier가 `dispute_guidance`를 감지했을 때 GuidanceService 분석 결과를 채팅 응답 메타데이터에 포함하고, 프론트엔드에서 접을 수 있는 가이던스 카드로 렌더링합니다.

## Motivation

- SPEC-GUIDANCE-001에서 백엔드 Guidance API가 완성되었으나 프론트엔드 UI 미구현
- 별도 페이지 대신 기존 채팅 UI에 하이브리드 통합 (C 방식)
- 사용자가 분쟁 관련 질문을 하면 자연스럽게 가이던스 정보 제공

## Architecture

```
사용자 질문
    ↓
ChatService.send_message()
    ├── IntentClassifier.classify()        ← 추가
    ├── RAG 검색 + LLM 응답               ← 기존
    └── if intent == DISPUTE_GUIDANCE:
          GuidanceService.analyze_dispute() ← 추가
          metadata_["guidance"] = 결과     ← metadata 확장
    ↓
Frontend MessageBubble
    ├── 메시지 버블                        ← 기존
    ├── SourcesCard                        ← 기존
    └── GuidanceCard (접기/펼치기)          ← 추가
```

## Requirements (EARS Format)

### Backend

**REQ-GC-001**: ChatService Intent 통합
When a user sends a message, the system SHALL classify the query intent using IntentClassifier before generating the AI response.

**ACC-01**: ChatService.send_message()에서 IntentClassifier.classify() 호출
**ACC-02**: 분류된 intent를 metadata_["intent"]에 저장 (현재 None인 필드 활용)
**ACC-03**: IntentClassifier 오류 시 general_qa로 폴백하고 정상 응답 반환

**REQ-GC-002**: Guidance 분석 트리거
When IntentClassifier returns `dispute_guidance` with confidence >= 0.6, the system SHALL additionally call GuidanceService.analyze_dispute() and include the result in the response metadata.

**ACC-04**: dispute_guidance 감지 시 GuidanceService.analyze_dispute(query) 호출
**ACC-05**: guidance 결과를 metadata_["guidance"]에 직렬화하여 저장
**ACC-06**: guidance 분석 실패 시 기본 채팅 응답은 정상 반환 (guidance만 누락)
**ACC-07**: confidence < 0.6이면 guidance 분석 건너뛰기

**REQ-GC-003**: SSE 스트리밍 Guidance 이벤트
When streaming mode is used and dispute_guidance is detected, the system SHALL emit a `guidance` SSE event after the `sources` event.

**ACC-08**: send_message_stream에서 `{"type": "guidance", "content": {...}}` 이벤트 추가
**ACC-09**: guidance 이벤트는 sources 이벤트 이후, done 이벤트 이전에 발생

**REQ-GC-004**: Guidance 메타데이터 스키마
The guidance metadata SHALL include dispute_type, precedent_count, probability_score, escalation_level, and disclaimer.

**ACC-10**: guidance 메타데이터 구조:
```json
{
  "dispute_type": "claim_denial",
  "dispute_type_label": "보험금 지급 거절",
  "precedents": [{"case_number": "...", "summary": "...", "relevance_score": 0.85}],
  "probability": {"overall_score": 0.65, "confidence": 0.7},
  "evidence": {"required_documents": [...], "recommended_documents": [...]},
  "escalation": {"recommended_level": "fss_complaint", "reason": "...", "next_steps": [...]},
  "ambiguous_clauses": [{"clause_text": "...", "recommendation": "..."}],
  "disclaimer": "본 정보는 참고용이며..."
}
```

### Frontend

**REQ-GC-005**: GuidanceCard 컴포넌트
When an assistant message has metadata.guidance, the system SHALL render a collapsible GuidanceCard below the SourcesCard.

**ACC-11**: GuidanceCard는 기본 접힘(collapsed) 상태로 렌더링
**ACC-12**: 헤더에 분쟁 유형과 "분쟁 가이던스" 라벨 표시
**ACC-13**: 펼침 시 판례 요약, 승소 확률, 증거 체크리스트, 에스컬레이션 단계 표시
**ACC-14**: 면책 고지는 GuidanceCard 하단에 항상 표시

**REQ-GC-006**: MessageMetadata 타입 확장
The frontend TypeScript types SHALL be extended to include the guidance field.

**ACC-15**: MessageMetadata에 `guidance?: GuidanceData` 필드 추가
**ACC-16**: GuidanceData 인터페이스 정의 (dispute_type, precedents, probability 등)

**REQ-GC-007**: SSE Guidance 이벤트 처리
When a `guidance` SSE event is received during streaming, the system SHALL update the message metadata with guidance data.

**ACC-17**: SSEEvent 유니온에 `{ type: "guidance"; content: GuidanceData }` 추가
**ACC-18**: StreamingMessage 컴포넌트에서 guidance 이벤트 수신 시 GuidanceCard 렌더링

## Implementation Phases

### Phase 1: Backend 통합 (REQ-GC-001~004)
- ChatService에 IntentClassifier 주입 및 호출
- dispute_guidance 감지 시 GuidanceService 호출
- metadata_["intent"], metadata_["guidance"] 저장
- SSE guidance 이벤트 추가
- 테스트: ChatService 통합 테스트

### Phase 2: Frontend 통합 (REQ-GC-005~007)
- TypeScript 타입 확장 (GuidanceData, SSEEvent)
- GuidanceCard 컴포넌트 구현
- MessageBubble에 GuidanceCard 조건부 렌더링
- StreamingMessage에 guidance 이벤트 핸들링
- 테스트: 컴포넌트 테스트

## Files to Modify

### Backend (Phase 1)
- `backend/app/services/chat_service.py` — IntentClassifier + GuidanceService 통합
- `backend/tests/unit/test_chat_service.py` — 통합 테스트 추가

### Frontend (Phase 2)
- `frontend/lib/types/chat.ts` — GuidanceData, SSEEvent 타입 추가
- `frontend/components/chat/GuidanceCard.tsx` — 신규 컴포넌트
- `frontend/components/chat/MessageBubble.tsx` — GuidanceCard 렌더링 추가
- `frontend/components/chat/StreamingMessage.tsx` — guidance 이벤트 핸들링
- `frontend/tests/` — 컴포넌트 테스트

## Dependencies

- SPEC-GUIDANCE-001 (완료): GuidanceService, DisputeDetector, PrecedentService 등
- SPEC-LLM-001 (완료): IntentClassifier, QueryIntent
- SPEC-CHAT-001 (완료): ChatService, SSE 스트리밍
- SPEC-FRONTEND-001 (완료): MessageBubble, SourcesCard, StreamingMessage

## Non-Goals

- 별도 `/guidance` 페이지 구현 (채팅 통합으로 대체)
- B2B 프론트엔드 UI (별도 SPEC 필요)
- 판례 전문 열람 기능 (향후 확장)
