---
id: SPEC-CHAT-001
type: acceptance
version: 0.1.0
status: draft
created: 2026-03-13
tags: [chat, ai, llm, rag, streaming, openai]
---

# SPEC-CHAT-001 인수 기준

## 1. Module 1: Chat 데이터 모델

### AC-M1-001: ChatSession 생성

```gherkin
Feature: 채팅 세션 생성

  Scenario: 기본 세션 생성
    Given 데이터베이스 연결이 활성화되어 있을 때
    When 새 ChatSession을 생성하면
    Then UUID 기반 id가 자동 생성되어야 한다
    And title이 "새 대화"로 기본 설정되어야 한다
    And created_at이 현재 시각으로 설정되어야 한다
    And updated_at이 현재 시각으로 설정되어야 한다

  Scenario: user_id가 있는 세션 생성
    Given 데이터베이스 연결이 활성화되어 있을 때
    When user_id="user-123"으로 ChatSession을 생성하면
    Then user_id 필드에 "user-123"이 저장되어야 한다

  Scenario: user_id 없이 익명 세션 생성
    Given 데이터베이스 연결이 활성화되어 있을 때
    When user_id 없이 ChatSession을 생성하면
    Then user_id 필드가 None이어야 한다
```

### AC-M1-002: ChatMessage 생성 및 관계

```gherkin
Feature: 채팅 메시지 생성 및 세션 관계

  Scenario: 사용자 메시지 생성
    Given ChatSession이 존재할 때
    When role="user", content="보험금 청구 방법"으로 ChatMessage를 생성하면
    Then 메시지가 해당 세션에 연결되어야 한다
    And role이 "user"여야 한다
    And content가 "보험금 청구 방법"이어야 한다

  Scenario: AI 응답 메시지 + metadata 저장
    Given ChatSession이 존재할 때
    When role="assistant"로 ChatMessage를 생성하고 metadata에 sources를 포함하면
    Then metadata JSONB 필드에 sources 배열이 저장되어야 한다
    And sources 각 항목에 policy_name, company_name이 포함되어야 한다

  Scenario: 세션 삭제 시 메시지 cascade 삭제
    Given ChatSession에 3개의 ChatMessage가 존재할 때
    When 해당 ChatSession을 삭제하면
    Then 연결된 3개의 ChatMessage도 모두 삭제되어야 한다
```

### AC-M1-003: Alembic 마이그레이션

```gherkin
Feature: 데이터베이스 마이그레이션

  Scenario: 마이그레이션 upgrade 성공
    Given 현재 마이그레이션 상태에서
    When alembic upgrade head를 실행하면
    Then chat_sessions 테이블이 생성되어야 한다
    And chat_messages 테이블이 생성되어야 한다
    And session_id FK 제약조건이 존재해야 한다
    And metadata 컬럼이 JSONB 타입이어야 한다

  Scenario: 마이그레이션 downgrade 성공
    Given chat 마이그레이션이 적용된 상태에서
    When alembic downgrade를 실행하면
    Then chat_messages 테이블이 삭제되어야 한다
    And chat_sessions 테이블이 삭제되어야 한다
```

---

## 2. Module 2: LLM 통합 서비스

### AC-M2-001: RAG 체인 응답 생성

```gherkin
Feature: RAG 기반 AI 응답 생성

  Scenario: 정상적인 질문에 대한 응답
    Given VectorSearchService가 5개의 관련 약관 청크를 반환하고
    And OpenAI API가 정상 응답하는 상태에서
    When "인공관절 수술 보험 보상"이라는 메시지를 generate_response로 전달하면
    Then 사용자 메시지가 ChatMessage로 저장되어야 한다
    And AI 응답이 ChatMessage(role="assistant")로 저장되어야 한다
    And AI 응답의 metadata에 sources 배열이 포함되어야 한다
    And sources에 policy_name, company_name이 있어야 한다
    And metadata에 model 필드가 "gpt-4o-mini"여야 한다

  Scenario: 검색 결과가 0건인 경우
    Given VectorSearchService가 0건의 결과를 반환하는 상태에서
    When 메시지를 generate_response로 전달하면
    Then AI 응답에 "관련 약관 정보를 찾지 못했습니다" 안내가 포함되어야 한다
    And 일반적인 보험 상담 안내가 제공되어야 한다
```

