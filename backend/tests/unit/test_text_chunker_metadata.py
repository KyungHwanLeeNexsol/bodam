"""TextChunker.chunk_text_with_metadata() 단위 테스트 (SPEC-EMBED-001 TASK-002)

chunk_text_with_metadata() 메서드가 텍스트와 토큰 수를 담은
딕셔너리 리스트를 반환하는지 테스트.
기존 chunk_text()의 하위 호환성도 검증.
"""

from __future__ import annotations


class TestChunkTextWithMetadata:
    """chunk_text_with_metadata() 메서드 테스트"""

    def test_returns_list_of_dicts_with_text_and_token_count(self):
        """결과가 'text'와 'token_count' 키를 가진 딕셔너리 리스트여야 한다"""
        from app.services.parser.text_chunker import TextChunker

        chunker = TextChunker(chunk_size=100, chunk_overlap=20)
        sentence = "보험 약관 제1조 이 약관은 피보험자의 상해를 보장합니다. "
        text = sentence * 10

        result = chunker.chunk_text_with_metadata(text)

        assert isinstance(result, list)
        assert len(result) > 0
        for item in result:
            assert isinstance(item, dict)
            assert "text" in item
            assert "token_count" in item

    def test_token_count_matches_actual_tokens(self):
        """token_count가 실제 tiktoken 토큰 수와 일치해야 한다"""
        import tiktoken

        from app.services.parser.text_chunker import TextChunker

        chunker = TextChunker(chunk_size=100, chunk_overlap=20)
        sentence = "보험 약관 제1조 이 약관은 피보험자의 상해를 보장합니다. "
        text = sentence * 10

        result = chunker.chunk_text_with_metadata(text)
        enc = tiktoken.get_encoding("cl100k_base")

        for item in result:
            expected_count = len(enc.encode(item["text"]))
            assert item["token_count"] == expected_count, (
                f"token_count 불일치: 기대={expected_count}, 실제={item['token_count']}"
            )

    def test_empty_text_returns_empty_list(self):
        """빈 텍스트는 빈 리스트를 반환해야 한다"""
        from app.services.parser.text_chunker import TextChunker

        chunker = TextChunker(chunk_size=500, chunk_overlap=100)
        result = chunker.chunk_text_with_metadata("")

        assert result == []

    def test_short_text_returns_single_dict(self):
        """청크 크기보다 짧은 텍스트는 단일 딕셔너리 리스트를 반환해야 한다"""
        from app.services.parser.text_chunker import TextChunker

        chunker = TextChunker(chunk_size=500, chunk_overlap=100)
        short_text = "짧은 보험 약관 텍스트입니다."

        result = chunker.chunk_text_with_metadata(short_text)

        assert len(result) == 1
        assert result[0]["text"] == short_text
        assert result[0]["token_count"] > 0

    def test_text_field_matches_chunk_text_output(self):
        """text 필드가 chunk_text()의 결과와 동일해야 한다 (하위 호환성)"""
        from app.services.parser.text_chunker import TextChunker

        chunker = TextChunker(chunk_size=100, chunk_overlap=20)
        sentence = "보험 약관 제1조 이 약관은 피보험자의 상해를 보장합니다. "
        text = sentence * 10

        chunks = chunker.chunk_text(text)
        metadata_chunks = chunker.chunk_text_with_metadata(text)

        assert len(chunks) == len(metadata_chunks)
        for chunk, meta in zip(chunks, metadata_chunks):
            assert chunk == meta["text"]


class TestChunkTextBackwardCompatibility:
    """기존 chunk_text() 하위 호환성 테스트"""

    def test_chunk_text_still_returns_list_of_strings(self):
        """chunk_text()는 여전히 문자열 리스트를 반환해야 한다"""
        from app.services.parser.text_chunker import TextChunker

        chunker = TextChunker(chunk_size=500, chunk_overlap=100)
        text = "보험 약관 텍스트입니다. " * 5

        result = chunker.chunk_text(text)

        assert isinstance(result, list)
        assert all(isinstance(item, str) for item in result)
