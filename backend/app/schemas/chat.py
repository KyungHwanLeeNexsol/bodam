"""채팅 도메인 Pydantic 스키마

API 요청/응답 직렬화 및 유효성 검사.
from_attributes=True로 SQLAlchemy 모델과 호환.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.sanitize import sanitize_input

# ─────────────────────────────────────────────
# ChatSession 스키마
# ─────────────────────────────────────────────


class ChatSessionCreate(BaseModel):
    """채팅 세션 생성 요청 스키마"""

    # 세션 제목 (기본값: '새 대화')
    title: str = "새 대화"

    # 사용자 식별자 (선택)
    user_id: str | None = None


class ChatSessionResponse(BaseModel):
    """채팅 세션 응답 스키마"""

    id: uuid.UUID
    title: str
    user_id: str | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ChatSessionListResponse(BaseModel):
    """채팅 세션 목록 응답 스키마 (메시지 수 포함)"""

    id: uuid.UUID
    title: str
    user_id: str | None
    created_at: datetime
    updated_at: datetime
    # 세션 내 메시지 수 (SQL COUNT 서브쿼리에서 산출)
    message_count: int

    model_config = ConfigDict(from_attributes=True)


class PaginatedSessionListResponse(BaseModel):
    """페이지네이션된 채팅 세션 목록 응답 스키마 (SPEC-CHAT-PERF-001)

    SQL COUNT 서브쿼리 기반으로 성능 최적화된 세션 목록 응답.
    limit/offset 페이지네이션 메타데이터 포함.
    """

    # 현재 페이지 세션 목록
    sessions: list[ChatSessionListResponse]
    # 전체 세션 수 (필터 적용 후)
    total_count: int
    # 다음 페이지 존재 여부
    has_more: bool


# ─────────────────────────────────────────────
# ChatMessage 스키마
# ─────────────────────────────────────────────


class ChatMessageCreate(BaseModel):
    """채팅 메시지 생성 요청 스키마"""

    # 메시지 내용 (1자 이상, 5000자 이하)
    content: str = Field(..., min_length=1, max_length=5000)

    @field_validator("content", mode="before")
    @classmethod
    def validate_content_no_xss(cls, v: str) -> str:
        """content에서 XSS 패턴을 검사한다"""
        result = sanitize_input(v)
        return result if result is not None else v


class ChatMessageResponse(BaseModel):
    """채팅 메시지 응답 스키마"""

    id: uuid.UUID
    session_id: uuid.UUID
    role: str
    content: str
    # 추가 메타데이터 (AI 모델명, 출처 목록 등)
    metadata: dict | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def from_orm_model(cls, msg: object) -> ChatMessageResponse:
        """ORM 모델에서 스키마 변환 (metadata_ -> metadata 매핑)"""
        return cls(
            id=msg.id,
            session_id=msg.session_id,
            role=str(msg.role),
            content=msg.content,
            metadata=getattr(msg, "metadata_", None),
            created_at=msg.created_at,
        )


# ─────────────────────────────────────────────
# 복합 응답 스키마
# ─────────────────────────────────────────────


class ChatSessionDetailResponse(BaseModel):
    """채팅 세션 상세 응답 스키마 (메시지 목록 포함)"""

    id: uuid.UUID
    title: str
    user_id: str | None
    created_at: datetime
    updated_at: datetime
    # 세션 내 모든 메시지
    messages: list[ChatMessageResponse]

    model_config = ConfigDict(from_attributes=True)


class MessageSendResponse(BaseModel):
    """메시지 전송 응답 스키마 (사용자 메시지 + AI 응답)"""

    # 사용자가 보낸 메시지
    user_message: ChatMessageResponse

    # AI가 생성한 응답 메시지
    assistant_message: ChatMessageResponse
