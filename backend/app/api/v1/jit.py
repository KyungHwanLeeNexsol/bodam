"""JIT RAG API 라우터 (SPEC-JIT-001)

Just-In-Time RAG 엔드포인트:
- POST /api/v1/jit/upload       PDF 업로드 및 세션 저장
- POST /api/v1/jit/find         상품명으로 문서 검색 및 세션 저장
- GET  /api/v1/jit/session/{id}/document  세션 문서 메타데이터 조회
- DELETE /api/v1/jit/session/{id}/document  세션 문서 삭제
"""

from __future__ import annotations

import logging
import os
from datetime import UTC, datetime

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.api.deps import get_current_user
from app.core.config import Settings, get_settings
from app.models.user import User
from app.services.jit_rag.document_fetcher import DocumentFetcher
from app.services.jit_rag.document_finder import DocumentFinder, DocumentNotFoundError
from app.services.jit_rag.models import DocumentData
from app.services.jit_rag.session_store import JITSessionStore
from app.services.jit_rag.text_extractor import TextExtractor

logger = logging.getLogger(__name__)

# JIT 라우터
router = APIRouter(prefix="/jit", tags=["jit"])


# ─────────────────────────────────────────────
# Pydantic 요청/응답 스키마
# ─────────────────────────────────────────────


class JITFindRequest(BaseModel):
    """상품명 검색 요청"""

    product_name: str
    session_id: str


class JITUploadResponse(BaseModel):
    """PDF 업로드 응답"""

    status: str
    product_name: str
    page_count: int
    session_id: str


class JITFindResponse(BaseModel):
    """상품명 검색 응답"""

    status: str
    source_url: str
    page_count: int
    session_id: str


class DocumentMetaResponse(BaseModel):
    """문서 메타데이터 응답"""

    product_name: str
    source_url: str
    source_type: str
    page_count: int
    extracted_at: str
    section_count: int


class DeleteResponse(BaseModel):
    """문서 삭제 응답"""

    status: str


# ─────────────────────────────────────────────
# 의존성 팩토리
# ─────────────────────────────────────────────


def get_redis_client(
    settings: Settings = Depends(get_settings),
) -> aioredis.Redis:
    """Redis 클라이언트 의존성"""
    redis_url = getattr(settings, "redis_url", os.environ.get("REDIS_URL", "redis://localhost:6379"))
    return aioredis.from_url(redis_url, decode_responses=False)


def get_session_store(
    redis_client: aioredis.Redis = Depends(get_redis_client),
) -> JITSessionStore:
    """JITSessionStore 의존성"""
    return JITSessionStore(redis_client=redis_client)


# ─────────────────────────────────────────────
# 엔드포인트
# ─────────────────────────────────────────────


