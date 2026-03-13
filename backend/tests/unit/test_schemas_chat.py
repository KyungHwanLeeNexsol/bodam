"""채팅 도메인 Pydantic 스키마 단위 테스트

ChatSession, ChatMessage 관련 스키마의 유효성 검사와 직렬화를 검증.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from app.schemas.chat import (
    ChatMessageCreate,
    ChatMessageResponse,
    ChatSessionCreate,
    ChatSessionDetailResponse,
    ChatSessionListResponse,
    ChatSessionResponse,
    MessageSendResponse,
)


class TestChatSessionCreate:
    """ChatSessionCreate 스키마 테스트"""

    def test_create_with_defaults(self) -> None:
        """아무 인수 없이 기본값 사용"""
        schema = ChatSessionCreate()
        assert schema.title == "새 대화"
        assert schema.user_id is None

    def test_create_with_custom_title(self) -> None:
        """사용자 지정 제목으로 생성"""
        schema = ChatSessionCreate(title="암 보험 문의")
        assert schema.title == "암 보험 문의"

    def test_create_with_user_id(self) -> None:
        """user_id 포함 생성"""
        schema = ChatSessionCreate(user_id="user-abc")
        assert schema.user_id == "user-abc"


class TestChatSessionResponse:
    """ChatSessionResponse 스키마 테스트"""

    def test_create_from_dict(self) -> None:
        """딕셔너리로부터 생성"""
        now = datetime.now(UTC)
        data = {
            "id": uuid.uuid4(),
            "title": "새 대화",
            "user_id": None,
            "created_at": now,
            "updated_at": now,
        }
        schema = ChatSessionResponse(**data)
        assert schema.title == "새 대화"
        assert schema.user_id is None

    def test_id_is_uuid_type(self) -> None:
        """id 필드가 UUID 타입인지 검증"""
        now = datetime.now(UTC)
        session_id = uuid.uuid4()
        schema = ChatSessionResponse(
            id=session_id,
            title="테스트",
            user_id=None,
            created_at=now,
            updated_at=now,
        )
        assert schema.id == session_id
        assert isinstance(schema.id, uuid.UUID)


class TestChatSessionListResponse:
    """ChatSessionListResponse 스키마 테스트"""

    def test_includes_message_count(self) -> None:
        """message_count 필드 포함 여부"""
        now = datetime.now(UTC)
        schema = ChatSessionListResponse(
            id=uuid.uuid4(),
            title="대화 목록",
            user_id=None,
            created_at=now,
            updated_at=now,
            message_count=5,
        )
        assert schema.message_count == 5


class TestChatMessageCreate:
    """ChatMessageCreate 스키마 테스트"""

    def test_create_valid_message(self) -> None:
        """정상 메시지 내용으로 생성"""
        schema = ChatMessageCreate(content="보험 청구 방법을 알고 싶어요")
        assert schema.content == "보험 청구 방법을 알고 싶어요"

    def test_empty_content_validation_fails(self) -> None:
        """빈 문자열 내용은 유효성 검사 실패"""
        with pytest.raises(Exception):
            ChatMessageCreate(content="")

    def test_content_exceeds_max_length_fails(self) -> None:
        """5000자 초과 내용은 유효성 검사 실패"""
        long_content = "a" * 5001
        with pytest.raises(Exception):
            ChatMessageCreate(content=long_content)

    def test_content_at_max_length_allowed(self) -> None:
        """정확히 5000자는 허용"""
        max_content = "a" * 5000
        schema = ChatMessageCreate(content=max_content)
        assert len(schema.content) == 5000


class TestChatMessageResponse:
    """ChatMessageResponse 스키마 테스트"""

    def test_create_message_response(self) -> None:
        """메시지 응답 스키마 생성"""
        now = datetime.now(UTC)
        schema = ChatMessageResponse(
            id=uuid.uuid4(),
            session_id=uuid.uuid4(),
            role="user",
            content="안녕하세요",
            metadata=None,
            created_at=now,
        )
        assert schema.role == "user"
        assert schema.content == "안녕하세요"
        assert schema.metadata is None

    def test_metadata_as_dict(self) -> None:
        """metadata가 딕셔너리인 경우"""
        now = datetime.now(UTC)
        schema = ChatMessageResponse(
            id=uuid.uuid4(),
            session_id=uuid.uuid4(),
            role="assistant",
            content="답변",
            metadata={"model": "gpt-4o-mini"},
            created_at=now,
        )
        assert schema.metadata == {"model": "gpt-4o-mini"}


class TestChatSessionDetailResponse:
    """ChatSessionDetailResponse 스키마 테스트"""

    def test_includes_empty_messages(self) -> None:
        """messages 리스트 필드 포함 여부"""
        now = datetime.now(UTC)
        schema = ChatSessionDetailResponse(
            id=uuid.uuid4(),
            title="상세 대화",
            user_id=None,
            created_at=now,
            updated_at=now,
            messages=[],
        )
        assert schema.messages == []

    def test_includes_messages(self) -> None:
        """messages 리스트에 메시지 포함"""
        now = datetime.now(UTC)
        msg = ChatMessageResponse(
            id=uuid.uuid4(),
            session_id=uuid.uuid4(),
            role="user",
            content="질문",
            metadata=None,
            created_at=now,
        )
        schema = ChatSessionDetailResponse(
            id=uuid.uuid4(),
            title="대화",
            user_id=None,
            created_at=now,
            updated_at=now,
            messages=[msg],
        )
        assert len(schema.messages) == 1


class TestMessageSendResponse:
    """MessageSendResponse 스키마 테스트"""

    def test_includes_both_messages(self) -> None:
        """user_message와 assistant_message 모두 포함"""
        now = datetime.now(UTC)
        session_id = uuid.uuid4()
        user_msg = ChatMessageResponse(
            id=uuid.uuid4(),
            session_id=session_id,
            role="user",
            content="질문",
            metadata=None,
            created_at=now,
        )
        assistant_msg = ChatMessageResponse(
            id=uuid.uuid4(),
            session_id=session_id,
            role="assistant",
            content="답변",
            metadata=None,
            created_at=now,
        )
        schema = MessageSendResponse(
            user_message=user_msg,
            assistant_message=assistant_msg,
        )
        assert schema.user_message.role == "user"
        assert schema.assistant_message.role == "assistant"
