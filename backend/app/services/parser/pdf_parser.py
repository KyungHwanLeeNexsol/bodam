"""PDF 파서 모듈 (TAG-013)

pymupdf(fitz)를 사용하여 PDF 파일에서 텍스트 추출.
텍스트 추출 실패 시 OCR(pytesseract) 폴백.
한국어 텍스트 포함 다국어 PDF 처리 지원.
pdfplumber 대비 10-50x 빠르며 디지털 PDF 정확도 동등.
"""

from __future__ import annotations

import logging

import fitz  # pymupdf

logger = logging.getLogger(__name__)

# 선택적 의존성: pytesseract + PIL (OCR 폴백)
try:
    import pytesseract
    from PIL import Image

    _HAS_OCR = True
except ImportError:
    _HAS_OCR = False


class PDFParser:
    """PDF 파일 텍스트 추출기

    pymupdf(fitz)를 사용하여 PDF 파일의 텍스트를 추출.
    텍스트가 비어있는 페이지는 OCR 폴백 시도.
    페이지별 추출 및 전체 텍스트 합산 기능 제공.
    """

    # OCR로 추출한 텍스트의 최소 유효 길이 (노이즈 필터링)
    _OCR_MIN_TEXT_LENGTH = 10

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
        pymupdf 추출 실패 시 OCR 폴백.

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

        # 빈 페이지가 없으면 바로 반환
        empty_indices = [i for i, t in enumerate(page_texts) if not t.strip()]
        if not empty_indices:
            return page_texts

        # 빈 페이지에 대해 OCR 폴백
        if _HAS_OCR:
            page_texts = self._fallback_ocr(file_path, page_texts, empty_indices)

        return page_texts

    def _fallback_ocr(
        self,
        file_path: str,
        page_texts: list[str],
        empty_indices: list[int],
    ) -> list[str]:
        """pytesseract OCR 폴백 (이미지 전용 페이지 대상)

        pymupdf로 페이지를 이미지로 렌더링한 후 OCR 수행.
        """
        recovered = 0
        try:
            doc = fitz.open(file_path)
            for idx in empty_indices:
                if idx >= len(doc):
                    continue
                try:
                    # 페이지를 이미지로 렌더링 (300 DPI)
                    pix = doc[idx].get_pixmap(dpi=300)
                    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

                    # OCR 수행 (한국어 + 영어)
                    text = pytesseract.image_to_string(img, lang="kor+eng").strip()

                    if len(text) >= self._OCR_MIN_TEXT_LENGTH:
                        page_texts[idx] = text
                        recovered += 1
                except Exception:
                    logger.debug(
                        "[PDFParser] OCR 실패 (페이지 %d): %s", idx + 1, file_path
                    )
            doc.close()
        except Exception:
            logger.warning("[PDFParser] OCR 폴백 실패: %s", file_path)

        if recovered:
            logger.info(
                "[PDFParser] OCR 폴백으로 %d페이지 복구: %s",
                recovered,
                file_path,
            )
        return page_texts
