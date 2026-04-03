"""T-001: ChatService에 JITSessionStore 주입 테스트 (SPEC-JIT-002)

get_chat_service 팩토리가 JITSessionStore를 주입하는지 검증.
Redis 가용 여부와 무관하게 ChatService가 생성되어야 함.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.jit_rag.session_store import JITSessionStore


@pytest.mark.asyncio
async def test_get_chat_service_injects_jit_store_when_available() -> None:
    """Redis 가용 시 get_chat_service가 JITSessionStore를 주입해야 함"""
    from app.api.v1.chat import get_chat_service
    from app.services.chat_service import ChatService

    mock_db = AsyncMock()
    mock_settings = MagicMock()
    mock_settings.gemini_api_key = None
    mock_settings.chat_history_limit = 10
    mock_settings.chat_context_top_k = 5
    mock_settings.chat_context_threshold = 0.7

    # JITSessionStore 모의 객체 생성
    mock_jit_store = MagicMock(spec=JITSessionStore)

    # get_session_store 의존성 모의
    with patch("app.api.v1.chat.get_session_store", return_value=mock_jit_store):
        # Depends()를 직접 호출하는 대신 함수를 직접 호출
        service = get_chat_service(
            db=mock_db,
            settings=mock_settings,
            jit_session_store=mock_jit_store,
        )

    assert isinstance(service, ChatService)
    # JIT 스토어가 주입되었는지 확인
    assert service._jit_store is not None
    assert service._jit_store is mock_jit_store


@pytest.mark.asyncio
async def test_get_chat_service_accepts_none_jit_store() -> None:
    """jit_session_store=None이어도 ChatService가 정상 생성되어야 함 (Redis 불가 폴백)"""
    from app.api.v1.chat import get_chat_service
    from app.services.chat_service import ChatService

    mock_db = AsyncMock()
    mock_settings = MagicMock()
    mock_settings.gemini_api_key = None

    service = get_chat_service(
        db=mock_db,
        settings=mock_settings,
        jit_session_store=None,
    )

    assert isinstance(service, ChatService)
    assert service._jit_store is None


def test_get_chat_service_signature_accepts_jit_store_param() -> None:
    """get_chat_service 함수 시그니처에 jit_session_store 파라미터가 있어야 함"""
    import inspect
    from app.api.v1.chat import get_chat_service

    sig = inspect.signature(get_chat_service)
    assert "jit_session_store" in sig.parameters, (
        "get_chat_service에 jit_session_store 파라미터가 없습니다. "
        "JITSessionStore 의존성 주입을 위해 파라미터를 추가해야 합니다."
    )
