"""SPEC-CHAT-PERF-001 잔여 Gap TDD 테스트

T-001/T-002: list_sessions 엔드포인트가 인증된 user_id를 서비스로 전달하는지 검증
T-003/T-004: list_sessions 실행 시 SQL 쿼리 수가 최대 2개인지 검증
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

# ─────────────────────────────────────────────────────────────
# T-001: list_sessions 라우터가 user_id를 서비스로 전달해야 함 (RED)
# ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_sessions_router_passes_user_id_to_service() -> None:
    """인증된 사용자의 user_id가 chat_service.list_sessions()로 전달되어야 함.

    라우터가 get_current_user 의존성으로부터 user_id를 획득하고
    chat_service.list_sessions(user_id=...) 호출 시 전달해야 함.
    """
    from app.api.v1.chat import list_sessions
    from app.models.user import User

    # 인증된 사용자 mock
    test_user_id = uuid.uuid4()
    mock_user = MagicMock(spec=User)
    mock_user.id = test_user_id

    # ChatService mock
    mock_service = AsyncMock()
    mock_service.list_sessions.return_value = ([], 0)

    # 라우터 핸들러를 직접 호출 (current_user 파라미터 포함 여부 테스트)
    import inspect

    sig = inspect.signature(list_sessions)
    assert "current_user" in sig.parameters, (
        "list_sessions 엔드포인트에 current_user 파라미터가 없습니다. "
        "get_current_user 의존성을 추가해야 합니다."
    )


@pytest.mark.asyncio
async def test_list_sessions_calls_service_with_user_id() -> None:
    """list_sessions 라우터 호출 시 service.list_sessions(user_id=user.id)를 전달해야 함."""
    from app.api.v1.chat import list_sessions
    from app.models.user import User

    # 인증된 사용자 mock
    test_user_id = uuid.uuid4()
    mock_user = MagicMock(spec=User)
    mock_user.id = test_user_id

    # ChatService mock
    mock_service = AsyncMock()
    mock_service.list_sessions.return_value = ([], 0)

    # current_user를 직접 주입하여 라우터 함수 호출
    await list_sessions(
        limit=20,
        offset=0,
        chat_service=mock_service,
        current_user=mock_user,
    )

    # user_id가 서비스로 전달되었는지 검증
    mock_service.list_sessions.assert_called_once_with(
        limit=20,
        offset=0,
        user_id=test_user_id,
    )


# ─────────────────────────────────────────────────────────────
# T-002: list_sessions 라우터 시그니처에 get_current_user 의존성 확인
# ─────────────────────────────────────────────────────────────


def test_list_sessions_has_get_current_user_dependency() -> None:
    """list_sessions 엔드포인트 파라미터에 get_current_user 의존성이 있어야 함."""
    import inspect

    from app.api.v1.chat import list_sessions

    sig = inspect.signature(list_sessions)

    # current_user 파라미터 존재 확인
    assert "current_user" in sig.parameters, (
        "list_sessions에 current_user 파라미터가 없습니다."
    )

    # Depends()를 통한 의존성 주입 확인
    param = sig.parameters["current_user"]
    assert param.default is not inspect.Parameter.empty, (
        "current_user 파라미터에 Depends() 기본값이 없습니다."
    )


# ─────────────────────────────────────────────────────────────
# T-003: list_sessions 실행 시 SQL 쿼리 수 최대 2개 검증
# ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_sessions_executes_at_most_two_sql_queries() -> None:
    """ChatService.list_sessions()가 최대 2개의 SQL 쿼리만 실행해야 함.

    1번째 쿼리: 세션 목록 + COUNT 서브쿼리
    2번째 쿼리: 전체 개수 COUNT
    """
    from app.services.chat_service import ChatService

    # SQL 실행 추적을 위한 카운터
    query_count = 0

    class QueryCountingResult:
        """SQL 실행 횟수를 추적하는 mock result"""

        def all(self):
            return []

        def scalar_one(self):
            return 0

    # DB 세션 mock (execute 호출 횟수 추적)
    mock_db = AsyncMock()

    async def counting_execute(stmt, *args, **kwargs):
        nonlocal query_count
        query_count += 1
        return QueryCountingResult()

    mock_db.execute = counting_execute

    # ChatService 인스턴스 생성 (settings mock)
    mock_settings = MagicMock()
    mock_settings.chat_history_limit = 10
    mock_settings.chat_context_top_k = 5
    mock_settings.chat_context_threshold = 0.7
    mock_settings.gemini_api_key = None

    service = ChatService(
        db=mock_db,
        settings=mock_settings,
        jit_session_store=None,
    )

    # list_sessions 실행
    await service.list_sessions(limit=20, offset=0)

    # SQL 쿼리 수 검증 (최대 2개)
    assert query_count <= 2, (
        f"list_sessions가 {query_count}개의 SQL 쿼리를 실행했습니다. "
        f"최대 2개(목록 쿼리 + 카운트 쿼리)만 허용됩니다."
    )


# ─────────────────────────────────────────────────────────────
# T-004: user_id 필터 적용 시에도 SQL 쿼리 수 최대 2개 유지
# ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_sessions_with_user_id_filter_executes_at_most_two_queries() -> None:
    """user_id 필터 조건에서도 최대 2개의 SQL 쿼리만 실행되어야 함."""
    from app.services.chat_service import ChatService

    query_count = 0

    class QueryCountingResult:
        def all(self):
            return []

        def scalar_one(self):
            return 0

    mock_db = AsyncMock()

    async def counting_execute(stmt, *args, **kwargs):
        nonlocal query_count
        query_count += 1
        return QueryCountingResult()

    mock_db.execute = counting_execute

    mock_settings = MagicMock()
    mock_settings.chat_history_limit = 10
    mock_settings.chat_context_top_k = 5
    mock_settings.chat_context_threshold = 0.7
    mock_settings.gemini_api_key = None

    service = ChatService(
        db=mock_db,
        settings=mock_settings,
        jit_session_store=None,
    )

    test_user_id = uuid.uuid4()
    await service.list_sessions(limit=20, offset=0, user_id=test_user_id)

    assert query_count <= 2, (
        f"user_id 필터 적용 시 {query_count}개의 SQL 쿼리가 실행되었습니다. "
        f"최대 2개만 허용됩니다."
    )
