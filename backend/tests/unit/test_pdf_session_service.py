"""PDFSessionService 단위 테스트 (SPEC-PDF-001 TASK-009/010)

세션 생성, 조회, 삭제, 메시지 관리 로직을 검증합니다.
DB는 AsyncMock으로 처리합니다.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException


class TestSessionCreate:
    """세션 생성 테스트"""

    @pytest.mark.asyncio
    async def test_create_session_success(self):
        """정상적인 조건에서 세션이 생성되어야 한다"""
        from app.services.pdf.session import PDFSessionService

        service = PDFSessionService()
        mock_db = AsyncMock()

        # 세션 수 제한 체크 통과 (현재 세션 수: 0)
        mock_count_result = MagicMock()
        mock_count_result.scalar.return_value = 0
        mock_db.execute = AsyncMock(return_value=mock_count_result)

        # 생성된 세션 mock
        mock_session = MagicMock()
        mock_session.id = uuid.uuid4()
        mock_session.title = "테스트 분석"
        mock_session.status = "active"
        mock_db.refresh = AsyncMock(side_effect=lambda obj: setattr(obj, "id", uuid.uuid4()) or None)
        mock_db.add = MagicMock()
        mock_db.flush = AsyncMock()

        with patch.object(service, "check_session_limit", AsyncMock()):
            result = await service.create(
                user_id=str(uuid.uuid4()),
                upload_id=str(uuid.uuid4()),
                title="테스트 분석",
                db=mock_db,
            )

        assert result is not None

    @pytest.mark.asyncio
    async def test_create_raises_429_when_limit_exceeded(self):
        """세션 수 제한 초과 시 429 예외를 발생시켜야 한다"""
        from app.services.pdf.session import PDFSessionService

        service = PDFSessionService()
        mock_db = AsyncMock()

        # check_session_limit이 429를 raise
        async def mock_limit_check(*args, **kwargs):
            raise HTTPException(status_code=429, detail="최대 세션 수 초과")

        with patch.object(service, "check_session_limit", side_effect=mock_limit_check):
            with pytest.raises(HTTPException) as exc_info:
                await service.create(
                    user_id=str(uuid.uuid4()),
                    upload_id=str(uuid.uuid4()),
                    title="테스트",
                    db=mock_db,
                )
            assert exc_info.value.status_code == 429


class TestSessionGet:
    """세션 조회 테스트"""

    @pytest.mark.asyncio
    async def test_get_existing_session(self):
        """존재하는 세션을 정상적으로 조회해야 한다"""
        from app.services.pdf.session import PDFSessionService

        service = PDFSessionService()
        mock_db = AsyncMock()

        session_id = uuid.uuid4()
        user_id = uuid.uuid4()
        mock_session = MagicMock()
        mock_session.id = session_id
        mock_session.user_id = user_id

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_session
        mock_db.execute = AsyncMock(return_value=mock_result)

        result = await service.get(
            session_id=str(session_id),
            user_id=str(user_id),
            db=mock_db,
        )

        assert result.id == session_id

    @pytest.mark.asyncio
    async def test_get_nonexistent_session_raises_404(self):
        """존재하지 않는 세션 조회 시 404 예외를 발생시켜야 한다"""
        from app.services.pdf.session import PDFSessionService

        service = PDFSessionService()
        mock_db = AsyncMock()

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute = AsyncMock(return_value=mock_result)

        with pytest.raises(HTTPException) as exc_info:
            await service.get(
                session_id=str(uuid.uuid4()),
                user_id=str(uuid.uuid4()),
                db=mock_db,
            )
        assert exc_info.value.status_code == 404


class TestSessionListByUser:
    """사용자 세션 목록 조회 테스트"""

    @pytest.mark.asyncio
    async def test_list_returns_sessions_for_user(self):
        """사용자의 세션 목록을 반환해야 한다"""
        from app.services.pdf.session import PDFSessionService

        service = PDFSessionService()
        mock_db = AsyncMock()

        user_id = uuid.uuid4()
        mock_sessions = [MagicMock(id=uuid.uuid4()) for _ in range(3)]

        mock_scalars = MagicMock()
        mock_scalars.all.return_value = mock_sessions
        mock_result = MagicMock()
        mock_result.scalars.return_value = mock_scalars
        mock_db.execute = AsyncMock(return_value=mock_result)

        result = await service.list_by_user(
            user_id=str(user_id),
            db=mock_db,
        )

        assert len(result) == 3

    @pytest.mark.asyncio
    async def test_list_returns_empty_when_no_sessions(self):
        """세션이 없으면 빈 목록을 반환해야 한다"""
        from app.services.pdf.session import PDFSessionService

        service = PDFSessionService()
        mock_db = AsyncMock()

        mock_scalars = MagicMock()
        mock_scalars.all.return_value = []
        mock_result = MagicMock()
        mock_result.scalars.return_value = mock_scalars
        mock_db.execute = AsyncMock(return_value=mock_result)

        result = await service.list_by_user(
            user_id=str(uuid.uuid4()),
            db=mock_db,
        )

        assert result == []


class TestCheckSessionLimit:
    """세션 수 제한 확인 테스트"""

    @pytest.mark.asyncio
    async def test_under_limit_passes(self):
        """세션 수가 5개 미만이면 통과해야 한다"""
        from app.services.pdf.session import PDFSessionService

        service = PDFSessionService()
        mock_db = AsyncMock()

        mock_result = MagicMock()
        mock_result.scalar.return_value = 3  # 현재 3개
        mock_db.execute = AsyncMock(return_value=mock_result)

        # 예외 없이 통과해야 함
        await service.check_session_limit(
            user_id=str(uuid.uuid4()),
            db=mock_db,
        )

    @pytest.mark.asyncio
    async def test_at_limit_raises_429(self):
        """세션 수가 5개이면 429 예외를 발생시켜야 한다"""
        from app.services.pdf.session import PDFSessionService

        service = PDFSessionService()
        mock_db = AsyncMock()

        mock_result = MagicMock()
        mock_result.scalar.return_value = 5  # 정확히 한도
        mock_db.execute = AsyncMock(return_value=mock_result)

        with pytest.raises(HTTPException) as exc_info:
            await service.check_session_limit(
                user_id=str(uuid.uuid4()),
                db=mock_db,
            )
        assert exc_info.value.status_code == 429

    @pytest.mark.asyncio
    async def test_over_limit_raises_429(self):
        """세션 수가 5개 초과이면 429 예외를 발생시켜야 한다"""
        from app.services.pdf.session import PDFSessionService

        service = PDFSessionService()
        mock_db = AsyncMock()

        mock_result = MagicMock()
        mock_result.scalar.return_value = 7  # 초과
        mock_db.execute = AsyncMock(return_value=mock_result)

        with pytest.raises(HTTPException) as exc_info:
            await service.check_session_limit(
                user_id=str(uuid.uuid4()),
                db=mock_db,
            )
        assert exc_info.value.status_code == 429


class TestSessionAddMessage:
    """세션 메시지 추가 테스트"""

    @pytest.mark.asyncio
    async def test_add_user_message_success(self):
        """사용자 메시지를 정상적으로 추가해야 한다"""
        from app.services.pdf.session import PDFSessionService

        service = PDFSessionService()
        mock_db = AsyncMock()

        session_id = uuid.uuid4()
        mock_message = MagicMock()
        mock_message.id = uuid.uuid4()
        mock_message.role = "user"
        mock_message.content = "보장 범위가 어떻게 되나요?"

        mock_db.add = MagicMock()
        mock_db.flush = AsyncMock()
        mock_db.refresh = AsyncMock(side_effect=lambda obj: None)
        mock_db.execute = AsyncMock(return_value=MagicMock())

        # add_message는 PdfAnalysisMessage 객체를 반환해야 함
        await service.add_message(
            session_id=str(session_id),
            role="user",
            content="보장 범위가 어떻게 되나요?",
            token_count=10,
            db=mock_db,
        )

        # DB에 메시지가 추가되었는지 확인
        mock_db.add.assert_called_once()
        mock_db.flush.assert_called()

    @pytest.mark.asyncio
    async def test_add_assistant_message_success(self):
        """어시스턴트 메시지를 정상적으로 추가해야 한다"""
        from app.services.pdf.session import PDFSessionService

        service = PDFSessionService()
        mock_db = AsyncMock()

        session_id = uuid.uuid4()

        mock_db.add = MagicMock()
        mock_db.flush = AsyncMock()
        mock_db.refresh = AsyncMock(side_effect=lambda obj: None)
        mock_db.execute = AsyncMock(return_value=MagicMock())

        await service.add_message(
            session_id=str(session_id),
            role="assistant",
            content="보장 범위는 다음과 같습니다...",
            token_count=50,
            db=mock_db,
        )

        mock_db.add.assert_called_once()


class TestGetConversationHistory:
    """대화 이력 조회 테스트"""

    @pytest.mark.asyncio
    async def test_get_history_returns_list(self):
        """대화 이력을 딕셔너리 목록으로 반환해야 한다"""
        from app.services.pdf.session import PDFSessionService

        service = PDFSessionService()
        mock_db = AsyncMock()

        session_id = uuid.uuid4()

        # mock 메시지 생성
        mock_msg1 = MagicMock()
        mock_msg1.role = "user"
        mock_msg1.content = "질문입니다"

        mock_msg2 = MagicMock()
        mock_msg2.role = "assistant"
        mock_msg2.content = "답변입니다"

        mock_scalars = MagicMock()
        mock_scalars.all.return_value = [mock_msg1, mock_msg2]
        mock_result = MagicMock()
        mock_result.scalars.return_value = mock_scalars
        mock_db.execute = AsyncMock(return_value=mock_result)

        result = await service.get_conversation_history(
            session_id=str(session_id),
            db=mock_db,
        )

        assert len(result) == 2
        assert result[0]["role"] == "user"
        assert result[0]["content"] == "질문입니다"
        assert result[1]["role"] == "assistant"
        assert result[1]["content"] == "답변입니다"

    @pytest.mark.asyncio
    async def test_get_empty_history(self):
        """대화 이력이 없으면 빈 목록을 반환해야 한다"""
        from app.services.pdf.session import PDFSessionService

        service = PDFSessionService()
        mock_db = AsyncMock()

        mock_scalars = MagicMock()
        mock_scalars.all.return_value = []
        mock_result = MagicMock()
        mock_result.scalars.return_value = mock_scalars
        mock_db.execute = AsyncMock(return_value=mock_result)

        result = await service.get_conversation_history(
            session_id=str(uuid.uuid4()),
            db=mock_db,
        )

        assert result == []


class TestSessionDelete:
    """세션 삭제 테스트"""

    @pytest.mark.asyncio
    async def test_delete_session_success(self):
        """세션 삭제 시 DB에서 제거되어야 한다"""
        from app.services.pdf.session import PDFSessionService

        service = PDFSessionService()
        mock_db = AsyncMock()

        session_id = uuid.uuid4()
        user_id = uuid.uuid4()

        mock_session = MagicMock()
        mock_session.id = session_id
        mock_session.upload_id = None  # 파일 없는 경우

        mock_db.delete = AsyncMock()
        mock_db.execute = AsyncMock(return_value=MagicMock())

        with patch.object(service, "get", AsyncMock(return_value=mock_session)):
            await service.delete(
                session_id=str(session_id),
                user_id=str(user_id),
                db=mock_db,
            )

        mock_db.delete.assert_called_once_with(mock_session)

    @pytest.mark.asyncio
    async def test_delete_session_with_file(self):
        """세션 삭제 시 연관 파일도 삭제되어야 한다"""
        from app.services.pdf.session import PDFSessionService

        service = PDFSessionService()
        mock_db = AsyncMock()

        session_id = uuid.uuid4()
        user_id = uuid.uuid4()
        upload_id = uuid.uuid4()

        mock_session = MagicMock()
        mock_session.id = session_id
        mock_session.upload_id = upload_id

        mock_upload = MagicMock()
        mock_upload.file_path = "/tmp/test.pdf"

        mock_upload_result = MagicMock()
        mock_upload_result.scalar_one_or_none.return_value = mock_upload
        mock_db.execute = AsyncMock(return_value=mock_upload_result)
        mock_db.delete = AsyncMock()

        mock_storage = AsyncMock()
        mock_storage.delete_file = AsyncMock()

        with patch.object(service, "get", AsyncMock(return_value=mock_session)):
            await service.delete(
                session_id=str(session_id),
                user_id=str(user_id),
                db=mock_db,
                storage_service=mock_storage,
            )

        mock_storage.delete_file.assert_called_once_with("/tmp/test.pdf")


class TestExpireInactiveSessions:
    """비활성 세션 만료 처리 테스트"""

    @pytest.mark.asyncio
    async def test_expire_returns_count(self):
        """만료 처리된 세션 수를 반환해야 한다"""
        from app.services.pdf.session import PDFSessionService

        service = PDFSessionService()
        mock_db = AsyncMock()

        # 2개 세션 만료 처리
        mock_result = MagicMock()
        mock_result.rowcount = 2
        mock_db.execute = AsyncMock(return_value=mock_result)

        count = await service.expire_inactive_sessions(db=mock_db)

        assert count == 2

    @pytest.mark.asyncio
    async def test_expire_zero_when_no_expired_sessions(self):
        """만료된 세션이 없으면 0을 반환해야 한다"""
        from app.services.pdf.session import PDFSessionService

        service = PDFSessionService()
        mock_db = AsyncMock()

        mock_result = MagicMock()
        mock_result.rowcount = 0
        mock_db.execute = AsyncMock(return_value=mock_result)

        count = await service.expire_inactive_sessions(db=mock_db)

        assert count == 0


class TestSessionConstants:
    """세션 서비스 상수 검증 테스트"""

    def test_max_sessions_per_user_is_5(self):
        """사용자당 최대 세션 수가 5이어야 한다"""
        from app.services.pdf.session import PDFSessionService

        assert PDFSessionService.MAX_SESSIONS_PER_USER == 5

    def test_session_expiry_is_24_hours(self):
        """세션 만료 시간이 24시간이어야 한다"""
        from app.services.pdf.session import PDFSessionService

        assert PDFSessionService.SESSION_EXPIRY_HOURS == 24
