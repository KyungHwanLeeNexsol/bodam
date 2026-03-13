"""채팅 도메인 모델 단위 테스트

ChatSession, ChatMessage, MessageRole 모델의 구조와 기본 동작을 검증.
실제 DB 연결 없이 모델 클래스 구조만 테스트.
"""

from __future__ import annotations

import uuid

from app.models.chat import ChatMessage, ChatSession, MessageRole


class TestMessageRole:
    """MessageRole StrEnum 테스트"""

    def test_user_role_value(self) -> None:
        """user 역할 값 검증"""
        assert MessageRole.USER == "user"

    def test_assistant_role_value(self) -> None:
        """assistant 역할 값 검증"""
        assert MessageRole.ASSISTANT == "assistant"

    def test_system_role_value(self) -> None:
        """system 역할 값 검증"""
        assert MessageRole.SYSTEM == "system"

    def test_role_count(self) -> None:
        """역할 총 개수 검증 (3개)"""
        assert len(MessageRole) == 3

    def test_role_string_comparison(self) -> None:
        """StrEnum 문자열 비교 가능 여부 검증"""
        assert MessageRole.USER == "user"
        assert str(MessageRole.ASSISTANT) == "assistant"


class TestChatSession:
    """ChatSession 모델 테스트"""

    def test_tablename(self) -> None:
        """테이블명 검증"""
        assert ChatSession.__tablename__ == "chat_sessions"

    def test_create_with_default_title(self) -> None:
        """기본 제목 '새 대화'로 인스턴스 생성"""
        session = ChatSession()
        assert session.title == "새 대화"

    def test_create_with_custom_title(self) -> None:
        """사용자 지정 제목으로 인스턴스 생성"""
        session = ChatSession(title="보험 청구 문의")
        assert session.title == "보험 청구 문의"

    def test_set_user_id(self) -> None:
        """user_id 설정 검증"""
        session = ChatSession(user_id="user-123")
        assert session.user_id == "user-123"

    def test_create_without_user_id(self) -> None:
        """user_id 없이 생성 (nullable)"""
        session = ChatSession()
        assert session.user_id is None

    def test_messages_relationship_exists(self) -> None:
        """messages 관계 속성 존재 여부"""
        assert hasattr(ChatSession, "messages")

    def test_id_column_exists(self) -> None:
        """id 컬럼 존재 여부"""
        assert hasattr(ChatSession, "id")

    def test_title_column_exists(self) -> None:
        """title 컬럼 존재 여부"""
        assert hasattr(ChatSession, "title")

    def test_created_at_column_exists(self) -> None:
        """TimestampMixin의 created_at 컬럼 존재 여부"""
        assert hasattr(ChatSession, "created_at")

    def test_updated_at_column_exists(self) -> None:
        """TimestampMixin의 updated_at 컬럼 존재 여부"""
        assert hasattr(ChatSession, "updated_at")


class TestChatMessage:
    """ChatMessage 모델 테스트"""

    def test_tablename(self) -> None:
        """테이블명 검증"""
        assert ChatMessage.__tablename__ == "chat_messages"

    def test_create_with_role_and_content(self) -> None:
        """role과 content로 메시지 인스턴스 생성"""
        session_id = uuid.uuid4()
        msg = ChatMessage(
            session_id=session_id,
            role=MessageRole.USER,
            content="안녕하세요",
        )
        assert msg.role == MessageRole.USER
        assert msg.content == "안녕하세요"
        assert msg.session_id == session_id

    def test_create_assistant_message(self) -> None:
        """assistant 역할 메시지 생성"""
        msg = ChatMessage(
            session_id=uuid.uuid4(),
            role=MessageRole.ASSISTANT,
            content="안녕하세요! 보험 관련 도움이 필요하신가요?",
        )
        assert msg.role == MessageRole.ASSISTANT

    def test_set_metadata(self) -> None:
        """metadata JSONB 필드 설정"""
        metadata = {"model": "gpt-4o-mini", "sources": []}
        msg = ChatMessage(
            session_id=uuid.uuid4(),
            role=MessageRole.ASSISTANT,
            content="답변입니다",
            metadata_=metadata,
        )
        assert msg.metadata_ == metadata

    def test_metadata_default_none(self) -> None:
        """metadata 기본값은 None"""
        msg = ChatMessage(
            session_id=uuid.uuid4(),
            role=MessageRole.USER,
            content="질문",
        )
        assert msg.metadata_ is None

    def test_id_column_exists(self) -> None:
        """id 컬럼 존재 여부"""
        assert hasattr(ChatMessage, "id")

    def test_session_id_column_exists(self) -> None:
        """session_id FK 컬럼 존재 여부"""
        assert hasattr(ChatMessage, "session_id")

    def test_role_column_exists(self) -> None:
        """role 컬럼 존재 여부"""
        assert hasattr(ChatMessage, "role")

    def test_content_column_exists(self) -> None:
        """content 컬럼 존재 여부"""
        assert hasattr(ChatMessage, "content")

    def test_created_at_column_exists(self) -> None:
        """created_at 컬럼 존재 여부"""
        assert hasattr(ChatMessage, "created_at")
