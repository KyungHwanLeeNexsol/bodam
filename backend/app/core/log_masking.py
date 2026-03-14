"""로그 민감 데이터 마스킹 모듈 (SPEC-SEC-001 M3)

structlog 프로세서로 이메일, 전화번호, JWT 토큰, 비밀번호 등
민감한 데이터를 자동으로 마스킹한다.
"""

from __future__ import annotations

import re
from typing import Any

# 민감 데이터 패턴 정규식
_EMAIL_PATTERN = re.compile(r"([\w.+-]{1,})(@[\w.-]+\.\w+)")
_PHONE_PATTERN = re.compile(r"(01[016789])-?(\d{3,4})-?(\d{4})")
_JWT_PATTERN = re.compile(r"(eyJ[\w-]+\.[\w-]+\.[\w-]+)")
_POLICY_NUMBER_PATTERN = re.compile(r"([A-Z]{2}\d{10,})")

# 로그에서 완전히 제거할 필드명 집합
_SENSITIVE_FIELD_NAMES: frozenset[str] = frozenset(
    {
        "password",
        "hashed_password",
        "secret_key",
        "api_key",
        "access_token",
        "refresh_token",
        "jwt_secret",
    }
)


def mask_email(email: str) -> str:
    """이메일 주소를 u***@domain.com 형식으로 마스킹

    첫 번째 문자만 표시하고 나머지 사용자명을 ***로 대체.
    사용자명이 2자 이상이면 처음 2자를 표시.

    Args:
        email: 마스킹할 이메일 주소

    Returns:
        str: 마스킹된 이메일 주소
    """
    match = _EMAIL_PATTERN.fullmatch(email.strip())
    if not match:
        return email

    local, domain = match.group(1), match.group(2)
    # 스펙(SPEC-SEC-001 REQ-SEC-024): 이메일은 처음 1자만 표시
    masked_local = local[0] + "***"

    return masked_local + domain


def mask_phone(phone: str) -> str:
    """한국 전화번호를 010-****-1234 형식으로 마스킹

    중간 4자리를 ****로 대체하고 마지막 4자리는 유지.

    Args:
        phone: 마스킹할 전화번호 (하이픈 있음/없음 모두 지원)

    Returns:
        str: 마스킹된 전화번호
    """
    match = _PHONE_PATTERN.fullmatch(phone.strip())
    if not match:
        return phone

    prefix = match.group(1)
    last = match.group(3)
    return f"{prefix}-****-{last}"


def mask_jwt(token: str) -> str:
    """JWT 토큰의 처음 10자만 표시하고 나머지를 ***로 마스킹

    Args:
        token: 마스킹할 JWT 토큰

    Returns:
        str: 마스킹된 JWT 토큰
    """
    if len(token) <= 10:
        return token[:3] + "***"
    return token[:10] + "***"


def mask_sensitive_text(text: str) -> str:
    """텍스트 내 민감한 패턴을 자동으로 탐지하고 마스킹

    이메일, 전화번호, JWT 토큰, 보험 증권 번호를 마스킹.

    Args:
        text: 마스킹할 텍스트

    Returns:
        str: 마스킹된 텍스트
    """
    # JWT 토큰 마스킹 (이메일보다 먼저 처리)
    def _replace_jwt(m: re.Match) -> str:
        return mask_jwt(m.group(1))

    text = _JWT_PATTERN.sub(_replace_jwt, text)

    # 이메일 마스킹
    def _replace_email(m: re.Match) -> str:
        return mask_email(m.group(0))

    text = _EMAIL_PATTERN.sub(_replace_email, text)

    # 전화번호 마스킹
    def _replace_phone(m: re.Match) -> str:
        prefix = m.group(1)
        last = m.group(3)
        sep = "-" if "-" in m.group(0) else ""
        if sep:
            return f"{prefix}{sep}****{sep}{last}"
        return f"{prefix}****{last}"

    text = _PHONE_PATTERN.sub(_replace_phone, text)

    # 보험 증권 번호 마스킹 (마지막 4자리만 표시)
    def _replace_policy(m: re.Match) -> str:
        num = m.group(1)
        return "****" + num[-4:]

    text = _POLICY_NUMBER_PATTERN.sub(_replace_policy, text)

    return text


def mask_event_dict(
    logger: Any,
    method: Any,
    event_dict: dict[str, Any],
) -> dict[str, Any]:
    """structlog 프로세서: event_dict 내 민감 데이터 마스킹

    - 민감 필드명(password 등)은 완전히 제거
    - 값 내의 이메일, JWT, 전화번호는 자동 마스킹

    Args:
        logger: structlog 로거 (미사용)
        method: 로그 메서드 이름 (미사용)
        event_dict: structlog 이벤트 딕셔너리

    Returns:
        dict: 마스킹 처리된 이벤트 딕셔너리
    """
    result: dict[str, Any] = {}

    for key, value in event_dict.items():
        # 민감 필드명이면 완전 제거
        if key in _SENSITIVE_FIELD_NAMES:
            continue

        # 문자열 값은 패턴 마스킹 적용
        if isinstance(value, str):
            result[key] = mask_sensitive_text(value)
        else:
            result[key] = value

    return result
