"""PDF 분석 도메인 SQLAlchemy 모델 (SPEC-PDF-001 TASK-002)

PdfUpload, PdfAnalysisSession, PdfAnalysisMessage 모델과
관련 enum을 정의합니다.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy import DateTime, Enum, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class PdfUploadStatus(StrEnum):
    """PDF 업로드 상태 enum

    UPLOADED: 업로드 완료
    ANALYZING: 분석 중
    COMPLETED: 분석 완료
    FAILED: 분석 실패
    EXPIRED: 만료됨
    """

    UPLOADED = "uploaded"
    ANALYZING = "analyzing"
    COMPLETED = "completed"
    FAILED = "failed"
    EXPIRED = "expired"


class PdfSessionStatus(StrEnum):
    """PDF 분석 세션 상태 enum

    ACTIVE: 활성 세션
    EXPIRED: 만료된 세션
    DELETED: 삭제된 세션
    """

    ACTIVE = "active"
    EXPIRED = "expired"
    DELETED = "deleted"


class PdfMessageRole(StrEnum):
    """PDF 분석 메시지 역할 enum"""

    USER = "user"
    ASSISTANT = "assistant"


class PdfUpload(TimestampMixin, Base):
    """PDF 업로드 테이블

    사용자가 업로드한 PDF 파일 메타데이터를 저장합니다.
    파일은 로컬 스토리지에 저장되며, 24시간 후 만료됩니다.
    """

    __tablename__ = "pdf_uploads"

    # 기본 키: UUID
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )

    # 사용자 FK
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # 원본 파일명 (사용자가 업로드한 파일명)
    original_filename: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # 저장된 파일명 (정제된 파일명)
    stored_filename: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # 파일 저장 경로
    file_path: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # 파일 크기 (바이트)
    file_size: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    # SHA256 파일 해시 (중복 감지 및 캐싱에 사용)
    file_hash: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        index=True,
    )

    # MIME 타입
    mime_type: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=sa.text("'application/pdf'"),
    )

    # PDF 페이지 수
    page_count: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    # 업로드 상태
    status: Mapped[PdfUploadStatus] = mapped_column(
        Enum(PdfUploadStatus, name="pdf_upload_status_enum"),
        nullable=False,
        server_default=sa.text("'uploaded'"),
    )

    # 만료 시각 (기본 24시간)
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # 관계: 업로드 -> 분석 세션 목록
    sessions: Mapped[list[PdfAnalysisSession]] = relationship(
        "PdfAnalysisSession",
        back_populates="upload",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return f"<PdfUpload id={self.id} filename={self.original_filename!r} status={self.status}>"


class PdfAnalysisSession(TimestampMixin, Base):
    """PDF 분석 세션 테이블

    사용자와 PDF 분석 AI 간의 대화 세션을 저장합니다.
    하나의 업로드에 여러 세션이 생성될 수 있습니다.
    """

    __tablename__ = "pdf_analysis_sessions"

    # 기본 키: UUID
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )

    # 사용자 FK
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # PDF 업로드 FK
    upload_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("pdf_uploads.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # 세션 제목
    title: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=sa.text("'새 분석'"),
    )

    # 세션 상태
    status: Mapped[PdfSessionStatus] = mapped_column(
        Enum(PdfSessionStatus, name="pdf_session_status_enum"),
        nullable=False,
        server_default=sa.text("'active'"),
    )

    # 초기 보장 분석 결과 (JSONB)
    initial_analysis: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
    )

    # 누적 토큰 사용량 (JSONB)
    token_usage: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
    )

    # 마지막 활동 시각
    last_activity_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # 만료 시각
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # 관계: 세션 -> 업로드
    upload: Mapped[PdfUpload] = relationship("PdfUpload", back_populates="sessions")

    # 관계: 세션 -> 메시지 목록
    messages: Mapped[list[PdfAnalysisMessage]] = relationship(
        "PdfAnalysisMessage",
        back_populates="session",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="PdfAnalysisMessage.created_at",
    )

    def __repr__(self) -> str:
        return f"<PdfAnalysisSession id={self.id} title={self.title!r} status={self.status}>"


class PdfAnalysisMessage(Base):
    """PDF 분석 메시지 테이블

    세션 내 사용자 질문과 AI 응답을 저장합니다.
    메시지는 불변이므로 updated_at 미포함.
    """

    __tablename__ = "pdf_analysis_messages"

    # 기본 키: UUID
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )

    # 분석 세션 FK
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("pdf_analysis_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # 메시지 역할 (user / assistant)
    role: Mapped[PdfMessageRole] = mapped_column(
        Enum(PdfMessageRole, name="pdf_message_role_enum"),
        nullable=False,
    )

    # 메시지 내용
    content: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # 토큰 수
    token_count: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    # 생성 시각
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # 관계: 메시지 -> 세션
    session: Mapped[PdfAnalysisSession] = relationship(
        "PdfAnalysisSession",
        back_populates="messages",
    )

    def __repr__(self) -> str:
        return f"<PdfAnalysisMessage id={self.id} role={self.role} session_id={self.session_id}>"
