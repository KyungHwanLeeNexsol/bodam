---
id: SPEC-FRONTEND-001
version: 0.1.0
status: draft
created: 2026-03-13
updated: 2026-03-13
author: zuge3
priority: high
issue_number: 0
tags: [frontend, chat, ui, nextjs, react, sse, streaming]
depends_on: [SPEC-CHAT-001]
---

# SPEC-FRONTEND-001: Chat UI 프론트엔드 - Bodam (보담)

## 1. 환경 (Environment)

### 1.1 프로젝트 컨텍스트

Bodam(보담)은 AI 기반 한국 보험 보상 안내 플랫폼이다. 본 SPEC은 사용자가 보험 관련 질문을 하고 AI로부터 실시간 스트리밍 답변을 받는 **프론트엔드 Chat UI**를 정의한다. 백엔드 API(SPEC-CHAT-001)가 완성된 상태에서, 6개 REST API 엔드포인트 및 SSE 스트리밍을 활용하여 ChatGPT/Gemini 스타일의 대화형 인터페이스를 구현한다.

### 1.2 기존 인프라

- **Framework**: Next.js 16.1.6 (App Router), React 19.2.3, TypeScript 5 (strict)
- **Styling**: Tailwind CSS 4 + 커스텀 디자인 토큰
- **UI 라이브러리**: shadcn/ui (base-nova 테마) - Button, Card, Input 설치 완료
- **아이콘**: lucide-react 0.577.0
- **테스트**: Vitest 4.1.0 + Testing Library
- **패키지 관리**: pnpm
- **환경변수**: `NEXT_PUBLIC_API_URL` 설정 완료
- **기존 페이지**: 랜딩 페이지 (`/`) 완성, 채팅 페이지 (`/chat`) placeholder, 로그인 페이지 (`/login`) placeholder
- **기존 컴포넌트**: Header, HeroSection, FeaturesSection, CTASection, Footer 등 랜딩 페이지 컴포넌트

### 1.3 백엔드 API (SPEC-CHAT-001 완료)

| Method | Path | 설명 | 응답 |
|--------|------|------|------|
| POST | `/api/v1/chat/sessions` | 새 세션 생성 | 201 |
| GET | `/api/v1/chat/sessions` | 세션 목록 조회 | 200 |
| GET | `/api/v1/chat/sessions/{id}` | 세션 상세 (메시지 포함) | 200/404 |
| DELETE | `/api/v1/chat/sessions/{id}` | 세션 삭제 | 204/404 |
| POST | `/api/v1/chat/sessions/{id}/messages` | 메시지 전송 + AI 응답 | 201/404/422 |
| POST | `/api/v1/chat/sessions/{id}/messages/stream` | SSE 스트리밍 응답 | text/event-stream |

SSE 이벤트 형식:
```
data: {"type": "token", "content": "보험"}
data: {"type": "sources", "content": [{policy_name, company_name, chunk_text, similarity}]}
data: {"type": "done", "message_id": "uuid"}
data: {"type": "error", "content": "error message"}
```

### 1.4 디자인 토큰

| 토큰 | 값 | 용도 |
|------|----|----|
| Brand Teal | `#0D6E6E` | 사용자 메시지 배경, CTA 버튼 |
| Brand Orange | `#E07B54` | 강조 색상, 링크 |
| 배경색 | `#FAFAFA` | 전체 배경 |
| 텍스트 | `#1A1A1A` | 기본 텍스트 |
| 서브텍스트 | `#666666` | 보조 텍스트 |
| Heading 폰트 | Newsreader | 제목용 serif |
| Body 폰트 | Inter | 본문용 sans-serif |
| Mono 폰트 | JetBrains Mono | 코드/데이터 |
| Button radius | 8px | 버튼 모서리 |
| Card radius | 12px | 카드 모서리 |
| Auth radius | 16px | 인증 관련 |
| Chip radius | 20px | 태그/칩 |

### 1.5 도메인 용어 정의

| 한국어 | 영어 | 설명 |
|--------|------|------|
| 채팅 세션 | Chat Session | 하나의 대화 흐름 단위 |
| 메시지 버블 | Message Bubble | 개별 메시지 표시 UI |
| 스트리밍 메시지 | Streaming Message | 토큰 단위 실시간 표시 |
| 출처 카드 | Sources Card | AI 답변의 참고 약관 표시 |
| 사이드바 | Sidebar | 세션 목록 표시 영역 |
| 빈 상태 | Empty State | 새 대화 시작 시 안내 화면 |

### 1.6 본 SPEC의 범위

