---
id: SPEC-FRONTEND-001
type: plan
version: 0.1.0
status: draft
created: 2026-03-13
tags: [frontend, chat, ui, nextjs, react, sse, streaming]
development_mode: tdd
---

# SPEC-FRONTEND-001 구현 계획

## 1. 개요

SPEC-FRONTEND-001은 Bodam 플랫폼의 Chat UI 프론트엔드를 구현한다. TDD(RED-GREEN-REFACTOR) 방식으로 4개 모듈을 의존성 순서대로 개발한다. 기존 Next.js 프로젝트에 채팅 기능을 추가하며, 백엔드 API(SPEC-CHAT-001)와 연동하여 SSE 스트리밍 기반 실시간 대화를 구현한다.

## 2. 구현 순서 및 의존성

```
M1: API 클라이언트 및 타입 정의
    |
    v
M2: Chat UI 컴포넌트 (M1 의존)
    |
    v
M3: /chat 페이지 통합 (M1 + M2 의존)
    |
    v
M4: 랜딩 페이지 연결 (M3 의존)
```

## 3. 마일스톤

### Primary Goal: M1 - API 클라이언트 및 타입 정의

**목적**: 백엔드 API와의 타입 안전한 통신 레이어 구축

**신규 파일**:
- `frontend/lib/types/chat.ts` - 타입 정의 (ChatSession, ChatMessage, SSEEvent 등)
- `frontend/lib/api/chat-client.ts` - API 클라이언트 클래스
- `frontend/lib/api/sse-parser.ts` - SSE 이벤트 스트림 파서
- `frontend/__tests__/lib/chat-client.test.ts` - API 클라이언트 테스트
- `frontend/__tests__/lib/sse-parser.test.ts` - SSE 파서 테스트

**TDD 사이클**:
1. RED: API 클라이언트 각 메서드 테스트 작성 (fetch 모킹), SSE 파서 테스트 작성
2. GREEN: fetch 기반 API 클라이언트 구현, ReadableStream 기반 SSE 파서 구현
3. REFACTOR: 에러 처리 통일, 타입 안전성 강화

**검증 기준**:
- 6개 API 메서드가 올바른 URL, method, body로 fetch 호출
- 에러 응답(404, 422, 500) 시 한국어 에러 메시지 변환
- SSE 파서가 token, sources, done, error 이벤트를 올바르게 파싱
- 불완전한 SSE 청크 버퍼링 처리

### Secondary Goal: M2 - Chat UI 컴포넌트

**목적**: 재사용 가능한 채팅 UI 컴포넌트 라이브러리 구축

**신규 파일**:
- `frontend/components/chat/ChatLayout.tsx` - 전체 레이아웃 (사이드바 + 채팅 영역)
- `frontend/components/chat/SessionList.tsx` - 세션 목록 컴포넌트
- `frontend/components/chat/MessageList.tsx` - 메시지 목록 (스크롤 영역)
- `frontend/components/chat/MessageBubble.tsx` - 개별 메시지 버블
- `frontend/components/chat/StreamingMessage.tsx` - 스트리밍 메시지 표시
- `frontend/components/chat/SourcesCard.tsx` - 출처 카드 (접기/펼치기)
- `frontend/components/chat/ChatInput.tsx` - 메시지 입력 영역
- `frontend/components/chat/EmptyState.tsx` - 빈 상태 화면
- `frontend/components/chat/LoadingStates.tsx` - 스켈레톤/로딩 컴포넌트
- `frontend/__tests__/components/chat/MessageBubble.test.tsx` - 메시지 버블 테스트
- `frontend/__tests__/components/chat/ChatInput.test.tsx` - 입력 컴포넌트 테스트
- `frontend/__tests__/components/chat/SessionList.test.tsx` - 세션 목록 테스트
- `frontend/__tests__/components/chat/EmptyState.test.tsx` - 빈 상태 테스트
- `frontend/__tests__/components/chat/SourcesCard.test.tsx` - 출처 카드 테스트

**TDD 사이클**:
1. RED: 각 컴포넌트 렌더링 및 인터랙션 테스트 작성 (Testing Library)
2. GREEN: Tailwind CSS + shadcn/ui 기반 컴포넌트 구현
3. REFACTOR: 공통 스타일 추출, 접근성 속성 보강

