---
id: SPEC-FRONTEND-001
type: acceptance
version: 0.1.0
status: draft
created: 2026-03-13
tags: [frontend, chat, ui, nextjs, react, sse, streaming]
---

# SPEC-FRONTEND-001 인수 기준

## 1. Module 1: API 클라이언트 및 타입 정의

### AC-M1-001: API 클라이언트 기본 동작

```gherkin
Feature: Chat API 클라이언트

  Scenario: 세션 생성 API 호출
    Given API 서버가 정상 동작 중일 때
    When createSession()을 호출하면
    Then POST /api/v1/chat/sessions로 fetch가 호출되어야 한다
    And 반환된 ChatSession 객체에 id, title, created_at이 포함되어야 한다

  Scenario: 세션 목록 조회 API 호출
    Given API 서버가 정상 동작 중일 때
    When listSessions()을 호출하면
    Then GET /api/v1/chat/sessions로 fetch가 호출되어야 한다
    And ChatSessionListItem 배열이 반환되어야 한다

  Scenario: 세션 상세 조회 API 호출
    Given 세션 ID가 주어졌을 때
    When getSession(sessionId)을 호출하면
    Then GET /api/v1/chat/sessions/{id}로 fetch가 호출되어야 한다
    And ChatSessionDetail 객체에 messages 배열이 포함되어야 한다

  Scenario: 세션 삭제 API 호출
    Given 세션 ID가 주어졌을 때
    When deleteSession(sessionId)을 호출하면
    Then DELETE /api/v1/chat/sessions/{id}로 fetch가 호출되어야 한다

  Scenario: 메시지 전송 API 호출
    Given 세션 ID와 메시지 내용이 주어졌을 때
    When sendMessage(sessionId, content)를 호출하면
    Then POST /api/v1/chat/sessions/{id}/messages로 fetch가 호출되어야 한다
    And 반환된 MessageSendResponse에 user_message와 assistant_message가 포함되어야 한다
```

### AC-M1-002: API 에러 처리

```gherkin
Feature: API 에러 처리

  Scenario: 404 에러 처리
    Given API가 404 응답을 반환할 때
    When getSession(존재하지않는ID)를 호출하면
    Then "세션을 찾을 수 없습니다" 에러 메시지가 포함된 에러가 발생해야 한다

  Scenario: 422 검증 에러 처리
    Given API가 422 응답을 반환할 때
    When sendMessage(sessionId, "")를 호출하면
    Then "입력값이 올바르지 않습니다" 에러 메시지가 포함된 에러가 발생해야 한다

  Scenario: 500 서버 에러 처리
    Given API가 500 응답을 반환할 때
    When 어떤 API 메서드를 호출하면
    Then "서버에 오류가 발생했습니다. 잠시 후 다시 시도해 주세요" 에러가 발생해야 한다

  Scenario: 네트워크 연결 실패
    Given 네트워크가 연결되지 않았을 때
    When 어떤 API 메서드를 호출하면
    Then "서버에 연결할 수 없습니다. 네트워크를 확인해 주세요" 에러가 발생해야 한다
```

### AC-M1-003: SSE 파서

```gherkin
Feature: SSE 이벤트 파싱

  Scenario: token 이벤트 파싱
    Given SSE 스트림에서 'data: {"type": "token", "content": "보험"}'을 수신했을 때
    When SSE 파서가 처리하면
    Then {type: "token", content: "보험"} 이벤트가 콜백으로 전달되어야 한다

  Scenario: sources 이벤트 파싱
    Given SSE 스트림에서 sources 타입 이벤트를 수신했을 때
    When SSE 파서가 처리하면
    Then {type: "sources", content: Source[]} 이벤트가 콜백으로 전달되어야 한다
    And Source 객체에 policy_name, company_name이 포함되어야 한다

  Scenario: done 이벤트 파싱
    Given SSE 스트림에서 done 타입 이벤트를 수신했을 때
    When SSE 파서가 처리하면
    Then {type: "done", message_id: string} 이벤트가 콜백으로 전달되어야 한다

  Scenario: error 이벤트 파싱
    Given SSE 스트림에서 error 타입 이벤트를 수신했을 때
    When SSE 파서가 처리하면
    Then {type: "error", content: string} 이벤트가 콜백으로 전달되어야 한다

  Scenario: 불완전한 청크 버퍼링
    Given SSE 데이터가 여러 청크로 분할되어 수신될 때
    When SSE 파서가 처리하면
    Then 불완전한 데이터는 버퍼링되어야 한다
    And 완전한 이벤트만 콜백으로 전달되어야 한다
```

