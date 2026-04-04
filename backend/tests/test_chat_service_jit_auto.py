"""T-003: send_message_stream() 자동 JIT 트리거 테스트 (SPEC-JIT-002)

메시지에 보험 상품명이 포함되어 있고 캐시된 문서가 없을 때
자동으로 JIT 파이프라인을 실행하는 기능 검증.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.jit_rag.models import DocumentData, Section
from app.services.jit_rag.product_extractor import ProductInfo


def _make_document() -> DocumentData:
    """테스트용 DocumentData 팩토리"""
    return DocumentData(
        product_name="DB손보 아이사랑보험",
        source_url="https://example.com/doc.pdf",
        source_type="pdf",
        sections=[
            Section(
                title="제1조",
                content="용종수술 보장 내용입니다",
                page_number=1,
            )
        ],
        extracted_at="2024-01-01T00:00:00",
        page_count=42,
    )


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
    mock_settings.gemini_api_key = None
    mock_settings.gemini_api_key_2 = ""
    mock_settings.gemini_api_key_3 = ""
    mock_settings.chat_model = "gpt-4o-mini"
    mock_settings.chat_history_limit = 10
    mock_settings.chat_context_top_k = 5
    mock_settings.chat_context_threshold = 0.7

    mock_jit_store = AsyncMock()

    service = ChatService(
        db=mock_db,
        settings=mock_settings,
        jit_session_store=mock_jit_store,
    )

    # 세션 조회 모의
    mock_session = MagicMock()
    mock_session.id = uuid.uuid4()
    mock_session.messages = []
    service.get_session = AsyncMock(return_value=mock_session)

    # DB 카운트 쿼리 모의
    mock_count_result = MagicMock()
    mock_count_result.scalar.return_value = 0
    mock_db.execute = AsyncMock(return_value=mock_count_result)
    mock_db.flush = AsyncMock()

    # LLM 응답 모의
    mock_llm_response = MagicMock()
    mock_llm_response.content = "AI 응답 내용"
    service._llm_chain = MagicMock()
    service._llm_chain.generate = AsyncMock(return_value=mock_llm_response)

    # 의도 분류 모의 (비활성화)
    service._intent_classifier = None
    service._guidance_service = None

    return service, mock_jit_store


@pytest.mark.asyncio
async def test_auto_trigger_when_product_detected_and_no_cached_doc(
    mock_chat_service_with_jit,
) -> None:
    """보험 상품명 감지 + 캐시 없음 → JIT 파이프라인 실행, searching_document/document_ready 이벤트 발생"""
    service, mock_jit_store = mock_chat_service_with_jit
    session_id = uuid.uuid4()
    content = "DB손보 아이사랑보험에서 용종수술 보장 알려줘"

    # JIT 스토어에 문서 없음
    mock_jit_store.get = AsyncMock(return_value=None)
    mock_jit_store.save = AsyncMock()

    from app.services.jit_rag.document_fetcher import FetchResult

    mock_document = _make_document()

    # JIT 파이프라인 모의
    with (
        patch("app.services.chat_service.DocumentFinder") as mock_finder_cls,
        patch("app.services.chat_service.DocumentFetcher") as mock_fetcher_cls,
        patch("app.services.chat_service.TextExtractor") as mock_extractor_cls,
        patch("app.services.chat_service.DocumentData") as mock_doc_cls,
    ):
        mock_finder = AsyncMock()
        mock_finder.find_url = AsyncMock(return_value="https://example.com/doc.pdf")
        mock_finder_cls.return_value = mock_finder

        mock_fetch_result = FetchResult(
            content_type="application/pdf",
            data=b"%PDF fake content",
            url="https://example.com/doc.pdf",
        )
        mock_fetcher = AsyncMock()
        mock_fetcher.fetch = AsyncMock(return_value=mock_fetch_result)
        mock_fetcher_cls.return_value = mock_fetcher

        mock_extractor = MagicMock()
        mock_extractor.extract_from_pdf = MagicMock(return_value=mock_document.sections)
        mock_extractor_cls.return_value = mock_extractor

        # DocumentData 생성자 모의 - mock_document 반환
        mock_doc_cls.return_value = mock_document

        events = await _collect_events(service, session_id, content)

    event_types = [e["type"] for e in events]

    assert "searching_document" in event_types, "searching_document 이벤트가 없습니다"
    assert "document_ready" in event_types, "document_ready 이벤트가 없습니다"
    assert "token" in event_types
    assert "done" in event_types

    # searching_document 이벤트에 product_name 포함 확인
    searching_evt = next(e for e in events if e["type"] == "searching_document")
    assert "DB손보" in searching_evt["product_name"]

    # document_ready 이벤트에 page_count 포함 확인
    ready_evt = next(e for e in events if e["type"] == "document_ready")
    assert ready_evt["page_count"] == 42


@pytest.mark.asyncio
async def test_auto_trigger_skips_when_doc_already_cached(
    mock_chat_service_with_jit,
) -> None:
    """캐시된 문서가 있으면 자동 JIT 트리거를 건너뜀 (searching_document 이벤트 없음)"""
    service, mock_jit_store = mock_chat_service_with_jit
    session_id = uuid.uuid4()
    content = "DB손보 아이사랑보험에서 용종수술 보장 알려줘"

    # JIT 스토어에 이미 문서 있음
    mock_jit_store.get = AsyncMock(return_value=_make_document())

    events = await _collect_events(service, session_id, content)
    event_types = [e["type"] for e in events]

    assert "searching_document" not in event_types, (
        "문서가 이미 캐시되어 있는데 searching_document 이벤트가 발생했습니다"
    )
    assert "token" in event_types
    assert "done" in event_types


@pytest.mark.asyncio
async def test_auto_trigger_skips_when_no_product(
    mock_chat_service_with_jit,
) -> None:
    """보험사명이 없는 메시지는 자동 JIT 트리거 건너뜀"""
    service, mock_jit_store = mock_chat_service_with_jit
    session_id = uuid.uuid4()
    content = "실손보험이 뭐야?"

    # JIT 스토어에 문서 없음
    mock_jit_store.get = AsyncMock(return_value=None)

    events = await _collect_events(service, session_id, content)
    event_types = [e["type"] for e in events]

    assert "searching_document" not in event_types
    assert "document_ready" not in event_types
    assert "token" in event_types


@pytest.mark.asyncio
async def test_auto_trigger_fallback_on_failure(
    mock_chat_service_with_jit,
) -> None:
    """JIT 파이프라인 실패 시 벡터 검색으로 폴백 (token/done 이벤트는 정상 발생)"""
    from app.services.jit_rag.document_finder import DocumentNotFoundError

    service, mock_jit_store = mock_chat_service_with_jit
    session_id = uuid.uuid4()
    content = "DB손보 아이사랑보험에서 용종수술 보장 알려줘"

    mock_jit_store.get = AsyncMock(return_value=None)

    with patch("app.services.chat_service.DocumentFinder") as mock_finder_cls:
        mock_finder = AsyncMock()
        mock_finder.find_url = AsyncMock(side_effect=DocumentNotFoundError("문서 없음"))
        mock_finder_cls.return_value = mock_finder

        events = await _collect_events(service, session_id, content)

    event_types = [e["type"] for e in events]

    # 실패해도 token/done은 정상 발생
    assert "token" in event_types
    assert "done" in event_types
    # document_ready는 발생하지 않음
    assert "document_ready" not in event_types


@pytest.mark.asyncio
async def test_auto_trigger_skips_when_jit_store_is_none() -> None:
    """jit_store=None이면 자동 JIT 트리거 건너뜀"""
    from app.services.chat_service import ChatService

    mock_db = AsyncMock()
    mock_settings = MagicMock()
    mock_settings.gemini_api_key = None
    mock_settings.gemini_api_key_2 = ""
    mock_settings.gemini_api_key_3 = ""
    mock_settings.chat_model = "gpt-4o-mini"
    mock_settings.chat_history_limit = 10
    mock_settings.chat_context_top_k = 5
    mock_settings.chat_context_threshold = 0.7

    # jit_session_store=None으로 서비스 생성
    service = ChatService(
        db=mock_db,
        settings=mock_settings,
        jit_session_store=None,
    )

    mock_session = MagicMock()
    mock_session.id = uuid.uuid4()
    mock_session.messages = []
    service.get_session = AsyncMock(return_value=mock_session)

    mock_count_result = MagicMock()
    mock_count_result.scalar.return_value = 0
    mock_db.execute = AsyncMock(return_value=mock_count_result)
    mock_db.flush = AsyncMock()

    mock_llm_response = MagicMock()
    mock_llm_response.content = "AI 응답 내용"
    service._llm_chain = MagicMock()
    service._llm_chain.generate = AsyncMock(return_value=mock_llm_response)
    service._intent_classifier = None
    service._guidance_service = None

    session_id = uuid.uuid4()
    content = "DB손보 아이사랑보험에서 용종수술 보장 알려줘"

    events = await _collect_events(service, session_id, content)
    event_types = [e["type"] for e in events]

    assert "searching_document" not in event_types
    assert "token" in event_types