### AC-M2-002: 대화 히스토리 관리

```gherkin
Feature: 멀티턴 대화 지원

  Scenario: 이전 대화 컨텍스트 포함
    Given 세션에 4개의 이전 메시지가 존재할 때 (user 2개 + assistant 2개)
    When 새 메시지를 generate_response로 전달하면
    Then OpenAI API 호출 시 이전 4개 메시지가 포함되어야 한다

  Scenario: 히스토리 제한 초과 시 오래된 메시지 제외
    Given chat_history_limit이 10이고
    And 세션에 15개의 메시지가 존재할 때
    When 새 메시지를 generate_response로 전달하면
    Then OpenAI API 호출 시 최근 10개 메시지만 포함되어야 한다
```

### AC-M2-003: 스트리밍 응답

```gherkin
Feature: SSE 스트리밍 응답 생성

  Scenario: 토큰 단위 스트리밍
    Given OpenAI API가 스트리밍 모드로 응답하는 상태에서
    When generate_response_stream을 호출하면
    Then AsyncIterator로 토큰이 순차적으로 반환되어야 한다
    And 모든 토큰이 전달된 후 완전한 응답이 ChatMessage로 저장되어야 한다
    And 저장된 메시지의 metadata에 sources가 포함되어야 한다
```

### AC-M2-004: 에러 처리

```gherkin
Feature: LLM API 에러 처리

  Scenario: OpenAI API 타임아웃
    Given OpenAI API가 타임아웃 에러를 반환하는 상태에서
    When generate_response를 호출하면
    Then 사용자 메시지는 정상 저장되어야 한다
    And 적절한 에러 메시지가 반환되어야 한다
    And 에러가 로깅되어야 한다

  Scenario: OpenAI API 인증 실패
    Given OpenAI API 키가 유효하지 않은 상태에서
    When generate_response를 호출하면
    Then 사용자에게 "AI 서비스 연결에 실패했습니다" 에러가 반환되어야 한다
```

---

## 3. Module 3: Chat API 엔드포인트

### AC-M3-001: 세션 CRUD API

```gherkin
Feature: 채팅 세션 관리 API

  Scenario: 새 세션 생성 (POST /api/v1/chat/sessions)
    Given API 서버가 실행 중일 때
    When POST /api/v1/chat/sessions를 요청하면
    Then 201 Created 응답이 반환되어야 한다
    And 응답에 id, title, created_at이 포함되어야 한다

  Scenario: 세션 목록 조회 (GET /api/v1/chat/sessions)
    Given 3개의 세션이 존재할 때
    When GET /api/v1/chat/sessions를 요청하면
    Then 200 OK 응답과 함께 3개의 세션 목록이 반환되어야 한다
    And 각 세션에 id, title, created_at, message_count가 포함되어야 한다

  Scenario: 세션 상세 조회 (GET /api/v1/chat/sessions/{id})
    Given 2개의 메시지가 있는 세션이 존재할 때
    When GET /api/v1/chat/sessions/{id}를 요청하면
    Then 200 OK 응답과 함께 세션 정보와 메시지 목록이 반환되어야 한다

  Scenario: 존재하지 않는 세션 조회
    Given 해당 ID의 세션이 존재하지 않을 때
    When GET /api/v1/chat/sessions/{id}를 요청하면
    Then 404 Not Found 응답이 반환되어야 한다

  Scenario: 세션 삭제 (DELETE /api/v1/chat/sessions/{id})
    Given 세션이 존재할 때
    When DELETE /api/v1/chat/sessions/{id}를 요청하면
    Then 204 No Content 응답이 반환되어야 한다
    And 해당 세션과 메시지가 삭제되어야 한다
```

### AC-M3-002: 메시지 전송 API