---

## 2. Module 2: Chat UI 컴포넌트

### AC-M2-001: MessageBubble 컴포넌트

```gherkin
Feature: 메시지 버블 표시

  Scenario: 사용자 메시지 표시
    Given role이 "user"인 ChatMessage가 주어졌을 때
    When MessageBubble을 렌더링하면
    Then 메시지가 오른쪽 정렬되어야 한다
    And 배경색이 Brand Teal(#0D6E6E)이어야 한다
    And 텍스트 색상이 흰색이어야 한다

  Scenario: AI 응답 메시지 표시
    Given role이 "assistant"인 ChatMessage가 주어졌을 때
    When MessageBubble을 렌더링하면
    Then 메시지가 왼쪽 정렬되어야 한다
    And 배경색이 흰색이어야 한다
    And 텍스트 색상이 어두운 색이어야 한다

  Scenario: metadata에 sources가 있는 AI 메시지
    Given sources가 포함된 assistant 메시지가 주어졌을 때
    When MessageBubble을 렌더링하면
    Then 메시지 하단에 SourcesCard가 표시되어야 한다
```

### AC-M2-002: ChatInput 컴포넌트

```gherkin
Feature: 메시지 입력

  Scenario: Enter로 메시지 전송
    Given 입력 필드에 "보험금 청구 방법"이 입력되어 있을 때
    When Enter 키를 누르면
    Then onSend 콜백이 "보험금 청구 방법"과 함께 호출되어야 한다
    And 입력 필드가 비워져야 한다

  Scenario: Shift+Enter로 줄바꿈
    Given 입력 필드에 텍스트가 입력되어 있을 때
    When Shift+Enter를 누르면
    Then 메시지가 전송되지 않아야 한다
    And 줄바꿈이 입력되어야 한다

  Scenario: 빈 메시지 전송 방지
    Given 입력 필드가 비어있을 때
    When Enter 키를 누르면
    Then onSend 콜백이 호출되지 않아야 한다

  Scenario: 5,000자 입력 제한
    Given 입력 필드에 5,000자가 입력되어 있을 때
    When 추가 문자를 입력하면
    Then 입력이 거부되거나 경고가 표시되어야 한다

  Scenario: 스트리밍 중 입력 비활성화
    Given isStreaming이 true일 때
    When ChatInput을 렌더링하면
    Then 입력 필드가 비활성화되어야 한다
    And 전송 버튼이 비활성화되어야 한다

  Scenario: 전송 버튼 접근성
    Given ChatInput이 렌더링되었을 때
    When 전송 버튼을 확인하면
    Then aria-label이 "메시지 전송"이어야 한다
```

### AC-M2-003: SessionList 컴포넌트

```gherkin
Feature: 세션 목록

  Scenario: 세션 목록 표시
    Given 3개의 세션이 주어졌을 때
    When SessionList를 렌더링하면
    Then 3개의 세션 항목이 표시되어야 한다
    And 각 항목에 세션 제목이 표시되어야 한다

  Scenario: 세션 클릭 시 선택
    Given 세션 목록이 표시되어 있을 때
    When 두 번째 세션을 클릭하면
    Then onSelectSession 콜백이 해당 세션 ID와 함께 호출되어야 한다

  Scenario: 현재 세션 하이라이트
    Given currentSessionId가 "session-2"일 때
    When SessionList를 렌더링하면
    Then "session-2" 항목이 하이라이트(배경색 변경)되어야 한다

  Scenario: 세션 삭제
    Given 세션 목록이 표시되어 있을 때
    When 세션의 삭제 버튼을 클릭하면
    Then 삭제 확인 대화상자가 표시되어야 한다
    And 확인 시 onDeleteSession 콜백이 호출되어야 한다

  Scenario: 새 대화 버튼
    Given SessionList가 렌더링되었을 때
    When "새 대화" 버튼을 클릭하면
    Then onNewSession 콜백이 호출되어야 한다
```

### AC-M2-004: SourcesCard 컴포넌트

