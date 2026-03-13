# 설정 로딩 테스트 (TDD - RED 단계)

import pytest


def test_settings_loads_from_env(monkeypatch):
    """환경변수에서 설정값을 올바르게 로드하는지 검증"""
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost/testdb")
    monkeypatch.setenv("SECRET_KEY", "test-secret-key-for-testing")
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/1")

    # 기존에 캐시된 인스턴스 방지를 위해 모듈 재로드
    import importlib

    import app.core.config as config_module

    importlib.reload(config_module)
    from app.core.config import get_settings

    settings = get_settings()
    assert settings.database_url == "postgresql+asyncpg://user:pass@localhost/testdb"
    assert settings.secret_key == "test-secret-key-for-testing"
    assert settings.redis_url == "redis://localhost:6379/1"


def test_settings_has_defaults(monkeypatch):
    """필수값이 아닌 설정에 기본값이 있는지 검증"""
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost/testdb")
    monkeypatch.setenv("SECRET_KEY", "test-secret-key")

    import importlib

    import app.core.config as config_module

    importlib.reload(config_module)
    from app.core.config import get_settings

    settings = get_settings()
    assert settings.app_name == "Bodam API"
    assert settings.app_version == "0.1.0"
    assert settings.debug is False


def test_settings_missing_required_raises(monkeypatch):
    """필수 환경변수(DATABASE_URL, SECRET_KEY)가 없으면 에러를 발생시키는지 검증"""
    # 환경변수 제거
    for key in ["DATABASE_URL", "SECRET_KEY"]:
        monkeypatch.delenv(key, raising=False)

    # .env 파일이 없는 환경에서 테스트
    import importlib

    import app.core.config as config_module

    importlib.reload(config_module)
    from app.core.config import get_settings

    with pytest.raises(Exception):
        get_settings()
