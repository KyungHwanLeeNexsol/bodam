"""PDF 분석 서비스 Pydantic 스키마 (SPEC-PDF-001 TASK-001)

PDF 업로드, 분석, 쿼리, 세션 관련 요청/응답 스키마를 정의합니다.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class PDFUploadResponse(BaseModel):
    """PDF 업로드 응답 스키마"""

    id: uuid.UUID
    filename: str
    file_size: int
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class PDFAnalyzeRequest(BaseModel):
    """PDF 분석 요청 스키마

    upload_id: 업로드된 PDF ID
    question: 분석 질문 (None이면 초기 보장 분석 수행)
    """

    upload_id: uuid.UUID
    question: str | None = Field(default=None, description="분석 질문 (None이면 초기 커버리지 분석)")


class PDFAnalyzeResponse(BaseModel):
    """PDF 분석 응답 스키마"""

    session_id: uuid.UUID
    analysis: dict[str, Any]
    token_usage: dict[str, Any]

    model_config = {"from_attributes": True}


class PDFQueryRequest(BaseModel):
    """PDF 질의 요청 스키마"""

    question: str = Field(..., min_length=1, description="보험 약관 관련 질문")


class PDFQueryResponse(BaseModel):
    """PDF 질의 응답 스키마"""

    answer: str
    token_usage: dict[str, Any]


class SessionListItem(BaseModel):
    """세션 목록 아이템 스키마"""

    id: uuid.UUID
    title: str
    status: str
    created_at: datetime
    last_activity_at: datetime | None = None

    model_config = {"from_attributes": True}


class MessageItem(BaseModel):
    """메시지 아이템 스키마"""

    id: uuid.UUID
    role: str
    content: str
    token_count: int | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class SessionDetail(BaseModel):
    """세션 상세 스키마"""

    id: uuid.UUID
    title: str
    status: str
    messages: list[MessageItem] = Field(default_factory=list)
    initial_analysis: dict[str, Any] | None = None
    token_usage: dict[str, Any] | None = None
    upload_id: uuid.UUID | None = None

    model_config = {"from_attributes": True}


class UploadStatusResponse(BaseModel):
    """업로드 상태 응답 스키마"""

    id: uuid.UUID
    status: str
    original_filename: str
    file_size: int
    page_count: int | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
