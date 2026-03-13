---
id: SPEC-CHAT-001
version: 0.1.0
status: draft
created: 2026-03-13
updated: 2026-03-13
author: zuge3
priority: high
issue_number: 0
tags: [chat, ai, llm, rag, streaming, openai]
depends_on: [SPEC-DATA-001]
---

# SPEC-CHAT-001: AI Chat Interface Backend - Bodam (보담)

## 1. 환경 (Environment)

### 1.1 프로젝트 컨텍스트

Bodam(보담)은 AI 기반 한국 보험 보상 안내 플랫폼이다. 본 SPEC은 사용자와 AI 간의 **대화형 채팅 인터페이스 백엔드**를 정의한다. 사용자가 보험 관련 질문을 입력하면, 기존 시맨틱 검색(SPEC-DATA-001)을 통해 관련 약관 데이터를 검색하고, LLM을 활용하여 정확하고 출처가 포함된 답변을 생성한다.

### 1.2 기존 인프라 (SPEC-DATA-001 완료)

- **Backend**: FastAPI 0.135.x, Python 3.13, SQLAlchemy 2.x async (asyncpg)
- **Database**: PostgreSQL 18 + pgvector 0.8.2
- **Cache**: Redis 7-alpine
- **Migration**: Alembic (기존 마이그레이션 존재)
- **Testing**: pytest + pytest-asyncio
- **기존 서비스**:
  - `EmbeddingService` (OpenAI text-embedding-3-small, 1536차원)
  - `VectorSearchService` (pgvector cosine distance)
  - `POST /api/v1/search/semantic` 엔드포인트
- **기존 모델**: InsuranceCompany, Policy, Coverage, PolicyChunk
- **패키지**: openai, pgvector 이미 설치됨

### 1.3 도메인 용어 정의

| 한국어 | 영어 | 설명 |
|--------|------|------|
| 채팅 세션 | Chat Session | 하나의 대화 흐름 단위 |
| 메시지 | Message | 세션 내 개별 발화 (사용자/AI/시스템) |
| RAG 체인 | RAG Chain | 검색-증강-생성 파이프라인 |
| 컨텍스트 청크 | Context Chunk | 검색된 약관 텍스트 조각 |
| 시스템 프롬프트 | System Prompt | AI 페르소나 및 행동 지침 |
| SSE | Server-Sent Events | 서버에서 클라이언트로의 단방향 스트리밍 |
| 출처 인용 | Source Citation | 답변의 근거가 되는 약관/보험사 정보 |

### 1.4 본 SPEC의 범위

- **포함**: 채팅 데이터 모델, LLM 통합 서비스, Chat API 엔드포인트 (백엔드 전용)
- **제외**: 프론트엔드 UI (별도 SPEC-UI-001로 진행), 사용자 인증 (추후 SPEC)

---

## 2. 가정 (Assumptions)

### 2.1 기술적 가정

- [A-1] SPEC-DATA-001의 VectorSearchService와 EmbeddingService가 정상 동작한다
- [A-2] OpenAI API 키가 환경변수로 제공되며, GPT-4o-mini 모델에 접근 가능하다
- [A-3] PostgreSQL 18 + pgvector 환경이 가동 중이며, PolicyChunk 테이블에 임베딩 데이터가 존재한다
- [A-4] Redis 7이 가동 중이다 (향후 캐싱 확장 대비)

### 2.2 비즈니스 가정

- [A-5] MVP 단계에서는 사용자 인증 없이 익명 채팅을 지원한다 (user_id는 optional)
- [A-6] 한국어 보험 도메인에 특화된 시스템 프롬프트가 답변 품질을 충분히 보장한다
- [A-7] gpt-4o-mini가 보험 약관 해석에 적합한 성능을 제공한다
- [A-8] 단일 질의에 대해 top_k=5 검색 결과가 충분한 컨텍스트를 제공한다

### 2.3 가정 검증 방법

