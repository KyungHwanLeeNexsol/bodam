"""채팅 API 라우터 모듈

채팅 세션 및 메시지 CRUD 엔드포인트.
SSE 스트리밍 응답 지원.
"""

from __future__ import annotations

import json
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.schemas.chat import (
    ChatMessageCreate,
    ChatMessageResponse,
    ChatSessionCreate,
    ChatSessionDetailResponse,
    ChatSessionListResponse,
    ChatSessionResponse,
    MessageSendResponse,
)
from app.services.chat_service import ChatService

# 채팅 라우터 (prefix: /chat)
router = APIRouter(prefix="/chat", tags=["chat"])


def get_chat_service(
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> ChatService:
    """ChatService 의존성 주입 팩토리

    Args:
        db: 비동기 DB 세션
        settings: 애플리케이션 설정

    Returns:
        ChatService 인스턴스
    """
    return ChatService(db=db, settings=settings)


# ─────────────────────────────────────────────
# 세션 CRUD 엔드포인트
# ─────────────────────────────────────────────


@router.post(
    "/sessions",
    response_model=ChatSessionResponse,
    status_code=201,
    summary="채팅 세션 생성",
)
async def create_session(
    body: ChatSessionCreate = ChatSessionCreate(),
    chat_service: ChatService = Depends(get_chat_service),
) -> ChatSessionResponse:
    """새 채팅 세션을 생성합니다."""
    import logging
    try:
        session = await chat_service.create_session(
            title=body.title,
            user_id=body.user_id,
        )
        return ChatSessionResponse(
            id=session.id,
            title=session.title,
            user_id=session.user_id,
            created_at=session.created_at,
            updated_at=session.updated_at,
        )
    except Exception as e:
        logging.getLogger(__name__).error("create_session failed: %s", e, exc_info=True)
        raise


@router.get(
    "/sessions",
    response_model=list[ChatSessionListResponse],
    status_code=200,
    summary="채팅 세션 목록 조회",
)
async def list_sessions(
    chat_service: ChatService = Depends(get_chat_service),
) -> list[ChatSessionListResponse]:
    """모든 채팅 세션 목록을 최신순으로 반환합니다."""
    sessions = await chat_service.list_sessions()
    return [
        ChatSessionListResponse(
            id=s.id,
            title=s.title,
            user_id=s.user_id,
            created_at=s.created_at,
            updated_at=s.updated_at,
            message_count=len(s.messages) if s.messages else 0,
        )
        for s in sessions
    ]


@router.get(
    "/sessions/{session_id}",
    response_model=ChatSessionDetailResponse,
    status_code=200,
    summary="채팅 세션 상세 조회",
)
async def get_session(
    session_id: uuid.UUID,
    chat_service: ChatService = Depends(get_chat_service),
) -> ChatSessionDetailResponse:
    """채팅 세션 상세 정보와 메시지 목록을 반환합니다."""
    session = await chat_service.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="채팅 세션을 찾을 수 없습니다.")

    messages = [
        ChatMessageResponse(
            id=msg.id,
            session_id=msg.session_id,
            role=str(msg.role),
            content=msg.content,
            metadata=msg.metadata_,
            created_at=msg.created_at,
        )
        for msg in (session.messages or [])
    ]

    return ChatSessionDetailResponse(
        id=session.id,
        title=session.title,
        user_id=session.user_id,
        created_at=session.created_at,
        updated_at=session.updated_at,
        messages=messages,
    )


@router.delete(
    "/sessions/{session_id}",
    status_code=204,
    summary="채팅 세션 삭제",
)
async def delete_session(
    session_id: uuid.UUID,
    chat_service: ChatService = Depends(get_chat_service),
) -> Response:
    """채팅 세션을 삭제합니다. (하위 메시지 포함 cascade 삭제)"""
    deleted = await chat_service.delete_session(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="채팅 세션을 찾을 수 없습니다.")
    return Response(status_code=204)


# ─────────────────────────────────────────────
# 메시지 엔드포인트
# ─────────────────────────────────────────────


@router.post(
    "/sessions/{session_id}/messages",
    response_model=MessageSendResponse,
    status_code=201,
    summary="메시지 전송 (동기)",
)
async def send_message(
    session_id: uuid.UUID,
    body: ChatMessageCreate,
    chat_service: ChatService = Depends(get_chat_service),
) -> MessageSendResponse:
    """메시지를 전송하고 AI 응답을 반환합니다. (RAG 기반)"""
    # 세션 존재 여부 확인
    session = await chat_service.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="채팅 세션을 찾을 수 없습니다.")

    user_msg, assistant_msg = await chat_service.send_message(
        session_id=session_id,
        content=body.content,
    )

    return MessageSendResponse(
        user_message=ChatMessageResponse(
            id=user_msg.id,
            session_id=user_msg.session_id,
            role=str(user_msg.role),
            content=user_msg.content,
            metadata=user_msg.metadata_,
            created_at=user_msg.created_at,
        ),
        assistant_message=ChatMessageResponse(
            id=assistant_msg.id,
            session_id=assistant_msg.session_id,
            role=str(assistant_msg.role),
            content=assistant_msg.content,
            metadata=assistant_msg.metadata_,
            created_at=assistant_msg.created_at,
        ),
    )


logger = logging.getLogger(__name__)


async def _stream_generator(
    chat_service: ChatService,
    session_id: uuid.UUID,
    content: str,
):
    """SSE 스트림 제너레이터

    ChatService.send_message_stream()에서 이벤트를 받아
    SSE 형식(data: {...}\\n\\n)으로 변환하여 yield.
    """
    try:
        async for event in chat_service.send_message_stream(session_id, content):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
    except Exception as e:
        logger.error("스트림 생성 중 오류: %s", str(e))
        yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"


@router.post(
    "/sessions/{session_id}/messages/stream",
    status_code=200,
    summary="메시지 전송 (SSE 스트리밍)",
)
async def stream_message(
    session_id: uuid.UUID,
    body: ChatMessageCreate,
    chat_service: ChatService = Depends(get_chat_service),
) -> StreamingResponse:
    """메시지를 전송하고 AI 응답을 SSE 스트림으로 반환합니다.

    이벤트 형식:
    - token: AI 응답 토큰 조각
    - sources: 참조 약관 출처
    - done: 완료 신호 (message_id 포함)
    - error: 오류 발생 시
    """
    # 세션 존재 여부 확인
    session = await chat_service.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="채팅 세션을 찾을 수 없습니다.")

    return StreamingResponse(
        _stream_generator(chat_service, session_id, body.content),
        media_type="text/event-stream",
    )
