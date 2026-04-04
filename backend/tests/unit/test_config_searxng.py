"""Config에 searxng_url 필드 테스트 (SPEC-JIT-003 T-002)

TDD RED: Settings에 searxng_url 필드가 존재하고 기본값이 올바른지 검증.
"""

from __future__ import annotations

import pytest

from app.core.config import Settings


class TestSearXNGConfig:
    """SearXNG 설정 필드 테스트"""

    def test_settings_has_searxng_url_field(self):
        """Settings에 searxng_url 필드가 존재해야 한다"""
        # 필수 필드만 제공하여 Settings 인스턴스 생성
        settings = Settings(
            database_url="postgresql+asyncpg://test:test@localhost/test",
            secret_key="test-secret-key",
        )
        assert hasattr(settings, "searxng_url")

    def test_searxng_url_default_value(self):
        """searxng_url 기본값은 내부 Fly.io 주소여야 한다"""
        settings = Settings(
            database_url="postgresql+asyncpg://test:test@localhost/test",
            secret_key="test-secret-key",
        )
        assert settings.searxng_url == "http://bodam-search.internal:8080"

    def test_searxng_url_can_be_overridden(self):
        """환경변수로 searxng_url을 재정의할 수 있어야 한다"""
        settings = Settings(
            database_url="postgresql+asyncpg://test:test@localhost/test",
            secret_key="test-secret-key",
            searxng_url="http://localhost:8888",
        )
        assert settings.searxng_url == "http://localhost:8888"

    def test_searxng_url_is_string_type(self):
        """searxng_url은 문자열 타입이어야 한다"""
        settings = Settings(
            database_url="postgresql+asyncpg://test:test@localhost/test",
            secret_key="test-secret-key",
        )
        assert isinstance(settings.searxng_url, str)
