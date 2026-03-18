"""텍스트 정제 모듈 (TAG-013)

PDF에서 추출한 텍스트의 헤더/푸터, 페이지 번호,
불필요한 공백을 제거하고 한국어 특수문자를 보존.
"""

from __future__ import annotations

import re


class TextCleaner:
    """보험 약관 PDF 텍스트 정제기

    PDF 추출 텍스트에서 페이지 번호, 헤더/푸터 등을 제거하고
    한국어 특수문자(※, ▶, ◆)를 보존하며 공백을 정규화.
    """

    # 페이지 번호 패턴: "- N -" 또는 "- N-" 형식
    _PAGE_NUM_DASH = re.compile(r"^\s*-\s*\d+\s*-\s*$", re.MULTILINE)

    # 페이지 번호 패턴: "페이지 N" 형식
    _PAGE_NUM_KOREAN = re.compile(r"^\s*페이지\s*\d+\s*$", re.MULTILINE)

    # 단독 숫자 줄 (페이지 번호): 줄 전체가 숫자만 있는 경우
    _STANDALONE_NUMBER = re.compile(r"^\s*\d+\s*$", re.MULTILINE)

    # 3개 이상 연속된 줄바꿈을 2개로 정규화
    _MULTI_NEWLINE = re.compile(r"\n{3,}")

    # 여러 공백(탭 포함)을 단일 공백으로 정규화
    _MULTI_SPACE = re.compile(r"[ \t]{2,}")

    def clean(self, text: str) -> str:
        """텍스트 정제 처리

        다음 순서로 정제:
        1. "- N -" 형식 페이지 번호 제거
        2. "페이지 N" 형식 페이지 번호 제거
        3. 단독 숫자(페이지 번호) 제거
        4. 여러 공백을 단일 공백으로 정규화
        5. 연속된 빈 줄을 최대 2줄로 정규화
        6. 앞뒤 공백 제거

        한국어 특수문자(※, ▶, ◆)는 보존됨.

        Args:
            text: 정제할 원본 텍스트

        Returns:
            정제된 텍스트
        """
        # NULL 바이트 제거 (PDF에서 간헐적으로 포함됨, PostgreSQL UTF-8 호환)
        text = text.replace("\x00", "")

        # 페이지 번호 패턴 제거 (순서 중요: 구체적인 패턴부터)
        text = self._PAGE_NUM_DASH.sub("", text)
        text = self._PAGE_NUM_KOREAN.sub("", text)
        text = self._STANDALONE_NUMBER.sub("", text)

        # 여러 공백 정규화 (한국어 특수문자는 영향받지 않음)
        text = self._MULTI_SPACE.sub(" ", text)

        # 연속된 빈 줄 정규화
        text = self._MULTI_NEWLINE.sub("\n\n", text)

        # 앞뒤 공백 제거
        return text.strip()