| 가정 | 신뢰도 | 검증 방법 |
|------|--------|----------|
| A-1 | 높음 | SPEC-DATA-001 테스트 통과 확인 |
| A-2 | 높음 | 환경변수 및 API 호출 테스트 |
| A-5 | 높음 | product.md Phase 1 요구사항 확인 |
| A-6 | 중간 | 도메인 전문가 검토 및 A/B 테스트 |
| A-7 | 중간 | 실제 약관 데이터 기반 응답 품질 평가 |

---

## 3. 요구사항 (Requirements)

### 3.1 유비쿼터스 요구사항 (Ubiquitous)

- [REQ-U-001] 시스템은 **항상** 모든 채팅 메시지를 ChatMessage 테이블에 영구 저장해야 한다
- [REQ-U-002] 시스템은 **항상** AI 응답에 참고한 약관 출처(보험사명, 상품명)를 metadata에 포함해야 한다
- [REQ-U-003] 시스템은 **항상** 한국어로 응답해야 한다
- [REQ-U-004] 시스템은 **항상** API 응답에 적절한 HTTP 상태 코드를 반환해야 한다

### 3.2 이벤트 기반 요구사항 (Event-Driven)

- [REQ-E-001] **WHEN** 사용자가 메시지를 전송하면 **THEN** 시스템은 시맨틱 검색으로 관련 약관을 검색하고, LLM에 컨텍스트와 함께 질문을 전달하여 응답을 생성해야 한다
- [REQ-E-002] **WHEN** 사용자가 새 채팅 세션을 생성하면 **THEN** 시스템은 고유 ID를 가진 ChatSession 레코드를 생성하고 반환해야 한다
- [REQ-E-003] **WHEN** 사용자가 스트리밍 엔드포인트를 호출하면 **THEN** 시스템은 SSE(text/event-stream) 형식으로 토큰 단위 실시간 응답을 전송해야 한다
- [REQ-E-004] **WHEN** 사용자가 채팅 세션을 삭제하면 **THEN** 시스템은 해당 세션과 모든 관련 메시지를 삭제해야 한다
- [REQ-E-005] **WHEN** 대화 기록이 존재하는 세션에서 새 메시지가 전송되면 **THEN** 시스템은 최근 N개 메시지를 대화 히스토리로 포함하여 멀티턴 대화를 지원해야 한다

### 3.3 상태 기반 요구사항 (State-Driven)

- [REQ-S-001] **IF** 시맨틱 검색 결과가 0건이면 **THEN** 시스템은 "관련 약관 정보를 찾지 못했습니다"라는 안내와 함께 일반적인 보험 상담 안내를 제공해야 한다
- [REQ-S-002] **IF** LLM API 호출이 실패하면 **THEN** 시스템은 적절한 에러 메시지를 반환하고, 사용자 메시지는 저장하되 AI 응답은 에러 상태로 기록해야 한다
- [REQ-S-003] **IF** 대화 히스토리가 chat_history_limit을 초과하면 **THEN** 시스템은 가장 오래된 메시지부터 제외하여 토큰 예산 내에서 컨텍스트를 구성해야 한다

### 3.4 금지 요구사항 (Unwanted)

- [REQ-N-001] 시스템은 확실하지 않은 보험금 금액을 확정적으로 답변**하지 않아야 한다**
- [REQ-N-002] 시스템은 사용자의 개인정보(주민등록번호, 계좌번호 등)를 메시지에 저장**하지 않아야 한다** (향후 필터링 구현 대비 metadata 필드 설계)
- [REQ-N-003] 시스템은 OpenAI API 키를 응답 본문이나 로그에 노출**하지 않아야 한다**

### 3.5 선택 요구사항 (Optional)

- [REQ-O-001] **가능하면** Redis 캐싱을 통해 동일 질문에 대한 응답 시간을 단축하는 기능을 제공
- [REQ-O-002] **가능하면** 세션 제목을 첫 번째 사용자 메시지 기반으로 자동 생성하는 기능을 제공

