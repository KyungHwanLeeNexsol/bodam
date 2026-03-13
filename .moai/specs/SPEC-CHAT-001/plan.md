---
id: SPEC-CHAT-001
type: plan
version: 0.1.0
status: draft
created: 2026-03-13
tags: [chat, ai, llm, rag, streaming, openai]
development_mode: tdd
---

# SPEC-CHAT-001 구현 계획

## 1. 개요

SPEC-CHAT-001은 Bodam 플랫폼의 AI 채팅 백엔드를 구현한다. TDD(RED-GREEN-REFACTOR) 방식으로 3개 모듈을 의존성 순서대로 개발한다.

## 2. 구현 순서 및 의존성

```
M1: Chat 데이터 모델
    |
    v
M2: LLM 통합 서비스 (M1 + SPEC-DATA-001 의존)
    |
    v
M3: Chat API 엔드포인트 (M1 + M2 의존)
```

## 3. 마일스톤

### Primary Goal: M1 - Chat 데이터 모델

**목적**: ChatSession, ChatMessage 모델 및 Alembic 마이그레이션 생성

**신규 파일**:
- `backend/app/models/chat.py` - ChatSession, ChatMessage SQLAlchemy 모델
- `backend/tests/unit/test_models_chat.py` - 모델 단위 테스트
- `backend/alembic/versions/xxxx_add_chat_tables.py` - 마이그레이션

**수정 파일**:
- `backend/app/models/__init__.py` - 새 모델 export 추가

**TDD 사이클**:
1. RED: ChatSession/ChatMessage 모델 생성 및 관계 테스트 작성 (실패 확인)
2. GREEN: 최소 모델 구현으로 테스트 통과
3. REFACTOR: 인덱스 최적화, 타입 힌트 정리

**검증 기준**:
- ChatSession CRUD 동작
- ChatMessage와 ChatSession 간 cascade delete 동작
- metadata JSONB 필드 저장/조회
- 마이그레이션 upgrade/downgrade 성공

### Secondary Goal: M2 - LLM 통합 서비스

**목적**: RAG 체인 기반 ChatService 구현 (시맨틱 검색 + LLM 응답 생성)

**신규 파일**:
- `backend/app/services/chat_service.py` - ChatService 클래스
- `backend/tests/unit/test_chat_service.py` - ChatService 단위 테스트
- `backend/tests/integration/test_chat_service_integration.py` - 통합 테스트

**수정 파일**:
- `backend/app/core/config.py` - chat_model, chat_max_tokens 등 설정 추가

**TDD 사이클**:
1. RED: generate_response 메서드 테스트 작성 (OpenAI 모킹)
2. GREEN: RAG 체인 구현 (검색 -> 프롬프트 구성 -> LLM 호출 -> 저장)
3. REFACTOR: 프롬프트 템플릿 분리, 에러 처리 개선

**핵심 구현 사항**:
- VectorSearchService 활용한 시맨틱 검색 연동
- EmbeddingService 활용한 쿼리 임베딩 생성
- OpenAI ChatCompletion API 직접 호출 (openai 패키지)
- 시스템 프롬프트: 한국 보험 전문가 '보담' 페르소나
- 대화 히스토리 관리 (최근 N개 메시지)
- 스트리밍 응답 생성 (AsyncIterator)
- 출처 메타데이터 구성

**검증 기준**:
- 시맨틱 검색 결과가 프롬프트에 포함되는지 확인
- 대화 히스토리가 올바르게 구성되는지 확인
- 검색 결과 0건 시 적절한 안내 메시지 생성
- LLM API 실패 시 에러 처리
- 출처 metadata 올바르게 구성

### Final Goal: M3 - Chat API 엔드포인트

**목적**: RESTful API 엔드포인트 및 SSE 스트리밍 구현

**신규 파일**:
- `backend/app/api/v1/chat.py` - Chat 라우터 (6개 엔드포인트)
- `backend/app/schemas/chat.py` - Pydantic 요청/응답 스키마
- `backend/tests/unit/test_schemas_chat.py` - 스키마 검증 테스트
- `backend/tests/integration/test_chat_api.py` - API 통합 테스트

**수정 파일**:
- `backend/app/api/v1/__init__.py` - chat 라우터 등록
- `backend/app/main.py` - 라우터 포함 (필요 시)

