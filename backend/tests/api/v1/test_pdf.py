"""PDF API 엔드포인트 통합 테스트 (SPEC-PDF-001 TASK-012~015)

PDF 업로드, 분석, 쿼리, 세션 관리 API를 테스트합니다.
"""

from __future__ import annotations

import io
import os
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

# 테스트 환경변수 설정
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost/testdb")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-testing-purposes-only")
os.environ.setdefault("GEMINI_API_KEY", "test-api-key")

VALID_PDF_CONTENT = b"%PDF-1.4 test pdf content"


def make_mock_user():
    """Mock User 객체 생성"""
    from app.models.user import User

    user = MagicMock(spec=User)
    user.id = uuid.uuid4()
    user.email = "test@example.com"
    user.is_active = True
    return user


def make_mock_upload(upload_id=None, user_id=None):
    """Mock PdfUpload 객체 생성"""
    from app.models.pdf import PdfUpload

    upload = MagicMock(spec=PdfUpload)
    upload.id = uuid.UUID(upload_id) if upload_id else uuid.uuid4()
    upload.user_id = uuid.UUID(user_id) if user_id else uuid.uuid4()
    upload.original_filename = "test.pdf"
    upload.file_path = "/fake/path/test.pdf"
    upload.file_size = len(VALID_PDF_CONTENT)
    upload.file_hash = "abc123"
    upload.status = "uploaded"
    return upload


def make_mock_session(session_id=None, user_id=None):
    """Mock PdfAnalysisSession 객체 생성"""
    from app.models.pdf import PdfAnalysisSession

    session = MagicMock(spec=PdfAnalysisSession)
    session.id = uuid.UUID(session_id) if session_id else uuid.uuid4()
    session.user_id = uuid.UUID(user_id) if user_id else uuid.uuid4()
    session.title = "테스트 세션"
    session.status = "active"
    session.initial_analysis = {"담보목록": ["상해사망"]}
    session.token_usage = {"total_tokens": 1000}
    session.upload_id = uuid.uuid4()
    session.created_at = "2024-01-01T00:00:00"
    session.last_activity_at = "2024-01-01T00:00:00"
    session.messages = []
    return session


@pytest.fixture
def mock_current_user():
    return make_mock_user()


@pytest.fixture
def mock_db():
    return AsyncMock()


@pytest.fixture
async def authenticated_client(mock_current_user, mock_db):
    """인증된 테스트 클라이언트"""
    from app.api.deps import get_current_user
    from app.api.v1.pdf import get_analysis_service, get_session_service, get_storage_service
    from app.core.database import get_db
    from app.main import app

    mock_storage = MagicMock()
    mock_storage.validate_mime_type = MagicMock()
    mock_storage.validate_magic_bytes = MagicMock()
    mock_storage.sanitize_filename = MagicMock(return_value="test.pdf")
    mock_storage.check_user_quota = AsyncMock()
    mock_storage.save_file = AsyncMock(return_value=("/fake/path.pdf", "hash123", 1024))
    mock_storage.delete_file = AsyncMock()
    mock_storage.MAX_FILE_SIZE = 50 * 1024 * 1024
    mock_storage.BASE_PATH = "/tmp/test_uploads"

    mock_session_svc = MagicMock()
    mock_session_svc.create = AsyncMock()
    mock_session_svc.get = AsyncMock()
    mock_session_svc.list_by_user = AsyncMock(return_value=[])
    mock_session_svc.delete = AsyncMock()
    mock_session_svc.get_conversation_history = AsyncMock(return_value=[])
    mock_session_svc.add_message = AsyncMock()

    mock_analysis_svc = MagicMock()
    mock_analysis_svc.analyze_initial = AsyncMock(return_value={"담보목록": []})
    mock_analysis_svc._calculate_token_usage = MagicMock(return_value={"total_tokens": 0})

    async def mock_stream(*args, **kwargs):
        yield "테스트 응답입니다."

    mock_analysis_svc.query_stream = mock_stream

    app.dependency_overrides[get_current_user] = lambda: mock_current_user
    app.dependency_overrides[get_db] = lambda: mock_db
    app.dependency_overrides[get_storage_service] = lambda: mock_storage
    app.dependency_overrides[get_session_service] = lambda: mock_session_svc
    app.dependency_overrides[get_analysis_service] = lambda: mock_analysis_svc

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client

    app.dependency_overrides.clear()


