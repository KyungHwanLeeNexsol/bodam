"""문서 처리 파이프라인 모듈 (TAG-015)

텍스트 또는 PDF 파일을 입력받아 정제 → 청크 분할 → 임베딩 생성까지
전체 파이프라인을 수행하는 DocumentProcessor 클래스 정의.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.parser.pdf_parser import PDFParser
    from app.services.parser.text_chunker import TextChunker
    from app.services.parser.text_cleaner import TextCleaner
    from app.services.rag.embeddings import EmbeddingService

logger = logging.getLogger(__name__)


class DocumentProcessor:
    """문서 처리 파이프라인 오케스트레이터

    텍스트 정제 → 청크 분할 → 임베딩 생성 파이프라인을 실행.
    모든 의존성은 생성자 주입(DI) 방식으로 제공받으며,
    단위 테스트 시 mock 객체를 주입 가능.
    """

    # # @MX:ANCHOR: [AUTO] DocumentProcessor는 RAG 인제스션 파이프라인의 핵심 진입점
    # # @MX:REASON: EmbeddingService, TextChunker, TextCleaner, PDFParser 모두 이 클래스를 통해 조합됨

    def __init__(
        self,
        embedding_service: EmbeddingService,
        text_chunker: TextChunker,
        text_cleaner: TextCleaner,
        pdf_parser: PDFParser,
    ) -> None:
        """DocumentProcessor 초기화

        Args:
            embedding_service: 텍스트 임베딩 생성 서비스
            text_chunker: 텍스트 청크 분할기
            text_cleaner: 텍스트 정제기
            pdf_parser: PDF 파일 텍스트 추출기
        """
        self._embedding_service = embedding_service
        self._text_chunker = text_chunker
        self._text_cleaner = text_cleaner
        self._pdf_parser = pdf_parser

    async def process_text(self, raw_text: str) -> list[dict]:
        """원시 텍스트를 정제 → 청크 분할 → 임베딩 생성하여 반환

        파이프라인 단계:
        1. TextCleaner로 텍스트 정제 (페이지 번호, 헤더/푸터 제거)
        2. TextChunker로 토큰 기반 청크 분할
        3. EmbeddingService로 각 청크의 임베딩 벡터 생성
        4. (chunk_text, embedding, chunk_index) 구조의 딕셔너리 리스트 반환

        Args:
            raw_text: 처리할 원시 텍스트

        Returns:
            각 청크에 대한 {"chunk_text": str, "embedding": list[float], "chunk_index": int} 딕셔너리 리스트.
            빈 텍스트 입력 시 빈 리스트 반환.

        Raises:
            Exception: 임베딩 API 호출 실패 시 예외 전파
        """
        # 빈 텍스트 처리
        if not raw_text or not raw_text.strip():
            return []

        # 1단계: 텍스트 정제
        cleaned_text = self._clean_text(raw_text)

        if not cleaned_text or not cleaned_text.strip():
            return []

        # 2단계: 청크 분할
        chunks = self._split_into_chunks(cleaned_text)

        if not chunks:
            return []

        # 3단계: 임베딩 생성 및 결과 조합
        return await self._embed_chunks(chunks)

    async def process_pdf(self, file_path: str) -> list[dict]:
        """PDF 파일에서 텍스트를 추출하여 파이프라인 실행

        PDFParser로 텍스트 추출 후 process_text 파이프라인 실행.

        Args:
            file_path: PDF 파일 경로

        Returns:
            각 청크에 대한 딕셔너리 리스트 (process_text와 동일한 구조)

        Raises:
            FileNotFoundError: 파일이 존재하지 않는 경우
            Exception: PDF 파싱 또는 임베딩 API 오류 시 예외 전파
        """
        # PDF에서 텍스트 추출
        raw_text = self._extract_pdf_text(file_path)

        # 추출된 텍스트로 파이프라인 실행
        return await self.process_text(raw_text)

    def _clean_text(self, text: str) -> str:
        """TextCleaner를 사용한 텍스트 정제 (내부 메서드)

        Args:
            text: 정제할 원시 텍스트

        Returns:
            정제된 텍스트
        """
        return self._text_cleaner.clean(text)

    def _split_into_chunks(self, text: str) -> list[str]:
        """TextChunker를 사용한 텍스트 청크 분할 (내부 메서드)

        Args:
            text: 분할할 텍스트

        Returns:
            청크 문자열 리스트
        """
        return self._text_chunker.chunk_text(text)

    def _extract_pdf_text(self, file_path: str) -> str:
        """PDFParser를 사용한 PDF 텍스트 추출 (내부 메서드)

        Args:
            file_path: PDF 파일 경로

        Returns:
            추출된 텍스트 문자열
        """
        return self._pdf_parser.extract_text(file_path)

    async def _embed_chunks(self, chunks: list[str]) -> list[dict]:
        """각 청크에 대해 임베딩 벡터를 생성하고 결과 딕셔너리 조합 (내부 메서드)

        Args:
            chunks: 임베딩할 청크 문자열 리스트

        Returns:
            {"chunk_text": str, "embedding": list[float], "chunk_index": int} 딕셔너리 리스트

        Raises:
            Exception: 임베딩 API 호출 실패 시 예외 전파
        """
        results = []
        for chunk_index, chunk_text in enumerate(chunks):
            logger.debug("청크 %d 임베딩 생성 중...", chunk_index)
            # 임베딩 생성 (실패 시 예외 전파)
            embedding = await self._embedding_service.embed_text(chunk_text)
            results.append(
                {
                    "chunk_text": chunk_text,
                    "embedding": embedding,
                    "chunk_index": chunk_index,
                }
            )
        return results
