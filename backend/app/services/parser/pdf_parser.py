"""PDF 파서 모듈 (TAG-013)

pdfplumber를 사용하여 PDF 파일에서 텍스트 추출.
한국어 텍스트 포함 다국어 PDF 처리 지원.
"""

from __future__ import annotations

import warnings

import pdfplumber


class PDFParser:
    """PDF 파일 텍스트 추출기

    pdfplumber를 사용하여 PDF 파일의 텍스트를 추출.
    페이지별 추출 및 전체 텍스트 합산 기능 제공.
    """

    def extract_text(self, file_path: str) -> str:
        """PDF 파일에서 전체 텍스트 추출

        모든 페이지의 텍스트를 추출하여 하나의 문자열로 반환.
        None이 반환되는 페이지(빈 페이지)는 건너뜀.

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
        None 반환 페이지는 빈 문자열로 대체.

        Args:
            file_path: PDF 파일 경로

        Returns:
            페이지별 텍스트 리스트 (PDF 페이지 수와 동일한 길이)
        """
        # # @MX:NOTE: [AUTO] pdfplumber는 한국어를 포함한 유니코드 텍스트 추출 지원
        # pypdf 내부: 순환참조 PDF 메타데이터 파싱 시 재귀 한도 경고 억제 (텍스트 추출 무관)
        with warnings.catch_warnings():
            warnings.filterwarnings(
                "ignore",
                message=r".*could not be parsed due to exception.*",
            )
            with pdfplumber.open(file_path) as pdf:
                page_texts = []
                for page in pdf.pages:
                    text = page.extract_text()
                    # None인 경우(빈 페이지 또는 이미지 전용 페이지) 빈 문자열로 처리
                    page_texts.append(text if text is not None else "")
        return page_texts
