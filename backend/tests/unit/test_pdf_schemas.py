"""PDF 분석 서비스 Pydantic 스키마 단위 테스트 (SPEC-PDF-001 TASK-001)

요청/응답 스키마의 검증, 직렬화, 역직렬화를 테스트합니다.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime


class TestPDFUploadResponse:
    """PDFUploadResponse 스키마 테스트"""

    def test_valid_upload_response(self):
        """유효한 업로드 응답을 생성할 수 있어야 한다"""
        from app.services.pdf.schemas import PDFUploadResponse

        now = datetime.now(UTC)
        response = PDFUploadResponse(
            id=uuid.uuid4(),
            filename="test.pdf",
            file_size=1024,
            status="uploaded",
            created_at=now,
        )

        assert response.filename == "test.pdf"
        assert response.file_size == 1024
        assert response.status == "uploaded"

    def test_upload_response_has_uuid_id(self):
        """응답 ID가 UUID 타입이어야 한다"""
        from app.services.pdf.schemas import PDFUploadResponse

        upload_id = uuid.uuid4()
        response = PDFUploadResponse(
            id=upload_id,
            filename="test.pdf",
            file_size=1024,
            status="uploaded",
            created_at=datetime.now(UTC),
        )

        assert response.id == upload_id


class TestPDFAnalyzeResponse:
    """PDFAnalyzeResponse 스키마 테스트"""

    def test_valid_analyze_response(self):
        """유효한 분석 응답을 생성할 수 있어야 한다"""
        from app.services.pdf.schemas import PDFAnalyzeResponse

        response = PDFAnalyzeResponse(
            session_id=uuid.uuid4(),
            analysis={
                "담보목록": ["사망보험금"],
                "보상조건": {},
                "면책사항": [],
                "보상한도": {},
            },
            token_usage={"total_tokens": 100, "estimated_cost_usd": 0.001},
        )

        assert "담보목록" in response.analysis
        assert response.token_usage["total_tokens"] == 100


class TestPDFQueryRequest:
    """PDFQueryRequest 스키마 테스트"""

    def test_valid_query_request(self):
        """유효한 질의 요청을 생성할 수 있어야 한다"""
        from app.services.pdf.schemas import PDFQueryRequest

        request = PDFQueryRequest(question="보장 범위가 어떻게 되나요?")
        assert request.question == "보장 범위가 어떻게 되나요?"

    def test_empty_question_raises_validation_error(self):
        """빈 질문은 유효성 검증 오류를 발생시켜야 한다"""
        import pytest
        from pydantic import ValidationError

        from app.services.pdf.schemas import PDFQueryRequest

        with pytest.raises(ValidationError):
            PDFQueryRequest(question="")


class TestSessionListItem:
    """SessionListItem 스키마 테스트"""

    def test_valid_session_list_item(self):
        """유효한 세션 목록 아이템을 생성할 수 있어야 한다"""
        from app.services.pdf.schemas import SessionListItem

        item = SessionListItem(
            id=uuid.uuid4(),
            title="보험 약관 분석",
            status="active",
            created_at=datetime.now(UTC),
        )

        assert item.title == "보험 약관 분석"
        assert item.status == "active"
        assert item.last_activity_at is None  # 선택 필드

    def test_session_list_item_with_last_activity(self):
        """last_activity_at 필드를 포함한 세션 아이템을 생성할 수 있어야 한다"""
        from app.services.pdf.schemas import SessionListItem

        now = datetime.now(UTC)
        item = SessionListItem(
            id=uuid.uuid4(),
            title="분석 세션",
            status="active",
            created_at=now,
            last_activity_at=now,
        )

        assert item.last_activity_at == now


class TestMessageItem:
    """MessageItem 스키마 테스트"""

    def test_user_message_item(self):
        """사용자 메시지 아이템을 생성할 수 있어야 한다"""
        from app.services.pdf.schemas import MessageItem

        item = MessageItem(
            id=uuid.uuid4(),
            role="user",
            content="질문합니다.",
            created_at=datetime.now(UTC),
        )

        assert item.role == "user"
        assert item.content == "질문합니다."
        assert item.token_count is None  # 선택 필드

    def test_assistant_message_item(self):
        """어시스턴트 메시지 아이템을 생성할 수 있어야 한다"""
        from app.services.pdf.schemas import MessageItem

        item = MessageItem(
            id=uuid.uuid4(),
            role="assistant",
            content="답변합니다.",
            token_count=50,
            created_at=datetime.now(UTC),
        )

        assert item.role == "assistant"
        assert item.token_count == 50


class TestSessionDetail:
    """SessionDetail 스키마 테스트"""

    def test_session_detail_with_messages(self):
        """메시지 목록을 포함한 세션 상세를 생성할 수 있어야 한다"""
        from app.services.pdf.schemas import MessageItem, SessionDetail

        now = datetime.now(UTC)
        messages = [
            MessageItem(
                id=uuid.uuid4(),
                role="user",
                content="질문",
                created_at=now,
            )
        ]

        detail = SessionDetail(
            id=uuid.uuid4(),
            title="세션 제목",
            status="active",
            messages=messages,
        )

        assert len(detail.messages) == 1
        assert detail.messages[0].role == "user"

    def test_session_detail_defaults(self):
        """세션 상세의 기본값이 올바르게 설정되어야 한다"""
        from app.services.pdf.schemas import SessionDetail

        detail = SessionDetail(
            id=uuid.uuid4(),
            title="세션",
            status="active",
        )

        assert detail.messages == []
        assert detail.initial_analysis is None
        assert detail.token_usage is None
        assert detail.upload_id is None


class TestUploadStatusResponse:
    """UploadStatusResponse 스키마 테스트"""

    def test_valid_upload_status(self):
        """유효한 업로드 상태 응답을 생성할 수 있어야 한다"""
        from app.services.pdf.schemas import UploadStatusResponse

        response = UploadStatusResponse(
            id=uuid.uuid4(),
            status="completed",
            original_filename="insurance.pdf",
            file_size=2048,
            created_at=datetime.now(UTC),
        )

        assert response.status == "completed"
        assert response.original_filename == "insurance.pdf"
        assert response.page_count is None  # 선택 필드

    def test_upload_status_with_page_count(self):
        """페이지 수를 포함한 업로드 상태 응답을 생성할 수 있어야 한다"""
        from app.services.pdf.schemas import UploadStatusResponse

        response = UploadStatusResponse(
            id=uuid.uuid4(),
            status="completed",
            original_filename="insurance.pdf",
            file_size=2048,
            page_count=45,
            created_at=datetime.now(UTC),
        )

        assert response.page_count == 45
