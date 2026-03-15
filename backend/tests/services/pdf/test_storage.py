"""PDF 스토리지 서비스 단위 테스트 (SPEC-PDF-001 TASK-004/005)

PDFStorageService의 파일 검증, 저장, 쿼터 관리 기능을 테스트합니다.
"""

from __future__ import annotations

import hashlib
import os
import tempfile
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException, UploadFile

# 테스트 환경변수 설정
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost/testdb")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-testing-purposes-only")


@pytest.fixture
def storage_service():
    """PDFStorageService 픽스처"""
    from app.services.pdf.storage import PDFStorageService

    return PDFStorageService()


@pytest.fixture
def mock_db():
    """Mock AsyncSession 픽스처"""
    db = AsyncMock()
    return db


@pytest.fixture
def valid_pdf_bytes():
    """유효한 PDF 매직 바이트"""
    return b"%PDF-1.4 fake pdf content for testing"


@pytest.fixture
def valid_upload_file(valid_pdf_bytes):
    """유효한 PDF UploadFile 픽스처"""
    mock_file = MagicMock(spec=UploadFile)
    mock_file.filename = "test.pdf"
    mock_file.content_type = "application/pdf"
    mock_file.read = AsyncMock(return_value=valid_pdf_bytes)
    mock_file.seek = AsyncMock(return_value=None)
    return mock_file


class TestValidateMimeType:
    """MIME 타입 검증 테스트"""

    def test_validate_mime_type_accepts_pdf(self, storage_service):
        """application/pdf MIME 타입을 허용해야 함"""
        # Should not raise
        storage_service.validate_mime_type("application/pdf")

    def test_validate_mime_type_rejects_non_pdf(self, storage_service):
        """application/pdf가 아닌 MIME 타입은 400 예외를 발생시켜야 함"""
        with pytest.raises(HTTPException) as exc_info:
            storage_service.validate_mime_type("image/jpeg")
        assert exc_info.value.status_code == 400

    def test_validate_mime_type_rejects_text(self, storage_service):
        """text/plain MIME 타입은 400 예외를 발생시켜야 함"""
        with pytest.raises(HTTPException) as exc_info:
            storage_service.validate_mime_type("text/plain")
        assert exc_info.value.status_code == 400

    def test_validate_mime_type_rejects_empty(self, storage_service):
        """빈 MIME 타입은 400 예외를 발생시켜야 함"""
        with pytest.raises(HTTPException) as exc_info:
            storage_service.validate_mime_type("")
        assert exc_info.value.status_code == 400


class TestValidateMagicBytes:
    """매직 바이트 검증 테스트"""

    def test_validate_magic_bytes_accepts_valid_pdf(self, storage_service, valid_pdf_bytes):
        """PDF 매직 바이트(%PDF-)로 시작하는 파일을 허용해야 함"""
        # Should not raise
        storage_service.validate_magic_bytes(valid_pdf_bytes)

    def test_validate_magic_bytes_rejects_fake_pdf(self, storage_service):
        """PDF가 아닌 파일은 400 예외를 발생시켜야 함"""
        fake_content = b"NOT A PDF FILE CONTENT"
        with pytest.raises(HTTPException) as exc_info:
            storage_service.validate_magic_bytes(fake_content)
        assert exc_info.value.status_code == 400

    def test_validate_magic_bytes_rejects_empty(self, storage_service):
        """빈 바이트는 400 예외를 발생시켜야 함"""
        with pytest.raises(HTTPException) as exc_info:
            storage_service.validate_magic_bytes(b"")
        assert exc_info.value.status_code == 400

    def test_validate_magic_bytes_rejects_jpeg(self, storage_service):
        """JPEG 파일은 400 예외를 발생시켜야 함"""
        jpeg_bytes = b"\xff\xd8\xff\xe0fake jpeg content"
        with pytest.raises(HTTPException) as exc_info:
            storage_service.validate_magic_bytes(jpeg_bytes)
        assert exc_info.value.status_code == 400


class TestSanitizeFilename:
    """파일명 정제 테스트"""

    def test_sanitize_filename_removes_path_traversal(self, storage_service):
        """경로 탐색 문자를 제거해야 함"""
        result = storage_service.sanitize_filename("../../../etc/passwd.pdf")
        assert ".." not in result
        assert "/" not in result

    def test_sanitize_filename_removes_special_chars(self, storage_service):
        """특수문자를 제거해야 함"""
        result = storage_service.sanitize_filename("file<>|:?*.pdf")
        for char in "<>|:?*":
            assert char not in result

    def test_sanitize_filename_keeps_extension(self, storage_service):
        """파일 확장자를 유지해야 함"""
        result = storage_service.sanitize_filename("myfile.pdf")
        assert result.endswith(".pdf")

    def test_sanitize_filename_handles_unicode(self, storage_service):
        """한글 파일명을 처리해야 함"""
        result = storage_service.sanitize_filename("보험약관.pdf")
        assert isinstance(result, str)
        assert len(result) > 0

    def test_sanitize_filename_removes_null_bytes(self, storage_service):
        """null 바이트를 제거해야 함"""
        result = storage_service.sanitize_filename("file\x00name.pdf")
        assert "\x00" not in result


