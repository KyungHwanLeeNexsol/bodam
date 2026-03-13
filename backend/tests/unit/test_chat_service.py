"""채팅 서비스 단위 테스트

ChatService의 세션 관리, 메시지 전송, RAG 통합, 스트리밍 기능을 검증.
외부 의존성(OpenAI, VectorSearchService)은 모두 Mock 처리.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.chat import ChatMessage, ChatSession, MessageRole


@pytest.fixture
def mock_settings():
    """테스트용 Settings 목 픽스처"""
    settings = MagicMock()
    settings.openai_api_key = "test-api-key"
    settings.embedding_model = "text-embedding-3-small"
    settings.embedding_dimensions = 1536
    settings.chat_model = "gpt-4o-mini"
    settings.chat_max_tokens = 1024
    settings.chat_temperature = 0.3
    settings.chat_history_limit = 10
    settings.chat_context_top_k = 5
    settings.chat_context_threshold = 0.3
    return settings


@pytest.fixture
def mock_db():
    """테스트용 AsyncSession 목 픽스처"""
    db = AsyncMock()
    db.flush = AsyncMock()
    db.execute = AsyncMock()
    return db


@pytest.fixture
def chat_service(mock_db, mock_settings):
    """ChatService 인스턴스 픽스처 (외부 의존성 모두 모킹)"""
    from app.services.chat_service import ChatService

    with (
        patch("app.services.chat_service.AsyncOpenAI") as mock_openai_cls,
        patch("app.services.chat_service.EmbeddingService") as mock_embedding_cls,
        patch("app.services.chat_service.VectorSearchService") as mock_vector_cls,
    ):
        mock_openai_cls.return_value = AsyncMock()
        mock_embedding_cls.return_value = AsyncMock()
        mock_vector_cls.return_value = AsyncMock()

        service = ChatService(db=mock_db, settings=mock_settings)
        service._openai_client = AsyncMock()
        service._vector_search = AsyncMock()

        yield service


class TestChatServiceCreateSession:
    """ChatService.create_session 테스트"""

    @pytest.mark.asyncio
    async def test_create_session_with_default_title(self, chat_service, mock_db) -> None:
        """기본 제목으로 세션 생성 후 flush 호출"""
        mock_db.add = MagicMock()
        mock_db.flush = AsyncMock()

        session = await chat_service.create_session(title="새 대화", user_id=None)

        assert session.title == "새 대화"
        assert session.user_id is None
        mock_db.add.assert_called_once()
        mock_db.flush.assert_called_once()

    @pytest.mark.asyncio
    async def test_create_session_with_user_id(self, chat_service, mock_db) -> None:
        """user_id 포함 세션 생성"""
        mock_db.add = MagicMock()
        mock_db.flush = AsyncMock()

        session = await chat_service.create_session(title="암 보험 문의", user_id="user-001")

        assert session.title == "암 보험 문의"
        assert session.user_id == "user-001"


class TestChatServiceListSessions:
    """ChatService.list_sessions 테스트"""

    @pytest.mark.asyncio
    async def test_list_returns_sessions(self, chat_service, mock_db) -> None:
        """세션 목록 반환"""
        mock_session = MagicMock(spec=ChatSession)
        mock_session.id = uuid.uuid4()
        mock_session.title = "테스트 세션"

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [mock_session]
        mock_db.execute = AsyncMock(return_value=mock_result)

        sessions = await chat_service.list_sessions()

        assert len(sessions) == 1
        mock_db.execute.assert_called_once()

    @pytest.mark.asyncio
    async def test_list_returns_empty_when_no_sessions(self, chat_service, mock_db) -> None:
        """세션 없을 때 빈 리스트 반환"""
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        mock_db.execute = AsyncMock(return_value=mock_result)

        sessions = await chat_service.list_sessions()

        assert sessions == []


class TestChatServiceGetSession:
    """ChatService.get_session 테스트"""

    @pytest.mark.asyncio
    async def test_get_existing_session(self, chat_service, mock_db) -> None:
        """존재하는 세션 ID로 조회 시 세션 반환"""
        session_id = uuid.uuid4()
        mock_session = MagicMock(spec=ChatSession)
        mock_session.id = session_id

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_session
        mock_db.execute = AsyncMock(return_value=mock_result)

        result = await chat_service.get_session(session_id)

        assert result == mock_session

    @pytest.mark.asyncio
    async def test_get_nonexistent_session_returns_none(self, chat_service, mock_db) -> None:
        """존재하지 않는 세션 ID 조회 시 None 반환"""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute = AsyncMock(return_value=mock_result)

        result = await chat_service.get_session(uuid.uuid4())

        assert result is None


class TestChatServiceDeleteSession:
    """ChatService.delete_session 테스트"""

    @pytest.mark.asyncio
    async def test_delete_existing_session_returns_true(self, chat_service, mock_db) -> None:
        """존재하는 세션 삭제 시 True 반환"""
        session_id = uuid.uuid4()
        mock_session = MagicMock(spec=ChatSession)

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_session
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.delete = AsyncMock()
        mock_db.flush = AsyncMock()

        result = await chat_service.delete_session(session_id)

        assert result is True
        mock_db.delete.assert_called_once_with(mock_session)

    @pytest.mark.asyncio
    async def test_delete_nonexistent_session_returns_false(self, chat_service, mock_db) -> None:
        """존재하지 않는 세션 삭제 시 False 반환"""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute = AsyncMock(return_value=mock_result)

        result = await chat_service.delete_session(uuid.uuid4())

        assert result is False


class TestChatServiceSendMessage:
    """ChatService.send_message 테스트"""

    def _make_openai_response(self, content: str) -> MagicMock:
        """OpenAI ChatCompletion 응답 목 생성"""
        mock_choice = MagicMock()
        mock_choice.message.content = content

        mock_response = MagicMock()
        mock_response.choices = [mock_choice]
        return mock_response

    def _make_search_result(self) -> dict:
        """벡터 검색 결과 목 생성"""
        return {
            "chunk_id": uuid.uuid4(),
            "policy_id": uuid.uuid4(),
            "chunk_text": "암 진단비는 최대 5000만원까지 지급됩니다.",
            "similarity": 0.9,
            "policy_name": "삼성생명 종신보험",
            "company_name": "삼성생명",
        }

    @pytest.mark.asyncio
    async def test_send_message_returns_tuple(self, chat_service, mock_db) -> None:
        """메시지 전송 후 (user_msg, assistant_msg) 튜플 반환"""
        session_id = uuid.uuid4()

        mock_session = MagicMock(spec=ChatSession)
        mock_session.id = session_id
        mock_session.messages = []

        session_result = MagicMock()
        session_result.scalar_one_or_none.return_value = mock_session
        mock_db.execute = AsyncMock(return_value=session_result)
        mock_db.add = MagicMock()
        mock_db.flush = AsyncMock()

        chat_service._vector_search.search = AsyncMock(return_value=[self._make_search_result()])

        chat_service._openai_client.chat.completions.create = AsyncMock(
            return_value=self._make_openai_response("암 보험에 대해 답변드립니다.")
        )

        user_msg, assistant_msg = await chat_service.send_message(
            session_id=session_id, content="암 보험 청구 방법이 궁금해요"
        )

        assert user_msg.role == MessageRole.USER
        assert user_msg.content == "암 보험 청구 방법이 궁금해요"
        assert assistant_msg.role == MessageRole.ASSISTANT
        assert "답변" in assistant_msg.content

    @pytest.mark.asyncio
    async def test_send_message_with_no_search_results(self, chat_service, mock_db) -> None:
        """벡터 검색 결과 없어도 AI 응답 반환"""
        session_id = uuid.uuid4()

        mock_session = MagicMock(spec=ChatSession)
        mock_session.id = session_id
        mock_session.messages = []

        session_result = MagicMock()
        session_result.scalar_one_or_none.return_value = mock_session
        mock_db.execute = AsyncMock(return_value=session_result)
        mock_db.add = MagicMock()
        mock_db.flush = AsyncMock()

        chat_service._vector_search.search = AsyncMock(return_value=[])

        chat_service._openai_client.chat.completions.create = AsyncMock(
            return_value=self._make_openai_response("관련 약관 정보를 찾지 못했습니다.")
        )

        user_msg, assistant_msg = await chat_service.send_message(session_id=session_id, content="이상한 질문")

        assert user_msg is not None
        assert assistant_msg is not None

    @pytest.mark.asyncio
    async def test_chat_history_limit_10(self, chat_service, mock_db) -> None:
        """15개 메시지 중 최근 10개만 히스토리에 포함"""
        session_id = uuid.uuid4()

        messages = []
        for i in range(15):
            msg = MagicMock(spec=ChatMessage)
            msg.role = MessageRole.USER if i % 2 == 0 else MessageRole.ASSISTANT
            msg.content = f"메시지 {i}"
            messages.append(msg)

        mock_session = MagicMock(spec=ChatSession)
        mock_session.id = session_id
        mock_session.messages = messages

        session_result = MagicMock()
        session_result.scalar_one_or_none.return_value = mock_session
        mock_db.execute = AsyncMock(return_value=session_result)
        mock_db.add = MagicMock()
        mock_db.flush = AsyncMock()

        chat_service._vector_search.search = AsyncMock(return_value=[])
        chat_service._openai_client.chat.completions.create = AsyncMock(
            return_value=self._make_openai_response("답변입니다")
        )

        await chat_service.send_message(session_id=session_id, content="새 질문")

        call_kwargs = chat_service._openai_client.chat.completions.create.call_args
        messages_arg = (
            call_kwargs.kwargs.get("messages") or call_kwargs.args[0]
            if call_kwargs.args
            else call_kwargs.kwargs.get("messages")
        )

        if messages_arg:
            history_messages = [m for m in messages_arg if m.get("role") != "system"]
            assert len(history_messages) <= 11  # 최근 10개 히스토리 + 1개 현재 메시지

    @pytest.mark.asyncio
    async def test_openai_timeout_error_handling(self, chat_service, mock_db) -> None:
        """OpenAI 타임아웃 시 에러 메시지 응답"""
        import openai

        session_id = uuid.uuid4()

        mock_session = MagicMock(spec=ChatSession)
        mock_session.id = session_id
        mock_session.messages = []

        session_result = MagicMock()
        session_result.scalar_one_or_none.return_value = mock_session
        mock_db.execute = AsyncMock(return_value=session_result)
        mock_db.add = MagicMock()
        mock_db.flush = AsyncMock()

        chat_service._vector_search.search = AsyncMock(return_value=[])
        chat_service._openai_client.chat.completions.create = AsyncMock(
            side_effect=openai.APITimeoutError(request=MagicMock())
        )

        user_msg, assistant_msg = await chat_service.send_message(session_id=session_id, content="질문")

        assert "시간이 초과" in assistant_msg.content or "다시 시도" in assistant_msg.content

    @pytest.mark.asyncio
    async def test_openai_auth_error_handling(self, chat_service, mock_db) -> None:
        """OpenAI 인증 실패 시 에러 메시지 응답"""
        import openai

        session_id = uuid.uuid4()

        mock_session = MagicMock(spec=ChatSession)
        mock_session.id = session_id
        mock_session.messages = []

        session_result = MagicMock()
        session_result.scalar_one_or_none.return_value = mock_session
        mock_db.execute = AsyncMock(return_value=session_result)
        mock_db.add = MagicMock()
        mock_db.flush = AsyncMock()

        chat_service._vector_search.search = AsyncMock(return_value=[])
        chat_service._openai_client.chat.completions.create = AsyncMock(
            side_effect=openai.AuthenticationError(
                message="invalid api key",
                response=MagicMock(),
                body=None,
            )
        )

        user_msg, assistant_msg = await chat_service.send_message(session_id=session_id, content="질문")

        assert "연결에 실패" in assistant_msg.content


class TestChatServiceSendMessageStream:
    """ChatService.send_message_stream 테스트"""

    @pytest.mark.asyncio
    async def test_stream_yields_token_events(self, chat_service, mock_db) -> None:
        """스트림에서 token 이벤트 생성"""
        session_id = uuid.uuid4()

        mock_session = MagicMock(spec=ChatSession)
        mock_session.id = session_id
        mock_session.messages = []

        session_result = MagicMock()
        session_result.scalar_one_or_none.return_value = mock_session
        mock_db.execute = AsyncMock(return_value=session_result)
        mock_db.add = MagicMock()
        mock_db.flush = AsyncMock()

        chat_service._vector_search.search = AsyncMock(return_value=[])

        async def mock_stream():
            for token in ["안녕", "하세요", "!"]:
                chunk = MagicMock()
                chunk.choices = [MagicMock()]
                chunk.choices[0].delta.content = token
                yield chunk

        mock_stream_cm = MagicMock()
        mock_stream_cm.__aenter__ = AsyncMock(return_value=mock_stream())
        mock_stream_cm.__aexit__ = AsyncMock(return_value=False)
        chat_service._openai_client.chat.completions.stream = MagicMock(return_value=mock_stream_cm)

        events = []
        async for event in chat_service.send_message_stream(session_id=session_id, content="안녕하세요"):
            events.append(event)

        token_events = [e for e in events if e.get("type") == "token"]
        assert len(token_events) >= 1

    @pytest.mark.asyncio
    async def test_stream_yields_sources_event(self, chat_service, mock_db) -> None:
        """스트림 종료 후 sources 이벤트 생성"""
        session_id = uuid.uuid4()

        mock_session = MagicMock(spec=ChatSession)
        mock_session.id = session_id
        mock_session.messages = []

        session_result = MagicMock()
        session_result.scalar_one_or_none.return_value = mock_session
        mock_db.execute = AsyncMock(return_value=session_result)
        mock_db.add = MagicMock()
        mock_db.flush = AsyncMock()

        chat_service._vector_search.search = AsyncMock(
            return_value=[
                {
                    "chunk_id": uuid.uuid4(),
                    "policy_id": uuid.uuid4(),
                    "chunk_text": "약관 내용",
                    "similarity": 0.9,
                    "policy_name": "종신보험",
                    "company_name": "삼성생명",
                }
            ]
        )

        async def mock_stream():
            chunk = MagicMock()
            chunk.choices = [MagicMock()]
            chunk.choices[0].delta.content = "답변"
            yield chunk

        mock_stream_cm = MagicMock()
        mock_stream_cm.__aenter__ = AsyncMock(return_value=mock_stream())
        mock_stream_cm.__aexit__ = AsyncMock(return_value=False)
        chat_service._openai_client.chat.completions.stream = MagicMock(return_value=mock_stream_cm)

        events = []
        async for event in chat_service.send_message_stream(session_id=session_id, content="질문"):
            events.append(event)

        sources_events = [e for e in events if e.get("type") == "sources"]
        assert len(sources_events) == 1

    @pytest.mark.asyncio
    async def test_stream_yields_done_event(self, chat_service, mock_db) -> None:
        """스트림 완료 후 done 이벤트 생성"""
        session_id = uuid.uuid4()

        mock_session = MagicMock(spec=ChatSession)
        mock_session.id = session_id
        mock_session.messages = []

        session_result = MagicMock()
        session_result.scalar_one_or_none.return_value = mock_session
        mock_db.execute = AsyncMock(return_value=session_result)
        mock_db.add = MagicMock()
        mock_db.flush = AsyncMock()

        chat_service._vector_search.search = AsyncMock(return_value=[])

        async def mock_stream():
            chunk = MagicMock()
            chunk.choices = [MagicMock()]
            chunk.choices[0].delta.content = "완료"
            yield chunk

        mock_stream_cm = MagicMock()
        mock_stream_cm.__aenter__ = AsyncMock(return_value=mock_stream())
        mock_stream_cm.__aexit__ = AsyncMock(return_value=False)
        chat_service._openai_client.chat.completions.stream = MagicMock(return_value=mock_stream_cm)

        events = []
        async for event in chat_service.send_message_stream(session_id=session_id, content="질문"):
            events.append(event)

        done_events = [e for e in events if e.get("type") == "done"]
        assert len(done_events) == 1
        assert "message_id" in done_events[0]