```gherkin
Feature: 출처 카드 표시

  Scenario: 기본 접힌 상태
    Given 2개의 소스가 있는 SourcesCard가 주어졌을 때
    When 렌더링하면
    Then "참고 자료 2건" 헤더가 표시되어야 한다
    And 소스 상세 내용은 숨겨져 있어야 한다

  Scenario: 펼치기 동작
    Given 접힌 상태의 SourcesCard가 있을 때
    When 헤더를 클릭하면
    Then 소스 목록이 펼쳐져야 한다
    And 각 소스에 보험사명, 상품명이 표시되어야 한다
    And 유사도 점수가 퍼센트로 표시되어야 한다

  Scenario: 접기 동작
    Given 펼쳐진 상태의 SourcesCard가 있을 때
    When 헤더를 클릭하면
    Then 소스 목록이 접혀야 한다
```

### AC-M2-005: EmptyState 컴포넌트

```gherkin
Feature: 빈 상태 화면

  Scenario: 환영 메시지 표시
    Given 현재 세션에 메시지가 없을 때
    When EmptyState를 렌더링하면
    Then "무엇이든 물어보세요" 안내 메시지가 표시되어야 한다

  Scenario: 추천 질문 표시
    Given EmptyState가 렌더링되었을 때
    When 화면을 확인하면
    Then 4개의 추천 질문 칩이 표시되어야 한다
    And "인공관절 수술 보험 보상이 되나요?" 칩이 포함되어야 한다

  Scenario: 추천 질문 클릭
    Given 추천 질문 칩이 표시되어 있을 때
    When "실손보험 청구 절차를 알려주세요" 칩을 클릭하면
    Then onSuggestedQuestion 콜백이 해당 질문 텍스트와 함께 호출되어야 한다
```

### AC-M2-006: StreamingMessage 컴포넌트

```gherkin
Feature: 스트리밍 메시지 표시

  Scenario: 토큰 단위 텍스트 표시
    Given streamingContent가 "보험금 청구"일 때
    When StreamingMessage를 렌더링하면
    Then "보험금 청구" 텍스트가 표시되어야 한다
    And 커서 깜빡임 애니메이션이 있어야 한다

  Scenario: 빈 스트리밍 시작
    Given streamingContent가 ""이고 isStreaming이 true일 때
    When StreamingMessage를 렌더링하면
    Then 타이핑 인디케이터(점 3개 애니메이션)가 표시되어야 한다
```

### AC-M2-007: LoadingStates 컴포넌트

```gherkin
Feature: 로딩 상태 표시

  Scenario: 세션 목록 스켈레톤
    Given 세션 목록이 로딩 중일 때
    When SessionListSkeleton을 렌더링하면
    Then 3-5개의 스켈레톤 항목이 표시되어야 한다
    And 펄스 애니메이션이 적용되어야 한다

  Scenario: 메시지 목록 스켈레톤
    Given 메시지가 로딩 중일 때
    When MessageListSkeleton을 렌더링하면
    Then 사용자/AI 메시지 형태의 스켈레톤이 표시되어야 한다
```

---

## 3. Module 3: /chat 페이지 통합

### AC-M3-001: 페이지 초기 로드

```gherkin
Feature: 채팅 페이지 초기 로드

  Scenario: 세션 목록 로드
    Given /chat 페이지에 접근했을 때
    When 페이지가 로드되면
    Then 세션 목록이 사이드바에 표시되어야 한다

  Scenario: 세션이 없는 경우
    Given 사용자에게 세션이 없을 때
    When /chat 페이지에 접근하면
    Then EmptyState 화면이 표시되어야 한다
    And "새 대화" 버튼이 사이드바에 표시되어야 한다

  Scenario: 로딩 중 스켈레톤 표시
    Given /chat 페이지에 접근했을 때
    When 세션 목록 로딩 중이면
    Then SessionListSkeleton이 표시되어야 한다
```

### AC-M3-002: 메시지 전송 및 스트리밍

```gherkin
Feature: 메시지 전송 및 AI 응답 스트리밍

  Scenario: 메시지 전송 시 스트리밍 응답 표시
    Given 활성 세션이 있을 때
    When "보험금 청구 방법"을 입력하고 전송하면
    Then 사용자 메시지가 즉시 메시지 목록에 추가되어야 한다
    And StreamingMessage 컴포넌트가 나타나야 한다
    And AI 응답이 토큰 단위로 실시간 표시되어야 한다
    And 스트리밍 완료 후 일반 MessageBubble로 전환되어야 한다

  Scenario: 스트리밍 중 입력 비활성화
    Given AI가 응답을 스트리밍 중일 때
    When ChatInput을 확인하면
    Then 입력 필드와 전송 버튼이 비활성화되어야 한다

  Scenario: 스트리밍 완료 후 입력 활성화
    Given AI 응답 스트리밍이 완료되었을 때
    When done 이벤트를 수신하면
    Then 입력 필드와 전송 버튼이 활성화되어야 한다
    And 입력 필드에 포커스가 이동해야 한다
```