```gherkin
Feature: 메시지 전송 및 AI 응답 API

  Scenario: 메시지 전송 성공 (POST /api/v1/chat/sessions/{id}/messages)
    Given 세션이 존재할 때
    When POST /api/v1/chat/sessions/{id}/messages에 content="보험금 청구 방법"을 전송하면
    Then 201 Created 응답이 반환되어야 한다
    And 응답에 AI 어시스턴트의 응답 메시지가 포함되어야 한다
    And 응답 metadata에 sources가 포함되어야 한다

  Scenario: 빈 메시지 전송 시 검증 에러
    Given 세션이 존재할 때
    When POST /api/v1/chat/sessions/{id}/messages에 content=""을 전송하면
    Then 422 Unprocessable Entity 응답이 반환되어야 한다

  Scenario: 존재하지 않는 세션에 메시지 전송
    Given 해당 ID의 세션이 존재하지 않을 때
    When POST /api/v1/chat/sessions/{id}/messages를 요청하면
    Then 404 Not Found 응답이 반환되어야 한다
```

### AC-M3-003: SSE 스트리밍 API

```gherkin
Feature: SSE 스트리밍 응답 API

  Scenario: 스트리밍 응답 성공 (POST /api/v1/chat/sessions/{id}/messages/stream)
    Given 세션이 존재할 때
    When POST /api/v1/chat/sessions/{id}/messages/stream에 content="보험 질문"을 전송하면
    Then Content-Type이 "text/event-stream"이어야 한다
    And SSE 형식으로 token 이벤트가 순차 전송되어야 한다
    And 마지막에 sources 이벤트와 done 이벤트가 전송되어야 한다

  Scenario: 스트리밍 중 에러 발생
    Given OpenAI API에서 스트리밍 중 에러가 발생할 때
    When 스트리밍 엔드포인트를 호출하면
    Then error 타입의 SSE 이벤트가 전송되어야 한다
```

---

## 4. 비기능 인수 기준

### AC-NF-001: 성능

```gherkin
Feature: 성능 요구사항

  Scenario: API 응답 시간
    Given 시스템이 정상 운영 중일 때
    When 메시지 전송 API를 호출하면
    Then 첫 번째 스트리밍 토큰이 3초 이내에 도착해야 한다

  Scenario: 세션 목록 조회 성능
    Given 100개의 세션이 존재할 때
    When 세션 목록을 조회하면
    Then 500ms 이내에 응답이 반환되어야 한다
```

### AC-NF-002: 품질

```gherkin
Feature: 코드 품질

  Scenario: 테스트 커버리지
    Given 모든 구현이 완료되었을 때
    When pytest --cov를 실행하면
    Then 신규 파일의 테스트 커버리지가 85% 이상이어야 한다

  Scenario: 린트 검사
    Given 모든 구현이 완료되었을 때
    When ruff check를 실행하면
    Then 에러가 0건이어야 한다
```

### AC-NF-003: 보안

```gherkin
Feature: 보안 요구사항

  Scenario: API 키 노출 방지
    Given API가 운영 중일 때
    When 어떤 API 엔드포인트를 호출하더라도
    Then 응답 본문에 OpenAI API 키가 포함되지 않아야 한다

  Scenario: 입력 검증
    Given API가 운영 중일 때
    When 5000자를 초과하는 메시지를 전송하면
    Then 422 검증 에러가 반환되어야 한다
```

---

## 5. Definition of Done

- [ ] M1: ChatSession, ChatMessage 모델 구현 완료
- [ ] M1: Alembic 마이그레이션 생성 및 적용 성공
- [ ] M2: ChatService RAG 체인 구현 완료
- [ ] M2: 시스템 프롬프트 적용 및 출처 인용 동작
- [ ] M2: 스트리밍 응답 생성 구현
- [ ] M2: 대화 히스토리 관리 구현
- [ ] M2: 검색 결과 0건 및 API 에러 처리
- [ ] M3: 6개 API 엔드포인트 구현 완료
- [ ] M3: Pydantic 스키마 검증 동작
- [ ] M3: SSE 스트리밍 엔드포인트 동작
- [ ] 전체: 테스트 커버리지 85% 이상
- [ ] 전체: ruff check/format 통과
- [ ] 전체: 한국어 코드 주석 작성
- [ ] 전체: 타입 힌트 완전성
