"""PDF 스토리지 서비스 (SPEC-PDF-001 TASK-004/005)

PDF 파일 검증, 저장, 쿼터 관리를 담당하는 서비스입니다.
"""

from __future__ import annotations

import hashlib
import os
import re
import uuid
from pathlib import Path

import sqlalchemy as sa
from fastapi import HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession


class PDFStorageService:
    """PDF 파일 스토리지 서비스

    파일 검증, 저장, 쿼터 관리 기능을 제공합니다.
    """

    # 기본 저장 경로
    BASE_PATH = "uploads/pdf"

    # 파일 크기 제한: 50MB
    MAX_FILE_SIZE = 50 * 1024 * 1024

    # 사용자별 쿼터: 200MB
    MAX_USER_QUOTA = 200 * 1024 * 1024

    def validate_mime_type(self, content_type: str) -> None:
        """MIME 타입 검증

        Args:
            content_type: 파일 MIME 타입

        Raises:
            HTTPException 400: application/pdf가 아닌 경우
        """
        if content_type != "application/pdf":
            raise HTTPException(
                status_code=400,
                detail="PDF 파일만 업로드 가능합니다. application/pdf MIME 타입이 필요합니다.",
            )

    def validate_magic_bytes(self, file_bytes: bytes) -> None:
        """PDF 매직 바이트 검증

        Args:
            file_bytes: 파일 바이트 데이터

        Raises:
            HTTPException 400: PDF 매직 바이트(%PDF-)로 시작하지 않는 경우
        """
        if not file_bytes or not file_bytes.startswith(b"%PDF-"):
            raise HTTPException(
                status_code=400,
                detail="유효하지 않은 PDF 파일입니다. 파일 내용이 PDF 형식이 아닙니다.",
            )

    def sanitize_filename(self, filename: str) -> str:
        """파일명 정제

        경로 탐색 문자와 특수문자를 제거하여 안전한 파일명을 반환합니다.

        Args:
            filename: 원본 파일명

        Returns:
            정제된 안전한 파일명
        """
        # null 바이트 제거
        filename = filename.replace("\x00", "")

        # 경로 구성 요소 제거 (경로 탐색 방지)
        filename = os.path.basename(filename)

        # 위험한 특수문자 제거: < > | : ? * \ /
        filename = re.sub(r'[<>|:?*\\/]', "_", filename)

        # 앞뒤 공백 및 점 제거
        filename = filename.strip(". ")

        # 빈 파일명 처리
        if not filename:
            filename = f"document_{uuid.uuid4().hex[:8]}.pdf"

        return filename

    async def save_file(
        self,
        user_id: str,
        upload_id: str,
        file: UploadFile,
        db: AsyncSession,
    ) -> tuple[str, str, int]:
        """PDF 파일 저장

        파일을 읽어서 검증하고 uploads/pdf/{user_id}/{upload_id}.pdf 경로에 저장합니다.

        Args:
            user_id: 사용자 ID
            upload_id: 업로드 ID
            file: 업로드된 파일 객체
            db: 비동기 DB 세션

        Returns:
            tuple: (file_path, sha256_hash, file_size)

        Raises:
            HTTPException 413: 파일 크기 초과
            HTTPException 400: 유효하지 않은 PDF
        """
        # 파일 전체 읽기
        file_bytes = await file.read()
        file_size = len(file_bytes)

        # 파일 크기 검증
        if file_size > self.MAX_FILE_SIZE:
            raise HTTPException(
                status_code=413,
                detail=f"파일 크기가 {self.MAX_FILE_SIZE // (1024 * 1024)}MB를 초과합니다. "
                f"현재 파일 크기: {file_size // (1024 * 1024)}MB",
            )

        # 매직 바이트 검증
        self.validate_magic_bytes(file_bytes)

        # 쿼터 검사
        await self.check_user_quota(user_id=user_id, file_size=file_size, db=db)

        # SHA256 해시 계산
        file_hash = hashlib.sha256(file_bytes).hexdigest()

        # 저장 경로 생성
        save_dir = Path(self.BASE_PATH) / user_id
        save_dir.mkdir(parents=True, exist_ok=True)
        file_path = str(save_dir / f"{upload_id}.pdf")

        # 파일 저장 (비동기)
        try:
            import aiofiles

            async with aiofiles.open(file_path, "wb") as f:
                await f.write(file_bytes)
        except ImportError:
            # aiofiles가 없으면 동기 방식 사용
            with open(file_path, "wb") as f:
                f.write(file_bytes)

        return file_path, file_hash, file_size

    async def check_user_quota(
        self,
        user_id: str,
        file_size: int,
        db: AsyncSession,
    ) -> None:
        """사용자 스토리지 쿼터 검사

        Args:
            user_id: 사용자 ID
            file_size: 추가할 파일 크기 (바이트)
            db: 비동기 DB 세션

        Raises:
            HTTPException 409: 쿼터 초과 시
        """
        current_usage = await self.get_user_storage_usage(user_id=user_id, db=db)

        if current_usage + file_size > self.MAX_USER_QUOTA:
            raise HTTPException(
                status_code=409,
                detail=f"스토리지 쿼터를 초과했습니다. "
                f"현재 사용량: {current_usage // (1024 * 1024)}MB, "
                f"최대: {self.MAX_USER_QUOTA // (1024 * 1024)}MB",
            )

    async def delete_file(self, file_path: str) -> None:
        """파일 삭제

        Args:
            file_path: 삭제할 파일 경로
        """
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
        except OSError:
            # 파일이 없거나 권한 오류는 무시
            pass

    async def get_user_storage_usage(self, user_id: str, db: AsyncSession) -> int:
        """사용자 총 스토리지 사용량 조회

        Args:
            user_id: 사용자 ID
            db: 비동기 DB 세션

        Returns:
            총 사용 바이트
        """
        from app.models.pdf import PdfUpload, PdfUploadStatus

        result = await db.execute(
            sa.select(sa.func.coalesce(sa.func.sum(PdfUpload.file_size), 0)).where(
                PdfUpload.user_id == uuid.UUID(user_id),
                PdfUpload.status != PdfUploadStatus.EXPIRED,
            )
        )
        return result.scalar() or 0
