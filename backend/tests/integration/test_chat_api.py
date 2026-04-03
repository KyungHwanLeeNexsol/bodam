"""채팅 API 통합 테스트

FastAPI 엔드포인트를 통한 채팅 세션 및 메시지 CRUD 통합 테스트.
외부 의존성(OpenAI, DB)은 모킹 처리.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient


def _make_mock_session() -> AsyncMock:
    """AsyncSession 목 객체 생성"""
    session = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none = MagicMock(return_value=None)
    scalars_result = MagicMock()
    scalars_result.all = MagicMock(return_value=[])
    execute_result.scalars = MagicMock(return_value=scalars_result)
    session.execute = AsyncMock(return_value=execute_result)
    session.add = MagicMock()
    session.flush = AsyncMock()
    session.delete = AsyncMock()
    session.commit = AsyncMock()
    return session


def _make_chat_session(title: str = "새 대화", user_id=None) -> MagicMock:
    """ChatSession 목 객체 생성"""
    from app.models.chat import ChatSession

    obj = MagicMock(spec=ChatSession)
    obj.id = uuid.uuid4()
    obj.title = title
    obj.user_id = user_id
    obj.messages = []
    now = datetime.now(UTC)
    obj.created_at = now
    obj.updated_at = now
    return obj


def _make_chat_message(session_id, role, content, metadata=None) -> MagicMock:
    """ChatMessage 목 객체 생성"""
    from app.models.chat import ChatMessage

    obj = MagicMock(spec=ChatMessage)
    obj.id = uuid.uuid4()
    obj.session_id = session_id
    obj.role = role
    obj.content = content
    obj.metadata_ = metadata
    obj.created_at = datetime.now(UTC)
    return obj


@pytest.fixture
async def chat_client():
    """채팅 API 테스트용 비동기 HTTP 클라이언트"""
    from app.core.database import get_db
    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test", follow_redirects=True) as client:
        yield client, app, get_db


class TestChatSessionCreate:
    """POST /api/v1/chat/sessions 테스트"""

    @pytest.mark.asyncio
    async def test_create_session_returns_201(self, chat_client) -> None:
        """세션 생성 성공 시 201 반환"""
        client, app, get_db = chat_client

        mock_session_obj = _make_chat_session()
        mock_db = _make_mock_session()

        async def override_get_db():
            yield mock_db

        with patch("app.api.v1.chat.ChatService") as mock_chat_service_cls:
            mock_svc = AsyncMock()
            mock_svc.create_session = AsyncMock(return_value=mock_session_obj)
            mock_chat_service_cls.return_value = mock_svc

            app.dependency_overrides[get_db] = override_get_db
            try:
                resp = await client.post("/api/v1/chat/sessions", json={"title": "새 대화"})
            finally:
                app.dependency_overrides.clear()

        assert resp.status_code == 201

    @pytest.mark.asyncio
    async def test_create_session_with_default_title(self, chat_client) -> None:
        """body 없이 기본 제목으로 세션 생성"""
        client, app, get_db = chat_client

        mock_session_obj = _make_chat_session()
        mock_db = _make_mock_session()

        async def override_get_db():
            yield mock_db

        with patch("app.api.v1.chat.ChatService") as mock_chat_service_cls:
            mock_svc = AsyncMock()
            mock_svc.create_session = AsyncMock(return_value=mock_session_obj)
            mock_chat_service_cls.return_value = mock_svc

            app.dependency_overrides[get_db] = override_get_db
            try:
                resp = await client.post("/api/v1/chat/sessions", json={})
            finally:
                app.dependency_overrides.clear()

        assert resp.status_code == 201


class TestChatSessionList:
    """GET /api/v1/chat/sessions 테스트"""

    @pytest.mark.asyncio
    async def test_list_sessions_returns_200(self, chat_client) -> None:
        """세션 목록 조회 성공 시 200과 리스트 반환"""
        client, app, get_db = chat_client

        sessions = [_make_chat_session("세션1"), _make_chat_session("세션2")]
        mock_db = _make_mock_session()

        async def override_get_db():
            yield mock_db

        with patch("app.api.v1.chat.ChatService") as mock_chat_service_cls:
            mock_svc = AsyncMock()
            mock_svc.list_sessions = AsyncMock(return_value=sessions)
            mock_chat_service_cls.return_value = mock_svc

            app.dependency_overrides[get_db] = override_get_db
            try:
                resp = await client.get("/api/v1/chat/sessions")
            finally:
                app.dependency_overrides.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) == 2

    @pytest.mark.asyncio
    async def test_list_sessions_returns_empty(self, chat_client) -> None:
        """세션 없을 때 빈 리스트와 200 반환"""
        client, app, get_db = chat_client

        mock_db = _make_mock_session()

        async def override_get_db():
            yield mock_db

        with patch("app.api.v1.chat.ChatService") as mock_chat_service_cls:
            mock_svc = AsyncMock()
            mock_svc.list_sessions = AsyncMock(return_value=[])
            mock_chat_service_cls.return_value = mock_svc

            app.dependency_overrides[get_db] = override_get_db
            try:
                resp = await client.get("/api/v1/chat/sessions")
            finally:
                app.dependency_overrides.clear()

        assert resp.status_code == 200
        assert resp.json() == []


class TestChatSessionGet:
    """GET /api/v1/chat/sessions/{session_id} 테스트"""

    @pytest.mark.asyncio
    async def test_get_session_returns_200(self, chat_client) -> None:
        """존재하는 세션 상세 조회 시 200과 메시지 목록 반환"""
        client, app, get_db = chat_client

        session = _make_chat_session("테스트 세션")
        mock_db = _make_mock_session()

        async def override_get_db():
            yield mock_db

        with patch("app.api.v1.chat.ChatService") as mock_chat_service_cls:
            mock_svc = AsyncMock()
            mock_svc.get_session = AsyncMock(return_value=session)
            mock_chat_service_cls.return_value = mock_svc

            app.dependency_overrides[get_db] = override_get_db
            try:
                resp = await client.get(f"/api/v1/chat/sessions/{session.id}")
            finally:
                app.dependency_overrides.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert "messages" in data

    @pytest.mark.asyncio
    async def test_get_nonexistent_session_returns_404(self, chat_client) -> None:
        """존재하지 않는 세션 조회 시 404 반환"""
        client, app, get_db = chat_client

        mock_db = _make_mock_session()

        async def override_get_db():
            yield mock_db

        with patch("app.api.v1.chat.ChatService") as mock_chat_service_cls:
            mock_svc = AsyncMock()
            mock_svc.get_session = AsyncMock(return_value=None)
            mock_chat_service_cls.return_value = mock_svc

            app.dependency_overrides[get_db] = override_get_db
            try:
                resp = await client.get(f"/api/v1/chat/sessions/{uuid.uuid4()}")
            finally:
                app.dependency_overrides.clear()

        assert resp.status_code == 404


class TestChatSessionDelete:
    """DELETE /api/v1/chat/sessions/{session_id} 테스트"""

    @pytest.mark.asyncio
    async def test_delete_session_returns_204(self, chat_client) -> None:
        """존재하는 세션 삭제 시 204 반환"""
        client, app, get_db = chat_client

        session_id = uuid.uuid4()
        mock_db = _make_mock_session()

        async def override_get_db():
            yield mock_db

        with patch("app.api.v1.chat.ChatService") as mock_chat_service_cls:
            mock_svc = AsyncMock()
            mock_svc.delete_session = AsyncMock(return_value=True)
            mock_chat_service_cls.return_value = mock_svc

            app.dependency_overrides[get_db] = override_get_db
            try:
                resp = await client.delete(f"/api/v1/chat/sessions/{session_id}")
            finally:
                app.dependency_overrides.clear()

        assert resp.status_code == 204

    @pytest.mark.asyncio
    async def test_delete_nonexistent_session_returns_404(self, chat_client) -> None:
        """존재하지 않는 세션 삭제 시 404 반환"""
        client, app, get_db = chat_client

        mock_db = _make_mock_session()

        async def override_get_db():
            yield mock_db

        with patch("app.api.v1.chat.ChatService") as mock_chat_service_cls:
            mock_svc = AsyncMock()
            mock_svc.delete_session = AsyncMock(return_value=False)
            mock_chat_service_cls.return_value = mock_svc

            app.dependency_overrides[get_db] = override_get_db
            try:
                resp = await client.delete(f"/api/v1/chat/sessions/{uuid.uuid4()}")
            finally:
                app.dependency_overrides.clear()

        assert resp.status_code == 404


class TestChatMessageSend:
    """POST /api/v1/chat/sessions/{session_id}/messages 테스트"""

    @pytest.mark.asyncio
    async def test_send_message_returns_201(self, chat_client) -> None:
        """메시지 전송 성공 시 201과 응답 반환"""
        client, app, get_db = chat_client

        from app.models.chat import MessageRole

        session = _make_chat_session()
        user_msg = _make_chat_message(session.id, MessageRole.USER, "질문")
        assistant_msg = _make_chat_message(session.id, MessageRole.ASSISTANT, "답변")

        mock_db = _make_mock_session()

        async def override_get_db():
            yield mock_db

        with patch("app.api.v1.chat.ChatService") as mock_chat_service_cls:
            mock_svc = AsyncMock()
            mock_svc.get_session = AsyncMock(return_value=session)
            mock_svc.send_message = AsyncMock(return_value=(user_msg, assistant_msg))
            mock_chat_service_cls.return_value = mock_svc

            app.dependency_overrides[get_db] = override_get_db
            try:
                resp = await client.post(
                    f"/api/v1/chat/sessions/{session.id}/messages",
                    json={"content": "보험 청구 방법이 궁금해요"},
                )
            finally:
                app.dependency_overrides.clear()

        assert resp.status_code == 201
        data = resp.json()
        assert "user_message" in data
        assert "assistant_message" in data

    @pytest.mark.asyncio
    async def test_send_empty_content_returns_422(self, chat_client) -> None:
        """빈 메시지 내용 전송 시 422 반환"""
        from unittest.mock import AsyncMock, MagicMock

        from app.api.v1.chat import get_chat_service

        client, app, get_db = chat_client

        mock_db = _make_mock_session()
        mock_chat_service = AsyncMock()

        async def override_get_db():
            yield mock_db

        def override_get_chat_service():
            return mock_chat_service

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_chat_service] = override_get_chat_service
        try:
            resp = await client.post(
                f"/api/v1/chat/sessions/{uuid.uuid4()}/messages",
                json={"content": ""},
            )
        finally:
            app.dependency_overrides.clear()

        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_send_message_to_nonexistent_session_returns_404(self, chat_client) -> None:
        """존재하지 않는 세션에 메시지 전송 시 404 반환"""
        client, app, get_db = chat_client

        mock_db = _make_mock_session()

        async def override_get_db():
            yield mock_db

        with patch("app.api.v1.chat.ChatService") as mock_chat_service_cls:
            mock_svc = AsyncMock()
            mock_svc.get_session = AsyncMock(return_value=None)
            mock_chat_service_cls.return_value = mock_svc

            app.dependency_overrides[get_db] = override_get_db
            try:
                resp = await client.post(
                    f"/api/v1/chat/sessions/{uuid.uuid4()}/messages",
                    json={"content": "질문"},
                )
            finally:
                app.dependency_overrides.clear()

        assert resp.status_code == 404


class TestChatMessageStream:
    """POST /api/v1/chat/sessions/{session_id}/messages/stream 테스트"""

    @pytest.mark.asyncio
    async def test_stream_returns_event_stream_content_type(self, chat_client) -> None:
        """스트림 엔드포인트가 text/event-stream 반환"""
        client, app, get_db = chat_client

        session = _make_chat_session()
        mock_db = _make_mock_session()

        async def mock_stream_gen():
            yield {"type": "token", "content": "답변"}
            yield {"type": "sources", "content": []}
            yield {"type": "done", "message_id": str(uuid.uuid4())}

        async def override_get_db():
            yield mock_db

        with patch("app.api.v1.chat.ChatService") as mock_chat_service_cls:
            mock_svc = AsyncMock()
            mock_svc.get_session = AsyncMock(return_value=session)
            mock_svc.send_message_stream = MagicMock(return_value=mock_stream_gen())
            mock_chat_service_cls.return_value = mock_svc

            app.dependency_overrides[get_db] = override_get_db
            try:
                resp = await client.post(
                    f"/api/v1/chat/sessions/{session.id}/messages/stream",
                    json={"content": "질문"},
                )
            finally:
                app.dependency_overrides.clear()

        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers.get("content-type", "")
