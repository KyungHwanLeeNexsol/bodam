"""PDF 세션 서비스 단위 테스트 (SPEC-PDF-001 TASK-009/010)

PDFSessionService의 세션 CRUD 및 제한 관리를 테스트합니다.
"""

from __future__ import annotations

import os
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

# 테스트 환경변수 설정
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost/testdb")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-testing-purposes-only")


@pytest.fixture
def session_service():
    """PDFSessionService 픽스처"""
    from app.services.pdf.session import PDFSessionService

    return PDFSessionService()


@pytest.fixture
def mock_db():
    """Mock AsyncSession 픽스처"""
    return AsyncMock()


@pytest.fixture
def sample_user_id():
    return str(uuid.uuid4())


@pytest.fixture
def sample_upload_id():
    return str(uuid.uuid4())


@pytest.fixture
def sample_session_id():
    return str(uuid.uuid4())


def make_mock_session(session_id=None, user_id=None):
    """Mock PdfAnalysisSession 생성"""
    from app.models.pdf import PdfAnalysisSession

    session = MagicMock(spec=PdfAnalysisSession)
    session.id = uuid.UUID(session_id) if session_id else uuid.uuid4()
    session.user_id = uuid.UUID(user_id) if user_id else uuid.uuid4()
    session.title = "테스트 세션"
    session.status = "active"
    session.initial_analysis = {}
    session.token_usage = {}
    session.messages = []
    return session


class TestCreateSession:
    """세션 생성 테스트"""

    @pytest.mark.asyncio
    async def test_create_session(self, session_service, mock_db, sample_user_id, sample_upload_id):
        """세션이 성공적으로 생성되어야 함"""
        mock_session = make_mock_session()

        with patch.object(session_service, "check_session_limit", new=AsyncMock()):
            mock_db.add = MagicMock()
            mock_db.flush = AsyncMock()
            mock_db.refresh = AsyncMock()

            # flush 후 세션 객체 반환 모킹
            with patch(
                "app.services.pdf.session.PdfAnalysisSession",
                return_value=mock_session,
            ):
                result = await session_service.create(
                    user_id=sample_user_id,
                    upload_id=sample_upload_id,
                    title="새 세션",
                    db=mock_db,
                )

        assert result is not None


class TestGetSession:
    """세션 조회 테스트"""

    @pytest.mark.asyncio
    async def test_get_session_returns_not_found_for_wrong_user(
        self, session_service, mock_db
    ):
        """잘못된 사용자 ID로 조회 시 404 예외가 발생해야 함"""
        session_id = str(uuid.uuid4())
        user_id = str(uuid.uuid4())

        # DB 조회 결과 None 반환 (소유자 불일치)
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute = AsyncMock(return_value=mock_result)

        with pytest.raises(HTTPException) as exc_info:
            await session_service.get(
                session_id=session_id,
                user_id=user_id,
                db=mock_db,
            )
        assert exc_info.value.status_code == 404


class TestListSessions:
    """세션 목록 조회 테스트"""

    @pytest.mark.asyncio
    async def test_list_sessions_ordered_by_latest(self, session_service, mock_db, sample_user_id):
        """세션 목록이 최신순으로 정렬되어야 함"""
        mock_sessions = [make_mock_session() for _ in range(3)]

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = mock_sessions
        mock_db.execute = AsyncMock(return_value=mock_result)

        result = await session_service.list_by_user(
            user_id=sample_user_id,
            db=mock_db,
        )

        assert len(result) == 3


class TestAddMessage:
    """메시지 추가 테스트"""

    @pytest.mark.asyncio
    async def test_add_message_to_session(self, session_service, mock_db, sample_session_id):
        """세션에 메시지가 추가되어야 함"""
        from app.models.pdf import PdfAnalysisMessage

        mock_message = MagicMock(spec=PdfAnalysisMessage)
        mock_message.id = uuid.uuid4()
        mock_message.role = "user"
        mock_message.content = "질문입니다"

        mock_db.add = MagicMock()
        mock_db.flush = AsyncMock()
        mock_db.refresh = AsyncMock()

        with patch(
            "app.services.pdf.session.PdfAnalysisMessage",
            return_value=mock_message,
        ):
            result = await session_service.add_message(
                session_id=sample_session_id,
                role="user",
                content="질문입니다",
                token_count=10,
                db=mock_db,
            )

        assert result is not None


class TestSessionLimit:
    """세션 제한 테스트"""

    @pytest.mark.asyncio
    async def test_session_limit_raises_429_when_exceeded(
        self, session_service, mock_db, sample_user_id
    ):
        """5개 이상의 세션이 있을 때 429 예외가 발생해야 함"""
        mock_result = MagicMock()
        mock_result.scalar.return_value = 5  # MAX_SESSIONS_PER_USER = 5
        mock_db.execute = AsyncMock(return_value=mock_result)

        with pytest.raises(HTTPException) as exc_info:
            await session_service.check_session_limit(
                user_id=sample_user_id,
                db=mock_db,
            )
        assert exc_info.value.status_code == 429


class TestDeleteSession:
    """세션 삭제 테스트"""

    @pytest.mark.asyncio
    async def test_delete_session(self, session_service, mock_db):
        """세션이 성공적으로 삭제되어야 함"""
        session_id = str(uuid.uuid4())
        user_id = str(uuid.uuid4())

        mock_session = make_mock_session()
        mock_session.upload_id = uuid.uuid4()

        # get 메서드 모킹
        with patch.object(session_service, "get", new=AsyncMock(return_value=mock_session)):
            mock_upload = MagicMock()
            mock_upload.file_path = "/fake/path/test.pdf"
            mock_upload_result = MagicMock()
            mock_upload_result.scalar_one_or_none.return_value = mock_upload
            mock_db.execute = AsyncMock(return_value=mock_upload_result)
            mock_db.delete = AsyncMock()

            from app.services.pdf.storage import PDFStorageService

            mock_storage = MagicMock(spec=PDFStorageService)
            mock_storage.delete_file = AsyncMock()

            await session_service.delete(
                session_id=session_id,
                user_id=user_id,
                db=mock_db,
                storage_service=mock_storage,
            )

        mock_db.delete.assert_called_once_with(mock_session)
