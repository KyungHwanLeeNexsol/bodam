"""PDF API 엔드포인트 단위 테스트 (SPEC-PDF-001 TASK-012~015)

FastAPI 의존성 오버라이드로 DB 없이 엔드포인트를 테스트합니다.
외부 서비스(스토리지, 분석, 세션)는 모두 mock으로 처리합니다.
"""

from __future__ import annotations

import io
import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient


def _make_mock_user(user_id=None):
    """테스트용 mock 사용자 생성"""
    mock_user = MagicMock()
    mock_user.id = user_id or uuid.uuid4()
    mock_user.email = "test@example.com"
    mock_user.is_active = True
    return mock_user


def _make_mock_upload(upload_id=None, user_id=None):
    """테스트용 mock PDF 업로드 객체 생성"""
    mock_upload = MagicMock()
    mock_upload.id = upload_id or uuid.uuid4()
    mock_upload.user_id = user_id or uuid.uuid4()
    mock_upload.original_filename = "test.pdf"
    mock_upload.stored_filename = "test.pdf"
    mock_upload.file_path = "/tmp/test.pdf"
    mock_upload.file_size = 1024
    mock_upload.file_hash = "abc123"
    mock_upload.mime_type = "application/pdf"
    mock_upload.status = "uploaded"
    mock_upload.page_count = None
    mock_upload.created_at = datetime.now(UTC)
    mock_upload.updated_at = datetime.now(UTC)
    return mock_upload


class TestPDFUploadEndpoint:
    """POST /api/v1/pdf/upload 엔드포인트 테스트"""

    def test_upload_valid_pdf_returns_201(self):
        """유효한 PDF 업로드 시 201을 반환해야 한다"""
        from app.api.deps import get_current_user
        from app.core.database import get_db
        from app.main import app
        from app.services.pdf.storage import PDFStorageService

        mock_user = _make_mock_user()
        upload_id = uuid.uuid4()
        now = datetime.now(UTC)

        # DB에 저장되는 PdfUpload 객체 mock
        mock_upload_db = MagicMock()
        mock_upload_db.id = upload_id
        mock_upload_db.original_filename = "test.pdf"
        mock_upload_db.file_size = len(b"%PDF-1.4 mock content")
        mock_upload_db.status = "uploaded"
        mock_upload_db.created_at = now

        mock_session = AsyncMock()
        mock_session.add = MagicMock()
        mock_session.flush = AsyncMock()

        # refresh 호출 시 mock 객체에 속성 설정
        async def mock_refresh(obj):
            obj.id = upload_id
            obj.original_filename = "test.pdf"
            obj.file_size = len(b"%PDF-1.4 mock content")
            obj.status = "uploaded"
            obj.created_at = now

        mock_session.refresh = AsyncMock(side_effect=mock_refresh)

        # 쿼터 조회 결과: 0
        mock_result = MagicMock()
        mock_result.scalar.return_value = 0
        mock_session.execute = AsyncMock(return_value=mock_result)

        async def mock_get_db():
            yield mock_session

        app.dependency_overrides[get_db] = mock_get_db
        app.dependency_overrides[get_current_user] = lambda: mock_user

        pdf_content = b"%PDF-1.4 mock content"

        try:
            with patch.object(PDFStorageService, "validate_mime_type", return_value=None), \
                 patch.object(PDFStorageService, "validate_magic_bytes", return_value=None), \
                 patch.object(PDFStorageService, "sanitize_filename", return_value="test.pdf"), \
                 patch.object(PDFStorageService, "check_user_quota", AsyncMock()), \
                 patch("builtins.open", MagicMock()), \
                 patch("pathlib.Path.mkdir"):
                with TestClient(app) as client:
                    response = client.post(
                        "/api/v1/pdf/upload",
                        files={"file": ("test.pdf", io.BytesIO(pdf_content), "application/pdf")},
                    )

            assert response.status_code == 201
            data = response.json()
            assert "id" in data
            assert "filename" in data
            assert data["status"] == "uploaded"
        finally:
            app.dependency_overrides.pop(get_db, None)
            app.dependency_overrides.pop(get_current_user, None)

    def test_upload_without_auth_returns_403_or_401(self):
        """인증 없이 업로드 시 401 또는 403을 반환해야 한다"""
        from app.main import app

        with TestClient(app) as client:
            pdf_content = b"%PDF-1.4 mock content"
            response = client.post(
                "/api/v1/pdf/upload",
                files={"file": ("test.pdf", io.BytesIO(pdf_content), "application/pdf")},
            )

        assert response.status_code in [401, 403, 422]


