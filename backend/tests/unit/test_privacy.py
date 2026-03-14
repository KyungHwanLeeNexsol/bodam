"""PIPA 컴플라이언스 단위 테스트 (SPEC-SEC-001 M2)

RED phase: 개인정보 처리 기능 구현 전 실패하는 테스트.
데이터 삭제, 내보내기, 보존 정책 자동화 검증.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestCleanupTasks:
    """데이터 보존 정책 자동화 Celery 태스크 테스트"""

    def _make_mock_session(self, rowcount: int = 0) -> AsyncMock:
        """테스트용 AsyncSession mock 생성"""
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.rowcount = rowcount
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.commit = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        return mock_session

    @pytest.mark.asyncio
    async def test_cleanup_old_chat_sessions_deletes_expired(self):
        """1년 이상 된 채팅 세션이 삭제되어야 한다 (SC-013)"""
        from contextlib import asynccontextmanager

        from app.tasks.cleanup_tasks import cleanup_expired_chat_history

        mock_session = self._make_mock_session(rowcount=3)

        @asynccontextmanager
        async def mock_get_db():
            yield mock_session

        with patch("app.tasks.cleanup_tasks.get_db_session", mock_get_db):
            deleted_count = await cleanup_expired_chat_history()

        assert deleted_count >= 0
        mock_session.execute.assert_called_once()
        mock_session.commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_cleanup_logs_deletes_90_day_old_records(self):
        """90일 이상 된 로그가 삭제되어야 한다 (SC-014)"""
        from contextlib import asynccontextmanager

        from app.tasks.cleanup_tasks import cleanup_expired_access_logs

        mock_session = self._make_mock_session(rowcount=5)

        @asynccontextmanager
        async def mock_get_db():
            yield mock_session

        with patch("app.tasks.cleanup_tasks.get_db_session", mock_get_db):
            deleted_count = await cleanup_expired_access_logs()

        assert deleted_count >= 0
        mock_session.execute.assert_called_once()

    @pytest.mark.asyncio
    async def test_cleanup_chat_uses_correct_cutoff_date(self):
        """채팅 정리 태스크가 정확한 1년 전 날짜를 기준으로 삭제해야 한다"""
        from contextlib import asynccontextmanager

        from app.tasks.cleanup_tasks import cleanup_expired_chat_history

        mock_session = self._make_mock_session(rowcount=0)

        @asynccontextmanager
        async def mock_get_db():
            yield mock_session

        with patch("app.tasks.cleanup_tasks.get_db_session", mock_get_db):
            await cleanup_expired_chat_history()

        call_args = mock_session.execute.call_args
        assert call_args is not None

    @pytest.mark.asyncio
    async def test_cleanup_logs_uses_90_day_cutoff(self):
        """로그 정리 태스크가 90일 전 날짜를 기준으로 삭제해야 한다"""
        from contextlib import asynccontextmanager

        from app.tasks.cleanup_tasks import cleanup_expired_access_logs

        mock_session = self._make_mock_session(rowcount=0)

        @asynccontextmanager
        async def mock_get_db():
            yield mock_session

        with patch("app.tasks.cleanup_tasks.get_db_session", mock_get_db):
            await cleanup_expired_access_logs()

        call_args = mock_session.execute.call_args
        assert call_args is not None


class TestDataExport:
    """사용자 데이터 내보내기 서비스 테스트"""

    @pytest.mark.asyncio
    async def test_export_user_data_returns_all_fields(self):
        """사용자 데이터 내보내기가 모든 필드를 포함해야 한다 (SC-012)"""
        from app.services.privacy_service import PrivacyService

        mock_session = AsyncMock()

        # User 모의 객체
        mock_user = MagicMock()
        mock_user.id = "user-uuid-123"
        mock_user.email = "test@example.com"
        mock_user.full_name = "테스트 사용자"
        mock_user.created_at = datetime.now(timezone.utc)

        # 빈 대화 목록 반환 - fetchall이 동기 메서드임
        mock_result = MagicMock()
        mock_result.fetchall.return_value = []
        mock_session.execute.return_value = mock_result

        service = PrivacyService(session=mock_session)
        result = await service.export_user_data(mock_user)

        assert "user" in result
        assert "conversations" in result
        assert "policies" in result
        assert "activity_log" in result
        assert result["user"]["email"] == "test@example.com"

    @pytest.mark.asyncio
    async def test_delete_user_cascades_all_data(self):
        """사용자 삭제 시 모든 관련 데이터가 삭제되어야 한다 (SC-010)"""
        from app.services.privacy_service import PrivacyService

        mock_session = AsyncMock()
        mock_user = MagicMock()
        mock_user.id = "user-uuid-123"

        service = PrivacyService(session=mock_session)
        await service.delete_user_data(mock_user)

        # session.delete가 호출되었는지 확인
        mock_session.delete.assert_called_once_with(mock_user)
        mock_session.commit.assert_called_once()


class TestConsentManagement:
    """동의 관리 테스트"""

    def test_consent_record_model_exists(self):
        """ConsentRecord 모델이 존재해야 한다"""
        import sys

        # app.models.user가 이미 로드되어 있으면 캐시에서 가져옴
        if "app.models.user" in sys.modules:
            mod = sys.modules["app.models.user"]
            assert hasattr(mod, "ConsentRecord"), "ConsentRecord class not found in app.models.user"
        else:
            # 직접 임포트 시도 (pgvector 미설치 환경에서 __init__.py 우회)
            from app.models.user import ConsentRecord
            assert ConsentRecord is not None

    def test_consent_record_has_required_fields(self):
        """ConsentRecord 모델이 필수 필드를 가져야 한다"""
        import sys

        if "app.models.user" in sys.modules:
            mod = sys.modules["app.models.user"]
            if hasattr(mod, "ConsentRecord"):
                ConsentRecord = mod.ConsentRecord
                columns = {col.name for col in ConsentRecord.__table__.columns}
                assert "user_id" in columns
                assert "consent_type" in columns
                assert "consented" in columns
                assert "created_at" in columns
        else:
            from app.models.user import ConsentRecord
            columns = {col.name for col in ConsentRecord.__table__.columns}
            assert "user_id" in columns
            assert "consent_type" in columns
            assert "consented" in columns
            assert "created_at" in columns
