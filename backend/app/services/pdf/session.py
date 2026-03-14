"""PDF 세션 서비스 (SPEC-PDF-001 TASK-009/010)

PDF 분석 세션의 생성, 조회, 삭제 및 메시지 관리를 담당합니다.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.pdf import PdfAnalysisMessage, PdfAnalysisSession, PdfSessionStatus, PdfUpload

logger = logging.getLogger(__name__)


class PDFSessionService:
    """PDF 분석 세션 서비스

    세션 생명주기 관리 및 메시지 CRUD를 제공합니다.
    """

    # 사용자당 최대 세션 수
    MAX_SESSIONS_PER_USER = 5

    # 세션 만료 시간 (시간)
    SESSION_EXPIRY_HOURS = 24

    async def create(
        self,
        user_id: str,
        upload_id: str,
        title: str,
        db: AsyncSession,
    ) -> PdfAnalysisSession:
        """새 분석 세션 생성

        Args:
            user_id: 사용자 ID
            upload_id: PDF 업로드 ID
            title: 세션 제목
            db: 비동기 DB 세션

        Returns:
            생성된 PdfAnalysisSession 객체

        Raises:
            HTTPException 429: 세션 수 초과 시
        """
        await self.check_session_limit(user_id=user_id, db=db)

        from datetime import timedelta

        expires_at = datetime.now(UTC) + timedelta(hours=self.SESSION_EXPIRY_HOURS)

        session = PdfAnalysisSession(
            user_id=uuid.UUID(user_id),
            upload_id=uuid.UUID(upload_id),
            title=title,
            status=PdfSessionStatus.ACTIVE,
            expires_at=expires_at,
            last_activity_at=datetime.now(UTC),
        )

        db.add(session)
        await db.flush()
        await db.refresh(session)

        logger.info("분석 세션 생성", extra={"session_id": str(session.id), "user_id": user_id})
        return session

    async def get(
        self,
        session_id: str,
        user_id: str,
        db: AsyncSession,
    ) -> PdfAnalysisSession:
        """세션 조회

        Args:
            session_id: 세션 ID
            user_id: 사용자 ID (소유자 확인용)
            db: 비동기 DB 세션

        Returns:
            PdfAnalysisSession 객체

        Raises:
            HTTPException 404: 세션 미존재 또는 소유자 불일치
        """
        result = await db.execute(
            sa.select(PdfAnalysisSession).where(
                PdfAnalysisSession.id == uuid.UUID(session_id),
                PdfAnalysisSession.user_id == uuid.UUID(user_id),
                PdfAnalysisSession.status != PdfSessionStatus.DELETED,
            )
        )
        session = result.scalar_one_or_none()

        if session is None:
            raise HTTPException(
                status_code=404,
                detail="분석 세션을 찾을 수 없습니다.",
            )

        return session

    async def list_by_user(
        self,
        user_id: str,
        db: AsyncSession,
    ) -> list[PdfAnalysisSession]:
        """사용자의 세션 목록 조회 (최신순)

        Args:
            user_id: 사용자 ID
            db: 비동기 DB 세션

        Returns:
            세션 목록 (created_at 내림차순)
        """
        result = await db.execute(
            sa.select(PdfAnalysisSession)
            .where(
                PdfAnalysisSession.user_id == uuid.UUID(user_id),
                PdfAnalysisSession.status != PdfSessionStatus.DELETED,
            )
            .order_by(PdfAnalysisSession.created_at.desc())
        )
        return list(result.scalars().all())

    async def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        token_count: int,
        db: AsyncSession,
    ) -> PdfAnalysisMessage:
        """세션에 메시지 추가

        Args:
            session_id: 세션 ID
            role: 메시지 역할 (user/assistant)
            content: 메시지 내용
            token_count: 토큰 수
            db: 비동기 DB 세션

        Returns:
            생성된 PdfAnalysisMessage 객체
        """
        from app.models.pdf import PdfMessageRole

        message = PdfAnalysisMessage(
            session_id=uuid.UUID(session_id),
            role=PdfMessageRole(role),
            content=content,
            token_count=token_count,
        )

        db.add(message)
        await db.flush()
        await db.refresh(message)

        # 세션 마지막 활동 시각 업데이트
        await db.execute(
            sa.update(PdfAnalysisSession)
            .where(PdfAnalysisSession.id == uuid.UUID(session_id))
            .values(last_activity_at=datetime.now(UTC))
        )

        return message

    async def get_conversation_history(
        self,
        session_id: str,
        db: AsyncSession,
    ) -> list[dict]:
        """세션의 대화 이력 조회

        Args:
            session_id: 세션 ID
            db: 비동기 DB 세션

        Returns:
            대화 이력 딕셔너리 목록
        """
        result = await db.execute(
            sa.select(PdfAnalysisMessage)
            .where(PdfAnalysisMessage.session_id == uuid.UUID(session_id))
            .order_by(PdfAnalysisMessage.created_at)
        )
        messages = result.scalars().all()

        return [
            {
                "role": str(msg.role),
                "content": msg.content,
            }
            for msg in messages
        ]

    async def check_session_limit(
        self,
        user_id: str,
        db: AsyncSession,
    ) -> None:
        """세션 수 제한 확인

        Args:
            user_id: 사용자 ID
            db: 비동기 DB 세션

        Raises:
            HTTPException 429: 최대 세션 수 초과 시
        """
        result = await db.execute(
            sa.select(sa.func.count(PdfAnalysisSession.id)).where(
                PdfAnalysisSession.user_id == uuid.UUID(user_id),
                PdfAnalysisSession.status == PdfSessionStatus.ACTIVE,
            )
        )
        count = result.scalar() or 0

        if count >= self.MAX_SESSIONS_PER_USER:
            raise HTTPException(
                status_code=429,
                detail=f"최대 분석 세션 수({self.MAX_SESSIONS_PER_USER}개)를 초과했습니다. "
                "기존 세션을 삭제하고 다시 시도해주세요.",
            )

    async def delete(
        self,
        session_id: str,
        user_id: str,
        db: AsyncSession,
        storage_service: Any = None,
    ) -> None:
        """세션 삭제

        세션 상태를 DELETED로 변경하고, 연관된 PDF 파일도 삭제합니다.

        Args:
            session_id: 세션 ID
            user_id: 사용자 ID
            db: 비동기 DB 세션
            storage_service: PDF 스토리지 서비스 (선택)
        """
        session = await self.get(session_id=session_id, user_id=user_id, db=db)

        # 연관 PDF 파일 삭제 (스토리지 서비스가 제공된 경우)
        if storage_service and session.upload_id:
            upload_result = await db.execute(
                sa.select(PdfUpload).where(PdfUpload.id == session.upload_id)
            )
            upload = upload_result.scalar_one_or_none()
            if upload and upload.file_path:
                await storage_service.delete_file(upload.file_path)

        # 세션 삭제
        await db.delete(session)
        logger.info("분석 세션 삭제", extra={"session_id": session_id, "user_id": user_id})

    async def expire_inactive_sessions(self, db: AsyncSession) -> int:
        """비활성 세션 만료 처리

        만료 시각이 지난 활성 세션을 만료 상태로 변경합니다.

        Args:
            db: 비동기 DB 세션

        Returns:
            만료 처리된 세션 수
        """
        now = datetime.now(UTC)

        result = await db.execute(
            sa.update(PdfAnalysisSession)
            .where(
                PdfAnalysisSession.status == PdfSessionStatus.ACTIVE,
                PdfAnalysisSession.expires_at < now,
            )
            .values(status=PdfSessionStatus.EXPIRED)
        )

        expired_count = result.rowcount
        if expired_count > 0:
            logger.info("비활성 세션 만료 처리", extra={"count": expired_count})

        return expired_count


# Type hint for storage_service parameter
from typing import Any  # noqa: E402
