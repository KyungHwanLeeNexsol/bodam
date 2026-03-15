"""채팅 도메인 SQLAlchemy 모델

ChatSession, ChatMessage 모델과 MessageRole enum을 정의.
RAG 기반 AI 채팅 세션 관리를 위한 테이블 구조.
"""

from __future__ import annotations

import uuid
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy import DateTime, Enum, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class MessageRole(StrEnum):
    """채팅 메시지 역할

    USER: 사용자가 보낸 메시지
    ASSISTANT: AI가 생성한 메시지
    SYSTEM: 시스템 프롬프트 메시지
    """

    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class ChatSession(TimestampMixin, Base):
    """채팅 세션 테이블

    사용자와 AI 간의 대화 세션.
    하나의 세션은 여러 메시지(ChatMessage)를 포함.
    """

    __tablename__ = "chat_sessions"

    # 기본 키: UUID (서버 기본값)
    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )

    # 세션 제목 (기본값: '새 대화')
    title: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=sa.text("'새 대화'"),
    )

    # 사용자 식별자 (nullable: 비로그인 사용자 지원)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        nullable=True,
    )

    def __init__(self, title: str = "새 대화", user_id: str | uuid.UUID | None = None, **kwargs):
        """ChatSession 초기화 (Python 레벨 기본값 설정)

        Args:
            title: 세션 제목 (기본값: '새 대화')
            user_id: 사용자 식별자 (선택)
        """
        super().__init__(title=title, user_id=user_id, **kwargs)

    # 관계: 세션 -> 메시지 목록 (cascade 삭제, selectin 로딩)
    messages: Mapped[list[ChatMessage]] = relationship(
        "ChatMessage",
        back_populates="session",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="ChatMessage.created_at",
    )

    def __repr__(self) -> str:
        return f"<ChatSession id={self.id} title={self.title!r}>"


class ChatMessage(Base):
    """채팅 메시지 테이블

    세션 내 개별 메시지. 사용자 입력과 AI 응답을 모두 저장.
    메시지는 변경되지 않으므로 updated_at 미포함.
    """

    __tablename__ = "chat_messages"

    # 기본 키: UUID (서버 기본값)
    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )

    # FK: 소속 세션 (CASCADE 삭제)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chat_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )

    # 메시지 역할 (user / assistant / system)
    role: Mapped[MessageRole] = mapped_column(
        Enum(MessageRole, name="message_role_enum", values_callable=lambda e: [x.value for x in e]),
        nullable=False,
    )

    # 메시지 본문 텍스트
    content: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # 추가 메타데이터 (JSONB: AI 모델명, 출처 목록 등)
    # 컬럼명은 "metadata", Python 속성명은 metadata_
    metadata_: Mapped[dict | None] = mapped_column(
        "metadata",
        JSONB,
        nullable=True,
    )

    # 생성 시각 (메시지는 불변이므로 updated_at 없음)
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # 관계: 메시지 -> 세션
    session: Mapped[ChatSession] = relationship("ChatSession", back_populates="messages")

    def __repr__(self) -> str:
        return f"<ChatMessage id={self.id} role={self.role} session_id={self.session_id}>"
