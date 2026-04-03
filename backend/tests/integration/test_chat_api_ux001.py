"""SPEC-CHAT-UX-001 채팅 API 통합 테스트 (RED 단계)

테스트 대상:
- PATCH /api/v1/chat/sessions/{session_id}: 세션 제목 업데이트
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient


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


@pytest.fixture
async def chat_client():
    """채팅 API 테스트용 비동기 HTTP 클라이언트"""
    from app.core.database import get_db
    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test", follow_redirects=True) as client:
        yield client, app, get_db


class TestPatchSessionTitle:
    """PATCH /api/v1/chat/sessions/{session_id} 테스트"""

    @pytest.mark.asyncio
    async def test_patch_session_returns_updated_title(self, chat_client) -> None:
        """세션 제목 업데이트 성공 시 200과 업데이트된 제목 반환"""
        client, app, get_db = chat_client

        session_id = uuid.uuid4()
        original_session = _make_chat_session("기존 제목")
        original_session.id = session_id

        updated_session = _make_chat_session("새로운 제목")
        updated_session.id = session_id

        mock_db = AsyncMock()

        async def override_get_db():
            yield mock_db

        with patch("app.api.v1.chat.ChatService") as mock_chat_service_cls:
            mock_svc = AsyncMock()
            mock_svc.get_session = AsyncMock(return_value=original_session)
            mock_svc.update_session_title = AsyncMock(return_value=updated_session)
            mock_chat_service_cls.return_value = mock_svc

            app.dependency_overrides[get_db] = override_get_db
            try:
                resp = await client.patch(
                    f"/api/v1/chat/sessions/{session_id}",
                    json={"title": "새로운 제목"},
                )
            finally:
                app.dependency_overrides.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == "새로운 제목"

    @pytest.mark.asyncio
    async def test_patch_session_returns_404_for_missing_session(
        self, chat_client
    ) -> None:
        """존재하지 않는 세션 ID로 PATCH 시 404 반환"""
        client, app, get_db = chat_client

        session_id = uuid.uuid4()
        mock_db = AsyncMock()

        async def override_get_db():
            yield mock_db

        with patch("app.api.v1.chat.ChatService") as mock_chat_service_cls:
            mock_svc = AsyncMock()
            mock_svc.get_session = AsyncMock(return_value=None)
            mock_chat_service_cls.return_value = mock_svc

            app.dependency_overrides[get_db] = override_get_db
            try:
                resp = await client.patch(
                    f"/api/v1/chat/sessions/{session_id}",
                    json={"title": "새 제목"},
                )
            finally:
                app.dependency_overrides.clear()

        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_patch_session_with_none_title_does_not_update(
        self, chat_client
    ) -> None:
        """title이 null인 경우 update_session_title 미호출, 기존 세션 반환"""
        client, app, get_db = chat_client

        session_id = uuid.uuid4()
        mock_session = _make_chat_session("기존 제목")
        mock_session.id = session_id

        mock_db = AsyncMock()

        async def override_get_db():
            yield mock_db

        with patch("app.api.v1.chat.ChatService") as mock_chat_service_cls:
            mock_svc = AsyncMock()
            mock_svc.get_session = AsyncMock(return_value=mock_session)
            mock_svc.update_session_title = AsyncMock()
            mock_chat_service_cls.return_value = mock_svc

            app.dependency_overrides[get_db] = override_get_db
            try:
                resp = await client.patch(
                    f"/api/v1/chat/sessions/{session_id}",
                    json={"title": None},
                )
            finally:
                app.dependency_overrides.clear()

        assert resp.status_code == 200
        mock_svc.update_session_title.assert_not_called()

    @pytest.mark.asyncio
    async def test_patch_session_title_max_length_50(self, chat_client) -> None:
        """50자 이하 제목은 성공, 51자 이상은 422 반환"""
        client, app, get_db = chat_client

        session_id = uuid.uuid4()
        mock_session = _make_chat_session("기존 제목")
        mock_session.id = session_id
        updated_session = _make_chat_session("A" * 50)
        updated_session.id = session_id

        mock_db = AsyncMock()

        async def override_get_db():
            yield mock_db

        with patch("app.api.v1.chat.ChatService") as mock_chat_service_cls:
            mock_svc = AsyncMock()
            mock_svc.get_session = AsyncMock(return_value=mock_session)
            mock_svc.update_session_title = AsyncMock(return_value=updated_session)
            mock_chat_service_cls.return_value = mock_svc

            app.dependency_overrides[get_db] = override_get_db
            try:
                # 50자 정확히 → 성공
                resp_ok = await client.patch(
                    f"/api/v1/chat/sessions/{session_id}",
                    json={"title": "A" * 50},
                )
                # 51자 → 422
                resp_fail = await client.patch(
                    f"/api/v1/chat/sessions/{session_id}",
                    json={"title": "A" * 51},
                )
            finally:
                app.dependency_overrides.clear()

        assert resp_ok.status_code == 200
        assert resp_fail.status_code == 422

    @pytest.mark.asyncio
    async def test_patch_session_returns_session_fields(self, chat_client) -> None:
        """응답에 id, title, user_id, created_at, updated_at 필드 포함"""
        client, app, get_db = chat_client

        session_id = uuid.uuid4()
        original_session = _make_chat_session("기존")
        original_session.id = session_id

        updated_session = _make_chat_session("업데이트된 제목")
        updated_session.id = session_id

        mock_db = AsyncMock()

        async def override_get_db():
            yield mock_db

        with patch("app.api.v1.chat.ChatService") as mock_chat_service_cls:
            mock_svc = AsyncMock()
            mock_svc.get_session = AsyncMock(return_value=original_session)
            mock_svc.update_session_title = AsyncMock(return_value=updated_session)
            mock_chat_service_cls.return_value = mock_svc

            app.dependency_overrides[get_db] = override_get_db
            try:
                resp = await client.patch(
                    f"/api/v1/chat/sessions/{session_id}",
                    json={"title": "업데이트된 제목"},
                )
            finally:
                app.dependency_overrides.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert "id" in data
        assert "title" in data
        assert "user_id" in data
        assert "created_at" in data
        assert "updated_at" in data
