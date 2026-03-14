"""텍스트 청크 분할 모듈 (TAG-011)

tiktoken을 사용하여 텍스트를 토큰 기반으로 분할.
청크 겹침(overlap) 처리 및 최소 청크 크기 필터링 포함.
calculate_chunk_quality()로 청크 품질 점수 계산 지원.
"""

from __future__ import annotations

import re
import unicodedata

import tiktoken

# 최적 토큰 수 범위 (품질 평가 기준)
_OPTIMAL_TOKEN_MIN = 200
_OPTIMAL_TOKEN_MAX = 500

# 품질 점수 가중치
_WEIGHT_TOKEN_COUNT = 0.3
_WEIGHT_KOREAN_RATIO = 0.3
_WEIGHT_SPECIAL_CHAR = 0.2
_WEIGHT_SENTENCE_COMPLETENESS = 0.2

# 문장 종결 패턴 (마침표, 물음표, 느낌표, 일본어 마침표)
_SENTENCE_END_PATTERN = re.compile(r"[.?!。]\s*$", re.MULTILINE)


def calculate_chunk_quality(text: str) -> float:
    """청크 텍스트의 품질 점수를 계산 (0.0~1.0)

    4가지 기준으로 품질을 평가하여 가중 평균을 반환:
    - 토큰 수 적절성 (0.3): 200~500 토큰이 최적
    - 한국어 문자 비율 (0.3): 한국어 비율이 높을수록 고득점
    - 특수문자 비율 (0.2): 특수문자 비율이 낮을수록 고득점
    - 문장 완결성 (0.2): 마침표/물음표/。로 끝나는 줄 비율

    Args:
        text: 품질을 평가할 청크 텍스트

    Returns:
        품질 점수 (0.0~1.0). 빈 텍스트는 0.0.
    """
    if not text or not text.strip():
        return 0.0

    encoder = tiktoken.get_encoding("cl100k_base")

    # 기준 1: 토큰 수 적절성
    token_count = len(encoder.encode(text))
    token_score = _calculate_token_score(token_count)

    # 기준 2: 한국어 문자 비율
    korean_score = _calculate_korean_ratio(text)

    # 기준 3: 특수문자 비율 (낮을수록 좋음)
    special_char_score = _calculate_special_char_score(text)

    # 기준 4: 문장 완결성
    completeness_score = _calculate_sentence_completeness(text)

    # 가중 평균 계산
    total = (
        token_score * _WEIGHT_TOKEN_COUNT
        + korean_score * _WEIGHT_KOREAN_RATIO
        + special_char_score * _WEIGHT_SPECIAL_CHAR
        + completeness_score * _WEIGHT_SENTENCE_COMPLETENESS
    )

    return max(0.0, min(1.0, total))


def _calculate_token_score(token_count: int) -> float:
    """토큰 수 기반 점수 계산 (내부 함수)

    Args:
        token_count: 청크의 토큰 수

    Returns:
        0.0~1.0 사이의 점수
    """
    if token_count <= 0:
        return 0.0
    if _OPTIMAL_TOKEN_MIN <= token_count <= _OPTIMAL_TOKEN_MAX:
        return 1.0
    if token_count < _OPTIMAL_TOKEN_MIN:
        # 최소 범위 미달: 선형 감소
        return token_count / _OPTIMAL_TOKEN_MIN
    # 최대 범위 초과: 선형 감소 (최대 2배까지)
    excess = token_count - _OPTIMAL_TOKEN_MAX
    decay = excess / _OPTIMAL_TOKEN_MAX
    return max(0.0, 1.0 - decay)


def _calculate_korean_ratio(text: str) -> float:
    """한국어 문자 비율 계산 (내부 함수)

    Args:
        text: 분석할 텍스트

    Returns:
        한국어 문자 비율 (0.0~1.0)
    """
    if not text:
        return 0.0
    total_chars = len(text.replace(" ", "").replace("\n", ""))
    if total_chars == 0:
        return 0.0
    korean_count = sum(
        1
        for ch in text
        if unicodedata.category(ch) in ("Lo",) and "\uAC00" <= ch <= "\uD7A3"
    )
    return min(1.0, korean_count / total_chars)


def _calculate_special_char_score(text: str) -> float:
    """특수문자 비율 기반 점수 계산 (낮을수록 고득점) (내부 함수)

    Args:
        text: 분석할 텍스트

    Returns:
        0.0~1.0 사이의 점수 (특수문자 비율이 낮을수록 높음)
    """
    if not text:
        return 0.0
    total_chars = len(text)
    if total_chars == 0:
        return 0.0
    # 특수문자: 알파벳, 숫자, 한국어, 공백/줄바꿈이 아닌 문자
    special_count = sum(
        1
        for ch in text
        if not ch.isalnum() and not ch.isspace() and ch not in ".,!?。"
    )
    special_ratio = special_count / total_chars
    return max(0.0, 1.0 - special_ratio * 2)


def _calculate_sentence_completeness(text: str) -> float:
    """문장 완결성 점수 계산 (내부 함수)

    마침표, 물음표, 느낌표, 일본어 마침표(。)로 끝나는
    줄의 비율을 기반으로 점수 계산.

    Args:
        text: 분석할 텍스트

    Returns:
        0.0~1.0 사이의 점수
    """
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    if not lines:
        return 0.0
    complete_count = sum(
        1 for line in lines if _SENTENCE_END_PATTERN.search(line)
    )
    return complete_count / len(lines)


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

    def chunk_text_with_metadata(self, text: str) -> list[dict]:
        """텍스트를 토큰 기반으로 청크로 분할하고 메타데이터 포함 반환

        chunk_text()와 동일한 분할 로직을 사용하되,
        각 청크의 토큰 수를 함께 반환하여 품질 평가 등에 활용 가능.

        Args:
            text: 분할할 텍스트

        Returns:
            {"text": str, "token_count": int} 딕셔너리 리스트.
            빈 텍스트는 빈 리스트 반환.
        """
        chunks = self.chunk_text(text)
        result = []
        for chunk in chunks:
            token_count = len(self._encoder.encode(chunk))
            result.append({"text": chunk, "token_count": token_count})
        return result

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
