"""XSS 살균 유틸리티 단위 테스트 (SPEC-SEC-001 TAG-2)

RED phase: XSS 살균 모듈 구현 전 실패하는 테스트.
허용되지 않는 XSS 패턴을 거부하고 정상 입력은 통과하는지 검증.
"""

from __future__ import annotations

import pytest


class TestSanitizeFunction:
    """sanitize_input 함수 테스트"""

    def test_sanitize_module_importable(self):
        """sanitize 모듈이 임포트 가능해야 한다"""
        from app.core.sanitize import sanitize_input

        assert sanitize_input is not None

    def test_valid_plain_text_passes(self):
        """일반 텍스트는 통과해야 한다"""
        from app.core.sanitize import sanitize_input

        result = sanitize_input("안녕하세요 저는 홍길동입니다")
        assert result == "안녕하세요 저는 홍길동입니다"

    def test_valid_english_name_passes(self):
        """영문 이름은 통과해야 한다"""
        from app.core.sanitize import sanitize_input

        result = sanitize_input("John Doe")
        assert result == "John Doe"

    def test_script_tag_raises_value_error(self):
        """<script> 태그가 포함된 입력은 ValueError를 발생시켜야 한다"""
        from app.core.sanitize import sanitize_input

        with pytest.raises(ValueError, match="허용되지 않는"):
            sanitize_input("<script>alert('xss')</script>")

    def test_script_tag_case_insensitive(self):
        """대문자 <SCRIPT> 태그도 거부되어야 한다"""
        from app.core.sanitize import sanitize_input

        with pytest.raises(ValueError):
            sanitize_input("<SCRIPT>alert('xss')</SCRIPT>")

    def test_javascript_protocol_raises_value_error(self):
        """javascript: 프로토콜이 포함된 입력은 ValueError를 발생시켜야 한다"""
        from app.core.sanitize import sanitize_input

        with pytest.raises(ValueError, match="허용되지 않는"):
            sanitize_input("javascript:alert('xss')")

    def test_onclick_event_handler_raises_value_error(self):
        """onclick= 이벤트 핸들러가 포함된 입력은 ValueError를 발생시켜야 한다"""
        from app.core.sanitize import sanitize_input

        with pytest.raises(ValueError, match="허용되지 않는"):
            sanitize_input("<div onclick=alert(1)>click</div>")

    def test_onload_event_handler_raises_value_error(self):
        """onload= 이벤트 핸들러가 포함된 입력은 ValueError를 발생시켜야 한다"""
        from app.core.sanitize import sanitize_input

        with pytest.raises(ValueError, match="허용되지 않는"):
            sanitize_input("<body onload=alert(1)>")

    def test_onerror_event_handler_raises_value_error(self):
        """onerror= 이벤트 핸들러가 포함된 입력은 ValueError를 발생시켜야 한다"""
        from app.core.sanitize import sanitize_input

        with pytest.raises(ValueError):
            sanitize_input('<img src=x onerror=alert(1)>')

    def test_normal_html_entity_like_text_passes(self):
        """일반 텍스트에 꺾쇠가 없으면 통과해야 한다"""
        from app.core.sanitize import sanitize_input

        # 보험 관련 일반 텍스트
        result = sanitize_input("보험료가 10% 인상되었습니다")
        assert result == "보험료가 10% 인상되었습니다"

    def test_empty_string_passes(self):
        """빈 문자열은 그대로 통과해야 한다"""
        from app.core.sanitize import sanitize_input

        result = sanitize_input("")
        assert result == ""

    def test_none_returns_none(self):
        """None 입력은 None을 반환해야 한다"""
        from app.core.sanitize import sanitize_input

        result = sanitize_input(None)
        assert result is None


class TestSanitizeValidatorOnSchemas:
    """Pydantic 스키마에서 XSS 살균 검증기 테스트"""

    def test_register_request_accepts_normal_full_name(self):
        """RegisterRequest는 일반 이름을 허용해야 한다"""
        from app.schemas.auth import RegisterRequest

        req = RegisterRequest(
            email="test@example.com",
            password="password123",
            full_name="홍길동",
        )
        assert req.full_name == "홍길동"

    def test_register_request_rejects_xss_in_full_name(self):
        """RegisterRequest는 full_name에 XSS 패턴이 있으면 ValidationError를 발생시켜야 한다"""
        from pydantic import ValidationError

        from app.schemas.auth import RegisterRequest

        with pytest.raises(ValidationError):
            RegisterRequest(
                email="test@example.com",
                password="password123",
                full_name="<script>alert('xss')</script>",
            )

    def test_chat_message_accepts_normal_content(self):
        """ChatMessageCreate는 일반 메시지를 허용해야 한다"""
        from app.schemas.chat import ChatMessageCreate

        msg = ChatMessageCreate(content="제 보험료를 알고 싶습니다")
        assert msg.content == "제 보험료를 알고 싶습니다"

    def test_chat_message_rejects_xss_in_content(self):
        """ChatMessageCreate는 content에 XSS 패턴이 있으면 ValidationError를 발생시켜야 한다"""
        from pydantic import ValidationError

        from app.schemas.chat import ChatMessageCreate

        with pytest.raises(ValidationError):
            ChatMessageCreate(content="<script>alert('xss')</script>")

    def test_chat_message_rejects_javascript_protocol(self):
        """ChatMessageCreate는 javascript: 프로토콜이 있으면 ValidationError를 발생시켜야 한다"""
        from pydantic import ValidationError

        from app.schemas.chat import ChatMessageCreate

        with pytest.raises(ValidationError):
            ChatMessageCreate(content="javascript:void(0)")
