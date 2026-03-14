"""로그 민감 데이터 마스킹 단위 테스트 (SPEC-SEC-001 M3)

RED phase: LogMaskingProcessor 구현 전 실패하는 테스트.
이메일, 전화번호, JWT 토큰 등 민감 데이터 마스킹 검증.
"""

from __future__ import annotations

import pytest


class TestEmailMasking:
    """이메일 마스킹 테스트"""

    def test_email_masked_in_log(self):
        """이메일이 u***@domain.com 형식으로 마스킹되어야 한다 (SC-024)"""
        from app.core.log_masking import mask_email

        result = mask_email("user@example.com")
        assert result == "u***@example.com"

    def test_short_email_masked(self):
        """짧은 사용자명 이메일도 마스킹되어야 한다"""
        from app.core.log_masking import mask_email

        result = mask_email("ab@test.com")
        assert "@test.com" in result
        assert result.startswith("a")
        assert "***" in result

    def test_long_email_masked_first_char_only(self):
        """이메일은 처음 1자만 표시하고 나머지는 마스킹되어야 한다"""
        from app.core.log_masking import mask_email

        result = mask_email("username@example.com")
        assert result.startswith("u")
        assert "***@example.com" in result

    def test_email_in_text_is_masked(self):
        """텍스트 내 이메일도 마스킹되어야 한다"""
        from app.core.log_masking import mask_sensitive_text

        text = "사용자 user@example.com 로그인 시도"
        result = mask_sensitive_text(text)
        assert "user@example.com" not in result
        assert "***" in result


class TestJwtMasking:
    """JWT 토큰 마스킹 테스트"""

    def test_jwt_token_masked_first_10_chars(self):
        """JWT 토큰은 처음 10자만 표시하고 나머지는 *** 처리"""
        from app.core.log_masking import mask_jwt

        jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
        result = mask_jwt(jwt)

        assert result.startswith("eyJhbGciOi")
        assert result.endswith("***")
        assert len(result) < len(jwt)

    def test_jwt_in_authorization_header_masked(self):
        """Authorization 헤더의 Bearer 토큰이 마스킹되어야 한다"""
        from app.core.log_masking import mask_sensitive_text

        text = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature"
        result = mask_sensitive_text(text)

        assert "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature" not in result


class TestPasswordMasking:
    """비밀번호 마스킹 테스트"""

    def test_password_field_completely_removed(self):
        """비밀번호 필드는 완전히 제거되어야 한다 (SC-024)"""
        from app.core.log_masking import mask_event_dict

        event_dict = {
            "event": "login attempt",
            "email": "user@example.com",
            "password": "secret123",
        }
        result = mask_event_dict(None, None, event_dict.copy())

        assert "password" not in result
        assert "secret123" not in str(result)

    def test_hashed_password_removed(self):
        """hashed_password 필드도 제거되어야 한다"""
        from app.core.log_masking import mask_event_dict

        event_dict = {
            "event": "user created",
            "hashed_password": "$2b$12$abcdefghijklmnopqrstuvwxyz",
        }
        result = mask_event_dict(None, None, event_dict.copy())

        assert "hashed_password" not in result


class TestPhoneNumberMasking:
    """전화번호 마스킹 테스트"""

    def test_korean_phone_masked(self):
        """한국 전화번호가 010-****-1234 형식으로 마스킹되어야 한다"""
        from app.core.log_masking import mask_phone

        result = mask_phone("010-1234-5678")
        assert result == "010-****-5678"

    def test_phone_without_dash_masked(self):
        """하이픈 없는 전화번호도 마스킹되어야 한다"""
        from app.core.log_masking import mask_phone

        result = mask_phone("01012345678")
        assert "****" in result
        assert "5678" in result

    def test_phone_in_text_masked(self):
        """텍스트 내 전화번호도 마스킹되어야 한다"""
        from app.core.log_masking import mask_sensitive_text

        text = "연락처: 010-1234-5678"
        result = mask_sensitive_text(text)
        assert "010-1234-5678" not in result
        assert "****" in result


class TestLogMaskingProcessor:
    """structlog 프로세서 통합 테스트"""

    def test_processor_masks_email_in_event_dict(self):
        """프로세서가 event_dict 내 이메일을 마스킹해야 한다"""
        from app.core.log_masking import mask_event_dict

        event_dict = {
            "event": "user login",
            "user_email": "test@example.com",
            "ip": "192.168.1.1",
        }
        result = mask_event_dict(None, None, event_dict)

        assert "test@example.com" not in str(result)

    def test_processor_masks_jwt_in_event_dict(self):
        """프로세서가 event_dict 내 JWT 토큰을 마스킹해야 한다"""
        from app.core.log_masking import mask_event_dict

        event_dict = {
            "event": "auth request",
            "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxMjMifQ.signature",
        }
        result = mask_event_dict(None, None, event_dict)

        # 토큰 전체가 그대로 노출되지 않아야 함
        full_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxMjMifQ.signature"
        assert full_token not in str(result)

    def test_processor_preserves_non_sensitive_fields(self):
        """민감하지 않은 필드는 그대로 유지되어야 한다"""
        from app.core.log_masking import mask_event_dict

        event_dict = {
            "event": "user action",
            "user_id": "123e4567-e89b-12d3-a456-426614174000",
            "action": "view_policy",
            "ip": "192.168.1.1",
        }
        result = mask_event_dict(None, None, event_dict)

        assert result["user_id"] == "123e4567-e89b-12d3-a456-426614174000"
        assert result["action"] == "view_policy"
        assert result["ip"] == "192.168.1.1"
