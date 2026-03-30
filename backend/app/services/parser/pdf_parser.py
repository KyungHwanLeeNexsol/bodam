"""PDF 파서 모듈 (TAG-013)

pymupdf(fitz)를 사용하여 PDF 파일에서 텍스트 추출.
한국어 텍스트 포함 다국어 PDF 처리 지원.
pdfplumber 대비 10-50x 빠르며 디지털 PDF 정확도 동등.
"""

from __future__ import annotations

import fitz  # pymupdf


class PDFParser:
    """PDF 파일 텍스트 추출기

    pymupdf(fitz)를 사용하여 PDF 파일의 텍스트를 추출.
    페이지별 추출 및 전체 텍스트 합산 기능 제공.
    """

    def extract_text(self, file_path: str) -> str:
        """PDF 파일에서 전체 텍스트 추출

        모든 페이지의 텍스트를 추출하여 하나의 문자열로 반환.
        빈 페이지는 건너뜀.

        Args:
            file_path: PDF 파일 경로

        Returns:
            추출된 전체 텍스트 (페이지 구분자로 줄바꿈 사용)
        """
        pages = self.extract_pages(file_path)
        return "\n".join(pages)

    def extract_pages(self, file_path: str) -> list[str]:
        """PDF 파일에서 페이지별 텍스트 추출

        각 페이지의 텍스트를 리스트로 반환.
        빈 페이지는 빈 문자열로 대체.

        Args:
            file_path: PDF 파일 경로

        Returns:
            페이지별 텍스트 리스트 (PDF 페이지 수와 동일한 길이)
        """
        # @MX:NOTE: [AUTO] pymupdf(fitz) 사용 - pdfplumber 대비 10-50x 빠름, 스레드 안전, asyncio.gather 호환
        with fitz.open(file_path) as pdf:
            page_texts = []
            for page in pdf:
                text = page.get_text()
                page_texts.append(text if text else "")
        return page_texts
