"""XSS 살균 유틸리티 (SPEC-SEC-001 M3 TAG-2)

사용자 입력에서 XSS 공격 패턴을 탐지하고 거부하는 함수.
Pydantic field_validator에서 사용.
"""

from __future__ import annotations

import re

# XSS 공격 패턴 정규식
# <script>, javascript:, on*= 이벤트 핸들러 패턴 탐지
_XSS_PATTERNS = re.compile(
    r"<script[\s>]"  # <script> 태그
    r"|</script>"  # </script> 태그
    r"|javascript\s*:"  # javascript: 프로토콜
    r"|on\w+\s*=",  # onclick=, onload=, onerror= 등 이벤트 핸들러
    re.IGNORECASE,
)


def sanitize_input(value: str | None) -> str | None:
    """사용자 입력에서 XSS 패턴을 검사합니다.

    # @MX:ANCHOR: XSS 입력 검증 함수 - 스키마 유효성 검사에서 사용
    # @MX:REASON: SPEC-SEC-001 REQ-SEC-M3 구현체. 모든 사용자 문자열 필드에 적용

    Args:
        value: 검사할 입력 문자열 (None 허용)

    Returns:
        검증된 입력 문자열 (그대로 반환)

    Raises:
        ValueError: XSS 공격 패턴이 감지된 경우
    """
    if value is None:
        return None

    if _XSS_PATTERNS.search(value):
        raise ValueError("입력에 허용되지 않는 문자가 포함되어 있습니다")

    return value