---

## 4. 명세 (Specifications)

### 4.1 Module 1: Chat 데이터 모델

#### 4.1.1 ChatSession 모델

```python
class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(500), default="새 대화")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())

    messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="session", cascade="all, delete-orphan",
        order_by="ChatMessage.created_at"
    )
```

#### 4.1.2 ChatMessage 모델

```python
class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("chat_sessions.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String(20))  # "user", "assistant", "system"
    content: Mapped[str] = mapped_column(Text)
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    session: Mapped["ChatSession"] = relationship(back_populates="messages")
```

#### 4.1.3 metadata JSONB 구조 (AI 응답 시)

```json
{
  "sources": [
    {
      "policy_name": "무배당 건강보험",
      "company_name": "삼성화재",
      "chunk_id": "uuid",
      "similarity_score": 0.92
    }
  ],
  "model": "gpt-4o-mini",
  "tokens_used": {
    "prompt": 1500,
    "completion": 800
  },
  "search_query": "인공관절 수술 보험 보상"
}
```

#### 4.1.4 Alembic 마이그레이션

- chat_sessions 테이블 생성
- chat_messages 테이블 생성 (session_id FK, JSONB metadata)
- 인덱스: session_id, user_id, created_at

### 4.2 Module 2: LLM 통합 서비스

#### 4.2.1 ChatService 클래스

```
ChatService
├── __init__(settings, vector_search_service, embedding_service)
├── async generate_response(session_id, user_message, db) -> ChatMessage
├── async generate_response_stream(session_id, user_message, db) -> AsyncIterator[str]
├── _build_prompt(user_message, context_chunks, history) -> list[dict]
├── _get_conversation_history(session_id, db, limit) -> list[ChatMessage]
└── _format_sources(chunks) -> list[dict]
```

#### 4.2.2 RAG 체인 흐름

```
사용자 메시지 입력
    |
    v
[1] EmbeddingService.generate_embedding(user_message)
    |
    v
[2] VectorSearchService.search(embedding, top_k=5, threshold=0.3)
    |
    v
[3] _build_prompt()
    - 시스템 프롬프트 (한국 보험 전문가 페르소나)
    - 검색된 약관 컨텍스트 (출처 정보 포함)
    - 최근 N개 대화 히스토리
    - 사용자 질문
    |
    v
[4] OpenAI ChatCompletion API 호출 (gpt-4o-mini)
    |
    v
[5] 응답 저장 + 출처 metadata 기록
    |
    v
ChatMessage (AI 응답 + sources)
```

#### 4.2.3 시스템 프롬프트

```
당신은 한국 보험 전문 AI 상담사 '보담'입니다.
사용자의 보험 관련 질문에 대해 약관 데이터를 기반으로 정확하고 이해하기 쉽게 답변합니다.
- 약관 원문을 인용하여 근거를 제시합니다
- 전문 용어는 쉬운 말로 풀어서 설명합니다
- 보험금 청구 절차를 단계별로 안내합니다
- 확실하지 않은 정보는 솔직히 모른다고 말합니다
- 답변 끝에 참고한 약관 출처(보험사명, 상품명)를 표시합니다
```

#### 4.2.4 Settings 확장

```python
# config.py에 추가할 설정
chat_model: str = "gpt-4o-mini"
chat_max_tokens: int = 1024
chat_temperature: float = 0.3
chat_history_limit: int = 10
chat_context_top_k: int = 5
chat_context_threshold: float = 0.3
```

### 4.3 Module 3: Chat API 엔드포인트

#### 4.3.1 엔드포인트 명세

