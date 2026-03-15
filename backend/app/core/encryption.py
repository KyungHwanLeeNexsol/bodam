"""PII 필드 레벨 암호화 유틸리티 (SPEC-B2B-001 Phase 3)

Fernet 대칭키 암호화를 사용하여 개인정보보호법(PIPA) 준수를 위한
PII(개인식별정보) 필드 암호화/복호화를 제공.
"""

from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken


class DecryptionError(Exception):
    """복호화 실패 예외

    잘못된 토큰 또는 잘못된 키로 복호화 시도 시 발생.
    """


# @MX:ANCHOR: FieldEncryptor - PII 암호화의 단일 진입점
# @MX:REASON: 고객 민감정보 암호화를 모든 B2B 서비스에서 사용
class FieldEncryptor:
    """PII 필드 암호화/복호화 클래스

    Fernet 대칭키 암호화를 사용하여 개인식별정보(이름, 전화번호, 이메일 등)를
    안전하게 암호화하고 복호화한다.

    Fernet 특성:
    - AES-128-CBC + HMAC-SHA256 기반 인증 암호화
    - 각 암호화마다 고유한 nonce 생성으로 동일한 값도 다른 암호문 생성
    - 타임스탬프 포함으로 만료 시간 설정 가능 (현재 미사용)
    """

    def __init__(self, key: str) -> None:
        """FieldEncryptor 초기화

        Args:
            key: Fernet 키 (base64url-encoded 32바이트 문자열)

        Raises:
            ValueError: 키가 비어있거나 유효하지 않은 Fernet 키인 경우
        """
        if not key:
            raise ValueError("암호화 키는 비어있을 수 없습니다.")
        try:
            self._fernet = Fernet(key.encode() if isinstance(key, str) else key)
        except Exception as e:
            raise ValueError(f"유효하지 않은 암호화 키: {e}") from e

    def encrypt_field(self, plaintext: str) -> str:
        """평문 필드를 암호화한다.

        빈 문자열은 그대로 반환 (DB에 빈 문자열 저장 허용).

        Args:
            plaintext: 암호화할 평문 문자열

        Returns:
            암호화된 base64url 인코딩 문자열
        """
        if not plaintext:
            return plaintext
        encrypted_bytes = self._fernet.encrypt(plaintext.encode("utf-8"))
        return encrypted_bytes.decode("utf-8")

    def decrypt_field(self, ciphertext: str) -> str:
        """암호화된 필드를 복호화한다.

        빈 문자열은 그대로 반환 (암호화되지 않은 빈 값 처리).

        Args:
            ciphertext: 복호화할 암호문 문자열

        Returns:
            복호화된 평문 문자열

        Raises:
            DecryptionError: 토큰이 유효하지 않거나 키가 맞지 않는 경우
        """
        if not ciphertext:
            return ciphertext
        try:
            decrypted_bytes = self._fernet.decrypt(ciphertext.encode("utf-8"))
            return decrypted_bytes.decode("utf-8")
        except (InvalidToken, Exception) as e:
            raise DecryptionError(f"복호화 실패: {e}") from e
