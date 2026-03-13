"""PDF 파서 단위 테스트 (TAG-012)

PDFParser의 텍스트 추출, 페이지별 추출,
한국어 텍스트 보존을 테스트.
pdfplumber를 mock으로 사용.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch


class TestPDFParserExtractText:
    """PDF 전체 텍스트 추출 테스트"""

    def test_extract_text_returns_string(self):
        """PDF에서 텍스트 추출 결과가 문자열이어야 한다"""
        from app.services.parser.pdf_parser import PDFParser

        mock_page1 = MagicMock()
        mock_page1.extract_text.return_value = "첫 번째 페이지 내용입니다."
        mock_page2 = MagicMock()
        mock_page2.extract_text.return_value = "두 번째 페이지 내용입니다."

        mock_pdf = MagicMock()
        mock_pdf.pages = [mock_page1, mock_page2]
        mock_pdf.__enter__ = MagicMock(return_value=mock_pdf)
        mock_pdf.__exit__ = MagicMock(return_value=False)

        with patch("pdfplumber.open", return_value=mock_pdf):
            parser = PDFParser()
            result = parser.extract_text("test.pdf")

        assert isinstance(result, str)
        assert len(result) > 0

    def test_extract_text_combines_all_pages(self):
        """모든 페이지의 텍스트가 합쳐져야 한다"""
        from app.services.parser.pdf_parser import PDFParser

        page_texts = ["첫 번째 페이지.", "두 번째 페이지.", "세 번째 페이지."]
        mock_pages = []
        for text in page_texts:
            mock_page = MagicMock()
            mock_page.extract_text.return_value = text
            mock_pages.append(mock_page)

        mock_pdf = MagicMock()
        mock_pdf.pages = mock_pages
        mock_pdf.__enter__ = MagicMock(return_value=mock_pdf)
        mock_pdf.__exit__ = MagicMock(return_value=False)

        with patch("pdfplumber.open", return_value=mock_pdf):
            parser = PDFParser()
            result = parser.extract_text("test.pdf")

        for text in page_texts:
            assert text in result

    def test_extract_text_preserves_korean(self):
        """한국어 텍스트가 올바르게 보존되어야 한다"""
        from app.services.parser.pdf_parser import PDFParser

        korean_content = "보험 약관 제1조 (목적) 이 약관은 피보험자의 상해를 보장합니다."

        mock_page = MagicMock()
        mock_page.extract_text.return_value = korean_content

        mock_pdf = MagicMock()
        mock_pdf.pages = [mock_page]
        mock_pdf.__enter__ = MagicMock(return_value=mock_pdf)
        mock_pdf.__exit__ = MagicMock(return_value=False)

        with patch("pdfplumber.open", return_value=mock_pdf):
            parser = PDFParser()
            result = parser.extract_text("test.pdf")

        # 한국어 내용이 보존되어야 함
        assert "보험" in result
        assert "약관" in result
        assert "피보험자" in result

    def test_extract_text_handles_none_page_text(self):
        """페이지 텍스트가 None인 경우를 처리해야 한다"""
        from app.services.parser.pdf_parser import PDFParser

        mock_page1 = MagicMock()
        mock_page1.extract_text.return_value = "정상 페이지 내용."
        mock_page2 = MagicMock()
        mock_page2.extract_text.return_value = None  # 빈 페이지

        mock_pdf = MagicMock()
        mock_pdf.pages = [mock_page1, mock_page2]
        mock_pdf.__enter__ = MagicMock(return_value=mock_pdf)
        mock_pdf.__exit__ = MagicMock(return_value=False)

        with patch("pdfplumber.open", return_value=mock_pdf):
            parser = PDFParser()
            result = parser.extract_text("test.pdf")

        # None 페이지가 있어도 정상 처리해야 함
        assert isinstance(result, str)
        assert "정상 페이지 내용." in result


class TestPDFParserExtractPages:
    """페이지별 텍스트 추출 테스트"""

    def test_extract_pages_returns_list(self):
        """페이지별 추출 결과가 리스트여야 한다"""
        from app.services.parser.pdf_parser import PDFParser

        mock_page = MagicMock()
        mock_page.extract_text.return_value = "페이지 내용"

        mock_pdf = MagicMock()
        mock_pdf.pages = [mock_page]
        mock_pdf.__enter__ = MagicMock(return_value=mock_pdf)
        mock_pdf.__exit__ = MagicMock(return_value=False)

        with patch("pdfplumber.open", return_value=mock_pdf):
            parser = PDFParser()
            result = parser.extract_pages("test.pdf")

        assert isinstance(result, list)

    def test_extract_pages_count_matches_pdf_pages(self):
        """추출된 페이지 수가 PDF 페이지 수와 일치해야 한다"""
        from app.services.parser.pdf_parser import PDFParser

        page_count = 5
        mock_pages = []
        for i in range(page_count):
            mock_page = MagicMock()
            mock_page.extract_text.return_value = f"페이지 {i + 1} 내용"
            mock_pages.append(mock_page)

        mock_pdf = MagicMock()
        mock_pdf.pages = mock_pages
        mock_pdf.__enter__ = MagicMock(return_value=mock_pdf)
        mock_pdf.__exit__ = MagicMock(return_value=False)

        with patch("pdfplumber.open", return_value=mock_pdf):
            parser = PDFParser()
            result = parser.extract_pages("test.pdf")

        assert len(result) == page_count

    def test_extract_pages_each_page_is_string(self):
        """각 페이지 텍스트가 문자열이어야 한다"""
        from app.services.parser.pdf_parser import PDFParser

        mock_pages = []
        for i in range(3):
            mock_page = MagicMock()
            mock_page.extract_text.return_value = f"페이지 {i + 1}"
            mock_pages.append(mock_page)

        mock_pdf = MagicMock()
        mock_pdf.pages = mock_pages
        mock_pdf.__enter__ = MagicMock(return_value=mock_pdf)
        mock_pdf.__exit__ = MagicMock(return_value=False)

        with patch("pdfplumber.open", return_value=mock_pdf):
            parser = PDFParser()
            result = parser.extract_pages("test.pdf")

        assert all(isinstance(page, str) for page in result)
