"""PDF 분석 API 라우터 (SPEC-PDF-001 TASK-012~015)

PDF 업로드, 분석, 질의, 세션 관리 엔드포인트를 제공합니다.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import uuid
from pathlib import Path

import sqlalchemy as sa
from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.models.pdf import PdfAnalysisSession, PdfUpload, PdfUploadStatus
from app.models.user import User
from app.services.pdf.analysis import PDFAnalysisService
from app.services.pdf.schemas import (
    MessageItem,
    PDFAnalyzeResponse,
    PDFQueryRequest,
    PDFUploadResponse,
    SessionDetail,
    SessionListItem,
    UploadStatusResponse,
)
from app.services.pdf.session import PDFSessionService
from app.services.pdf.storage import PDFStorageService

logger = logging.getLogger(__name__)

# PDF 라우터
router = APIRouter(prefix="/pdf", tags=["pdf"])


def get_storage_service() -> PDFStorageService:
    """PDFStorageService 의존성 팩토리"""
    return PDFStorageService()


def get_session_service() -> PDFSessionService:
    """PDFSessionService 의존성 팩토리"""
    return PDFSessionService()


def get_analysis_service(
    settings: Settings = Depends(get_settings),
) -> PDFAnalysisService:
    """PDFAnalysisService 의존성 팩토리"""
    import redis.asyncio as aioredis

    redis_url = getattr(settings, "redis_url", os.environ.get("REDIS_URL", "redis://localhost:6379"))
    redis_client = aioredis.from_url(redis_url, decode_responses=False)

    api_key = getattr(settings, "gemini_api_key", os.environ.get("GEMINI_API_KEY", ""))
    return PDFAnalysisService(api_key=api_key, redis_client=redis_client)


# ─────────────────────────────────────────────
# PDF 업로드 엔드포인트
# ─────────────────────────────────────────────


# @MX:ANCHOR: PDF 업로드 진입점 - 파일 검증 및 저장
# @MX:REASON: 모든 PDF 처리의 시작점으로 보안 검증이 집중되는 지점
@router.post(
    "/upload",
    response_model=PDFUploadResponse,
    status_code=201,
    summary="PDF 파일 업로드",
)
async def upload_pdf(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    storage_service: PDFStorageService = Depends(get_storage_service),
) -> PDFUploadResponse:
    """PDF 파일을 업로드합니다.

    - MIME 타입 검증 (application/pdf 만 허용)
    - 파일 매직 바이트 검증
    - 파일 크기 제한 (50MB)
    - 사용자 스토리지 쿼터 확인 (200MB)
    """
    # MIME 타입 검증
    storage_service.validate_mime_type(file.content_type or "")

    # 파일명 정제
    safe_filename = storage_service.sanitize_filename(file.filename or "document.pdf")

    # 업로드 ID 생성
    upload_id = str(uuid.uuid4())

    # 파일 읽기 및 매직 바이트 검증
    file_bytes = await file.read()
    storage_service.validate_magic_bytes(file_bytes)

    # 파일 크기 검증
    if len(file_bytes) > storage_service.MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"파일 크기가 {storage_service.MAX_FILE_SIZE // (1024 * 1024)}MB를 초과합니다.",
        )

    # 쿼터 확인
    await storage_service.check_user_quota(
        user_id=str(current_user.id),
        file_size=len(file_bytes),
        db=db,
    )

    # 파일 저장 처리
    file_hash = hashlib.sha256(file_bytes).hexdigest()
    file_size = len(file_bytes)

    save_dir = Path(storage_service.BASE_PATH) / str(current_user.id)
    save_dir.mkdir(parents=True, exist_ok=True)
    file_path = str(save_dir / f"{upload_id}.pdf")

    with open(file_path, "wb") as f:
        f.write(file_bytes)

    # DB에 업로드 레코드 생성
    upload = PdfUpload(
        user_id=current_user.id,
        original_filename=file.filename or "document.pdf",
        stored_filename=safe_filename,
        file_path=file_path,
        file_size=file_size,
        file_hash=file_hash,
        mime_type="application/pdf",
        status=PdfUploadStatus.UPLOADED,
    )

    db.add(upload)
    await db.flush()
    await db.refresh(upload)

    logger.info(
        "PDF 업로드 완료",
        extra={
            "upload_id": str(upload.id),
            "user_id": str(current_user.id),
            "file_size": file_size,
        },
    )

    return PDFUploadResponse(
        id=upload.id,
        filename=upload.original_filename,
        file_size=upload.file_size,
        status=str(upload.status),
        created_at=upload.created_at,
    )


# ─────────────────────────────────────────────
# PDF 분석 엔드포인트
# ─────────────────────────────────────────────


@router.post(
    "/{upload_id}/analyze",
    response_model=PDFAnalyzeResponse,
    status_code=200,
    summary="PDF 초기 분석",
)
async def analyze_pdf(
    upload_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    analysis_service: PDFAnalysisService = Depends(get_analysis_service),
    session_service: PDFSessionService = Depends(get_session_service),
) -> PDFAnalyzeResponse:
    """업로드된 PDF를 분석하여 보장 내용을 추출합니다.

    초기 분석 결과(담보목록, 보상조건, 면책사항, 보상한도)를 반환하고
    새로운 분석 세션을 생성합니다.
    """
    # 업로드 조회 및 소유권 확인
    result = await db.execute(
        sa.select(PdfUpload).where(
            PdfUpload.id == upload_id,
            PdfUpload.user_id == current_user.id,
        )
    )
    upload = result.scalar_one_or_none()

    if upload is None:
        raise HTTPException(status_code=404, detail="업로드된 PDF를 찾을 수 없습니다.")

    # 업로드 상태를 분석 중으로 변경
    upload.status = PdfUploadStatus.ANALYZING
    await db.flush()

    try:
        # 초기 분석 수행
        analysis_result = await analysis_service.analyze_initial(
            file_path=upload.file_path,
            file_hash=upload.file_hash,
        )

        # 토큰 사용량은 분석 응답 내에서 추적
        token_usage = {"total_tokens": 0, "estimated_cost_usd": 0.0}

        # 세션 생성
        session = await session_service.create(
            user_id=str(current_user.id),
            upload_id=str(upload_id),
            title=f"{upload.original_filename} 분석",
            db=db,
        )

        # 분석 결과를 세션에 저장
        session.initial_analysis = analysis_result
        session.token_usage = token_usage
        await db.flush()

        # 업로드 상태를 완료로 변경
        upload.status = PdfUploadStatus.COMPLETED
        await db.flush()

    except Exception as e:
        upload.status = PdfUploadStatus.FAILED
        await db.flush()
        logger.error("PDF 분석 실패: %s", str(e))
        raise HTTPException(status_code=500, detail=f"PDF 분석 중 오류가 발생했습니다: {str(e)}")

    return PDFAnalyzeResponse(
        session_id=session.id,
        analysis=analysis_result,
        token_usage=token_usage,
    )


# ─────────────────────────────────────────────
# PDF 질의 엔드포인트 (SSE 스트리밍)
# ─────────────────────────────────────────────


@router.post(
    "/{upload_id}/query",
    status_code=200,
    summary="PDF 질의 (SSE 스트리밍)",
)
async def query_pdf(
    upload_id: uuid.UUID,
    body: PDFQueryRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    analysis_service: PDFAnalysisService = Depends(get_analysis_service),
    session_service: PDFSessionService = Depends(get_session_service),
) -> StreamingResponse:
    """PDF 약관에 대한 질문에 SSE 스트리밍으로 응답합니다."""
    # 업로드 조회
    upload_result = await db.execute(
        sa.select(PdfUpload).where(
            PdfUpload.id == upload_id,
            PdfUpload.user_id == current_user.id,
        )
    )
    upload = upload_result.scalar_one_or_none()

    if upload is None:
        raise HTTPException(status_code=404, detail="업로드된 PDF를 찾을 수 없습니다.")

    # 활성 세션 조회
    session_result = await db.execute(
        sa.select(PdfAnalysisSession).where(
            PdfAnalysisSession.upload_id == upload_id,
            PdfAnalysisSession.user_id == current_user.id,
            PdfAnalysisSession.status == "active",
        )
    )
    session = session_result.scalar_one_or_none()

    if session is None:
        raise HTTPException(status_code=404, detail="활성 분석 세션을 찾을 수 없습니다.")

    # 대화 이력 조회
    history = await session_service.get_conversation_history(
        session_id=str(session.id),
        db=db,
    )

    async def generate():
        """SSE 스트림 생성기"""
        full_response = ""
        try:
            async for chunk in analysis_service.query_stream(
                file_path=upload.file_path,
                question=body.question,
                history=history,
            ):
                full_response += chunk
                yield f"data: {json.dumps({'type': 'token', 'content': chunk}, ensure_ascii=False)}\n\n"

            # 완료 이벤트
            yield f"data: {json.dumps({'type': 'done', 'content': full_response}, ensure_ascii=False)}\n\n"

        except Exception as e:
            logger.error("스트리밍 쿼리 오류: %s", str(e))
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
    )


# ─────────────────────────────────────────────
# 세션 관리 엔드포인트
# ─────────────────────────────────────────────


@router.get(
    "/sessions",
    response_model=list[SessionListItem],
    status_code=200,
    summary="세션 목록 조회",
)
async def list_sessions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    session_service: PDFSessionService = Depends(get_session_service),
) -> list[SessionListItem]:
    """현재 사용자의 PDF 분석 세션 목록을 반환합니다."""
    sessions = await session_service.list_by_user(
        user_id=str(current_user.id),
        db=db,
    )

    return [
        SessionListItem(
            id=s.id,
            title=s.title,
            status=str(s.status),
            created_at=s.created_at,
            last_activity_at=s.last_activity_at,
        )
        for s in sessions
    ]


@router.get(
    "/sessions/{session_id}",
    response_model=SessionDetail,
    status_code=200,
    summary="세션 상세 조회",
)
async def get_session(
    session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    session_service: PDFSessionService = Depends(get_session_service),
) -> SessionDetail:
    """특정 PDF 분석 세션의 상세 정보를 반환합니다."""
    session = await session_service.get(
        session_id=str(session_id),
        user_id=str(current_user.id),
        db=db,
    )

    messages = [
        MessageItem(
            id=msg.id,
            role=str(msg.role),
            content=msg.content,
            token_count=msg.token_count,
            created_at=msg.created_at,
        )
        for msg in (session.messages or [])
    ]

    return SessionDetail(
        id=session.id,
        title=session.title,
        status=str(session.status),
        messages=messages,
        initial_analysis=session.initial_analysis,
        token_usage=session.token_usage,
        upload_id=session.upload_id,
    )


@router.delete(
    "/sessions/{session_id}",
    status_code=204,
    summary="세션 삭제",
)
async def delete_session(
    session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    session_service: PDFSessionService = Depends(get_session_service),
    storage_service: PDFStorageService = Depends(get_storage_service),
) -> Response:
    """PDF 분석 세션을 삭제합니다."""
    await session_service.delete(
        session_id=str(session_id),
        user_id=str(current_user.id),
        db=db,
        storage_service=storage_service,
    )
    return Response(status_code=204)


@router.get(
    "/{upload_id}/status",
    response_model=UploadStatusResponse,
    status_code=200,
    summary="업로드 상태 조회",
)
async def get_upload_status(
    upload_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UploadStatusResponse:
    """PDF 업로드 상태를 조회합니다."""
    result = await db.execute(
        sa.select(PdfUpload).where(
            PdfUpload.id == upload_id,
            PdfUpload.user_id == current_user.id,
        )
    )
    upload = result.scalar_one_or_none()

    if upload is None:
        raise HTTPException(status_code=404, detail="업로드된 PDF를 찾을 수 없습니다.")

    return UploadStatusResponse(
        id=upload.id,
        status=str(upload.status),
        original_filename=upload.original_filename,
        file_size=upload.file_size,
        page_count=upload.page_count,
        created_at=upload.created_at,
    )
