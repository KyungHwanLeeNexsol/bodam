"""document_not_found SSE 이벤트 테스트 (SPEC-JIT-003 T-008)

DocumentNotFoundError가 발생했을 때 SSE 스트림에
document_not_found 이벤트가 포함되어야 한다.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.jit_rag.document_finder import DocumentNotFoundError
from app.services.jit_rag.product_extractor import ProductInfo


async def _collect_events(service, session_id, content):
    """send_message_stream에서 모든 이벤트를 수집하는 헬퍼"""
    events = []
    async for event in service.send_message_stream(session_id, content):
        events.append(event)
    return events


@pytest.fixture
def mock_chat_service_with_jit():
    """JIT 스토어가 있는 ChatService 모의 객체 설정"""
    from app.services.chat_service import ChatService

    mock_db = AsyncMock()
    mock_settings = MagicMock()
    mock_settings.chat_history_limit = 5
    mock_settings.chat_context_top_k = 3
    mock_settings.chat_context_threshold = 0.3
    mock_settings.chat_model = "gpt-4o-mini"
    mock_settings.embedding_provider = "openai"
    mock_settings.openai_api_key = ""

    # 세션 쿼리 모의
    mock_session = MagicMock()
    mock_session.id = uuid.uuid4()
    mock_session.messages = []

    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = mock_session
    mock_result.scalar_one.return_value = 0
    mock_result.scalar.return_value = 0

    mock_db.execute = AsyncMock(return_value=mock_result)
    mock_db.add = MagicMock()
    mock_db.flush = AsyncMock()

    mock_jit_store = AsyncMock()
    # JIT 캐시 없음 (새 JIT 트리거 발생 조건)
    mock_jit_store.get.return_value = None

    service = ChatService(
        db=mock_db,
        settings=mock_settings,
        jit_session_store=mock_jit_store,
    )
    # RAG 서비스 지연 초기화 방지
    service._rag_initialized = True
    service._jit_section_finder = MagicMock()
    service._product_extractor = MagicMock()
    service._llm_chain = AsyncMock()
    service._llm_chain.generate = AsyncMock(return_value=MagicMock(content="AI 응답"))

    return service


class TestDocumentNotFoundSSEEvent:
    """document_not_found SSE 이벤트 테스트"""

    @pytest.mark.asyncio
    async def test_document_not_found_event_emitted_when_finder_fails(
        self, mock_chat_service_with_jit
    ):
        """DocumentNotFoundError 발생 시 document_not_found 이벤트가 방출되어야 한다"""
        service = mock_chat_service_with_jit
        session_id = uuid.uuid4()
        product_name = "DB손해보험 아이사랑보험"

        # 상품명 추출 성공 설정
        service._product_extractor.extract.return_value = ProductInfo(
            company="DB손보",
            product_name=product_name,
            full_query=product_name,
        )

        with patch(
            "app.services.chat_service.DocumentFinder",
        ) as mock_finder_cls:
            mock_finder_instance = AsyncMock()
            mock_finder_instance.find_url.side_effect = DocumentNotFoundError(
                f"보험 문서를 찾을 수 없습니다: {product_name}"
            )
            mock_finder_cls.return_value = mock_finder_instance

            events = await _collect_events(service, session_id, f"{product_name} 약관 내용 알려줘")

        event_types = [e["type"] for e in events]
        assert "document_not_found" in event_types

    @pytest.mark.asyncio
    async def test_document_not_found_event_contains_product_name(
        self, mock_chat_service_with_jit
    ):
        """document_not_found 이벤트에 product_name이 포함되어야 한다"""
        service = mock_chat_service_with_jit
        session_id = uuid.uuid4()
        product_name = "삼성화재 운전자보험"

        service._product_extractor.extract.return_value = ProductInfo(
            company="삼성화재",
            product_name=product_name,
            full_query=product_name,
        )

        with patch(
            "app.services.chat_service.DocumentFinder",
        ) as mock_finder_cls:
            mock_finder_instance = AsyncMock()
            mock_finder_instance.find_url.side_effect = DocumentNotFoundError(
                f"보험 문서를 찾을 수 없습니다: {product_name}"
            )
            mock_finder_cls.return_value = mock_finder_instance

            events = await _collect_events(service, session_id, f"{product_name} 알려줘")

        document_not_found_events = [e for e in events if e["type"] == "document_not_found"]
        assert len(document_not_found_events) == 1
        assert document_not_found_events[0]["product_name"] == product_name

    @pytest.mark.asyncio
    async def test_chat_continues_after_document_not_found(
        self, mock_chat_service_with_jit
    ):
        """document_not_found 이후에도 채팅 응답(token + done)이 방출되어야 한다"""
        service = mock_chat_service_with_jit
        session_id = uuid.uuid4()
        product_name = "알 수 없는 보험사 상품"

        service._product_extractor.extract.return_value = ProductInfo(
            company="알수없음",
            product_name=product_name,
            full_query=product_name,
        )

        with patch(
            "app.services.chat_service.DocumentFinder",
        ) as mock_finder_cls:
            mock_finder_instance = AsyncMock()
            mock_finder_instance.find_url.side_effect = DocumentNotFoundError(
                f"보험 문서를 찾을 수 없습니다: {product_name}"
            )
            mock_finder_cls.return_value = mock_finder_instance

            events = await _collect_events(service, session_id, f"{product_name} 알려줘")

        event_types = [e["type"] for e in events]
        # document_not_found 이후 token 이벤트가 있어야 함
        assert "document_not_found" in event_types
        assert "token" in event_types
        # 이벤트 순서: document_not_found → token
        doc_not_found_idx = event_types.index("document_not_found")
        token_idx = event_types.index("token")
        assert doc_not_found_idx < token_idx

    @pytest.mark.asyncio
    async def test_no_document_not_found_event_when_product_not_detected(
        self, mock_chat_service_with_jit
    ):
        """상품명이 감지되지 않으면 document_not_found 이벤트가 방출되지 않아야 한다"""
        service = mock_chat_service_with_jit
        session_id = uuid.uuid4()

        # 상품명 추출 실패 설정
        service._product_extractor.extract.return_value = None

        events = await _collect_events(service, session_id, "보험에 대해 일반적으로 알려줘")

        event_types = [e["type"] for e in events]
        assert "document_not_found" not in event_types
