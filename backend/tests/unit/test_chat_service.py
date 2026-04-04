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
    settings.gemini_api_key = ""
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
        patch("app.services.chat_service.FallbackChain") as mock_chain_cls,
        patch("app.services.chat_service.get_embedding_service") as mock_embedding_fn,
        patch("app.services.chat_service.VectorSearchService") as mock_vector_cls,
    ):
        mock_chain_cls.return_value = AsyncMock()
        mock_embedding_fn.return_value = AsyncMock()
        mock_vector_cls.return_value = AsyncMock()

        service = ChatService(db=mock_db, settings=mock_settings)
        service._rag_initialized = True
        service._llm_chain = AsyncMock()
        service._vector_search = AsyncMock()
        service._jit_section_finder = MagicMock()
        service._product_extractor = MagicMock(extract=MagicMock(return_value=None))

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
    """ChatService.list_sessions 테스트 (새 시그니처 - 페이지네이션)"""

    @pytest.mark.asyncio
    async def test_list_returns_sessions(self, chat_service, mock_db) -> None:
        """세션 목록 반환 - (sessions_with_counts, total_count) 튜플 반환"""
        mock_session = MagicMock(spec=ChatSession)
        mock_session.id = uuid.uuid4()
        mock_session.title = "테스트 세션"

        # 새 시그니처: 첫 execute는 (session, count) 목록, 두 번째는 total count
        sessions_result = MagicMock()
        sessions_result.all.return_value = [(mock_session, 2)]
        count_result = MagicMock()
        count_result.scalar_one.return_value = 1
        mock_db.execute = AsyncMock(side_effect=[sessions_result, count_result])

        sessions_data, total = await chat_service.list_sessions()

        assert len(sessions_data) == 1
        assert total == 1
        assert mock_db.execute.call_count == 2

    @pytest.mark.asyncio
    async def test_list_returns_empty_when_no_sessions(self, chat_service, mock_db) -> None:
        """세션 없을 때 빈 리스트와 total_count=0 반환"""
        sessions_result = MagicMock()
        sessions_result.all.return_value = []
        count_result = MagicMock()
        count_result.scalar_one.return_value = 0
        mock_db.execute = AsyncMock(side_effect=[sessions_result, count_result])

        sessions_data, total = await chat_service.list_sessions()

        assert sessions_data == []
        assert total == 0


