"""FieldEncryptor 단위 테스트 (SPEC-B2B-001 Phase 3 - PII 암호화)

TDD RED 페이즈: FieldEncryptor 클래스의 예상 동작을 테스트로 정의.
"""

from __future__ import annotations

import pytest


class TestFieldEncryptorInit:
    """FieldEncryptor 초기화 테스트"""

    def test_init_with_valid_key(self):
        """유효한 Fernet 키로 초기화 성공"""
        from cryptography.fernet import Fernet

        from app.core.encryption import FieldEncryptor

        key = Fernet.generate_key().decode()
        encryptor = FieldEncryptor(key=key)
        assert encryptor is not None

    def test_init_with_empty_key_raises_error(self):
        """빈 키로 초기화 시 ValueError 발생"""
        from app.core.encryption import FieldEncryptor

        with pytest.raises(ValueError, match="암호화 키"):
            FieldEncryptor(key="")

    def test_init_with_invalid_key_raises_error(self):
        """유효하지 않은 Fernet 키로 초기화 시 ValueError 발생"""
        from app.core.encryption import FieldEncryptor

        with pytest.raises(ValueError):
            FieldEncryptor(key="not-a-valid-fernet-key")


class TestFieldEncryptorEncrypt:
    """encrypt_field 메서드 테스트"""

    @pytest.fixture
    def encryptor(self):
        """테스트용 FieldEncryptor 인스턴스"""
        from cryptography.fernet import Fernet

        from app.core.encryption import FieldEncryptor

        key = Fernet.generate_key().decode()
        return FieldEncryptor(key=key)

    def test_encrypt_returns_string(self, encryptor):
        """암호화 결과가 문자열이어야 함"""
        result = encryptor.encrypt_field("홍길동")
        assert isinstance(result, str)

    def test_encrypt_result_differs_from_plaintext(self, encryptor):
        """암호화 결과가 평문과 달라야 함"""
        plaintext = "홍길동"
        result = encryptor.encrypt_field(plaintext)
        assert result != plaintext

    def test_encrypt_same_value_produces_different_tokens(self, encryptor):
        """같은 값을 암호화해도 매번 다른 토큰이 생성됨 (Fernet 특성)"""
        result1 = encryptor.encrypt_field("홍길동")
        result2 = encryptor.encrypt_field("홍길동")
        # Fernet은 nonce를 사용하므로 같은 값도 다른 암호문 생성
        assert result1 != result2

    def test_encrypt_empty_string_returns_empty(self, encryptor):
        """빈 문자열은 빈 문자열을 반환 (nullable 필드 처리)"""
        result = encryptor.encrypt_field("")
        assert isinstance(result, str)
        assert result == ""  # 빈 문자열은 암호화 없이 그대로 반환

    def test_encrypt_korean_text(self, encryptor):
        """한국어 텍스트 암호화"""
        result = encryptor.encrypt_field("010-1234-5678")
        assert isinstance(result, str)

    def test_encrypt_email(self, encryptor):
        """이메일 주소 암호화"""
        result = encryptor.encrypt_field("test@example.com")
        assert isinstance(result, str)


class TestFieldEncryptorDecrypt:
    """decrypt_field 메서드 테스트"""

    @pytest.fixture
    def encryptor(self):
        """테스트용 FieldEncryptor 인스턴스"""
        from cryptography.fernet import Fernet

        from app.core.encryption import FieldEncryptor

        key = Fernet.generate_key().decode()
        return FieldEncryptor(key=key)

    def test_decrypt_returns_original_value(self, encryptor):
        """복호화 결과가 원래 값과 같아야 함"""
        plaintext = "홍길동"
        encrypted = encryptor.encrypt_field(plaintext)
        result = encryptor.decrypt_field(encrypted)
        assert result == plaintext

    def test_decrypt_phone_number(self, encryptor):
        """전화번호 복호화"""
        phone = "010-1234-5678"
        encrypted = encryptor.encrypt_field(phone)
        result = encryptor.decrypt_field(encrypted)
        assert result == phone

    def test_decrypt_email(self, encryptor):
        """이메일 복호화"""
        email = "test@example.com"
        encrypted = encryptor.encrypt_field(email)
        result = encryptor.decrypt_field(encrypted)
        assert result == email

    def test_decrypt_empty_string(self, encryptor):
        """빈 문자열 복호화"""
        encrypted = encryptor.encrypt_field("")
        result = encryptor.decrypt_field("")
        # 빈 문자열은 암호화되지 않은 것으로 처리
        assert result == ""

    def test_decrypt_invalid_token_raises_error(self, encryptor):
        """유효하지 않은 토큰 복호화 시 예외 발생"""
        from app.core.encryption import DecryptionError

        with pytest.raises(DecryptionError):
            encryptor.decrypt_field("invalid-token")

    def test_decrypt_with_wrong_key_raises_error(self):
        """다른 키로 암호화된 값 복호화 시 예외 발생"""
        from cryptography.fernet import Fernet

        from app.core.encryption import DecryptionError, FieldEncryptor

        key1 = Fernet.generate_key().decode()
        key2 = Fernet.generate_key().decode()
        enc1 = FieldEncryptor(key=key1)
        enc2 = FieldEncryptor(key=key2)

        encrypted = enc1.encrypt_field("비밀 데이터")
        with pytest.raises(DecryptionError):
            enc2.decrypt_field(encrypted)


class TestFieldEncryptorRoundTrip:
    """암호화/복호화 왕복 테스트"""

    @pytest.fixture
    def encryptor(self):
        """테스트용 FieldEncryptor 인스턴스"""
        from cryptography.fernet import Fernet

        from app.core.encryption import FieldEncryptor

        key = Fernet.generate_key().decode()
        return FieldEncryptor(key=key)

    @pytest.mark.parametrize(
        "plaintext",
        [
            "홍길동",
            "010-1234-5678",
            "test@example.com",
            "서울시 강남구 테헤란로 123",
            "A" * 1000,  # 긴 문자열
        ],
    )
    def test_encrypt_decrypt_roundtrip(self, encryptor, plaintext):
        """다양한 값에 대한 암호화/복호화 왕복 테스트"""
        encrypted = encryptor.encrypt_field(plaintext)
        decrypted = encryptor.decrypt_field(encrypted)
        assert decrypted == plaintext