### AC-M3-003: 세션 관리

```gherkin
Feature: 세션 관리

  Scenario: 새 세션 생성
    Given /chat 페이지가 로드되어 있을 때
    When "새 대화" 버튼을 클릭하면
    Then 새 세션이 API를 통해 생성되어야 한다
    And 세션 목록에 새 세션이 추가되어야 한다
    And EmptyState 화면이 표시되어야 한다

  Scenario: 기존 세션 전환
    Given 세션 목록에 3개의 세션이 있을 때
    When 두 번째 세션을 클릭하면
    Then 해당 세션의 메시지 히스토리가 로드되어야 한다
    And 메시지 목록이 업데이트되어야 한다

  Scenario: 세션 삭제
    Given 세션 목록에 세션이 있을 때
    When 세션의 삭제 버튼을 클릭하고 확인하면
    Then 세션이 API를 통해 삭제되어야 한다
    And 세션 목록에서 해당 세션이 제거되어야 한다

  Scenario: 현재 활성 세션 삭제
    Given 현재 보고 있는 세션을 삭제했을 때
    When 삭제가 완료되면
    Then EmptyState 화면이 표시되어야 한다
    Or 다른 세션이 자동 선택되어야 한다
```

### AC-M3-004: 모바일 반응형

```gherkin
Feature: 모바일 반응형 레이아웃

  Scenario: 모바일에서 사이드바 숨김
    Given 뷰포트 너비가 768px 미만일 때
    When /chat 페이지를 렌더링하면
    Then 사이드바가 숨겨져야 한다
    And 햄버거 메뉴 버튼이 표시되어야 한다

  Scenario: 모바일 사이드바 오버레이
    Given 모바일 뷰포트에서
    When 햄버거 메뉴 버튼을 클릭하면
    Then 사이드바가 오버레이로 표시되어야 한다
    And 배경에 반투명 오버레이가 있어야 한다

  Scenario: 모바일 사이드바 닫기
    Given 모바일 사이드바가 열려있을 때
    When 오버레이 배경을 클릭하거나 Escape를 누르면
    Then 사이드바가 닫혀야 한다

  Scenario: 데스크톱에서 고정 사이드바
    Given 뷰포트 너비가 768px 이상일 때
    When /chat 페이지를 렌더링하면
    Then 사이드바가 왼쪽에 280px 너비로 고정 표시되어야 한다
```

### AC-M3-005: 자동 스크롤

```gherkin
Feature: 자동 스크롤

  Scenario: 새 메시지 추가 시 스크롤
    Given 메시지 목록이 스크롤 가능할 때
    When 새 메시지가 추가되면
    Then 메시지 목록이 최신 메시지로 자동 스크롤되어야 한다

  Scenario: 스트리밍 중 스크롤
    Given AI가 응답을 스트리밍 중일 때
    When 새 토큰이 추가되면
    Then 스트리밍 메시지가 보이도록 자동 스크롤되어야 한다
```

### AC-M3-006: 에러 처리

```gherkin
Feature: 에러 처리

  Scenario: API 에러 표시
    Given API 호출이 실패했을 때
    When 에러가 발생하면
    Then 사용자 친화적인 한국어 에러 메시지가 표시되어야 한다

  Scenario: 스트리밍 에러
    Given SSE 스트리밍 중 error 이벤트가 수신되었을 때
    When 에러를 처리하면
    Then 에러 메시지가 채팅 영역에 표시되어야 한다

  Scenario: 세션 목록 로드 실패
    Given 세션 목록 API가 실패했을 때
    When /chat 페이지를 로드하면
    Then "세션 목록을 불러올 수 없습니다" 에러가 표시되어야 한다
    And "다시 시도" 버튼이 제공되어야 한다
```

---

## 4. Module 4: 랜딩 페이지 연결

### AC-M4-001: 네비게이션 연결