class TestChatServiceListSessionsPaginated:
    """ChatService.list_sessions 페이지네이션 테스트 (SPEC-CHAT-PERF-001)

    RED: 아직 구현되지 않은 새 시그니처 검증.
    list_sessions(limit, offset, user_id)는 (sessions, total_count) 튜플을 반환해야 함.
    """

    @pytest.mark.asyncio
    async def test_list_sessions_returns_tuple_with_total_count(self, chat_service, mock_db) -> None:
        """list_sessions가 (sessions, total_count) 튜플을 반환해야 함"""
        mock_session = MagicMock(spec=ChatSession)
        mock_session.id = uuid.uuid4()
        mock_session.title = "테스트 세션"
        mock_session.message_count = 3

        # 첫 번째 execute: 세션 목록 조회
        sessions_result = MagicMock()
        sessions_result.all.return_value = [(mock_session, 3)]

        # 두 번째 execute: 총 개수 조회
        count_result = MagicMock()
        count_result.scalar_one.return_value = 1

        mock_db.execute = AsyncMock(side_effect=[sessions_result, count_result])

        result = await chat_service.list_sessions(limit=20, offset=0)

        # (sessions_with_counts, total_count) 튜플이어야 함
        assert isinstance(result, tuple)
        assert len(result) == 2
        sessions_data, total_count = result
        assert total_count == 1

    @pytest.mark.asyncio
    async def test_list_sessions_default_limit_is_20(self, chat_service, mock_db) -> None:
        """기본 limit은 20이어야 함"""
        sessions_result = MagicMock()
        sessions_result.all.return_value = []

        count_result = MagicMock()
        count_result.scalar_one.return_value = 0

        mock_db.execute = AsyncMock(side_effect=[sessions_result, count_result])

        result = await chat_service.list_sessions()

        assert isinstance(result, tuple)
        _, total_count = result
        assert total_count == 0

    @pytest.mark.asyncio
    async def test_list_sessions_with_user_id_filter(self, chat_service, mock_db) -> None:
        """user_id 필터링 적용 시 해당 사용자 세션만 반환"""
        user_id = uuid.uuid4()
        mock_session = MagicMock(spec=ChatSession)
        mock_session.id = uuid.uuid4()
        mock_session.user_id = user_id
        mock_session.message_count = 0

        sessions_result = MagicMock()
        sessions_result.all.return_value = [(mock_session, 0)]

        count_result = MagicMock()
        count_result.scalar_one.return_value = 1

        mock_db.execute = AsyncMock(side_effect=[sessions_result, count_result])

        result = await chat_service.list_sessions(limit=20, offset=0, user_id=user_id)

        assert isinstance(result, tuple)
        sessions_data, total_count = result
        assert total_count == 1

    @pytest.mark.asyncio
    async def test_list_sessions_message_count_from_sql_not_python(self, chat_service, mock_db) -> None:
        """message_count는 Python len() 아닌 SQL COUNT 서브쿼리에서 와야 함"""
        mock_session = MagicMock(spec=ChatSession)
        mock_session.id = uuid.uuid4()

        # SQL COUNT 서브쿼리 결과: 정수 5
        sessions_result = MagicMock()
        sessions_result.all.return_value = [(mock_session, 5)]

        count_result = MagicMock()
        count_result.scalar_one.return_value = 1

        mock_db.execute = AsyncMock(side_effect=[sessions_result, count_result])

        result = await chat_service.list_sessions(limit=20, offset=0)
        sessions_data, _ = result

        # 튜플 목록이어야 함 (session, count)
        assert len(sessions_data) == 1
        session_obj, msg_count = sessions_data[0]
        assert msg_count == 5  # SQL에서 온 숫자

    @pytest.mark.asyncio
    async def test_get_session_with_messages_eager_loaded(self, chat_service, mock_db) -> None:
        """get_session은 messages를 eager load해야 함 (noload 변경 후 회귀 테스트)"""
        session_id = uuid.uuid4()
        mock_session = MagicMock(spec=ChatSession)
        mock_session.id = session_id

        # messages가 로드되어 있어야 함 (noload 기본값으로는 접근 불가)
        from app.models.chat import ChatMessage, MessageRole
        mock_msg = MagicMock(spec=ChatMessage)
        mock_msg.role = MessageRole.USER
        mock_msg.content = "테스트 메시지"
        mock_session.messages = [mock_msg]

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_session
        mock_db.execute = AsyncMock(return_value=mock_result)

        result = await chat_service.get_session(session_id)

        assert result is not None
        # messages에 접근 가능해야 함 (eager load 확인)
        assert result.messages is not None
        assert len(result.messages) == 1


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

    def _make_llm_response(self, content: str) -> MagicMock:
        """LLMResponse 목 생성"""
        mock_response = MagicMock()
        mock_response.content = content
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

        chat_service._llm_chain.generate = AsyncMock(
            return_value=self._make_llm_response("암 보험에 대해 답변드립니다.")
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

        chat_service._llm_chain.generate = AsyncMock(
            return_value=self._make_llm_response("관련 약관 정보를 찾지 못했습니다.")
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
        chat_service._llm_chain.generate = AsyncMock(
            return_value=self._make_llm_response("답변입니다")
        )

        await chat_service.send_message(session_id=session_id, content="새 질문")

        call_kwargs = chat_service._llm_chain.generate.call_args
        messages_arg = (
            call_kwargs.args[0]
            if call_kwargs.args
            else call_kwargs.kwargs.get("messages")
        )

        if messages_arg:
            history_messages = [m for m in messages_arg if m.get("role") != "system"]
            assert len(history_messages) <= 11  # 최근 10개 히스토리 + 1개 현재 메시지

    @pytest.mark.asyncio
    async def test_openai_timeout_error_handling(self, chat_service, mock_db) -> None:
        """LLM 타임아웃 시 에러 메시지 응답"""
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
        chat_service._llm_chain.generate = AsyncMock(
            side_effect=TimeoutError("request timed out")
        )

        user_msg, assistant_msg = await chat_service.send_message(session_id=session_id, content="질문")

        assert "문제가 발생했습니다" in assistant_msg.content or "다시 시도" in assistant_msg.content

    @pytest.mark.asyncio
    async def test_openai_auth_error_handling(self, chat_service, mock_db) -> None:
        """LLM 인증 실패 시 에러 메시지 응답"""
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
        chat_service._llm_chain.generate = AsyncMock(
            side_effect=PermissionError("invalid api key")
        )

        user_msg, assistant_msg = await chat_service.send_message(session_id=session_id, content="질문")

        assert "문제가 발생했습니다" in assistant_msg.content or "다시 시도" in assistant_msg.content


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

        mock_llm_resp = MagicMock()
        mock_llm_resp.content = "안녕하세요!"
        chat_service._llm_chain.generate = AsyncMock(return_value=mock_llm_resp)

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

        mock_llm_resp = MagicMock()
        mock_llm_resp.content = "답변"
        chat_service._llm_chain.generate = AsyncMock(return_value=mock_llm_resp)

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

        mock_llm_resp = MagicMock()
        mock_llm_resp.content = "완료"
        chat_service._llm_chain.generate = AsyncMock(return_value=mock_llm_resp)

        events = []
        async for event in chat_service.send_message_stream(session_id=session_id, content="질문"):
            events.append(event)

        done_events = [e for e in events if e.get("type") == "done"]
        assert len(done_events) == 1
        assert "message_id" in done_events[0]
