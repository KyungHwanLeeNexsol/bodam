"""인증 보안 유틸리티 단위 테스트 (SPEC-AUTH-001 Module 2)

비밀번호 해시/검증 및 JWT 토큰 생성/검증 로직 테스트.
"""

from __future__ import annotations

import time
import uuid

import pytest


class TestPasswordHashing:
    """bcrypt 비밀번호 해시/검증 테스트"""

    def test_hash_password_returns_string(self):
        """hash_password는 문자열을 반환해야 한다"""
        from app.core.security import hash_password

        result = hash_password("password123")
        assert isinstance(result, str)

    def test_hash_password_not_same_as_plain(self):
        """해시된 비밀번호는 평문과 달라야 한다"""
        from app.core.security import hash_password

        plain = "password123"
        hashed = hash_password(plain)
        assert hashed != plain

    def test_hash_password_different_each_time(self):
        """같은 비밀번호를 해시해도 매번 다른 결과가 나와야 한다 (salt)"""
        from app.core.security import hash_password

        hashed1 = hash_password("password123")
        hashed2 = hash_password("password123")
        assert hashed1 != hashed2

    def test_verify_password_correct(self):
        """올바른 비밀번호 검증은 True를 반환해야 한다"""
        from app.core.security import hash_password, verify_password

        plain = "password123"
        hashed = hash_password(plain)
        assert verify_password(plain, hashed) is True

    def test_verify_password_wrong(self):
        """잘못된 비밀번호 검증은 False를 반환해야 한다"""
        from app.core.security import hash_password, verify_password

        hashed = hash_password("correct_password")
        assert verify_password("wrong_password", hashed) is False

    def test_verify_password_empty_fails(self):
        """빈 비밀번호 검증은 False를 반환해야 한다"""
        from app.core.security import hash_password, verify_password

        hashed = hash_password("some_password")
        assert verify_password("", hashed) is False


class TestPasswordValidation:
    """비밀번호 강도 검증 테스트"""

    def test_validate_password_too_short(self):
        """8자 미만 비밀번호는 ValidationError를 발생시켜야 한다"""
        from app.core.security import validate_password_strength

        with pytest.raises(ValueError, match="8"):
            validate_password_strength("short")

    def test_validate_password_letters_only(self):
        """알파벳만으로 구성된 비밀번호는 ValidationError를 발생시켜야 한다"""
        from app.core.security import validate_password_strength

        with pytest.raises(ValueError):
            validate_password_strength("onlyletters")

    def test_validate_password_digits_only(self):
        """숫자만으로 구성된 비밀번호는 ValidationError를 발생시켜야 한다"""
        from app.core.security import validate_password_strength

        with pytest.raises(ValueError):
            validate_password_strength("12345678")

    def test_validate_password_strong(self):
        """강한 비밀번호는 예외 없이 통과해야 한다"""
        from app.core.security import validate_password_strength

        # 예외가 발생하지 않아야 함
        validate_password_strength("password123")
        validate_password_strength("Abcdef1!")
        validate_password_strength("secure42pass")


class TestJWTToken:
    """JWT 토큰 생성/검증 테스트"""

    def test_create_access_token_returns_string(self):
        """create_access_token은 문자열을 반환해야 한다"""
        from app.core.security import create_access_token

        user_id = uuid.uuid4()
        token = create_access_token(
            user_id=str(user_id), secret_key="test-secret", algorithm="HS256", expire_minutes=30,
        )
        assert isinstance(token, str)

    def test_create_access_token_has_three_parts(self):
        """JWT 토큰은 점(.)으로 구분된 세 부분을 가져야 한다"""
        from app.core.security import create_access_token

        user_id = uuid.uuid4()
        token = create_access_token(
            user_id=str(user_id), secret_key="test-secret", algorithm="HS256", expire_minutes=30,
        )
        parts = token.split(".")
        assert len(parts) == 3

    def test_decode_access_token_returns_user_id(self):
        """decode_access_token은 user_id를 반환해야 한다"""
        from app.core.security import create_access_token, decode_access_token

        user_id = str(uuid.uuid4())
        token = create_access_token(user_id=user_id, secret_key="test-secret", algorithm="HS256", expire_minutes=30)
        decoded_id = decode_access_token(token, secret_key="test-secret", algorithm="HS256")
        assert decoded_id == user_id

    def test_decode_invalid_token_raises(self):
        """유효하지 않은 토큰은 예외를 발생시켜야 한다"""
        from app.core.security import decode_access_token

        with pytest.raises(Exception):
            decode_access_token("invalid.token.here", secret_key="test-secret", algorithm="HS256")

    def test_decode_wrong_key_raises(self):
        """잘못된 시크릿 키로 디코딩하면 예외를 발생시켜야 한다"""
        from app.core.security import create_access_token, decode_access_token

        user_id = str(uuid.uuid4())
        token = create_access_token(user_id=user_id, secret_key="correct-secret", algorithm="HS256", expire_minutes=30)
        with pytest.raises(Exception):
            decode_access_token(token, secret_key="wrong-secret", algorithm="HS256")

    def test_token_expiry(self):
        """만료된 토큰은 예외를 발생시켜야 한다"""
        from app.core.security import create_access_token, decode_access_token

        user_id = str(uuid.uuid4())
        # 만료 시간을 0분으로 설정 (즉시 만료)
        token = create_access_token(user_id=user_id, secret_key="test-secret", algorithm="HS256", expire_minutes=0)
        time.sleep(1)
        with pytest.raises(Exception):
            decode_access_token(token, secret_key="test-secret", algorithm="HS256")