**검증 기준**:
- MessageBubble이 role에 따라 올바른 정렬과 색상 적용
- ChatInput이 Enter/Shift+Enter를 올바르게 처리
- SessionList가 세션 클릭/삭제 이벤트를 올바르게 전달
- EmptyState가 추천 질문을 표시하고 클릭 시 콜백 호출
- SourcesCard가 접기/펼치기 토글 동작
- 모든 컴포넌트에 ARIA 라벨 적용

### Final Goal: M3 - /chat 페이지 통합

**목적**: 컴포넌트와 API 클라이언트를 통합하여 완전한 채팅 페이지 구현

**신규 파일**:
- `frontend/app/chat/layout.tsx` - 채팅 페이지 레이아웃 (metadata)
- `frontend/__tests__/chat-page.test.tsx` - 채팅 페이지 통합 테스트

**수정 파일**:
- `frontend/app/chat/page.tsx` - placeholder를 완전한 채팅 UI로 교체

**TDD 사이클**:
1. RED: 페이지 로드 시 세션 목록 표시 테스트, 메시지 전송 플로우 테스트
2. GREEN: useReducer 기반 상태 관리 + API 연동 구현
3. REFACTOR: 커스텀 훅 추출 (useChatSession, useSSEStream)

**핵심 구현 사항**:
- useReducer 기반 전체 상태 관리 (ChatState + ChatAction)
- 세션 CRUD 연동 (생성, 선택, 삭제)
- SSE 스트리밍 메시지 처리 (토큰 추가, 소스 수신, 완료)
- 자동 스크롤 (새 메시지, 스트리밍 중)
- 에러 처리 및 재시도
- 모바일 사이드바 토글

**검증 기준**:
- 페이지 로드 시 세션 목록이 표시됨
- 새 세션 생성 후 빈 상태 표시
- 메시지 전송 시 스트리밍 응답이 실시간 표시
- 세션 전환 시 메시지 히스토리 로드
- 모바일에서 사이드바 토글 동작

### Optional Goal: M4 - 랜딩 페이지 연결

**목적**: 기존 랜딩 페이지에서 채팅 페이지로의 자연스러운 네비게이션 추가

**수정 파일**:
- `frontend/components/landing/HeroSection.tsx` - "시작하기" 버튼에 `/chat` 링크
- `frontend/components/landing/Header.tsx` - 내비게이션에 "상담하기" 링크
- `frontend/components/landing/CTASection.tsx` - CTA 버튼에 `/chat` 링크

**검증 기준**:
- "시작하기" 버튼 클릭 시 `/chat`으로 이동
- Header 내비게이션에 "상담하기" 표시 및 동작
- CTA 버튼 클릭 시 `/chat`으로 이동

## 4. 기술적 접근

### 4.1 SSE 스트리밍 클라이언트

```typescript
// fetch + ReadableStream 기반 SSE 파싱
async function streamMessage(
  sessionId: string,
  content: string,
  onEvent: (event: SSEEvent) => void
): Promise<void> {
  const response = await fetch(
    `${API_URL}/api/v1/chat/sessions/${sessionId}/messages/stream`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }
  )

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6))
        onEvent(data as SSEEvent)
      }
    }
  }
}
```

### 4.2 상태 관리 패턴

```typescript
// useReducer로 복잡한 채팅 상태 관리
function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "APPEND_TOKEN":
      return {
        ...state,
        streamingContent: state.streamingContent + action.token,
      }
    case "END_STREAMING":
      return {
        ...state,
        isStreaming: false,
        streamingContent: "",
        messages: [...state.messages, action.message],
      }
    // ... 기타 액션
  }
}
```

### 4.3 자동 스크롤

```typescript
// 새 메시지 추가 시 자동 스크롤
const messagesEndRef = useRef<HTMLDivElement>(null)

useEffect(() => {
  messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
}, [messages, streamingContent])
```

### 4.4 반응형 사이드바

```typescript
// 모바일: 오버레이 사이드바, 데스크톱: 고정 사이드바
<div className="flex h-screen">
  {/* 데스크톱 사이드바 */}
  <aside className="hidden md:flex md:w-[280px] md:flex-col border-r">
    <SessionList />
  </aside>

  {/* 모바일 오버레이 사이드바 */}
  {sidebarOpen && (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-black/50" onClick={closeSidebar} />
      <aside className="relative w-[280px] h-full bg-white">
        <SessionList />
      </aside>
    </div>
  )}

  {/* 채팅 영역 */}
  <main className="flex-1 flex flex-col">
    <ChatArea />
  </main>
</div>
```

