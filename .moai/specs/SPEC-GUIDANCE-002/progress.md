---
id: SPEC-GUIDANCE-002
document: progress
version: 1.0.0
status: completed
created: 2026-03-15
updated: 2026-03-17
author: zuge3
tags: [guidance, chat-integration, hybrid]
---

# SPEC-GUIDANCE-002: 진행 현황

## 전체 진행률: 100%

| 마일스톤 | 상태 | 진행률 |
|----------|------|--------|
| Phase 1: Backend TDD | 완료 | 100% |
| Phase 2: Frontend TDD | 완료 | 100% |

### Phase 1: Backend Integration (REQ-GC-001~004)

**TDD RED-GREEN-REFACTOR cycle complete**

- ChatService.__init__에 IntentClassifier, GuidanceService 선택적 파라미터 추가
- _classify_intent() 공통 헬퍼: 의도 분류 + 오류 시 general_qa 폴백
- _analyze_guidance() 공통 헬퍼: confidence >= 0.6 조건 검사 + guidance 분석
- send_message(): 의도 분류 → guidance 분석 → metadata 저장
- send_message_stream(): sources → guidance → done 이벤트 순서 보장
- Tests: 13 new + 16 existing = 29 all passing
- ruff: All checks passed

### Phase 2: Frontend Integration (REQ-GC-005~007)

- GuidanceCard.tsx: 접기/펼치기 컴포넌트 (amber 색상 테마)
- chat.ts: GuidanceData, 10개 관련 타입 추가, SSEEvent 확장
- sse-parser.ts: guidance 이벤트 파싱 케이스 추가
- MessageBubble.tsx: GuidanceCard 조건부 렌더링
- StreamingMessage.tsx: guidance prop 지원
- page.tsx: streamingGuidance 상태 + SET_GUIDANCE 액션 추가
- Tests: 8 new (GuidanceCard.test.tsx) + 124 existing = 132 all passing

### Acceptance Criteria Status

| ACC | Description | Status |
|-----|-------------|--------|
| ACC-01 | IntentClassifier.classify() 호출 | Complete |
| ACC-02 | metadata_["intent"] 저장 | Complete |
| ACC-03 | 분류기 오류 시 general_qa 폴백 | Complete |
| ACC-04 | dispute_guidance → analyze_dispute() 호출 | Complete |
| ACC-05 | metadata_["guidance"] 직렬화 저장 | Complete |
| ACC-06 | guidance 오류 시 채팅 정상 반환 | Complete |
| ACC-07 | confidence < 0.6 시 guidance 스킵 | Complete |
| ACC-08 | SSE guidance 이벤트 | Complete |
| ACC-09 | sources → guidance → done 순서 | Complete |
| ACC-10 | Guidance 메타데이터 스키마 | Complete |
| ACC-11 | GuidanceCard 기본 접힘 | Complete |
| ACC-12 | 헤더에 분쟁 유형 + 라벨 | Complete |
| ACC-13 | 펼침 시 판례/확률/증거/에스컬레이션 | Complete |
| ACC-14 | 면책 고지 항상 표시 | Complete |
| ACC-15 | MessageMetadata guidance 필드 | Complete |
| ACC-16 | GuidanceData 인터페이스 정의 | Complete |
| ACC-17 | SSEEvent guidance 케이스 | Complete |
| ACC-18 | StreamingMessage guidance 렌더링 | Complete |

### Verification

- Backend: 1256 tests passed (pytest)
- Frontend: 124 tests passed (vitest), 13 test files
- Backend ruff: All checks passed
- Frontend tsc: No new errors (pre-existing auth/pdf errors only)

### Status: Complete