| Method | Path | 설명 | 요청 | 응답 |
|--------|------|------|------|------|
| POST | `/api/v1/chat/sessions` | 새 세션 생성 | `CreateSessionRequest` | `SessionResponse` (201) |
| GET | `/api/v1/chat/sessions` | 세션 목록 조회 | query: limit, offset | `list[SessionSummary]` (200) |
| GET | `/api/v1/chat/sessions/{id}` | 세션 상세 조회 (메시지 포함) | path: id | `SessionDetailResponse` (200) |
| DELETE | `/api/v1/chat/sessions/{id}` | 세션 삭제 | path: id | 204 No Content |
| POST | `/api/v1/chat/sessions/{id}/messages` | 메시지 전송 + AI 응답 | `SendMessageRequest` | `MessageResponse` (201) |
| POST | `/api/v1/chat/sessions/{id}/messages/stream` | 스트리밍 응답 | `SendMessageRequest` | SSE stream (200) |

#### 4.3.2 Pydantic 스키마

```python
# 요청 스키마
class CreateSessionRequest(BaseModel):
    title: str | None = None
    user_id: str | None = None

class SendMessageRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=5000)

# 응답 스키마
class SessionResponse(BaseModel):
    id: uuid.UUID
    title: str
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

class SessionSummary(BaseModel):
    id: uuid.UUID
    title: str
    created_at: datetime
    message_count: int

class MessageResponse(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    role: str
    content: str
    metadata_: dict | None = Field(None, alias="metadata")
    created_at: datetime
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

class SessionDetailResponse(BaseModel):
    id: uuid.UUID
    title: str
    created_at: datetime
    updated_at: datetime
    messages: list[MessageResponse]
    model_config = ConfigDict(from_attributes=True)
```

#### 4.3.3 SSE 스트리밍 형식

```
data: {"type": "token", "content": "보험"}
data: {"type": "token", "content": "금 청구"}
data: {"type": "token", "content": " 절차는"}
...
data: {"type": "sources", "content": [{"policy_name": "...", "company_name": "..."}]}
data: {"type": "done", "message_id": "uuid"}
```

### 4.4 Module 4: API 계약 (프론트엔드 연동용)

본 SPEC은 백엔드에 집중하나, 프론트엔드(SPEC-UI-001)와의 API 계약을 명확히 정의한다.

#### 4.4.1 Content-Type 규칙

- 일반 API: `application/json`
- 스트리밍: `text/event-stream`

#### 4.4.2 에러 응답 형식

```json
{
  "detail": "세션을 찾을 수 없습니다",
  "error_code": "SESSION_NOT_FOUND"
}
```

---

## 5. 추적성 (Traceability)

### 5.1 요구사항-모듈 매핑

| 요구사항 | 모듈 | 구현 파일 |
|---------|------|----------|
| REQ-U-001 | M1, M3 | models/chat.py, api/v1/chat.py |
| REQ-U-002 | M2 | services/chat_service.py |
| REQ-U-003 | M2 | services/chat_service.py (system prompt) |
| REQ-U-004 | M3 | api/v1/chat.py |
| REQ-E-001 | M2, M3 | services/chat_service.py, api/v1/chat.py |
| REQ-E-002 | M1, M3 | models/chat.py, api/v1/chat.py |
| REQ-E-003 | M2, M3 | services/chat_service.py, api/v1/chat.py |
| REQ-E-004 | M1, M3 | models/chat.py, api/v1/chat.py |
| REQ-E-005 | M2 | services/chat_service.py |
| REQ-S-001 | M2 | services/chat_service.py |
| REQ-S-002 | M2, M3 | services/chat_service.py, api/v1/chat.py |
| REQ-S-003 | M2 | services/chat_service.py |
| REQ-N-001 | M2 | services/chat_service.py (system prompt) |
| REQ-N-002 | M2 | services/chat_service.py |
| REQ-N-003 | M2 | core/config.py |

### 5.2 의존성 관계

```
SPEC-INFRA-001 (인프라) --> SPEC-DATA-001 (데이터) --> SPEC-CHAT-001 (채팅)
                                                            |
                                                            v
                                                      SPEC-UI-001 (프론트엔드, 향후)
```
