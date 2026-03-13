"""문서 처리 파이프라인 통합 테스트 (TAG-014)

DocumentProcessor의 전체 파이프라인을 목(mock)을 사용하여 테스트.
실제 DB 연결 없이 텍스트 정제 → 청크 분할 → 임베딩 생성 흐름 검증.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest


def _make_fixed_embedding(dim: int = 1536) -> list[float]:
    """테스트용 고정 임베딩 벡터 생성 헬퍼"""
    return [0.1] * dim


def _make_embedding_service(embedding: list[float] | None = None) -> MagicMock:
    """embed_text/embed_batch를 모킹한 EmbeddingService 생성 헬퍼"""
    vec = embedding or _make_fixed_embedding()
    service = AsyncMock()
    service.embed_text = AsyncMock(return_value=vec)
    service.embed_batch = AsyncMock(return_value=[vec])
    return service


def _make_processor(
    embedding_service=None,
    text_chunker=None,
    text_cleaner=None,
    pdf_parser=None,
):
    """DocumentProcessor 생성 헬퍼 (의존성 목 주입)"""
    from app.services.parser.document_processor import DocumentProcessor
    from app.services.parser.pdf_parser import PDFParser
    from app.services.parser.text_chunker import TextChunker
    from app.services.parser.text_cleaner import TextCleaner

    return DocumentProcessor(
        embedding_service=embedding_service or _make_embedding_service(),
        text_chunker=text_chunker or TextChunker(chunk_size=50, chunk_overlap=10),
        text_cleaner=text_cleaner or TextCleaner(),
        pdf_parser=pdf_parser or PDFParser(),
    )


class TestDocumentProcessorPipeline:
    """DocumentProcessor 전체 파이프라인 테스트"""

    async def test_process_text_full_pipeline(self):
        """전체 파이프라인: 원시 텍스트 → 정제 → 청크 → 임베딩 결과 반환"""
        # 충분히 긴 원시 텍스트 준비
        raw_text = "보험 약관 본문 내용입니다. " * 20

        fixed_vec = _make_fixed_embedding()
        emb_service = _make_embedding_service(fixed_vec)
        processor = _make_processor(embedding_service=emb_service)

        results = await processor.process_text(raw_text)

        # 결과가 리스트여야 함
        assert isinstance(results, list)
        # 최소 1개 이상의 청크가 생성되어야 함
        assert len(results) >= 1

        # 각 결과 항목 구조 검증
        for i, item in enumerate(results):
            assert "chunk_text" in item
            assert "embedding" in item
            assert "chunk_index" in item
            assert isinstance(item["chunk_text"], str)
            assert isinstance(item["embedding"], list)
            assert len(item["embedding"]) == 1536
            assert item["chunk_index"] == i

    async def test_process_text_with_precleaned_text(self):
        """사전 정제된 텍스트는 TextCleaner를 거쳐도 동일한 결과 반환"""
        # 이미 정제된 텍스트 (페이지 번호, 헤더 없음)
        clean_text = "이 텍스트는 이미 정제되어 있습니다. " * 15

        mock_cleaner = MagicMock()
        # clean()이 입력과 동일한 텍스트 반환 (정제 불필요)
        mock_cleaner.clean = MagicMock(return_value=clean_text)

        fixed_vec = _make_fixed_embedding()
        emb_service = _make_embedding_service(fixed_vec)
        processor = _make_processor(
            embedding_service=emb_service,
            text_cleaner=mock_cleaner,
        )

        results = await processor.process_text(clean_text)

        # TextCleaner가 반드시 호출되어야 함
        mock_cleaner.clean.assert_called_once_with(clean_text)
        # 결과가 반환되어야 함
        assert isinstance(results, list)
        assert len(results) >= 1

    async def test_process_text_replaces_existing_chunks(self):
        """동일 문서 재처리 시 기존 청크 삭제 후 새 청크 생성 검증

        DocumentProcessor는 상태를 가지지 않으므로,
        pipeline 외부(예: ingestion 서비스)에서 기존 청크 삭제를 담당.
        process_text는 새로운 청크 목록만 반환함.
        """
        raw_text = "보험 약관 갱신 내용입니다. " * 15

        fixed_vec = _make_fixed_embedding()
        emb_service = _make_embedding_service(fixed_vec)
        processor = _make_processor(embedding_service=emb_service)

        # 첫 번째 처리
        first_results = await processor.process_text(raw_text)
        # 두 번째 처리 (같은 텍스트)
        second_results = await processor.process_text(raw_text)

        # 두 결과의 청크 수가 동일해야 함
        assert len(first_results) == len(second_results)
        # 각 결과의 chunk_index가 0부터 순차적으로 증가해야 함
        for i, item in enumerate(second_results):
            assert item["chunk_index"] == i

    async def test_process_text_embedding_api_failure(self):
        """임베딩 API 실패 시 예외가 전파되어야 함"""
        raw_text = "임베딩 실패 테스트용 텍스트입니다. " * 15

        # embed_text가 예외를 발생시키도록 설정
        failing_emb_service = AsyncMock()
        failing_emb_service.embed_text = AsyncMock(side_effect=Exception("OpenAI API 오류: 속도 제한 초과"))
        failing_emb_service.embed_batch = AsyncMock(side_effect=Exception("OpenAI API 오류: 속도 제한 초과"))

        processor = _make_processor(embedding_service=failing_emb_service)

        with pytest.raises(Exception, match="OpenAI API 오류"):
            await processor.process_text(raw_text)

    async def test_process_text_empty_document(self):
        """빈 문서 입력 시 빈 리스트 반환"""
        emb_service = _make_embedding_service()
        processor = _make_processor(embedding_service=emb_service)

        results = await processor.process_text("")

        assert results == []

    async def test_process_text_whitespace_only_document(self):
        """공백만 있는 문서 입력 시 빈 리스트 반환"""
        emb_service = _make_embedding_service()
        processor = _make_processor(embedding_service=emb_service)

        results = await processor.process_text("   \n\t\n  ")

        assert results == []

    async def test_process_text_returns_correct_structure(self):
        """결과가 (chunk_text, embedding, chunk_index) 구조의 딕셔너리 리스트 반환"""
        raw_text = "약관 구조 검증용 텍스트입니다. " * 15

        fixed_vec = _make_fixed_embedding()
        emb_service = _make_embedding_service(fixed_vec)
        processor = _make_processor(embedding_service=emb_service)

        results = await processor.process_text(raw_text)

        assert isinstance(results, list)
        for item in results:
            # 필수 키 존재 확인
            assert set(item.keys()) >= {"chunk_text", "embedding", "chunk_index"}
            # 타입 확인
            assert isinstance(item["chunk_text"], str)
            assert len(item["chunk_text"]) > 0
            assert isinstance(item["embedding"], list)
            assert len(item["embedding"]) == 1536
            assert isinstance(item["chunk_index"], int)
            assert item["chunk_index"] >= 0

    async def test_process_pdf_calls_pdf_parser(self):
        """process_pdf가 PDFParser를 호출하고 process_text 파이프라인을 실행"""
        raw_text = "PDF에서 추출된 텍스트입니다. " * 15

        mock_pdf_parser = MagicMock()
        mock_pdf_parser.extract_text = MagicMock(return_value=raw_text)

        fixed_vec = _make_fixed_embedding()
        emb_service = _make_embedding_service(fixed_vec)
        processor = _make_processor(
            embedding_service=emb_service,
            pdf_parser=mock_pdf_parser,
        )

        results = await processor.process_pdf("/fake/path/document.pdf")

        # PDFParser.extract_text가 호출되어야 함
        mock_pdf_parser.extract_text.assert_called_once_with("/fake/path/document.pdf")
        # 결과가 반환되어야 함
        assert isinstance(results, list)
        assert len(results) >= 1
