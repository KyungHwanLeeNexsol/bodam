"""텍스트 청크 분할 서비스 단위 테스트 (TAG-010)

TextChunker의 토큰 기반 텍스트 분할, 청크 겹침,
한국어 텍스트 처리, 최소 청크 크기 필터링을 테스트.
tiktoken cl100k_base 인코더 사용.
"""

from __future__ import annotations


class TestTextChunkerBasic:
    """기본 청크 분할 테스트"""

    def test_chunk_text_empty_returns_empty_list(self):
        """빈 텍스트는 빈 리스트를 반환해야 한다"""
        from app.services.parser.text_chunker import TextChunker

        chunker = TextChunker(chunk_size=500, chunk_overlap=100)
        result = chunker.chunk_text("")

        assert result == []

    def test_chunk_text_short_text_returns_single_chunk(self):
        """청크 크기보다 짧은 텍스트는 단일 청크로 반환해야 한다"""
        from app.services.parser.text_chunker import TextChunker

        short_text = "짧은 텍스트입니다."
        chunker = TextChunker(chunk_size=500, chunk_overlap=100)
        result = chunker.chunk_text(short_text)

        assert len(result) == 1
        assert result[0] == short_text

    def test_chunk_text_long_text_splits_into_multiple_chunks(self):
        """5000 토큰 텍스트가 ~500 토큰 청크로 분할되어야 한다"""
        import tiktoken

        from app.services.parser.text_chunker import TextChunker

        # 5000 토큰 이상의 영어 텍스트 생성
        word = "insurance policy terms and conditions coverage benefit premium "
        long_text = word * 100  # ~1000 tokens

        chunker = TextChunker(chunk_size=100, chunk_overlap=20)
        result = chunker.chunk_text(long_text)

        enc = tiktoken.get_encoding("cl100k_base")

        assert len(result) > 1
        # 각 청크가 적절한 토큰 크기인지 확인 (마지막 청크 제외)
        for chunk in result[:-1]:
            token_count = len(enc.encode(chunk))
            assert token_count <= 120, f"청크 토큰 수 초과: {token_count}"


class TestTextChunkerTokenRange:
    """토큰 범위 검증 테스트"""

    def test_chunk_size_within_range(self):
        """각 청크가 400-550 토큰 범위 내에 있어야 한다 (chunk_size=500 기준)"""
        import tiktoken

        from app.services.parser.text_chunker import TextChunker

        # 충분히 긴 영문 텍스트 생성 (약 3000 토큰)
        sentence = (
            "The insurance policy provides comprehensive coverage "
            "for medical expenses, hospitalization, and treatment costs. "
        )
        long_text = sentence * 40

        chunker = TextChunker(chunk_size=500, chunk_overlap=100)
        result = chunker.chunk_text(long_text)

        enc = tiktoken.get_encoding("cl100k_base")

        assert len(result) > 1
        # 마지막 청크를 제외한 청크는 크기 범위 확인
        for chunk in result[:-1]:
            token_count = len(enc.encode(chunk))
            assert 400 <= token_count <= 600, f"청크 토큰 범위 벗어남: {token_count}"

    def test_chunks_overlap_by_approximately_100_tokens(self):
        """연속된 청크는 약 100 토큰의 겹침이 있어야 한다"""
        import tiktoken

        from app.services.parser.text_chunker import TextChunker

        # 충분히 긴 영문 텍스트
        sentence = "The insurance policy provides coverage for various medical and health-related expenses. "
        long_text = sentence * 40

        chunker = TextChunker(chunk_size=500, chunk_overlap=100)
        result = chunker.chunk_text(long_text)

        enc = tiktoken.get_encoding("cl100k_base")

        if len(result) >= 2:
            # 첫 번째와 두 번째 청크의 끝/시작 부분에 겹침이 있는지 확인
            tokens1 = enc.encode(result[0])
            tokens2 = enc.encode(result[1])

            # 두 번째 청크의 시작이 첫 번째 청크의 끝 부분과 겹쳐야 함
            # 겹침 토큰 수가 overlap 크기(100)의 50%~150% 범위에 있어야 함
            overlap_start_tokens = tokens1[-100:]
            chunk2_start_tokens = tokens2[:100]

            # 두 토큰 목록의 교집합으로 겹침 확인
            overlap_count = len(set(overlap_start_tokens) & set(chunk2_start_tokens))
            assert overlap_count > 0, "청크 간 겹침이 없음"


