"""청크 품질 점수 함수 단위 테스트 (SPEC-EMBED-001 TASK-003)

calculate_chunk_quality(text) -> float (0.0~1.0) 함수의
4가지 품질 기준 및 가중치 적용 결과를 검증.
"""

from __future__ import annotations


class TestCalculateChunkQualityBasic:
    """calculate_chunk_quality() 기본 동작 테스트"""

    def test_returns_float_between_0_and_1(self):
        """결과가 0.0~1.0 사이의 float이어야 한다"""
        from app.services.parser.text_chunker import calculate_chunk_quality

        text = "보험 약관 제1조 목적 이 약관은 피보험자의 상해 및 질병을 보장합니다. " * 10
        result = calculate_chunk_quality(text)

        assert isinstance(result, float)
        assert 0.0 <= result <= 1.0

    def test_empty_text_returns_zero(self):
        """빈 텍스트는 0.0을 반환해야 한다"""
        from app.services.parser.text_chunker import calculate_chunk_quality

        result = calculate_chunk_quality("")

        assert result == 0.0

    def test_score_is_not_negative(self):
        """점수는 항상 0 이상이어야 한다"""
        from app.services.parser.text_chunker import calculate_chunk_quality

        texts = [
            "짧음",
            "!@#$%^&*()",
            "   ",
            "아무 내용이나 테스트용 텍스트입니다.",
        ]
        for text in texts:
            result = calculate_chunk_quality(text)
            assert result >= 0.0, f"음수 점수: {result} for '{text}'"


class TestTokenCountScore:
    """토큰 수 적절성 점수 테스트 (가중치 0.3)"""

    def test_optimal_token_range_scores_high(self):
        """200~500 토큰 범위의 텍스트가 높은 점수를 받아야 한다"""
        import tiktoken

        from app.services.parser.text_chunker import calculate_chunk_quality

        enc = tiktoken.get_encoding("cl100k_base")

        # 약 300 토큰 길이의 한국어 텍스트 생성
        sentence = "본 약관은 피보험자의 의료비 및 입원비를 보장합니다. "
        text = sentence
        while len(enc.encode(text)) < 250:
            text += sentence

        result = calculate_chunk_quality(text)
        # 최적 범위에서는 0.5 이상이어야 함
        assert result >= 0.5, f"최적 토큰 범위에서 점수 낮음: {result}"

    def test_very_short_token_count_lowers_score(self):
        """매우 짧은 텍스트(50 토큰 미만)는 낮은 점수를 받아야 한다"""
        from app.services.parser.text_chunker import calculate_chunk_quality

        short_text = "짧은 텍스트"
        long_optimal_text = "본 약관은 피보험자의 의료비를 보장합니다. " * 15

        short_score = calculate_chunk_quality(short_text)
        long_score = calculate_chunk_quality(long_optimal_text)

        assert long_score > short_score, "최적 범위 텍스트가 짧은 텍스트보다 높은 점수를 받아야 함"


class TestKoreanCharRatioScore:
    """한국어 문자 비율 점수 테스트 (가중치 0.3)"""

    def test_high_korean_ratio_gives_higher_score(self):
        """높은 한국어 비율이 낮은 한국어 비율보다 높은 점수를 받아야 한다"""
        from app.services.parser.text_chunker import calculate_chunk_quality

        # 한국어 위주 텍스트
        korean_text = "피보험자가 보험 기간 중 상해를 입거나 질병에 걸린 경우 보험금을 지급합니다. " * 10
        # 영어 위주 텍스트
        english_text = "The insurance policy provides comprehensive coverage for medical expenses. " * 10

        korean_score = calculate_chunk_quality(korean_text)
        english_score = calculate_chunk_quality(english_text)

        assert korean_score > english_score, (
            f"한국어 텍스트({korean_score})가 영어 텍스트({english_score})보다 높은 점수를 받아야 함"
        )


class TestSpecialCharRatioScore:
    """특수문자 비율 점수 테스트 (가중치 0.2)"""

    def test_low_special_char_ratio_gives_higher_score(self):
        """특수문자가 적은 텍스트가 높은 점수를 받아야 한다"""
        from app.services.parser.text_chunker import calculate_chunk_quality

        # 특수문자 거의 없는 텍스트
        clean_text = "피보험자가 보험 기간 중 상해를 입은 경우 보험금을 지급합니다. " * 10
        # 특수문자 많은 텍스트
        special_text = "!@#$%^&*()_+-={}[]|\\:;<>?,./~`" * 20

        clean_score = calculate_chunk_quality(clean_text)
        special_score = calculate_chunk_quality(special_text)

        assert clean_score > special_score, (
            f"깨끗한 텍스트({clean_score})가 특수문자 텍스트({special_score})보다 높은 점수를 받아야 함"
        )


class TestSentenceCompletenessScore:
    """문장 완결성 점수 테스트 (가중치 0.2)"""

    def test_complete_sentences_give_higher_score(self):
        """마침표/물음표/。로 끝나는 문장 비율이 높을수록 높은 점수를 받아야 한다"""
        from app.services.parser.text_chunker import calculate_chunk_quality

        # 문장이 완결된 텍스트
        complete_text = (
            "피보험자가 상해를 입은 경우 보험금을 지급합니다. "
            "보험료는 매월 납입해야 합니다. "
            "계약 해지 시 환급금이 지급됩니다. "
        ) * 5

        # 문장이 불완전한 텍스트 (마침표 없음)
        incomplete_text = (
            "피보험자 상해 보험금 지급 "
            "보험료 매월 납입 "
            "계약 해지 환급금 지급 "
        ) * 5

        complete_score = calculate_chunk_quality(complete_text)
        incomplete_score = calculate_chunk_quality(incomplete_text)

        assert complete_score > incomplete_score, (
            f"완결 문장({complete_score})이 불완전 문장({incomplete_score})보다 높은 점수를 받아야 함"
        )
