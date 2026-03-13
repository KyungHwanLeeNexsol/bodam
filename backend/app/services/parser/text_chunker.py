"""텍스트 청크 분할 모듈 (TAG-011)

tiktoken을 사용하여 텍스트를 토큰 기반으로 분할.
청크 겹침(overlap) 처리 및 최소 청크 크기 필터링 포함.
"""

from __future__ import annotations

import tiktoken


class TextChunker:
    """토큰 기반 텍스트 청크 분할기

    tiktoken의 cl100k_base 인코더를 사용하여 텍스트를
    지정된 토큰 크기의 청크로 분할.
    한국어 텍스트 처리 가능.
    """

    def __init__(
        self,
        chunk_size: int = 500,
        chunk_overlap: int = 100,
        min_chunk_chars: int = 50,
    ) -> None:
        """텍스트 청크 분할기 초기화

        Args:
            chunk_size: 청크당 최대 토큰 수
            chunk_overlap: 연속 청크 간 겹치는 토큰 수
            min_chunk_chars: 최소 청크 문자 수 (이보다 짧은 청크는 병합 또는 제거)
        """
        self._chunk_size = chunk_size
        self._chunk_overlap = chunk_overlap
        self._min_chunk_chars = min_chunk_chars
        # cl100k_base: GPT-4, text-embedding-3-* 모델에서 사용하는 인코더
        # # @MX:NOTE: [AUTO] cl100k_base 인코더는 한국어 포함 다국어 텍스트 지원
        self._encoder = tiktoken.get_encoding("cl100k_base")

    def chunk_text(self, text: str) -> list[str]:
        """텍스트를 토큰 기반으로 청크로 분할

        Args:
            text: 분할할 텍스트

        Returns:
            청크 문자열 리스트. 빈 텍스트는 빈 리스트 반환.
        """
        if not text or not text.strip():
            return []

        # 전체 텍스트를 토큰으로 인코딩
        tokens = self._encoder.encode(text)

        # 텍스트가 청크 크기보다 작으면 단일 청크로 반환
        if len(tokens) <= self._chunk_size:
            return [text]

        chunks = []
        start = 0
        step = self._chunk_size - self._chunk_overlap  # 겹침을 고려한 이동 간격

        while start < len(tokens):
            end = min(start + self._chunk_size, len(tokens))
            chunk_tokens = tokens[start:end]

            # 토큰을 다시 문자열로 디코딩
            chunk_text = self._encoder.decode(chunk_tokens)

            if chunk_text.strip():
                chunks.append(chunk_text)

            if end >= len(tokens):
                break

            start += step

        # 최소 청크 크기 필터링: 너무 짧은 마지막 청크를 이전 청크에 병합
        chunks = self._merge_short_tail(chunks)

        return chunks

    def _merge_short_tail(self, chunks: list[str]) -> list[str]:
        """너무 짧은 마지막 청크를 이전 청크에 병합하거나 제거

        Args:
            chunks: 청크 목록

        Returns:
            병합 또는 제거 후 청크 목록
        """
        if len(chunks) <= 1:
            return chunks

        # 마지막 청크가 최소 크기보다 작으면 이전 청크에 병합
        if len(chunks[-1]) < self._min_chunk_chars:
            # 이전 청크에 병합 (이전 청크가 있는 경우)
            if len(chunks) >= 2:
                merged = chunks[-2] + chunks[-1]
                return chunks[:-2] + [merged]
            else:
                # 이전 청크가 없으면 그냥 반환 (단일 청크이므로)
                return chunks

        return chunks