# @MX:ANCHOR: [AUTO] JIT PDF 업로드 진입점
# @MX:REASON: PDF 업로드 → 텍스트 추출 → Redis 저장의 시작점
@router.post(
    "/upload",
    response_model=JITUploadResponse,
    status_code=200,
    summary="PDF 업로드 및 JIT 세션 저장",
)
async def upload_jit_pdf(
    file: UploadFile = File(...),
    session_id: str = Form(...),
    current_user: User = Depends(get_current_user),
    session_store: JITSessionStore = Depends(get_session_store),
) -> JITUploadResponse:
    """PDF 파일을 업로드하여 JIT 세션에 저장합니다.

    약관 PDF를 업로드하면:
    1. 텍스트 및 섹션 추출
    2. Redis에 세션 데이터 저장 (TTL 3600초)
    3. 문서 메타데이터 반환
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="PDF 파일만 업로드 가능합니다.")

    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="빈 파일입니다.")

    # 텍스트 추출
    extractor = TextExtractor()
    sections = extractor.extract_from_pdf(pdf_bytes)

    # PDF 페이지 수 계산
    try:
        import pymupdf

        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
        page_count = len(doc)
        doc.close()
    except Exception:
        page_count = len(sections) if sections else 1

    # 파일명에서 상품명 추출 (확장자 제거)
    product_name = file.filename.replace(".pdf", "").replace("_", " ")

    # 문서 데이터 생성 및 Redis 저장
    document = DocumentData(
        product_name=product_name,
        source_url="",
        source_type="pdf",
        sections=sections,
        extracted_at=datetime.now(UTC).isoformat(),
        page_count=page_count,
    )
    await session_store.save(session_id, document)

    logger.info(
        "JIT PDF 업로드 완료: session_id=%s, pages=%d, sections=%d",
        session_id,
        page_count,
        len(sections),
    )

    return JITUploadResponse(
        status="ok",
        product_name=product_name,
        page_count=page_count,
        session_id=session_id,
    )


@router.post(
    "/find",
    response_model=JITFindResponse,
    status_code=200,
    summary="상품명으로 약관 문서 검색 및 JIT 세션 저장",
)
async def find_jit_document(
    request: JITFindRequest,
    current_user: User = Depends(get_current_user),
    session_store: JITSessionStore = Depends(get_session_store),
) -> JITFindResponse:
    """보험 상품명으로 약관 문서를 찾아 JIT 세션에 저장합니다.

    1. 보험사 직접 URL 매핑 시도
    2. FSS 금융감독원 공시 검색 시도
    3. DuckDuckGo 검색 시도
    4. 문서 다운로드 및 텍스트 추출
    5. Redis에 세션 데이터 저장

    Raises:
        HTTPException 404: 문서를 찾을 수 없는 경우
        HTTPException 408: 30초 타임아웃 초과
    """
    finder = DocumentFinder()
    fetcher = DocumentFetcher()
    extractor = TextExtractor()

    # 문서 URL 검색
    try:
        url = await finder.find_url(request.product_name)
    except DocumentNotFoundError:
        raise HTTPException(
            status_code=404,
            detail=f"보험 문서를 찾을 수 없습니다: {request.product_name}",
        )
    except Exception as e:
        logger.error("문서 URL 검색 실패: product=%s, error=%s", request.product_name, str(e))
        raise HTTPException(
            status_code=404,
            detail=f"보험 문서를 찾을 수 없습니다: {request.product_name}",
        )

    # 문서 다운로드
    try:
        fetch_result = await fetcher.fetch(url)
    except Exception as e:
        logger.error("문서 다운로드 실패: url=%s, error=%s", url, str(e))
        raise HTTPException(
            status_code=502,
            detail=f"문서 다운로드에 실패했습니다: {url}",
        )

    # 텍스트 추출
    if "pdf" in fetch_result.content_type:
        sections = extractor.extract_from_pdf(fetch_result.data)
        source_type = "pdf"
        try:
            import pymupdf

            doc = pymupdf.open(stream=fetch_result.data, filetype="pdf")
            page_count = len(doc)
            doc.close()
        except Exception:
            page_count = len(sections) if sections else 1
    else:
        html_content = fetch_result.data.decode("utf-8", errors="replace")
        sections = extractor.extract_from_html(html_content)
        source_type = "html"
        page_count = 1

    # 문서 데이터 저장
    document = DocumentData(
        product_name=request.product_name,
        source_url=fetch_result.url,
        source_type=source_type,
        sections=sections,
        extracted_at=datetime.now(UTC).isoformat(),
        page_count=page_count,
    )
    await session_store.save(request.session_id, document)

    logger.info(
        "JIT 문서 검색 완료: session_id=%s, product=%s, url=%s",
        request.session_id,
        request.product_name,
        fetch_result.url,
    )

    return JITFindResponse(
        status="ok",
        source_url=fetch_result.url,
        page_count=page_count,
        session_id=request.session_id,
    )


@router.get(
    "/session/{session_id}/document",
    response_model=DocumentMetaResponse,
    status_code=200,
    summary="세션 문서 메타데이터 조회",
)
async def get_session_document(
    session_id: str,
    current_user: User = Depends(get_current_user),
    session_store: JITSessionStore = Depends(get_session_store),
) -> DocumentMetaResponse:
    """JIT 세션에 저장된 문서 메타데이터를 반환합니다.

    Raises:
        HTTPException 404: 세션에 문서가 없는 경우
    """
    document = await session_store.get(session_id)
    if document is None:
        raise HTTPException(
            status_code=404,
            detail=f"세션에 문서가 없습니다: {session_id}",
        )

    return DocumentMetaResponse(
        product_name=document.product_name,
        source_url=document.source_url,
        source_type=document.source_type,
        page_count=document.page_count,
        extracted_at=document.extracted_at,
        section_count=len(document.sections),
    )


@router.delete(
    "/session/{session_id}/document",
    response_model=DeleteResponse,
    status_code=200,
    summary="세션 문서 삭제",
)
async def delete_session_document(
    session_id: str,
    current_user: User = Depends(get_current_user),
    session_store: JITSessionStore = Depends(get_session_store),
) -> DeleteResponse:
    """JIT 세션에서 문서를 삭제합니다."""
    await session_store.delete(session_id)
    return DeleteResponse(status="deleted")
