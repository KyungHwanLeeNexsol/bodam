"""텍스트 정제 서비스 단위 테스트 (TAG-012)

TextCleaner의 헤더/푸터 제거, 페이지 번호 제거,
한국어 특수문자 보존, 공백 정규화를 테스트.
"""

from __future__ import annotations


class TestTextCleanerPageNumbers:
    """페이지 번호 제거 테스트"""

    def test_remove_page_number_dash_format(self):
        """'- N -' 형식의 페이지 번호를 제거해야 한다"""
        from app.services.parser.text_cleaner import TextCleaner

        text = "보험 약관 내용입니다.\n- 1 -\n다음 내용입니다."
        cleaner = TextCleaner()
        result = cleaner.clean(text)

        assert "- 1 -" not in result
        assert "보험 약관 내용입니다." in result

    def test_remove_page_number_korean_format(self):
        """'페이지 N' 형식의 페이지 번호를 제거해야 한다"""
        from app.services.parser.text_cleaner import TextCleaner

        text = "보험 약관 제1조.\n페이지 5\n계속 내용입니다."
        cleaner = TextCleaner()
        result = cleaner.clean(text)

        assert "페이지 5" not in result
        assert "보험 약관 제1조." in result

    def test_remove_standalone_page_numbers(self):
        """단독으로 있는 숫자(페이지 번호)를 제거해야 한다"""
        from app.services.parser.text_cleaner import TextCleaner

        text = "내용 시작.\n\n42\n\n계속되는 내용."
        cleaner = TextCleaner()
        result = cleaner.clean(text)

        # 단독 숫자 줄이 제거되어야 함
        lines = [line.strip() for line in result.split("\n") if line.strip()]
        assert "42" not in lines


class TestTextCleanerWhitespace:
    """공백 정규화 테스트"""

    def test_normalize_multiple_spaces(self):
        """여러 공백이 단일 공백으로 정규화되어야 한다"""
        from app.services.parser.text_cleaner import TextCleaner

        text = "보험  약관   내용   입니다."
        cleaner = TextCleaner()
        result = cleaner.clean(text)

        assert "  " not in result  # 이중 공백 없어야 함

    def test_normalize_multiple_newlines(self):
        """여러 빈 줄이 단일 빈 줄로 정규화되어야 한다"""
        from app.services.parser.text_cleaner import TextCleaner

        text = "첫 번째 단락.\n\n\n\n두 번째 단락."
        cleaner = TextCleaner()
        result = cleaner.clean(text)

        assert "\n\n\n" not in result

    def test_strip_leading_trailing_whitespace(self):
        """앞뒤 공백이 제거되어야 한다"""
        from app.services.parser.text_cleaner import TextCleaner

        text = "   보험 약관 내용.   "
        cleaner = TextCleaner()
        result = cleaner.clean(text)

        assert result == result.strip()
        assert "보험 약관 내용." in result


class TestTextCleanerKoreanSpecialChars:
    """한국어 특수문자 보존 테스트"""

    def test_preserve_note_symbol(self):
        """※ 기호가 보존되어야 한다"""
        from app.services.parser.text_cleaner import TextCleaner

        text = "※ 중요한 보험 약관 사항입니다."
        cleaner = TextCleaner()
        result = cleaner.clean(text)

        assert "※" in result

    def test_preserve_arrow_symbol(self):
        """▶ 기호가 보존되어야 한다"""
        from app.services.parser.text_cleaner import TextCleaner

        text = "▶ 보험금 청구 방법 안내"
        cleaner = TextCleaner()
        result = cleaner.clean(text)

        assert "▶" in result

    def test_preserve_diamond_symbol(self):
        """◆ 기호가 보존되어야 한다"""
        from app.services.parser.text_cleaner import TextCleaner

        text = "◆ 주요 보장 내용"
        cleaner = TextCleaner()
        result = cleaner.clean(text)

        assert "◆" in result

    def test_preserve_all_korean_special_chars(self):
        """한국어 특수문자(※, ▶, ◆)가 모두 보존되어야 한다"""
        from app.services.parser.text_cleaner import TextCleaner

        text = "※ 참고사항\n▶ 보장 내용\n◆ 주요 조건"
        cleaner = TextCleaner()
        result = cleaner.clean(text)

        assert "※" in result
        assert "▶" in result
        assert "◆" in result


class TestTextCleanerMeaningPreservation:
    """한국어 텍스트 의미 보존 테스트"""

    def test_korean_text_meaning_preserved(self):
        """한국어 텍스트의 핵심 내용이 보존되어야 한다"""
        from app.services.parser.text_cleaner import TextCleaner

        text = """보험 약관 제1조 (목적)
이 약관은 피보험자가 질병 또는 상해로 인하여 입원하거나
수술을 받는 경우에 보험금을 지급함을 목적으로 합니다.

- 2 -

제2조 (용어의 정의)
※ 피보험자란 보험계약에 의하여 보험의 보호를 받는 자를 말합니다."""

        cleaner = TextCleaner()
        result = cleaner.clean(text)

        # 핵심 내용이 보존되어야 함
        assert "보험 약관" in result
        assert "피보험자" in result
        assert "보험금" in result
        # 페이지 번호는 제거되어야 함
        assert "- 2 -" not in result

    def test_clean_does_not_corrupt_korean_text(self):
        """정제 과정에서 한국어 텍스트가 손상되지 않아야 한다"""
        from app.services.parser.text_cleaner import TextCleaner

        original_content = "보험계약자는 보험료를 납입할 의무가 있습니다."
        text = f"{original_content}\n\n3\n\n다음 조항."

        cleaner = TextCleaner()
        result = cleaner.clean(text)

        assert original_content in result


class TestTextCleanerHeaderFooter:
    """헤더/푸터 제거 테스트"""

    def test_remove_empty_lines_cleanup(self):
        """불필요한 빈 줄들이 정리되어야 한다"""
        from app.services.parser.text_cleaner import TextCleaner

        text = "\n\n\n내용 시작\n\n\n\n내용 끝\n\n\n"
        cleaner = TextCleaner()
        result = cleaner.clean(text)

        # 연속된 3개 이상의 빈 줄이 없어야 함
        assert "\n\n\n" not in result

    def test_clean_returns_non_empty_for_valid_input(self):
        """유효한 입력에 대해 비어 있지 않은 결과를 반환해야 한다"""
        from app.services.parser.text_cleaner import TextCleaner

        text = "유효한 보험 약관 내용입니다."
        cleaner = TextCleaner()
        result = cleaner.clean(text)

        assert len(result) > 0
        assert "보험" in result
