"""PDF 분석 도메인 SQLAlchemy 모델 단위 테스트 (SPEC-PDF-001 TASK-002)

PdfUpload, PdfAnalysisSession, PdfAnalysisMessage 모델의
enum 값, 관계, repr 메서드를 테스트합니다.
"""

from __future__ import annotations

import uuid


class TestPdfUploadStatus:
    """PdfUploadStatus enum 테스트"""

    def test_all_statuses_defined(self):
        """모든 업로드 상태가 정의되어 있어야 한다"""
        from app.models.pdf import PdfUploadStatus

        assert PdfUploadStatus.UPLOADED == "uploaded"
        assert PdfUploadStatus.ANALYZING == "analyzing"
        assert PdfUploadStatus.COMPLETED == "completed"
        assert PdfUploadStatus.FAILED == "failed"
        assert PdfUploadStatus.EXPIRED == "expired"

    def test_status_count(self):
        """5개의 업로드 상태가 있어야 한다"""
        from app.models.pdf import PdfUploadStatus

        assert len(PdfUploadStatus) == 5


class TestPdfSessionStatus:
    """PdfSessionStatus enum 테스트"""

    def test_all_statuses_defined(self):
        """모든 세션 상태가 정의되어 있어야 한다"""
        from app.models.pdf import PdfSessionStatus

        assert PdfSessionStatus.ACTIVE == "active"
        assert PdfSessionStatus.EXPIRED == "expired"
        assert PdfSessionStatus.DELETED == "deleted"

    def test_status_count(self):
        """3개의 세션 상태가 있어야 한다"""
        from app.models.pdf import PdfSessionStatus

        assert len(PdfSessionStatus) == 3


class TestPdfMessageRole:
    """PdfMessageRole enum 테스트"""

    def test_all_roles_defined(self):
        """사용자와 어시스턴트 역할이 정의되어 있어야 한다"""
        from app.models.pdf import PdfMessageRole

        assert PdfMessageRole.USER == "user"
        assert PdfMessageRole.ASSISTANT == "assistant"

    def test_role_count(self):
        """2개의 메시지 역할이 있어야 한다"""
        from app.models.pdf import PdfMessageRole

        assert len(PdfMessageRole) == 2


class TestPdfUploadModel:
    """PdfUpload 모델 테스트"""

    def test_pdf_upload_tablename(self):
        """PdfUpload 테이블명이 올바르게 설정되어야 한다"""
        from app.models.pdf import PdfUpload

        assert PdfUpload.__tablename__ == "pdf_uploads"

    def test_pdf_upload_repr(self):
        """PdfUpload repr이 올바른 형식이어야 한다"""
        from app.models.pdf import PdfUpload, PdfUploadStatus

        upload = PdfUpload()
        upload.id = uuid.uuid4()
        upload.original_filename = "test.pdf"
        upload.status = PdfUploadStatus.UPLOADED

        repr_str = repr(upload)
        assert "PdfUpload" in repr_str
        assert "test.pdf" in repr_str
        assert "uploaded" in repr_str


class TestPdfAnalysisSessionModel:
    """PdfAnalysisSession 모델 테스트"""

    def test_session_tablename(self):
        """PdfAnalysisSession 테이블명이 올바르게 설정되어야 한다"""
        from app.models.pdf import PdfAnalysisSession

        assert PdfAnalysisSession.__tablename__ == "pdf_analysis_sessions"

    def test_session_repr(self):
        """PdfAnalysisSession repr이 올바른 형식이어야 한다"""
        from app.models.pdf import PdfAnalysisSession, PdfSessionStatus

        session = PdfAnalysisSession()
        session.id = uuid.uuid4()
        session.title = "보험 분석"
        session.status = PdfSessionStatus.ACTIVE

        repr_str = repr(session)
        assert "PdfAnalysisSession" in repr_str
        assert "보험 분석" in repr_str
        assert "active" in repr_str


class TestPdfAnalysisMessageModel:
    """PdfAnalysisMessage 모델 테스트"""

    def test_message_tablename(self):
        """PdfAnalysisMessage 테이블명이 올바르게 설정되어야 한다"""
        from app.models.pdf import PdfAnalysisMessage

        assert PdfAnalysisMessage.__tablename__ == "pdf_analysis_messages"

    def test_message_repr(self):
        """PdfAnalysisMessage repr이 올바른 형식이어야 한다"""
        from app.models.pdf import PdfAnalysisMessage, PdfMessageRole

        message = PdfAnalysisMessage()
        message.id = uuid.uuid4()
        message.role = PdfMessageRole.USER
        message.session_id = uuid.uuid4()

        repr_str = repr(message)
        assert "PdfAnalysisMessage" in repr_str
        assert "user" in repr_str