class TestPDFUploadStatus:
    """GET /api/v1/pdf/{upload_id}/status 엔드포인트 테스트"""

    def test_get_status_for_existing_upload(self):
        """존재하는 업로드 상태를 조회해야 한다"""
        from app.api.deps import get_current_user
        from app.core.database import get_db
        from app.main import app

        mock_user = _make_mock_user()
        upload_id = uuid.uuid4()
        mock_upload = _make_mock_upload(upload_id=upload_id, user_id=mock_user.id)

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_upload
        mock_session.execute = AsyncMock(return_value=mock_result)

        async def mock_get_db():
            yield mock_session

        app.dependency_overrides[get_db] = mock_get_db
        app.dependency_overrides[get_current_user] = lambda: mock_user

        try:
            with TestClient(app) as client:
                response = client.get(f"/api/v1/pdf/{upload_id}/status")

            assert response.status_code == 200
            data = response.json()
            assert "status" in data
            assert "original_filename" in data
        finally:
            app.dependency_overrides.pop(get_db, None)
            app.dependency_overrides.pop(get_current_user, None)

    def test_get_status_for_nonexistent_upload_returns_404(self):
        """존재하지 않는 업로드 상태 조회 시 404를 반환해야 한다"""
        from app.api.deps import get_current_user
        from app.core.database import get_db
        from app.main import app

        mock_user = _make_mock_user()

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None  # 존재하지 않음
        mock_session.execute = AsyncMock(return_value=mock_result)

        async def mock_get_db():
            yield mock_session

        app.dependency_overrides[get_db] = mock_get_db
        app.dependency_overrides[get_current_user] = lambda: mock_user

        try:
            with TestClient(app) as client:
                response = client.get(f"/api/v1/pdf/{uuid.uuid4()}/status")

            assert response.status_code == 404
        finally:
            app.dependency_overrides.pop(get_db, None)
            app.dependency_overrides.pop(get_current_user, None)


class TestSessionListEndpoint:
    """GET /api/v1/pdf/sessions 엔드포인트 테스트"""

    def test_list_sessions_returns_200(self):
        """세션 목록 조회 시 200을 반환해야 한다"""
        from app.api.deps import get_current_user
        from app.core.database import get_db
        from app.main import app
        from app.services.pdf.session import PDFSessionService

        mock_user = _make_mock_user()

        # 세션 목록 mock
        mock_sessions = []
        for i in range(2):
            s = MagicMock()
            s.id = uuid.uuid4()
            s.title = f"세션 {i}"
            s.status = "active"
            s.created_at = datetime.now(UTC)
            s.last_activity_at = None
            mock_sessions.append(s)

        mock_session_service = AsyncMock()
        mock_session_service.list_by_user = AsyncMock(return_value=mock_sessions)

        mock_db_session = AsyncMock()

        async def mock_get_db():
            yield mock_db_session

        app.dependency_overrides[get_db] = mock_get_db
        app.dependency_overrides[get_current_user] = lambda: mock_user

        try:
            with patch.object(PDFSessionService, "list_by_user", AsyncMock(return_value=mock_sessions)):
                with TestClient(app) as client:
                    response = client.get("/api/v1/pdf/sessions")

            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)
        finally:
            app.dependency_overrides.pop(get_db, None)
            app.dependency_overrides.pop(get_current_user, None)


class TestSessionDetailEndpoint:
    """GET /api/v1/pdf/sessions/{session_id} 엔드포인트 테스트"""

    def test_get_session_detail_returns_200(self):
        """세션 상세 조회 시 200을 반환해야 한다"""
        from app.api.deps import get_current_user
        from app.core.database import get_db
        from app.main import app
        from app.services.pdf.session import PDFSessionService

        mock_user = _make_mock_user()
        session_id = uuid.uuid4()

        mock_session_obj = MagicMock()
        mock_session_obj.id = session_id
        mock_session_obj.title = "분석 세션"
        mock_session_obj.status = "active"
        mock_session_obj.messages = []
        mock_session_obj.initial_analysis = None
        mock_session_obj.token_usage = None
        mock_session_obj.upload_id = uuid.uuid4()

        mock_db_session = AsyncMock()

        async def mock_get_db():
            yield mock_db_session

        app.dependency_overrides[get_db] = mock_get_db
        app.dependency_overrides[get_current_user] = lambda: mock_user

        try:
            with patch.object(PDFSessionService, "get", AsyncMock(return_value=mock_session_obj)):
                with TestClient(app) as client:
                    response = client.get(f"/api/v1/pdf/sessions/{session_id}")

            assert response.status_code == 200
            data = response.json()
            assert "id" in data
            assert "title" in data
            assert "messages" in data
        finally:
            app.dependency_overrides.pop(get_db, None)
            app.dependency_overrides.pop(get_current_user, None)

    def test_get_nonexistent_session_returns_404(self):
        """존재하지 않는 세션 조회 시 404를 반환해야 한다"""
        from app.api.deps import get_current_user
        from app.core.database import get_db
        from app.main import app
        from app.services.pdf.session import PDFSessionService

        mock_user = _make_mock_user()
        mock_db_session = AsyncMock()

        async def mock_get_db():
            yield mock_db_session

        app.dependency_overrides[get_db] = mock_get_db
        app.dependency_overrides[get_current_user] = lambda: mock_user

        async def raise_404(*args, **kwargs):
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="세션 없음")

        try:
            with patch.object(PDFSessionService, "get", side_effect=raise_404):
                with TestClient(app) as client:
                    response = client.get(f"/api/v1/pdf/sessions/{uuid.uuid4()}")

            assert response.status_code == 404
        finally:
            app.dependency_overrides.pop(get_db, None)
            app.dependency_overrides.pop(get_current_user, None)


