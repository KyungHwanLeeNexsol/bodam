"""PDFStorageService 단위 테스트 (SPEC-PDF-001 TASK-004/005)

파일 검증, 저장, 쿼터 관리 로직을 검증합니다.
외부 의존성(DB, 파일시스템)은 mock으로 처리합니다.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException


class TestValidateMimeType:
    """MIME 타입 검증 테스트"""

    def test_valid_pdf_mime_type_passes(self):
        """application/pdf MIME 타입은 검증을 통과해야 한다"""
        from app.services.pdf.storage import PDFStorageService

        service = PDFStorageService()
        # 예외 없이 통과해야 함
        service.validate_mime_type("application/pdf")

    def test_invalid_mime_type_raises_400(self):
        """PDF가 아닌 MIME 타입은 400 예외를 발생시켜야 한다"""
        from app.services.pdf.storage import PDFStorageService

        service = PDFStorageService()
        with pytest.raises(HTTPException) as exc_info:
            service.validate_mime_type("image/jpeg")
        assert exc_info.value.status_code == 400

    def test_empty_mime_type_raises_400(self):
        """빈 MIME 타입은 400 예외를 발생시켜야 한다"""
        from app.services.pdf.storage import PDFStorageService

        service = PDFStorageService()
        with pytest.raises(HTTPException) as exc_info:
            service.validate_mime_type("")
        assert exc_info.value.status_code == 400

    def test_text_plain_mime_type_raises_400(self):
        """text/plain MIME 타입은 400 예외를 발생시켜야 한다"""
        from app.services.pdf.storage import PDFStorageService

        service = PDFStorageService()
        with pytest.raises(HTTPException):
            service.validate_mime_type("text/plain")


class TestValidateMagicBytes:
    """PDF 매직 바이트 검증 테스트"""

    def test_valid_pdf_magic_bytes_passes(self):
        """%PDF-로 시작하는 파일은 검증을 통과해야 한다"""
        from app.services.pdf.storage import PDFStorageService

        service = PDFStorageService()
        valid_pdf = b"%PDF-1.4 ..." + b"\x00" * 100
        # 예외 없이 통과해야 함
        service.validate_magic_bytes(valid_pdf)

    def test_invalid_magic_bytes_raises_400(self):
        """%PDF-로 시작하지 않는 파일은 400 예외를 발생시켜야 한다"""
        from app.services.pdf.storage import PDFStorageService

        service = PDFStorageService()
        not_pdf = b"PK\x03\x04"  # zip 파일 시그니처
        with pytest.raises(HTTPException) as exc_info:
            service.validate_magic_bytes(not_pdf)
        assert exc_info.value.status_code == 400

    def test_empty_bytes_raises_400(self):
        """빈 바이트는 400 예외를 발생시켜야 한다"""
        from app.services.pdf.storage import PDFStorageService

        service = PDFStorageService()
        with pytest.raises(HTTPException) as exc_info:
            service.validate_magic_bytes(b"")
        assert exc_info.value.status_code == 400

    def test_jpg_magic_bytes_raises_400(self):
        """JPG 매직 바이트는 400 예외를 발생시켜야 한다"""
        from app.services.pdf.storage import PDFStorageService

        service = PDFStorageService()
        jpg_header = b"\xff\xd8\xff"
        with pytest.raises(HTTPException):
            service.validate_magic_bytes(jpg_header)


class TestSanitizeFilename:
    """파일명 정제 테스트"""

    def test_normal_filename_unchanged(self):
        """일반 파일명은 그대로 반환되어야 한다"""
        from app.services.pdf.storage import PDFStorageService

        service = PDFStorageService()
        result = service.sanitize_filename("insurance_policy.pdf")
        assert result == "insurance_policy.pdf"

    def test_path_traversal_prevented(self):
        """../로 시작하는 경로 탐색 공격은 방어되어야 한다"""
        from app.services.pdf.storage import PDFStorageService

        service = PDFStorageService()
        result = service.sanitize_filename("../../etc/passwd")
        # 경로 구분자가 제거되어야 함
        assert ".." not in result or "/" not in result

    def test_null_bytes_removed(self):
        """null 바이트는 파일명에서 제거되어야 한다"""
        from app.services.pdf.storage import PDFStorageService

        service = PDFStorageService()
        result = service.sanitize_filename("file\x00name.pdf")
        assert "\x00" not in result

    def test_empty_filename_gets_random_name(self):
        """빈 파일명은 랜덤 이름으로 대체되어야 한다"""
        from app.services.pdf.storage import PDFStorageService

        service = PDFStorageService()
        result = service.sanitize_filename("")
        assert len(result) > 0
        assert ".pdf" in result

    def test_special_chars_replaced(self):
        """특수문자는 언더스코어로 대체되어야 한다"""
        from app.services.pdf.storage import PDFStorageService

        service = PDFStorageService()
        result = service.sanitize_filename("file<>|:?.pdf")
        assert "<" not in result
        assert ">" not in result
        assert "|" not in result


class TestCheckUserQuota:
    """사용자 스토리지 쿼터 검사 테스트"""

    @pytest.mark.asyncio
    async def test_quota_ok_when_under_limit(self):
        """총 사용량이 200MB 미만이면 통과해야 한다"""
        from app.services.pdf.storage import PDFStorageService

        service = PDFStorageService()
        mock_db = AsyncMock()

        # 현재 사용량: 10MB
        with patch.object(service, "get_user_storage_usage", return_value=10 * 1024 * 1024):
            # 파일 크기: 5MB
            await service.check_user_quota(
                user_id=str(uuid.uuid4()),
                file_size=5 * 1024 * 1024,
                db=mock_db,
            )

    @pytest.mark.asyncio
    async def test_quota_exceeded_raises_409(self):
        """총 사용량이 200MB를 초과하면 409 예외를 발생시켜야 한다"""
        from app.services.pdf.storage import PDFStorageService

        service = PDFStorageService()
        mock_db = AsyncMock()

        # 현재 사용량: 195MB
        with patch.object(service, "get_user_storage_usage", return_value=195 * 1024 * 1024):
            # 파일 크기: 10MB (합계: 205MB > 200MB)
            with pytest.raises(HTTPException) as exc_info:
                await service.check_user_quota(
                    user_id=str(uuid.uuid4()),
                    file_size=10 * 1024 * 1024,
                    db=mock_db,
                )
            assert exc_info.value.status_code == 409

    @pytest.mark.asyncio
    async def test_quota_exactly_at_limit_raises_409(self):
        """총 사용량이 정확히 200MB이면 409 예외를 발생시켜야 한다"""
        from app.services.pdf.storage import PDFStorageService

        service = PDFStorageService()
        mock_db = AsyncMock()

        # 현재 사용량: 200MB
        with patch.object(service, "get_user_storage_usage", return_value=200 * 1024 * 1024):
            with pytest.raises(HTTPException) as exc_info:
                await service.check_user_quota(
                    user_id=str(uuid.uuid4()),
                    file_size=1,  # 1바이트도 안됨
                    db=mock_db,
                )
            assert exc_info.value.status_code == 409


class TestDeleteFile:
    """파일 삭제 테스트"""

    @pytest.mark.asyncio
    async def test_delete_existing_file(self):
        """존재하는 파일은 정상적으로 삭제되어야 한다"""
        from app.services.pdf.storage import PDFStorageService

        service = PDFStorageService()
        with patch("os.path.exists", return_value=True), patch("os.remove") as mock_remove:
            await service.delete_file("/tmp/test.pdf")
            mock_remove.assert_called_once_with("/tmp/test.pdf")

    @pytest.mark.asyncio
    async def test_delete_nonexistent_file_does_not_raise(self):
        """존재하지 않는 파일 삭제 시 예외가 발생하지 않아야 한다"""
        from app.services.pdf.storage import PDFStorageService

        service = PDFStorageService()
        with patch("os.path.exists", return_value=False):
            # 예외 없이 통과해야 함
            await service.delete_file("/tmp/nonexistent.pdf")


class TestSaveFile:
    """파일 저장 테스트"""

    @pytest.mark.asyncio
    async def test_save_file_success(self):
        """파일을 정상적으로 저장해야 한다"""
        from unittest.mock import mock_open

        from app.services.pdf.storage import PDFStorageService

        service = PDFStorageService()
        mock_db = AsyncMock()

        # mock UploadFile
        mock_file = AsyncMock()
        pdf_content = b"%PDF-1.4 valid content"
        mock_file.read = AsyncMock(return_value=pdf_content)

        with patch.object(service, "check_user_quota", AsyncMock()), \
             patch("pathlib.Path.mkdir"), \
             patch("builtins.open", mock_open()):
            file_path, file_hash, file_size = await service.save_file(
                user_id=str(uuid.uuid4()),
                upload_id=str(uuid.uuid4()),
                file=mock_file,
                db=mock_db,
            )

        assert file_path.endswith(".pdf")
        assert len(file_hash) == 64  # SHA256 헥스 길이
        assert file_size == len(pdf_content)

    @pytest.mark.asyncio
    async def test_save_file_raises_413_when_too_large(self):
        """파일이 50MB를 초과하면 413 예외를 발생시켜야 한다"""
        from app.services.pdf.storage import PDFStorageService

        service = PDFStorageService()
        mock_db = AsyncMock()

        # 51MB 파일
        oversized_content = b"%PDF-1.4 " + b"x" * (51 * 1024 * 1024)
        mock_file = AsyncMock()
        mock_file.read = AsyncMock(return_value=oversized_content)

        with pytest.raises(HTTPException) as exc_info:
            await service.save_file(
                user_id=str(uuid.uuid4()),
                upload_id=str(uuid.uuid4()),
                file=mock_file,
                db=mock_db,
            )
        assert exc_info.value.status_code == 413


class TestGetUserStorageUsage:
    """사용자 스토리지 사용량 조회 테스트"""

    @pytest.mark.asyncio
    async def test_returns_correct_usage(self):
        """사용자의 총 스토리지 사용량을 반환해야 한다"""
        from app.services.pdf.storage import PDFStorageService

        service = PDFStorageService()
        mock_db = AsyncMock()

        expected_usage = 50 * 1024 * 1024  # 50MB
        mock_result = MagicMock()
        mock_result.scalar.return_value = expected_usage
        mock_db.execute = AsyncMock(return_value=mock_result)

        usage = await service.get_user_storage_usage(
            user_id=str(uuid.uuid4()),
            db=mock_db,
        )

        assert usage == expected_usage

    @pytest.mark.asyncio
    async def test_returns_zero_when_no_uploads(self):
        """업로드가 없으면 0을 반환해야 한다"""
        from app.services.pdf.storage import PDFStorageService

        service = PDFStorageService()
        mock_db = AsyncMock()

        mock_result = MagicMock()
        mock_result.scalar.return_value = None  # 아무 업로드 없음
        mock_db.execute = AsyncMock(return_value=mock_result)

        usage = await service.get_user_storage_usage(
            user_id=str(uuid.uuid4()),
            db=mock_db,
        )

        assert usage == 0


class TestMaxFileSizeConstant:
    """파일 크기 제한 상수 테스트"""

    def test_max_file_size_is_50mb(self):
        """최대 파일 크기가 50MB이어야 한다"""
        from app.services.pdf.storage import PDFStorageService

        assert PDFStorageService.MAX_FILE_SIZE == 50 * 1024 * 1024

    def test_max_user_quota_is_200mb(self):
        """사용자 최대 쿼터가 200MB이어야 한다"""
        from app.services.pdf.storage import PDFStorageService

        assert PDFStorageService.MAX_USER_QUOTA == 200 * 1024 * 1024