## 5. 예상 파일 목록

### 신규 파일 (~20개)

| 파일 | 목적 |
|------|------|
| `frontend/lib/types/chat.ts` | 타입 정의 |
| `frontend/lib/api/chat-client.ts` | API 클라이언트 |
| `frontend/lib/api/sse-parser.ts` | SSE 파서 |
| `frontend/components/chat/ChatLayout.tsx` | 전체 레이아웃 |
| `frontend/components/chat/SessionList.tsx` | 세션 목록 |
| `frontend/components/chat/MessageList.tsx` | 메시지 목록 |
| `frontend/components/chat/MessageBubble.tsx` | 메시지 버블 |
| `frontend/components/chat/StreamingMessage.tsx` | 스트리밍 메시지 |
| `frontend/components/chat/SourcesCard.tsx` | 출처 카드 |
| `frontend/components/chat/ChatInput.tsx` | 메시지 입력 |
| `frontend/components/chat/EmptyState.tsx` | 빈 상태 화면 |
| `frontend/components/chat/LoadingStates.tsx` | 로딩 상태 |
| `frontend/app/chat/layout.tsx` | 채팅 레이아웃 |
| `frontend/__tests__/lib/chat-client.test.ts` | API 클라이언트 테스트 |
| `frontend/__tests__/lib/sse-parser.test.ts` | SSE 파서 테스트 |
| `frontend/__tests__/components/chat/MessageBubble.test.tsx` | 메시지 버블 테스트 |
| `frontend/__tests__/components/chat/ChatInput.test.tsx` | 입력 컴포넌트 테스트 |
| `frontend/__tests__/components/chat/SessionList.test.tsx` | 세션 목록 테스트 |
| `frontend/__tests__/components/chat/EmptyState.test.tsx` | 빈 상태 테스트 |
| `frontend/__tests__/components/chat/SourcesCard.test.tsx` | 출처 카드 테스트 |
| `frontend/__tests__/chat-page.test.tsx` | 페이지 통합 테스트 |

### 수정 파일 (~4개)

| 파일 | 변경 내용 |
|------|----------|
| `frontend/app/chat/page.tsx` | placeholder에서 완전한 채팅 UI로 교체 |
| `frontend/components/landing/HeroSection.tsx` | "시작하기" 버튼에 `/chat` 링크 추가 |
| `frontend/components/landing/Header.tsx` | 내비게이션에 "상담하기" 링크 추가 |
| `frontend/components/landing/CTASection.tsx` | CTA 버튼에 `/chat` 링크 추가 |

## 6. 리스크 및 대응 방안

### 리스크 1: SSE 스트리밍 파싱 복잡성

- **영향**: 불완전한 청크, 네트워크 지연으로 인한 파싱 에러
- **대응**: 버퍼링 로직으로 불완전한 데이터 처리, 에러 시 사용자 알림 및 재시도 옵션

### 리스크 2: CORS 설정 미비

- **영향**: 프론트엔드에서 백엔드 API 호출 차단
- **대응**: 개발 환경에서 Next.js rewrites로 프록시 설정, 프로덕션에서 CORS 허용 확인

### 리스크 3: 모바일 레이아웃 복잡성

- **영향**: 사이드바 오버레이, 키보드 표시 시 레이아웃 깨짐
- **대응**: Tailwind 반응형 유틸리티 활용, dvh (dynamic viewport height) 사용

### 리스크 4: 대량 메시지 렌더링 성능

- **영향**: 긴 대화에서 DOM 노드 증가로 인한 스크롤 성능 저하
- **대응**: MVP에서는 최근 100개 메시지만 렌더링, 필요 시 가상 스크롤 적용

### 리스크 5: fetch API 기반 SSE의 브라우저 호환성

- **영향**: 일부 브라우저에서 ReadableStream 지원 미비
- **대응**: 최신 브라우저 타겟 (Chrome, Firefox, Safari, Edge 최신 버전), polyfill 불필요

## 7. 품질 요구사항

- 테스트 커버리지: 85% 이상
- ESLint + Prettier 통과
- TypeScript strict mode (no any)
- 모든 컴포넌트에 ARIA 라벨
- 한국어 UI 텍스트
- 한국어 코드 주석 (code_comments: ko)
- Vitest + Testing Library 기반 단위/통합 테스트
