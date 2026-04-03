"""JIT RAG 텍스트 추출기 (SPEC-JIT-001)

PDF 바이트 또는 HTML 문자열에서 약관 섹션을 추출하는 서비스.
pymupdf(fitz)로 PDF 파싱, 한국어 약관 조항 패턴(제X조) 감지.
"""

from __future__ import annotations

import io
import logging
import re

import pymupdf

from app.services.jit_rag.models import Section

logger = logging.getLogger(__name__)

# 한국어 약관 조항 패턴
# 예: "제1조", "제1조의2", "제 1 조"
_ARTICLE_PATTERN = re.compile(r"^제\s*\d+\s*조")
# 항 패턴: ①, ②, ... 또는 제1항
_PARA_PATTERN = re.compile(r"^[①②③④⑤⑥⑦⑧⑨⑩]|^제\s*\d+\s*항")
# 번호 목록 패턴: "1.", "2.", "가.", "나."
_LIST_PATTERN = re.compile(r"^\d+\.\s|^[가-힣]\.\s")


class TextExtractor:
    """PDF/HTML → 구조화된 섹션 목록 추출기

    약관 문서의 계층 구조(조/항/목)를 감지하여 섹션으로 분리.
    """

    def extract_from_pdf(self, pdf_bytes: bytes) -> list[Section]:
        """PDF 바이트에서 섹션 목록 추출

        Args:
            pdf_bytes: PDF 파일 바이트

        Returns:
            추출된 섹션 목록 (한국어 조항 패턴 기준으로 분리)
        """
        try:
            doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
            return self._parse_pdf_doc(doc)
        except Exception as e:
            logger.error("PDF 파싱 실패: %s", str(e))
            return []

    def _parse_pdf_doc(self, doc: pymupdf.Document) -> list[Section]:
        """pymupdf Document에서 섹션 추출

        페이지별 텍스트를 수집한 후 한국어 조항 패턴으로 분리.

        Args:
            doc: pymupdf Document 인스턴스

        Returns:
            섹션 목록
        """
        # 페이지별 텍스트 수집
        page_texts: list[tuple[int, str]] = []
        for page_num in range(len(doc)):
            page = doc[page_num]
            text = page.get_text("text")
            if text.strip():
                page_texts.append((page_num + 1, text))

        if not page_texts:
            return []

        # 전체 텍스트를 조항 패턴 기준으로 분리
        return self._split_into_sections(page_texts)

    def _split_into_sections(self, page_texts: list[tuple[int, str]]) -> list[Section]:
        """페이지 텍스트를 섹션으로 분리

        한국어 조항(제X조) 패턴을 감지하면 해당 패턴 기준으로 분리.
        패턴이 없으면 페이지 단위로 섹션 생성.

        Args:
            page_texts: (페이지번호, 텍스트) 튜플 목록

        Returns:
            섹션 목록
        """
        sections: list[Section] = []
        section_num = 1

        for page_number, text in page_texts:
            lines = text.split("\n")
            current_title = ""
            current_content_lines: list[str] = []
            found_article = False

            for line in lines:
                stripped = line.strip()
                if not stripped:
                    continue

                if _ARTICLE_PATTERN.match(stripped):
                    # 이전 섹션 저장
                    if current_content_lines:
                        content = "\n".join(current_content_lines).strip()
                        if content:
                            sections.append(
                                Section(
                                    title=current_title,
                                    content=content,
                                    page_number=page_number,
                                    section_number=section_num,
                                )
                            )
                            section_num += 1

                    current_title = stripped
                    current_content_lines = []
                    found_article = True
                else:
                    if found_article:
                        current_content_lines.append(stripped)
                    else:
                        # 조항 패턴 이전의 텍스트는 현재 섹션에 추가
                        current_content_lines.append(stripped)

            # 마지막 섹션 저장
            if current_content_lines:
                content = "\n".join(current_content_lines).strip()
                if content:
                    sections.append(
                        Section(
                            title=current_title,
                            content=content,
                            page_number=page_number,
                            section_number=section_num,
                        )
                    )
                    section_num += 1
            elif not found_article and page_texts:
                # 조항 패턴도 없고 내용도 없으면 페이지 텍스트 자체를 섹션으로
                pass

        return sections

    def extract_from_html(self, html: str) -> list[Section]:
        """HTML 문자열에서 섹션 목록 추출

        h1/h2/h3 태그를 제목으로, 이후 p/div 텍스트를 내용으로 분리.

        Args:
            html: HTML 문자열

        Returns:
            추출된 섹션 목록
        """
        try:
            from html.parser import HTMLParser

            sections: list[Section] = []
            section_num = 1

            class _ArticleParser(HTMLParser):
                """간단한 HTML → 섹션 파서"""

                def __init__(self) -> None:
                    super().__init__()
                    self.current_title = ""
                    self.current_content: list[str] = []
                    self._in_heading = False
                    self._in_content = False

                def handle_starttag(self, tag: str, attrs: list) -> None:
                    if tag in ("h1", "h2", "h3"):
                        # 이전 섹션 저장
                        if self.current_content:
                            content = " ".join(self.current_content).strip()
                            if content:
                                nonlocal section_num
                                sections.append(
                                    Section(
                                        title=self.current_title,
                                        content=content,
                                        page_number=1,
                                        section_number=section_num,
                                    )
                                )
                                section_num += 1
                        self.current_title = ""
                        self.current_content = []
                        self._in_heading = True
                        self._in_content = False
                    elif tag in ("p", "div", "li", "span"):
                        self._in_heading = False
                        self._in_content = True

                def handle_endtag(self, tag: str) -> None:
                    if tag in ("h1", "h2", "h3"):
                        self._in_heading = False
                    elif tag in ("p", "div", "li", "span"):
                        self._in_content = False

                def handle_data(self, data: str) -> None:
                    stripped = data.strip()
                    if not stripped:
                        return
                    if self._in_heading:
                        self.current_title += stripped
                    elif self._in_content:
                        self.current_content.append(stripped)

            parser = _ArticleParser()
            parser.feed(html)

            # 마지막 섹션 저장
            if parser.current_content:
                content = " ".join(parser.current_content).strip()
                if content:
                    sections.append(
                        Section(
                            title=parser.current_title,
                            content=content,
                            page_number=1,
                            section_number=section_num,
                        )
                    )

            return sections

        except Exception as e:
            logger.error("HTML 파싱 실패: %s", str(e))
            return []
