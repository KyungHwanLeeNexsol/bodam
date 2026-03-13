## SPEC-FRONTEND-001 Progress

- Started: 2026-03-13
- Development Mode: TDD (RED-GREEN-REFACTOR)
- Depends on: SPEC-CHAT-001 (completed)

### Phase 1: API Client & Types (M1) - NOT STARTED
- [ ] TypeScript 타입 정의 (ChatSession, ChatMessage, SSEEvent 등)
- [ ] fetch 기반 API 클라이언트 (6개 메서드)
- [ ] SSE 파서 (ReadableStream 기반)
- [ ] 에러 처리 (한국어 메시지 변환)
- [ ] 단위 테스트

### Phase 2: Chat UI Components (M2) - NOT STARTED
- [ ] ChatLayout (사이드바 + 채팅 영역)
- [ ] SessionList (세션 목록/선택/삭제)
- [ ] MessageBubble (사용자/AI 스타일)
- [ ] StreamingMessage (토큰 단위 표시)
- [ ] SourcesCard (접기/펼치기)
- [ ] ChatInput (Enter/Shift+Enter, 5000자 제한)
- [ ] EmptyState (환영 메시지, 추천 질문)
- [ ] LoadingStates (스켈레톤)
- [ ] 컴포넌트 테스트

### Phase 3: Chat Page Integration (M3) - NOT STARTED
- [ ] /chat 페이지 useReducer 상태 관리
- [ ] 세션 CRUD 연동
- [ ] SSE 스트리밍 처리
- [ ] 자동 스크롤
- [ ] 모바일 반응형 사이드바
- [ ] 에러 처리 UI
- [ ] 통합 테스트

### Phase 4: Landing Page Connection (M4) - NOT STARTED
- [ ] HeroSection "시작하기" -> /chat 연결
- [ ] Header "상담하기" 내비게이션 추가
- [ ] CTASection CTA -> /chat 연결