```gherkin
Feature: 랜딩 페이지에서 채팅으로 연결

  Scenario: Hero 섹션 "시작하기" 버튼
    Given 랜딩 페이지가 로드되었을 때
    When "시작하기" 버튼을 클릭하면
    Then /chat 페이지로 이동해야 한다

  Scenario: Header 내비게이션
    Given 랜딩 페이지의 Header가 표시되어 있을 때
    When 내비게이션을 확인하면
    Then "상담하기" 링크가 존재해야 한다
    And 클릭 시 /chat 페이지로 이동해야 한다

  Scenario: CTA 섹션 버튼
    Given 랜딩 페이지의 CTA 섹션이 표시되어 있을 때
    When CTA 버튼을 클릭하면
    Then /chat 페이지로 이동해야 한다
```

---

## 5. 비기능 인수 기준

### AC-NF-001: 성능

```gherkin
Feature: 성능 요구사항

  Scenario: 페이지 초기 로드
    Given /chat 페이지에 접근했을 때
    When 페이지가 로드되면
    Then 3초 이내에 UI가 인터랙티브 상태가 되어야 한다

  Scenario: 스트리밍 첫 토큰 표시
    Given 메시지를 전송했을 때
    When SSE 스트리밍이 시작되면
    Then 첫 번째 토큰이 500ms 이내에 화면에 표시되어야 한다
    (백엔드 응답 시간 제외, 프론트엔드 처리 시간만)
```

### AC-NF-002: 접근성

```gherkin
Feature: 접근성 요구사항

  Scenario: 키보드 내비게이션
    Given /chat 페이지가 로드되었을 때
    When Tab 키로 네비게이션하면
    Then 모든 인터랙티브 요소에 접근 가능해야 한다
    And 포커스 표시가 시각적으로 명확해야 한다

  Scenario: ARIA 라벨
    Given 채팅 UI가 렌더링되었을 때
    When 스크린 리더로 탐색하면
    Then 모든 버튼에 적절한 aria-label이 있어야 한다
    And 메시지 목록에 role="log"가 적용되어야 한다
    And 입력 영역에 aria-label이 있어야 한다
```

### AC-NF-003: 코드 품질

```gherkin
Feature: 코드 품질

  Scenario: 테스트 커버리지
    Given 모든 구현이 완료되었을 때
    When vitest --coverage를 실행하면
    Then 신규 파일의 테스트 커버리지가 85% 이상이어야 한다

  Scenario: 린트 검사
    Given 모든 구현이 완료되었을 때
    When eslint를 실행하면
    Then 에러가 0건이어야 한다

  Scenario: TypeScript 검사
    Given 모든 구현이 완료되었을 때
    When tsc --noEmit을 실행하면
    Then 타입 에러가 0건이어야 한다
    And any 타입이 사용되지 않아야 한다
```

---

## 6. Definition of Done

- [ ] M1: 타입 정의 완료 (ChatSession, ChatMessage, SSEEvent 등)
- [ ] M1: API 클라이언트 6개 메서드 구현 완료
- [ ] M1: SSE 파서 구현 완료 (토큰, 소스, 완료, 에러 이벤트)
- [ ] M1: API 에러를 한국어 메시지로 변환
- [ ] M2: MessageBubble (사용자/AI 스타일 분기)
- [ ] M2: ChatInput (Enter 전송, Shift+Enter 줄바꿈, 5000자 제한)
- [ ] M2: SessionList (목록 표시, 선택, 삭제)
- [ ] M2: StreamingMessage (토큰 단위 표시, 타이핑 인디케이터)
- [ ] M2: SourcesCard (접기/펼치기, 출처 정보 표시)
- [ ] M2: EmptyState (환영 메시지, 추천 질문)
- [ ] M2: LoadingStates (스켈레톤 로더)
- [ ] M2: 모든 컴포넌트 ARIA 라벨 적용
- [ ] M3: /chat 페이지 useReducer 상태 관리
- [ ] M3: 세션 CRUD 연동 (생성, 선택, 삭제)
- [ ] M3: SSE 스트리밍 메시지 처리
- [ ] M3: 자동 스크롤 동작
- [ ] M3: 모바일 반응형 사이드바
- [ ] M3: 에러 처리 및 표시
- [ ] M4: 랜딩 페이지 "시작하기" 버튼 연결
- [ ] M4: Header "상담하기" 링크 추가
- [ ] M4: CTA 버튼 연결
- [ ] 전체: Vitest 테스트 커버리지 85% 이상
- [ ] 전체: ESLint + Prettier 통과
- [ ] 전체: TypeScript strict mode (no any)
- [ ] 전체: 한국어 UI 텍스트
- [ ] 전체: 한국어 코드 주석