class TestSaveFile:
    """파일 저장 테스트"""

    @pytest.mark.asyncio
    async def test_save_file_creates_correct_path(self, storage_service, valid_pdf_bytes, mock_db):
        """파일을 올바른 경로에 저장해야 함"""
        user_id = str(uuid.uuid4())
        upload_id = str(uuid.uuid4())

        mock_file = MagicMock(spec=UploadFile)
        mock_file.filename = "test.pdf"
        mock_file.content_type = "application/pdf"
        mock_file.read = AsyncMock(return_value=valid_pdf_bytes)

        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.object(storage_service, "BASE_PATH", tmpdir):
                with patch.object(storage_service, "check_user_quota", new=AsyncMock()):
                    file_path, _, _ = await storage_service.save_file(
                        user_id=user_id,
                        upload_id=upload_id,
                        file=mock_file,
                        db=mock_db,
                    )
                    assert os.path.exists(file_path)

    @pytest.mark.asyncio
    async def test_save_file_calculates_sha256(self, storage_service, valid_pdf_bytes, mock_db):
        """파일 저장 시 SHA256 해시를 계산해야 함"""
        user_id = str(uuid.uuid4())
        upload_id = str(uuid.uuid4())

        mock_file = MagicMock(spec=UploadFile)
        mock_file.filename = "test.pdf"
        mock_file.content_type = "application/pdf"
        mock_file.read = AsyncMock(return_value=valid_pdf_bytes)

        expected_hash = hashlib.sha256(valid_pdf_bytes).hexdigest()

        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.object(storage_service, "BASE_PATH", tmpdir):
                with patch.object(storage_service, "check_user_quota", new=AsyncMock()):
                    _, file_hash, _ = await storage_service.save_file(
                        user_id=user_id,
                        upload_id=upload_id,
                        file=mock_file,
                        db=mock_db,
                    )
                    assert file_hash == expected_hash

    @pytest.mark.asyncio
    async def test_reject_file_exceeding_50mb(self, storage_service, mock_db):
        """50MB 초과 파일은 413 예외를 발생시켜야 함"""
        user_id = str(uuid.uuid4())
        upload_id = str(uuid.uuid4())

        # 50MB + 1 bytes
        large_content = b"%PDF-" + b"x" * (50 * 1024 * 1024 + 1)

        mock_file = MagicMock(spec=UploadFile)
        mock_file.filename = "large.pdf"
        mock_file.content_type = "application/pdf"
        mock_file.read = AsyncMock(return_value=large_content)

        with pytest.raises(HTTPException) as exc_info:
            await storage_service.save_file(
                user_id=user_id,
                upload_id=upload_id,
                file=mock_file,
                db=mock_db,
            )
        assert exc_info.value.status_code == 413


class TestUserQuota:
    """사용자 스토리지 쿼터 테스트"""

    @pytest.mark.asyncio
    async def test_user_quota_exceeded(self, storage_service, mock_db):
        """200MB 쿼터 초과 시 409 예외를 발생시켜야 함"""
        user_id = str(uuid.uuid4())

        # mock: 사용자가 이미 190MB 사용 중
        with patch.object(
            storage_service,
            "get_user_storage_usage",
            new=AsyncMock(return_value=190 * 1024 * 1024),
        ):
            # 20MB 추가 시 초과
            with pytest.raises(HTTPException) as exc_info:
                await storage_service.check_user_quota(
                    user_id=user_id,
                    file_size=20 * 1024 * 1024,
                    db=mock_db,
                )
            assert exc_info.value.status_code == 409

    @pytest.mark.asyncio
    async def test_user_quota_within_limit(self, storage_service, mock_db):
        """쿼터 내 파일은 예외를 발생시키지 않아야 함"""
        user_id = str(uuid.uuid4())

        with patch.object(
            storage_service,
            "get_user_storage_usage",
            new=AsyncMock(return_value=10 * 1024 * 1024),
        ):
            # Should not raise (10MB + 5MB = 15MB, well within 200MB)
            await storage_service.check_user_quota(
                user_id=user_id,
                file_size=5 * 1024 * 1024,
                db=mock_db,
            )


class TestDeleteFile:
    """파일 삭제 테스트"""

    @pytest.mark.asyncio
    async def test_delete_file_removes_from_disk(self, storage_service):
        """파일이 디스크에서 삭제되어야 함"""
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            tmp.write(b"%PDF-test content")
            tmp_path = tmp.name

        assert os.path.exists(tmp_path)
        await storage_service.delete_file(tmp_path)
        assert not os.path.exists(tmp_path)

    @pytest.mark.asyncio
    async def test_delete_nonexistent_file_does_not_raise(self, storage_service):
        """존재하지 않는 파일 삭제는 예외를 발생시키지 않아야 함"""
        # Should not raise
        await storage_service.delete_file("/nonexistent/path/file.pdf")