- **포함**: API 클라이언트, Chat UI 컴포넌트, `/chat` 페이지 통합, 랜딩 페이지 연결
- **제외**: 사용자 인증 (별도 SPEC), 결제 기능 (Phase 2+), 모바일 앱 (Phase 4)

---

## 2. 가정 (Assumptions)

### 2.1 기술적 가정

- [A-1] SPEC-CHAT-001의 6개 API 엔드포인트가 정상 동작하며, `NEXT_PUBLIC_API_URL`로 접근 가능하다
- [A-2] SSE 스트리밍이 `text/event-stream` 형식으로 토큰, 소스, 완료 이벤트를 순차 전송한다
- [A-3] 기존 shadcn/ui 컴포넌트(Button, Card, Input)와 Tailwind CSS 4 디자인 토큰이 정상 동작한다
- [A-4] Next.js App Router의 Client Component에서 fetch API 및 ReadableStream을 사용할 수 있다
- [A-5] CORS 설정이 백엔드에서 프론트엔드 도메인에 대해 완료되어 있다

### 2.2 비즈니스 가정

- [A-6] MVP 단계에서는 사용자 인증 없이 익명 채팅을 지원한다
- [A-7] 모든 UI 텍스트는 한국어로 표시한다
- [A-8] 데스크톱/모바일 반응형 레이아웃을 지원하되, 데스크톱 우선으로 설계한다
- [A-9] 메시지 입력은 최대 5,000자로 제한한다

### 2.3 가정 검증 방법

| 가정 | 신뢰도 | 검증 방법 |
|------|--------|----------|
| A-1 | 높음 | SPEC-CHAT-001 테스트 통과 확인, API 직접 호출 검증 |
| A-2 | 높음 | SSE 엔드포인트 curl 테스트 |
| A-3 | 높음 | 기존 랜딩 페이지에서 정상 동작 확인 |
| A-5 | 중간 | 프론트엔드 개발 시 CORS 에러 발생 여부 확인 |
| A-8 | 높음 | product.md Phase 1 요구사항 (웹 우선) |

---

## 3. 요구사항 (Requirements)

### 3.1 유비쿼터스 요구사항 (Ubiquitous)

- [REQ-U-001] 시스템은 **항상** 모든 API 호출 에러에 대해 사용자 친화적인 한국어 에러 메시지를 표시해야 한다
- [REQ-U-002] 시스템은 **항상** TypeScript strict mode를 준수하며 `any` 타입을 사용하지 않아야 한다
- [REQ-U-003] 시스템은 **항상** 반응형 레이아웃을 제공하여 모바일(< 768px)과 데스크톱(>= 768px)에서 적절히 표시되어야 한다
- [REQ-U-004] 시스템은 **항상** ARIA 라벨과 키보드 네비게이션을 지원하여 접근성을 보장해야 한다
- [REQ-U-005] 시스템은 **항상** 보담 디자인 토큰(Brand Teal, Brand Orange, 폰트, radius)을 일관되게 적용해야 한다

### 3.2 이벤트 기반 요구사항 (Event-Driven)

- [REQ-E-001] **WHEN** 사용자가 메시지를 입력하고 전송 버튼을 클릭하거나 Enter를 누르면 **THEN** 시스템은 SSE 스트리밍 API를 호출하여 AI 응답을 토큰 단위로 실시간 표시해야 한다
- [REQ-E-002] **WHEN** 사용자가 "새 대화" 버튼을 클릭하면 **THEN** 시스템은 새 채팅 세션을 생성하고 빈 상태 화면으로 전환해야 한다
- [REQ-E-003] **WHEN** 사용자가 사이드바에서 기존 세션을 클릭하면 **THEN** 시스템은 해당 세션의 메시지 히스토리를 로드하여 표시해야 한다
- [REQ-E-004] **WHEN** 사용자가 세션을 삭제하면 **THEN** 시스템은 확인 후 세션을 삭제하고 세션 목록을 업데이트해야 한다
- [REQ-E-005] **WHEN** SSE 스트리밍이 `sources` 이벤트를 수신하면 **THEN** 시스템은 AI 응답 하단에 접을 수 있는 출처 카드를 표시해야 한다
- [REQ-E-006] **WHEN** SSE 스트리밍이 `done` 이벤트를 수신하면 **THEN** 시스템은 스트리밍 상태를 종료하고 입력 필드를 활성화해야 한다
- [REQ-E-007] **WHEN** SSE 스트리밍이 `error` 이벤트를 수신하면 **THEN** 시스템은 에러 메시지를 표시하고 재전송 옵션을 제공해야 한다
- [REQ-E-008] **WHEN** 새 메시지가 추가되면 **THEN** 메시지 목록이 자동으로 최신 메시지로 스크롤되어야 한다
- [REQ-E-009] **WHEN** 사용자가 Shift+Enter를 누르면 **THEN** 메시지가 전송되지 않고 줄바꿈이 입력되어야 한다
- [REQ-E-010] **WHEN** `/chat` 페이지에 처음 접근하면 **THEN** 세션 목록을 로드하고, 세션이 없으면 빈 상태 화면을 표시해야 한다

