"""인증 보안 유틸리티 (SPEC-AUTH-001 Module 2)

bcrypt 비밀번호 해시/검증 및 JWT 토큰 생성/검증 함수 제공.
passlib 대신 bcrypt를 직접 사용 (bcrypt 5.x 호환성).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import bcrypt
from jose import JWTError, jwt


def hash_password(plain_password: str) -> str:
    """비밀번호를 bcrypt로 해시합니다.

    Args:
        plain_password: 평문 비밀번호

    Returns:
        bcrypt 해시 문자열
    """
    # @MX:ANCHOR: 비밀번호 해시 함수 - 인증 시스템 핵심
    # @MX:REASON: 평문 비밀번호를 절대 저장하지 않도록 강제
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(plain_password.encode("utf-8"), salt)
    return hashed.decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """평문 비밀번호와 해시를 비교합니다.

    Args:
        plain_password: 평문 비밀번호
        hashed_password: 저장된 bcrypt 해시

    Returns:
        일치하면 True, 불일치하면 False
    """
    if not plain_password:
        return False
    try:
        return bcrypt.checkpw(
            plain_password.encode("utf-8"),
            hashed_password.encode("utf-8"),
        )
    except Exception:
        return False


def validate_password_strength(password: str) -> None:
    """비밀번호 강도를 검증합니다.

    규칙:
    - 최소 8자 이상
    - 알파벳만으로 구성되면 안 됨
    - 숫자만으로 구성되면 안 됨

    Args:
        password: 검증할 비밀번호

    Raises:
        ValueError: 비밀번호가 강도 조건을 충족하지 않을 경우
    """
    if len(password) < 8:
        raise ValueError("비밀번호는 최소 8자 이상이어야 합니다.")
    if password.isalpha():
        raise ValueError("비밀번호는 알파벳만으로 구성될 수 없습니다.")
    if password.isdigit():
        raise ValueError("비밀번호는 숫자만으로 구성될 수 없습니다.")


def create_access_token(
    user_id: str,
    secret_key: str,
    algorithm: str,
    expire_minutes: int,
) -> str:
    """JWT 액세스 토큰을 생성합니다.

    Args:
        user_id: 사용자 UUID 문자열 (sub 클레임에 저장)
        secret_key: JWT 서명 시크릿 키
        algorithm: 서명 알고리즘 (예: "HS256")
        expire_minutes: 토큰 만료 시간 (분)

    Returns:
        서명된 JWT 문자열
    """
    now = datetime.now(tz=UTC)
    expire = now + timedelta(minutes=expire_minutes)

    payload = {
        "sub": user_id,
        "exp": expire,
        "iat": now,
    }
    return jwt.encode(payload, secret_key, algorithm=algorithm)


def decode_access_token(
    token: str,
    secret_key: str,
    algorithm: str,
) -> str:
    """JWT 액세스 토큰을 디코딩하여 user_id를 반환합니다.

    Args:
        token: JWT 문자열
        secret_key: JWT 서명 시크릿 키
        algorithm: 서명 알고리즘

    Returns:
        user_id 문자열 (sub 클레임)

    Raises:
        JWTError: 토큰이 유효하지 않거나 만료된 경우
    """
    try:
        payload = jwt.decode(token, secret_key, algorithms=[algorithm])
        user_id: str | None = payload.get("sub")
        if user_id is None:
            raise JWTError("토큰에 사용자 ID가 없습니다.")
        return user_id
    except JWTError:
        raise