@pytest.fixture
async def unauthenticated_client():
    """인증되지 않은 테스트 클라이언트"""
    from app.core.database import get_db
    from app.main import app

    mock_db = AsyncMock()
    app.dependency_overrides[get_db] = lambda: mock_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client

    app.dependency_overrides.clear()


class TestUploadPDF:
    """PDF 업로드 테스트"""

    @pytest.mark.asyncio
    async def test_upload_pdf_success(self, authenticated_client, mock_current_user, mock_db):
        """PDF 업로드가 성공해야 함"""
        mock_upload = make_mock_upload(user_id=str(mock_current_user.id))
        mock_db.add = MagicMock()
        mock_db.flush = AsyncMock()
        mock_db.refresh = AsyncMock(side_effect=lambda obj: None)

        with patch("app.api.v1.pdf.PdfUpload", return_value=mock_upload):
            files = {"file": ("test.pdf", io.BytesIO(VALID_PDF_CONTENT), "application/pdf")}
            response = await authenticated_client.post("/api/v1/pdf/upload", files=files)

        assert response.status_code in [200, 201]

    @pytest.mark.asyncio
    async def test_upload_non_pdf_returns_400(self, authenticated_client, mock_db):
        """PDF가 아닌 파일 업로드 시 400이 반환되어야 함"""
        from fastapi import HTTPException as FHTTPException

        from app.api.v1.pdf import get_storage_service
        from app.main import app

        # validate_mime_type이 예외를 던지도록 오버라이드
        mock_storage_400 = MagicMock()
        mock_storage_400.validate_mime_type = MagicMock(
            side_effect=FHTTPException(status_code=400, detail="PDF 파일만 업로드 가능합니다.")
        )
        mock_storage_400.MAX_FILE_SIZE = 50 * 1024 * 1024

        app.dependency_overrides[get_storage_service] = lambda: mock_storage_400

        files = {"file": ("test.txt", io.BytesIO(b"not a pdf"), "text/plain")}
        response = await authenticated_client.post("/api/v1/pdf/upload", files=files)

        # 원래 mock으로 복원
        app.dependency_overrides[get_storage_service] = lambda: authenticated_client._transport.app.dependency_overrides.get(get_storage_service, get_storage_service)()

        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_upload_oversized_returns_413(self, authenticated_client):
        """50MB 초과 파일 업로드 시 413이 반환되어야 함"""

        from app.api.v1.pdf import get_storage_service
        from app.main import app

        mock_storage_413 = MagicMock()
        mock_storage_413.validate_mime_type = MagicMock()
        mock_storage_413.validate_magic_bytes = MagicMock()
        mock_storage_413.sanitize_filename = MagicMock(return_value="test.pdf")
        mock_storage_413.check_user_quota = AsyncMock()
        mock_storage_413.MAX_FILE_SIZE = 100  # 매우 작게 설정

        app.dependency_overrides[get_storage_service] = lambda: mock_storage_413

        content = b"%PDF-" + b"x" * 200  # 200 bytes > 100 limit
        files = {"file": ("large.pdf", io.BytesIO(content), "application/pdf")}
        response = await authenticated_client.post("/api/v1/pdf/upload", files=files)

        assert response.status_code == 413

    @pytest.mark.asyncio
    async def test_upload_requires_auth(self, unauthenticated_client):
        """인증 없이 업로드 시 401이 반환되어야 함"""
        files = {"file": ("test.pdf", io.BytesIO(VALID_PDF_CONTENT), "application/pdf")}
        response = await unauthenticated_client.post("/api/v1/pdf/upload", files=files)
        assert response.status_code == 401