### 3.3 상태 기반 요구사항 (State-Driven)

- [REQ-S-001] **IF** AI가 응답을 생성 중이면 **THEN** 타이핑 인디케이터를 표시하고 입력 필드를 비활성화해야 한다
- [REQ-S-002] **IF** 세션 목록이 비어있으면 **THEN** "새 대화를 시작해 보세요" 안내와 함께 새 대화 버튼을 표시해야 한다
- [REQ-S-003] **IF** 모바일 뷰포트(< 768px)이면 **THEN** 사이드바를 숨기고 햄버거 메뉴로 토글할 수 있어야 한다
- [REQ-S-004] **IF** API 호출이 진행 중이면 **THEN** 해당 UI 요소에 로딩 상태(스켈레톤 또는 스피너)를 표시해야 한다
- [REQ-S-005] **IF** 네트워크 연결이 실패하면 **THEN** "서버에 연결할 수 없습니다. 네트워크를 확인해 주세요" 메시지를 표시해야 한다

### 3.4 금지 요구사항 (Unwanted)

- [REQ-N-001] 시스템은 스트리밍 응답 중에 사용자가 추가 메시지를 전송할 수 있게 **하지 않아야 한다**
- [REQ-N-002] 시스템은 `any` 타입이나 `@ts-ignore`를 사용**하지 않아야 한다**
- [REQ-N-003] 시스템은 외부 상태 관리 라이브러리(Redux, Zustand 등)를 MVP에서 사용**하지 않아야 한다** (React 기본 useState/useReducer 사용)
- [REQ-N-004] 시스템은 추가 HTTP 클라이언트 라이브러리(axios 등)를 설치**하지 않아야 한다** (fetch API 사용)

### 3.5 선택 요구사항 (Optional)

- [REQ-O-001] **가능하면** URL 기반 세션 라우팅(`/chat?session=uuid`)을 통해 특정 세션을 직접 접근할 수 있는 기능을 제공
- [REQ-O-002] **가능하면** 세션 목록에서 제목으로 검색할 수 있는 기능을 제공
- [REQ-O-003] **가능하면** 빈 상태 화면에서 추천 질문 칩을 클릭하면 자동으로 해당 질문이 전송되는 기능을 제공
- [REQ-O-004] **가능하면** 메시지 내용을 클립보드에 복사할 수 있는 버튼을 제공

---

## 4. 명세 (Specifications)

### 4.1 Module 1: API 클라이언트 및 타입 정의

#### 4.1.1 타입 정의 (`lib/types/chat.ts`)

```typescript
// 백엔드 응답 스키마 매핑
export interface ChatSession {
  id: string
  title: string
  user_id: string | null
  created_at: string
  updated_at: string
}

export interface ChatSessionListItem {
  id: string
  title: string
  user_id: string | null
  created_at: string
  updated_at: string
  message_count: number
}

export interface ChatMessage {
  id: string
  session_id: string
  role: "user" | "assistant" | "system"
  content: string
  metadata: MessageMetadata | null
  created_at: string
}

export interface MessageMetadata {
  sources?: Source[]
  model?: string
  tokens_used?: { prompt: number; completion: number }
  search_query?: string
}

export interface Source {
  policy_name: string
  company_name: string
  chunk_text?: string
  similarity_score?: number
}

export interface ChatSessionDetail {
  id: string
  title: string
  user_id: string | null
  created_at: string
  updated_at: string
  messages: ChatMessage[]
}

export interface MessageSendResponse {
  user_message: ChatMessage
  assistant_message: ChatMessage
}

// SSE 이벤트 타입
export type SSEEvent =
  | { type: "token"; content: string }
  | { type: "sources"; content: Source[] }
  | { type: "done"; message_id: string }
  | { type: "error"; content: string }

// API 에러
export interface ApiError {
  detail: string
  error_code?: string
}
```

#### 4.1.2 API 클라이언트 (`lib/api/chat-client.ts`)

