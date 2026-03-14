"""DocumentProcessor.process_text() 메타데이터 강화 단위 테스트 (SPEC-EMBED-001 TASK-004)

process_text()가 각 청크 딕셔너리에 metadata 필드를 포함하고,
기존 키(chunk_text, embedding, chunk_index)가 유지되는지 검증.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock


def _make_processor(mock_embedding: list[float] | None = None):
    """테스트용 DocumentProcessor 생성 헬퍼"""
    from app.services.parser.document_processor import DocumentProcessor
    from app.services.parser.pdf_parser import PDFParser
    from app.services.parser.text_chunker import TextChunker
    from app.services.parser.text_cleaner import TextCleaner
    from app.services.rag.embeddings import EmbeddingService

    if mock_embedding is None:
        mock_embedding = [0.1] * 1536

    # Mock EmbeddingService
    mock_embed_svc = MagicMock(spec=EmbeddingService)
    mock_embed_svc.embed_text = AsyncMock(return_value=mock_embedding)
    mock_embed_svc._model = "text-embedding-3-small"

    processor = DocumentProcessor(
        embedding_service=mock_embed_svc,
        text_chunker=TextChunker(chunk_size=100, chunk_overlap=20),
        text_cleaner=TextCleaner(),
        pdf_parser=MagicMock(spec=PDFParser),
    )
    return processor, mock_embed_svc


class TestProcessTextMetadata:
    """process_text() 메타데이터 포함 테스트"""

    async def test_result_contains_metadata_field(self):
        """결과 딕셔너리에 'metadata' 키가 포함되어야 한다"""
        processor, _ = _make_processor()
        text = "보험 약관 제1조 이 약관은 피보험자의 상해를 보장합니다. " * 5

        result = await processor.process_text(text)

        assert len(result) > 0
        for item in result:
            assert "metadata" in item, f"'metadata' 키가 없음: {item.keys()}"

    async def test_metadata_contains_token_count(self):
        """metadata에 'token_count' 키가 있어야 한다"""
        processor, _ = _make_processor()
        text = "보험 약관 제1조 이 약관은 피보험자의 상해를 보장합니다. " * 5

        result = await processor.process_text(text)

        for item in result:
            assert "token_count" in item["metadata"]
            assert isinstance(item["metadata"]["token_count"], int)
            assert item["metadata"]["token_count"] > 0

    async def test_metadata_contains_chunk_quality_score(self):
        """metadata에 'chunk_quality_score' 키가 있어야 한다"""
        processor, _ = _make_processor()
        text = "보험 약관 제1조 이 약관은 피보험자의 상해를 보장합니다. " * 5

        result = await processor.process_text(text)

        for item in result:
            assert "chunk_quality_score" in item["metadata"]
            score = item["metadata"]["chunk_quality_score"]
            assert isinstance(score, float)
            assert 0.0 <= score <= 1.0

    async def test_metadata_contains_embedding_model(self):
        """metadata에 'embedding_model' 키가 있어야 한다"""
        processor, mock_svc = _make_processor()
        text = "보험 약관 제1조 이 약관은 피보험자의 상해를 보장합니다. " * 5

        result = await processor.process_text(text)

        for item in result:
            assert "embedding_model" in item["metadata"]
            assert isinstance(item["metadata"]["embedding_model"], str)

    async def test_metadata_contains_embedded_at(self):
        """metadata에 'embedded_at' 키가 있어야 한다 (ISO 형식 문자열)"""
        processor, _ = _make_processor()
        text = "보험 약관 제1조 이 약관은 피보험자의 상해를 보장합니다. " * 5

        result = await processor.process_text(text)

        for item in result:
            assert "embedded_at" in item["metadata"]
            # ISO 형식 타임스탬프 확인
            embedded_at = item["metadata"]["embedded_at"]
            assert isinstance(embedded_at, str)
            # 간단한 형식 검증: 날짜 부분 포함 여부
            assert "T" in embedded_at or "-" in embedded_at


class TestProcessTextBackwardCompatibility:
    """process_text() 하위 호환성 테스트"""

    async def test_chunk_text_key_still_exists(self):
        """기존 'chunk_text' 키가 유지되어야 한다"""
        processor, _ = _make_processor()
        text = "보험 약관 제1조 이 약관은 피보험자의 상해를 보장합니다. " * 5

        result = await processor.process_text(text)

        for item in result:
            assert "chunk_text" in item

    async def test_embedding_key_still_exists(self):
        """기존 'embedding' 키가 유지되어야 한다"""
        processor, _ = _make_processor()
        text = "보험 약관 제1조 이 약관은 피보험자의 상해를 보장합니다. " * 5

        result = await processor.process_text(text)

        for item in result:
            assert "embedding" in item

    async def test_chunk_index_key_still_exists(self):
        """기존 'chunk_index' 키가 유지되어야 한다"""
        processor, _ = _make_processor()
        text = "보험 약관 제1조 이 약관은 피보험자의 상해를 보장합니다. " * 5

        result = await processor.process_text(text)

        for i, item in enumerate(result):
            assert "chunk_index" in item
            assert item["chunk_index"] == i

    async def test_empty_text_returns_empty_list(self):
        """빈 텍스트는 빈 리스트를 반환해야 한다"""
        processor, _ = _make_processor()

        result = await processor.process_text("")

        assert result == []