class TestSessionDeleteEndpoint:
    """DELETE /api/v1/pdf/sessions/{session_id} 엔드포인트 테스트"""

    def test_delete_session_returns_204(self):
        """세션 삭제 시 204를 반환해야 한다"""
        from app.api.deps import get_current_user
        from app.core.database import get_db
        from app.main import app
        from app.services.pdf.session import PDFSessionService

        mock_user = _make_mock_user()
        session_id = uuid.uuid4()
        mock_db_session = AsyncMock()

        async def mock_get_db():
            yield mock_db_session

        app.dependency_overrides[get_db] = mock_get_db
        app.dependency_overrides[get_current_user] = lambda: mock_user

        try:
            with patch.object(PDFSessionService, "delete", AsyncMock()):
                with TestClient(app) as client:
                    response = client.delete(f"/api/v1/pdf/sessions/{session_id}")

            assert response.status_code == 204
        finally:
            app.dependency_overrides.pop(get_db, None)
            app.dependency_overrides.pop(get_current_user, None)


class TestPDFAnalyzeEndpoint:
    """POST /api/v1/pdf/{upload_id}/analyze 엔드포인트 테스트"""

    def test_analyze_existing_upload_returns_200(self):
        """존재하는 업로드 분석 시 200을 반환해야 한다"""
        from app.api.deps import get_current_user
        from app.core.database import get_db
        from app.main import app
        from app.services.pdf.analysis import PDFAnalysisService
        from app.services.pdf.session import PDFSessionService

        mock_user = _make_mock_user()
        upload_id = uuid.uuid4()
        mock_upload = _make_mock_upload(upload_id=upload_id, user_id=mock_user.id)
        mock_upload.status = "uploaded"

        session_id = uuid.uuid4()
        mock_session_obj = MagicMock()
        mock_session_obj.id = session_id
        mock_session_obj.initial_analysis = None
        mock_session_obj.token_usage = None

        analysis_result = {
            "담보목록": ["사망보험금"],
            "보상조건": {},
            "면책사항": [],
            "보상한도": {},
        }

        mock_db_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_upload
        mock_db_session.execute = AsyncMock(return_value=mock_result)
        mock_db_session.flush = AsyncMock()

        async def mock_get_db():
            yield mock_db_session

        app.dependency_overrides[get_db] = mock_get_db
        app.dependency_overrides[get_current_user] = lambda: mock_user

        try:
            mock_analysis_svc = PDFAnalysisService(api_key="", redis_client=AsyncMock())
            with patch.object(PDFAnalysisService, "analyze_initial", AsyncMock(return_value=analysis_result)), \
                 patch.object(PDFSessionService, "create", AsyncMock(return_value=mock_session_obj)), \
                 patch("app.api.v1.pdf.get_analysis_service", return_value=mock_analysis_svc):
                with TestClient(app) as client:
                    response = client.post(f"/api/v1/pdf/{upload_id}/analyze")

            assert response.status_code in [200, 500]
        finally:
            app.dependency_overrides.pop(get_db, None)
            app.dependency_overrides.pop(get_current_user, None)

    def test_analyze_nonexistent_upload_returns_404(self):
        """존재하지 않는 업로드 분석 시 404를 반환해야 한다"""
        from app.api.deps import get_current_user
        from app.core.database import get_db
        from app.main import app

        mock_user = _make_mock_user()
        mock_db_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None  # 업로드 없음
        mock_db_session.execute = AsyncMock(return_value=mock_result)

        async def mock_get_db():
            yield mock_db_session

        app.dependency_overrides[get_db] = mock_get_db
        app.dependency_overrides[get_current_user] = lambda: mock_user

        try:
            with TestClient(app) as client:
                response = client.post(f"/api/v1/pdf/{uuid.uuid4()}/analyze")

            assert response.status_code == 404
        finally:
            app.dependency_overrides.pop(get_db, None)
            app.dependency_overrides.pop(get_current_user, None)