```
ChatApiClient
├── createSession(title?: string): Promise<ChatSession>
├── listSessions(limit?: number, offset?: number): Promise<ChatSessionListItem[]>
├── getSession(sessionId: string): Promise<ChatSessionDetail>
├── deleteSession(sessionId: string): Promise<void>
├── sendMessage(sessionId: string, content: string): Promise<MessageSendResponse>
└── streamMessage(sessionId: string, content: string, onEvent: (event: SSEEvent) => void): Promise<void>
```

- `fetch` API 기반, `NEXT_PUBLIC_API_URL` 환경변수 활용
- 에러 응답 시 `ApiError`로 변환하여 사용자 친화적 메시지 제공
- `streamMessage`는 fetch + ReadableStream을 사용하여 SSE 이벤트를 파싱

#### 4.1.3 SSE 파서 (`lib/api/sse-parser.ts`)

- `ReadableStream`에서 `data:` 줄을 파싱하여 JSON 변환
- 불완전한 청크 버퍼링 처리
- 에러 이벤트 감지 및 콜백 전달

### 4.2 Module 2: Chat UI 컴포넌트

#### 4.2.1 컴포넌트 트리

```
ChatLayout
├── Sidebar (desktop: 고정, mobile: 오버레이)
│   ├── NewChatButton
│   ├── SessionSearch (optional)
│   └── SessionList
│       └── SessionItem (선택 가능, 삭제 가능)
├── ChatArea
│   ├── ChatHeader (세션 제목, 모바일 메뉴 토글)
│   ├── MessageList (스크롤 영역)
│   │   ├── MessageBubble (user / assistant)
│   │   │   └── SourcesCard (assistant만, 접기/펼치기)
│   │   └── StreamingMessage (스트리밍 중 표시)
│   │       └── TypingIndicator (점 3개 애니메이션)
│   ├── EmptyState (메시지 없을 때)
│   │   └── SuggestedQuestions (추천 질문 칩)
│   └── ChatInput (텍스트 입력 + 전송 버튼)
└── LoadingStates
    ├── SessionListSkeleton
    └── MessageListSkeleton
```

#### 4.2.2 주요 컴포넌트 명세

**ChatLayout** (`components/chat/ChatLayout.tsx`)
- Client Component
- 사이드바(280px) + 메인 채팅 영역 flex 레이아웃
- 모바일: 사이드바 숨김, 햄버거 버튼으로 오버레이 토글
- 전체 채팅 상태 관리 (useReducer)

**SessionList** (`components/chat/SessionList.tsx`)
- 세션 목록 표시 (최신순 정렬)
- 현재 세션 하이라이트
- 세션 삭제 (확인 대화상자 포함)
- 스켈레톤 로딩 상태

**MessageBubble** (`components/chat/MessageBubble.tsx`)
- 사용자 메시지: 오른쪽 정렬, Brand Teal 배경, 흰색 텍스트
- AI 메시지: 왼쪽 정렬, 흰색 배경, 어두운 텍스트
- 마크다운 기본 서식 지원 (볼드, 리스트, 코드)
- 타임스탬프 표시

**StreamingMessage** (`components/chat/StreamingMessage.tsx`)
- 토큰 단위 실시간 텍스트 추가
- 커서 깜빡임 애니메이션
- 스트리밍 완료 시 일반 MessageBubble로 전환

**SourcesCard** (`components/chat/SourcesCard.tsx`)
- 접기/펼치기 토글 (기본: 접힘)
- 보험사명, 상품명, 유사도 표시
- 약관 텍스트 미리보기 (chunk_text 일부)

**ChatInput** (`components/chat/ChatInput.tsx`)
- textarea 기반 (자동 높이 조절, 최대 5줄)
- Enter: 전송, Shift+Enter: 줄바꿈
- 5,000자 제한 (카운터 표시)
- 전송 버튼 (Send 아이콘, Brand Teal)
- 스트리밍 중 비활성화

**EmptyState** (`components/chat/EmptyState.tsx`)
- 보담 로고 + 환영 메시지
- "무엇이든 물어보세요" 안내
- 추천 질문 칩 4개:
  - "인공관절 수술 보험 보상이 되나요?"
  - "교통사고 입원 보상 범위가 어떻게 되나요?"
  - "실손보험 청구 절차를 알려주세요"
  - "암 진단비 보험금은 얼마인가요?"

### 4.3 Module 3: /chat 페이지 통합

#### 4.3.1 페이지 구조 (`app/chat/page.tsx`)

- Client Component (`"use client"`)
- 페이지 진입 시 세션 목록 로드
- 세션 선택/생성/삭제 관리
- 메시지 전송 및 SSE 스트리밍 처리
- URL 쿼리 파라미터 기반 세션 선택 (optional: `?session=uuid`)