class TestAnalyzePDF:
    """PDF 분석 테스트"""

    @pytest.mark.asyncio
    async def test_analyze_pdf_success(self, authenticated_client, mock_current_user, mock_db):
        """PDF 분석이 성공해야 함"""
        upload_id = str(uuid.uuid4())
        mock_upload = make_mock_upload(upload_id=upload_id, user_id=str(mock_current_user.id))
        mock_session = make_mock_session(user_id=str(mock_current_user.id))
        mock_session.upload_id = mock_upload.id
        mock_session.initial_analysis = {"담보목록": ["상해사망"]}
        mock_session.token_usage = {"total_tokens": 0}

        mock_upload_result = MagicMock()
        mock_upload_result.scalar_one_or_none.return_value = mock_upload
        mock_db.execute = AsyncMock(return_value=mock_upload_result)
        mock_db.flush = AsyncMock()

        from app.api.v1.pdf import get_analysis_service, get_session_service
        from app.main import app

        mock_analysis_svc = MagicMock()
        mock_analysis_svc.analyze_initial = AsyncMock(return_value={"담보목록": ["상해사망"]})

        mock_session_svc = MagicMock()
        mock_session_svc.create = AsyncMock(return_value=mock_session)

        app.dependency_overrides[get_analysis_service] = lambda: mock_analysis_svc
        app.dependency_overrides[get_session_service] = lambda: mock_session_svc

        response = await authenticated_client.post(f"/api/v1/pdf/{upload_id}/analyze")

        assert response.status_code in [200, 201]


class TestQueryPDF:
    """PDF 질의 테스트"""

    @pytest.mark.asyncio
    async def test_query_pdf_returns_stream(self, authenticated_client, mock_current_user, mock_db):
        """PDF 질의가 스트림 응답을 반환해야 함"""
        upload_id = str(uuid.uuid4())
        mock_upload = make_mock_upload(upload_id=upload_id, user_id=str(mock_current_user.id))
        mock_session = make_mock_session(user_id=str(mock_current_user.id))

        mock_upload_result = MagicMock()
        mock_upload_result.scalar_one_or_none.return_value = mock_upload
        mock_session_result = MagicMock()
        mock_session_result.scalar_one_or_none.return_value = mock_session
        mock_db.execute = AsyncMock(side_effect=[mock_upload_result, mock_session_result])

        from app.api.v1.pdf import get_analysis_service, get_session_service
        from app.main import app

        async def mock_stream(*args, **kwargs):
            yield "상해사망 보험금은"
            yield " 1억원입니다."

        mock_analysis_svc = MagicMock()
        mock_analysis_svc.query_stream = mock_stream

        mock_session_svc = MagicMock()
        mock_session_svc.get_conversation_history = AsyncMock(return_value=[])
        mock_session_svc.add_message = AsyncMock()

        app.dependency_overrides[get_analysis_service] = lambda: mock_analysis_svc
        app.dependency_overrides[get_session_service] = lambda: mock_session_svc

        response = await authenticated_client.post(
            f"/api/v1/pdf/{upload_id}/query",
            json={"question": "상해사망 보험금은 얼마인가요?"},
        )

        assert response.status_code == 200


class TestSessionManagement:
    """세션 관리 테스트"""

    @pytest.mark.asyncio
    async def test_list_sessions(self, authenticated_client, mock_current_user, mock_db):
        """세션 목록 조회가 성공해야 함"""
        from app.api.v1.pdf import get_session_service
        from app.main import app

        mock_sessions = [make_mock_session(user_id=str(mock_current_user.id)) for _ in range(2)]

        mock_session_svc = MagicMock()
        mock_session_svc.list_by_user = AsyncMock(return_value=mock_sessions)

        app.dependency_overrides[get_session_service] = lambda: mock_session_svc

        response = await authenticated_client.get("/api/v1/pdf/sessions")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 2

    @pytest.mark.asyncio
    async def test_delete_session(self, authenticated_client, mock_current_user, mock_db):
        """세션 삭제가 성공해야 함"""
        from app.api.v1.pdf import get_session_service, get_storage_service
        from app.main import app

        session_id = str(uuid.uuid4())

        mock_session_svc = MagicMock()
        mock_session_svc.delete = AsyncMock()

        mock_storage = MagicMock()
        mock_storage.delete_file = AsyncMock()

        app.dependency_overrides[get_session_service] = lambda: mock_session_svc
        app.dependency_overrides[get_storage_service] = lambda: mock_storage

        response = await authenticated_client.delete(f"/api/v1/pdf/sessions/{session_id}")

        assert response.status_code in [200, 204]