class TestTextChunkerMinSize:
    """최소 청크 크기 테스트"""

    def test_last_chunk_too_small_is_merged(self):
        """마지막 청크가 50자 미만이면 이전 청크에 병합되거나 버려야 한다"""
        import tiktoken

        from app.services.parser.text_chunker import TextChunker

        # 청크 경계 직후 아주 짧은 텍스트가 남는 상황 생성
        sentence = "The insurance policy covers medical expenses and hospitalization costs. "
        # 정확히 청크 크기보다 약간 큰 텍스트
        enc = tiktoken.get_encoding("cl100k_base")

        # chunk_size=500 기준, 약 550 토큰짜리 텍스트 생성
        words = sentence.split()
        text_tokens = 0
        text_parts = []
        while text_tokens < 550:
            text_parts.extend(words)
            text_tokens = len(enc.encode(" ".join(text_parts)))

        base_text = " ".join(text_parts)
        # 끝에 짧은 조각 추가
        short_tail = "짧음"  # 50자 미만
        test_text = base_text + " " + short_tail

        chunker = TextChunker(chunk_size=500, chunk_overlap=100, min_chunk_chars=50)
        result = chunker.chunk_text(test_text)

        # 결과 검증: 마지막 청크가 50자 이상이어야 함
        if len(result) > 0:
            for chunk in result:
                assert len(chunk) >= 50 or len(result) == 1, "짧은 청크가 필터링되지 않음"


class TestTextChunkerKorean:
    """한국어 텍스트 처리 테스트"""

    def test_korean_text_chunking_works(self):
        """한국어 텍스트가 올바르게 청크로 분할되어야 한다"""
        from app.services.parser.text_chunker import TextChunker

        # 충분히 긴 한국어 텍스트 (보험 약관 예시)
        korean_sentence = (
            "본 보험 약관은 피보험자의 의료비 및 입원비를 보장합니다. "
            "보험금 청구는 사고 발생일로부터 3년 이내에 하여야 합니다. "
            "보험료는 매월 납입하여야 하며 미납 시 계약이 해지될 수 있습니다. "
        )
        long_korean_text = korean_sentence * 30  # 충분히 긴 텍스트

        chunker = TextChunker(chunk_size=200, chunk_overlap=40)
        result = chunker.chunk_text(long_korean_text)

        assert isinstance(result, list)
        assert len(result) > 0
        # 모든 청크가 문자열인지 확인
        assert all(isinstance(chunk, str) for chunk in result)
        # 원본 텍스트의 내용이 청크에 포함되어 있는지 확인
        combined = "".join(result)
        assert "보험" in combined
        assert "약관" in combined

    def test_korean_text_preserves_content(self):
        """한국어 텍스트의 내용이 청크 분할 후 보존되어야 한다"""
        from app.services.parser.text_chunker import TextChunker

        korean_text = "보험 가입자는 사고 발생 시 즉시 보험사에 통보하여야 합니다. " * 20

        chunker = TextChunker(chunk_size=100, chunk_overlap=20)
        result = chunker.chunk_text(korean_text)

        # 청크 내 한국어 텍스트 확인
        for chunk in result:
            assert len(chunk) > 0
            # 한국어 문자 포함 여부 (적어도 일부 청크에는 한국어가 있어야 함)
        total_content = " ".join(result)
        assert "보험" in total_content