#### 4.3.2 상태 관리 (useReducer)

```typescript
interface ChatState {
  sessions: ChatSessionListItem[]
  currentSessionId: string | null
  messages: ChatMessage[]
  isLoading: boolean
  isStreaming: boolean
  streamingContent: string
  streamingSources: Source[]
  error: string | null
  sidebarOpen: boolean
}

type ChatAction =
  | { type: "SET_SESSIONS"; sessions: ChatSessionListItem[] }
  | { type: "SET_CURRENT_SESSION"; sessionId: string | null }
  | { type: "SET_MESSAGES"; messages: ChatMessage[] }
  | { type: "ADD_MESSAGE"; message: ChatMessage }
  | { type: "START_STREAMING" }
  | { type: "APPEND_TOKEN"; token: string }
  | { type: "SET_SOURCES"; sources: Source[] }
  | { type: "END_STREAMING"; message: ChatMessage }
  | { type: "SET_ERROR"; error: string }
  | { type: "CLEAR_ERROR" }
  | { type: "SET_LOADING"; isLoading: boolean }
  | { type: "TOGGLE_SIDEBAR" }
```

#### 4.3.3 키보드 단축키

| 단축키 | 동작 |
|--------|------|
| Enter | 메시지 전송 |
| Shift+Enter | 줄바꿈 |
| Escape | 사이드바 닫기 (모바일) |

### 4.4 Module 4: 랜딩 페이지 연결

#### 4.4.1 변경 사항

- HeroSection의 "시작하기" 버튼: `href="/chat"` 링크 추가
- Header: 내비게이션에 "상담하기" 링크 추가 (`/chat`)
- CTASection의 CTA 버튼: `href="/chat"` 링크 추가

---

## 5. 추적성 (Traceability)

### 5.1 요구사항-모듈 매핑

| 요구사항 | 모듈 | 구현 파일 |
|---------|------|----------|
| REQ-U-001 | M1 | lib/api/chat-client.ts |
| REQ-U-002 | 전체 | tsconfig.json (strict: true) |
| REQ-U-003 | M2, M3 | components/chat/ChatLayout.tsx |
| REQ-U-004 | M2 | 모든 컴포넌트 (ARIA labels) |
| REQ-U-005 | M2 | 모든 컴포넌트 (디자인 토큰) |
| REQ-E-001 | M1, M2, M3 | chat-client.ts, ChatInput.tsx, page.tsx |
| REQ-E-002 | M1, M2, M3 | chat-client.ts, SessionList.tsx, page.tsx |
| REQ-E-003 | M1, M2, M3 | chat-client.ts, SessionList.tsx, page.tsx |
| REQ-E-004 | M1, M2, M3 | chat-client.ts, SessionList.tsx, page.tsx |
| REQ-E-005 | M1, M2 | sse-parser.ts, SourcesCard.tsx |
| REQ-E-006 | M1, M3 | sse-parser.ts, page.tsx |
| REQ-E-007 | M1, M2, M3 | sse-parser.ts, StreamingMessage.tsx, page.tsx |
| REQ-E-008 | M2, M3 | MessageList.tsx, page.tsx |
| REQ-E-009 | M2 | ChatInput.tsx |
| REQ-E-010 | M1, M3 | chat-client.ts, page.tsx |
| REQ-S-001 | M2, M3 | StreamingMessage.tsx, ChatInput.tsx, page.tsx |
| REQ-S-002 | M2, M3 | EmptyState.tsx, page.tsx |
| REQ-S-003 | M2 | ChatLayout.tsx |
| REQ-S-004 | M2 | LoadingStates (Skeleton) |
| REQ-S-005 | M1, M2 | chat-client.ts, ChatLayout.tsx |
| REQ-N-001 | M3 | page.tsx (상태 관리) |
| REQ-N-002 | 전체 | tsconfig.json, ESLint |
| REQ-N-003 | M3 | page.tsx (useState/useReducer만 사용) |
| REQ-N-004 | M1 | chat-client.ts (fetch API만 사용) |

### 5.2 의존성 관계

```
SPEC-INFRA-001 (인프라)
    |
    v
SPEC-DATA-001 (데이터)
    |
    v
SPEC-CHAT-001 (채팅 백엔드) --> SPEC-FRONTEND-001 (채팅 프론트엔드)
```

### 5.3 전문가 상담 권장

본 SPEC은 다음 도메인 전문가 상담을 권장한다:

- **expert-frontend**: UI 컴포넌트 아키텍처, React 19 패턴, SSE 클라이언트 구현
- **expert-backend**: API 계약 확인, CORS 설정, SSE 형식 호환성 검증
