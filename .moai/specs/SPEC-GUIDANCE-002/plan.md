---
id: SPEC-GUIDANCE-002
document: plan
version: 1.0.0
status: completed
created: 2026-03-17
updated: 2026-03-17
author: zuge3
---

# SPEC-GUIDANCE-002: 구현 계획

## 개요

기존 채팅 파이프라인에 분쟁 가이던스를 하이브리드 통합하는 SPEC.

## 구현 전략

### Phase 1: Backend Integration (TDD)
- ChatService에 IntentClassifier, GuidanceService 통합
- SSE 스트리밍에 guidance 이벤트 추가
- metadata에 guidance 결과 저장

### Phase 2: Frontend Integration (TDD)
- GuidanceCard 컴포넌트 구현 (접기/펼치기)
- SSE 파서에 guidance 이벤트 파싱 추가
- MessageBubble에 GuidanceCard 렌더링

## 의존성

- SPEC-GUIDANCE-001 (완료): GuidanceService, 판례 분석 API
- SPEC-LLM-001 (완료): IntentClassifier
- SPEC-CHAT-001 (완료): ChatService, SSE 스트리밍
- SPEC-FRONTEND-001 (완료): MessageBubble, StreamingMessage