**TDD 사이클**:
1. RED: 각 엔드포인트별 테스트 작성 (httpx AsyncClient)
2. GREEN: FastAPI 라우터 구현
3. REFACTOR: 에러 핸들링 통일, 의존성 주입 정리

**검증 기준**:
- 세션 CRUD API 정상 동작 (201, 200, 204)
- 메시지 전송 시 AI 응답 생성 및 반환
- SSE 스트리밍 형식 준수
- 존재하지 않는 세션 접근 시 404 반환
- 빈 메시지 전송 시 422 검증 에러

## 4. 기술적 접근

### 4.1 OpenAI 클라이언트 사용

```python
# openai 패키지 직접 사용 (LangChain 미사용, MVP 단순화)
from openai import AsyncOpenAI

client = AsyncOpenAI(api_key=settings.openai_api_key)

# 일반 응답
response = await client.chat.completions.create(
    model=settings.chat_model,
    messages=messages,
    max_tokens=settings.chat_max_tokens,
    temperature=settings.chat_temperature,
)

# 스트리밍 응답
stream = await client.chat.completions.create(
    model=settings.chat_model,
    messages=messages,
    stream=True,
)
async for chunk in stream:
    yield chunk.choices[0].delta.content
```

### 4.2 SSE 스트리밍 구현

```python
from fastapi.responses import StreamingResponse

async def stream_response():
    async for token in chat_service.generate_response_stream(...):
        yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"
    yield f"data: {json.dumps({'type': 'done'})}\n\n"

return StreamingResponse(stream_response(), media_type="text/event-stream")
```

### 4.3 의존성 주입 패턴

```python
# ChatService는 기존 서비스를 주입받음
def get_chat_service(
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> ChatService:
    vector_search = VectorSearchService(db)
    embedding = EmbeddingService(settings)
    return ChatService(settings, vector_search, embedding)
```

## 5. 예상 파일 목록

### 신규 파일 (~12개)

| 파일 | 목적 |
|------|------|
| `backend/app/models/chat.py` | ChatSession, ChatMessage 모델 |
| `backend/app/schemas/chat.py` | Pydantic 스키마 |
| `backend/app/services/chat_service.py` | ChatService (RAG + LLM) |
| `backend/app/api/v1/chat.py` | Chat API 라우터 |
| `backend/alembic/versions/xxxx_add_chat.py` | DB 마이그레이션 |
| `backend/tests/unit/test_models_chat.py` | 모델 테스트 |
| `backend/tests/unit/test_schemas_chat.py` | 스키마 테스트 |
| `backend/tests/unit/test_chat_service.py` | 서비스 테스트 |
| `backend/tests/integration/test_chat_api.py` | API 통합 테스트 |
| `backend/tests/integration/test_chat_service_integration.py` | 서비스 통합 테스트 |

### 수정 파일 (~3개)

| 파일 | 변경 내용 |
|------|----------|
| `backend/app/core/config.py` | chat 관련 설정 4개 추가 |
| `backend/app/models/__init__.py` | ChatSession, ChatMessage export |
| `backend/app/api/v1/__init__.py` | chat 라우터 등록 |

## 6. 리스크 및 대응 방안

### 리스크 1: OpenAI API 응답 지연

- **영향**: 사용자 응답 시간 증가 (2초 이상)
- **대응**: 스트리밍 응답(SSE)으로 체감 대기시간 감소, 타임아웃 설정

### 리스크 2: 토큰 예산 초과

- **영향**: 대화 히스토리 + 컨텍스트가 모델 컨텍스트 윈도우 초과
- **대응**: chat_history_limit으로 히스토리 제한, 컨텍스트 청크 수 제한 (top_k=5)

### 리스크 3: 부정확한 보험 정보 응답

- **영향**: 사용자에게 잘못된 보험 안내 제공
- **대응**: 시스템 프롬프트에 "확실하지 않으면 모른다고 답변" 지침 포함, 출처 인용 필수

### 리스크 4: VectorSearchService 의존성

- **영향**: SPEC-DATA-001 변경 시 ChatService 영향
- **대응**: 서비스 간 인터페이스 명확히 정의, 단위 테스트에서 모킹 처리

## 7. 품질 요구사항

- 테스트 커버리지: 85% 이상
- ruff check/format 통과
- 모든 public 함수에 타입 힌트
- 한국어 코드 주석 (code_comments: ko)
- OpenAI 외부 호출은 테스트에서 모킹 처리
