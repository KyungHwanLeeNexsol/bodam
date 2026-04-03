"""SPEC-CHAT-UX-001 채팅 서비스 단위 테스트 (RED 단계)

테스트 대상:
- ChatService.update_session_title(): 세션 제목 업데이트
- ChatService._generate_session_title(): 첫 메시지 기반 제목 자동 생성
- ChatService.send_message_stream(): 첫 메시지 시 title_update 이벤트 yield
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
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
    db.add = MagicMock()
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
        service._llm_chain = AsyncMock()
        service._vector_search = AsyncMock()

        yield service


# ─────────────────────────────────────────────
# update_session_title 테스트
# ─────────────────────────────────────────────


class TestUpdateSessionTitle:
    """ChatService.update_session_title 단위 테스트"""

    @pytest.mark.asyncio
    async def test_update_session_title_success(self, chat_service, mock_db) -> None:
        """존재하는 세션의 제목을 업데이트하고 변경된 세션 반환"""
        session_id = uuid.uuid4()
        mock_session = MagicMock(spec=ChatSession)
        mock_session.id = session_id
        mock_session.title = "기존 제목"

        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = mock_session
        mock_db.execute = AsyncMock(return_value=result_mock)

        result = await chat_service.update_session_title(session_id, "새 제목")

        assert result is not None
        assert result.title == "새 제목"
        mock_db.flush.assert_called_once()

    @pytest.mark.asyncio
    async def test_update_session_title_returns_none_for_missing_session(
        self, chat_service, mock_db
    ) -> None:
        """존재하지 않는 세션 ID로 update 시 None 반환"""
        session_id = uuid.uuid4()

        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = None
        mock_db.execute = AsyncMock(return_value=result_mock)

        result = await chat_service.update_session_title(session_id, "새 제목")

        assert result is None
        mock_db.flush.assert_not_called()

    @pytest.mark.asyncio
    async def test_update_session_title_sets_correct_title(
        self, chat_service, mock_db
    ) -> None:
        """제목이 정확히 전달된 값으로 업데이트되는지 검증"""
        session_id = uuid.uuid4()
        mock_session = MagicMock(spec=ChatSession)
        mock_session.id = session_id
        mock_session.title = "원래 제목"

        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = mock_session
        mock_db.execute = AsyncMock(return_value=result_mock)

        new_title = "보험금 청구 문의"
        await chat_service.update_session_title(session_id, new_title)

        assert mock_session.title == new_title


# ─────────────────────────────────────────────
# _generate_session_title 테스트
# ─────────────────────────────────────────────


class TestGenerateSessionTitle:
    """ChatService._generate_session_title 단위 테스트"""

    @pytest.mark.asyncio
    async def test_generate_title_returns_short_string(
        self, chat_service
    ) -> None:
        """LLM 응답에서 15자 이내 제목 반환"""
        mock_response = MagicMock()
        mock_response.content = "보험금 청구 방법"
        chat_service._llm_chain.generate = AsyncMock(return_value=mock_response)

        title = await chat_service._generate_session_title("보험금을 어떻게 청구하나요?")

        assert title is not None
        assert len(title) <= 15
        assert title == "보험금 청구 방법"

    @pytest.mark.asyncio
    async def test_generate_title_truncates_long_response(
        self, chat_service
    ) -> None:
        """LLM이 15자 초과 제목 반환 시 15자로 자름"""
        mock_response = MagicMock()
        mock_response.content = "이것은 매우 긴 제목으로 15자를 초과합니다"
        chat_service._llm_chain.generate = AsyncMock(return_value=mock_response)

        title = await chat_service._generate_session_title("질문입니다")

        assert title is not None
        assert len(title) <= 15

    @pytest.mark.asyncio
    async def test_generate_title_strips_trailing_period(
        self, chat_service
    ) -> None:
        """제목 끝에 마침표가 있으면 제거"""
        mock_response = MagicMock()
        mock_response.content = "보험금 청구."
        chat_service._llm_chain.generate = AsyncMock(return_value=mock_response)

        title = await chat_service._generate_session_title("보험금 청구 방법은?")

        assert title is not None
        assert not title.endswith(".")

    @pytest.mark.asyncio
    async def test_generate_title_returns_none_on_llm_error(
        self, chat_service
    ) -> None:
        """LLM 오류 발생 시 None 반환 (예외 전파 안 함)"""
        chat_service._llm_chain.generate = AsyncMock(side_effect=Exception("LLM 오류"))

        title = await chat_service._generate_session_title("질문입니다")

        assert title is None

    @pytest.mark.asyncio
    async def test_generate_title_returns_none_for_empty_response(
        self, chat_service
    ) -> None:
        """LLM이 빈 문자열 반환 시 None 반환"""
        mock_response = MagicMock()
        mock_response.content = ""
        chat_service._llm_chain.generate = AsyncMock(return_value=mock_response)

        title = await chat_service._generate_session_title("질문입니다")

        assert title is None


# ─────────────────────────────────────────────
# send_message_stream - title_update 이벤트 테스트
# ─────────────────────────────────────────────


class TestSendMessageStreamTitleUpdate:
    """send_message_stream의 title_update 이벤트 테스트"""

    def _make_mock_session(self, session_id: uuid.UUID) -> MagicMock:
        """테스트용 ChatSession 목 객체 생성"""
        session = MagicMock(spec=ChatSession)
        session.id = session_id
        session.title = "새 대화"
        session.user_id = None
        session.messages = []
        session.created_at = datetime.now(UTC)
        session.updated_at = datetime.now(UTC)
        return session

    @pytest.mark.asyncio
    async def test_stream_yields_title_update_for_first_message(
        self, chat_service, mock_db
    ) -> None:
        """첫 번째 메시지 전송 시 title_update 이벤트 yield"""
        session_id = uuid.uuid4()
        mock_session = self._make_mock_session(session_id)

        # get_session 반환값 설정 (messages eager load 포함)
        session_result = MagicMock()
        session_result.scalar_one_or_none.return_value = mock_session

        # existing_message_count = 0 (첫 메시지)
        count_result = MagicMock()
        count_result.scalar.return_value = 0

        # update_session_title 내부 execute 응답
        update_result = MagicMock()
        update_result.scalar_one_or_none.return_value = mock_session

        mock_db.execute = AsyncMock(
            side_effect=[session_result, count_result, update_result]
        )

        # LLM 응답 설정
        mock_llm_response = MagicMock()
        mock_llm_response.content = "AI 응답 내용입니다."
        chat_service._llm_chain.generate = AsyncMock(return_value=mock_llm_response)

        # 제목 생성 모킹
        chat_service._generate_session_title = AsyncMock(return_value="보험금 문의")
        chat_service._classify_intent = AsyncMock(return_value=(None, 0.0))
        chat_service._analyze_guidance = AsyncMock(return_value=None)

        events = []
        async for event in chat_service.send_message_stream(session_id, "보험금 청구 방법?"):
            events.append(event)

        event_types = [e["type"] for e in events]
        assert "title_update" in event_types

        title_event = next(e for e in events if e["type"] == "title_update")
        assert title_event["title"] == "보험금 문의"

    @pytest.mark.asyncio
    async def test_stream_no_title_update_for_subsequent_message(
        self, chat_service, mock_db
    ) -> None:
        """두 번째 이후 메시지 전송 시 title_update 이벤트 미발생"""
        session_id = uuid.uuid4()
        mock_session = self._make_mock_session(session_id)

        session_result = MagicMock()
        session_result.scalar_one_or_none.return_value = mock_session

        # existing_message_count = 2 (두 번째 이후 메시지)
        count_result = MagicMock()
        count_result.scalar.return_value = 2

        mock_db.execute = AsyncMock(side_effect=[session_result, count_result])

        mock_llm_response = MagicMock()
        mock_llm_response.content = "AI 응답입니다."
        chat_service._llm_chain.generate = AsyncMock(return_value=mock_llm_response)

        chat_service._generate_session_title = AsyncMock(return_value="보험금 문의")
        chat_service._classify_intent = AsyncMock(return_value=(None, 0.0))
        chat_service._analyze_guidance = AsyncMock(return_value=None)

        events = []
        async for event in chat_service.send_message_stream(session_id, "추가 질문입니다"):
            events.append(event)

        event_types = [e["type"] for e in events]
        assert "title_update" not in event_types

    @pytest.mark.asyncio
    async def test_stream_no_title_update_when_generate_returns_none(
        self, chat_service, mock_db
    ) -> None:
        """_generate_session_title이 None 반환 시 title_update 이벤트 미발생"""
        session_id = uuid.uuid4()
        mock_session = self._make_mock_session(session_id)

        session_result = MagicMock()
        session_result.scalar_one_or_none.return_value = mock_session

        # 첫 번째 메시지
        count_result = MagicMock()
        count_result.scalar.return_value = 0

        mock_db.execute = AsyncMock(side_effect=[session_result, count_result])

        mock_llm_response = MagicMock()
        mock_llm_response.content = "AI 응답입니다."
        chat_service._llm_chain.generate = AsyncMock(return_value=mock_llm_response)

        # 제목 생성 실패 시 None
        chat_service._generate_session_title = AsyncMock(return_value=None)
        chat_service._classify_intent = AsyncMock(return_value=(None, 0.0))
        chat_service._analyze_guidance = AsyncMock(return_value=None)

        events = []
        async for event in chat_service.send_message_stream(session_id, "첫 질문"):
            events.append(event)

        event_types = [e["type"] for e in events]
        assert "title_update" not in event_types

    @pytest.mark.asyncio
    async def test_stream_title_update_comes_after_done(
        self, chat_service, mock_db
    ) -> None:
        """title_update 이벤트는 done 이벤트 이후에 발생"""
        session_id = uuid.uuid4()
        mock_session = self._make_mock_session(session_id)

        session_result = MagicMock()
        session_result.scalar_one_or_none.return_value = mock_session

        count_result = MagicMock()
        count_result.scalar.return_value = 0

        update_result = MagicMock()
        update_result.scalar_one_or_none.return_value = mock_session

        mock_db.execute = AsyncMock(
            side_effect=[session_result, count_result, update_result]
        )

        mock_llm_response = MagicMock()
        mock_llm_response.content = "AI 응답입니다."
        chat_service._llm_chain.generate = AsyncMock(return_value=mock_llm_response)

        chat_service._generate_session_title = AsyncMock(return_value="첫 질문 제목")
        chat_service._classify_intent = AsyncMock(return_value=(None, 0.0))
        chat_service._analyze_guidance = AsyncMock(return_value=None)

        events = []
        async for event in chat_service.send_message_stream(session_id, "첫 번째 메시지"):
            events.append(event)

        event_types = [e["type"] for e in events]
        done_idx = event_types.index("done")
        title_update_idx = event_types.index("title_update")
        assert title_update_idx > done_idx
