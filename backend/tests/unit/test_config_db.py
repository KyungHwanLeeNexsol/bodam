"""Config 및 Database DI 단위 테스트 (TAG-006)

임베딩 설정 필드와 database.py의 get_db 의존성 구조를 검증.
실제 DB 연결 없이 구조적으로만 테스트.
"""

from __future__ import annotations

import inspect
import os


# ─────────────────────────────────────────────
# TAG-006-01: Settings 임베딩 필드 검증
# ─────────────────────────────────────────────
class TestSettingsEmbeddingFields:
    """Settings 클래스에 임베딩 관련 필드가 추가되어야 함"""

    def test_openai_api_key_field_exists(self) -> None:
        """openai_api_key 필드가 존재해야 함 (기본값 빈 문자열)"""
        os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://u:p@localhost/db")
        os.environ.setdefault("SECRET_KEY", "test-key")
        os.environ.setdefault("OPENAI_API_KEY", "")

        from app.core.config import get_settings

        get_settings.cache_clear()
        settings = get_settings()
        assert hasattr(settings, "openai_api_key")

    def test_openai_api_key_default_empty(self) -> None:
        """openai_api_key 기본값이 빈 문자열이어야 함"""
        os.environ["OPENAI_API_KEY"] = ""

        from app.core.config import get_settings

        get_settings.cache_clear()
        settings = get_settings()
        assert settings.openai_api_key == ""

    def test_embedding_model_default(self) -> None:
        """embedding_model 기본값이 gemini-embedding-001이어야 함"""
        from app.core.config import get_settings

        get_settings.cache_clear()
        settings = get_settings()
        assert settings.embedding_model == "gemini-embedding-001"

    def test_embedding_dimensions_default(self) -> None:
        """embedding_dimensions 기본값이 768이어야 함"""
        from app.core.config import get_settings

        get_settings.cache_clear()
        settings = get_settings()
        assert settings.embedding_dimensions == 768

    def test_chunk_size_tokens_default(self) -> None:
        """chunk_size_tokens 기본값이 500이어야 함"""
        from app.core.config import get_settings

        get_settings.cache_clear()
        settings = get_settings()
        assert settings.chunk_size_tokens == 500

    def test_chunk_overlap_tokens_default(self) -> None:
        """chunk_overlap_tokens 기본값이 100이어야 함"""
        from app.core.config import get_settings

        get_settings.cache_clear()
        settings = get_settings()
        assert settings.chunk_overlap_tokens == 100


# ─────────────────────────────────────────────
# TAG-006-02: database.py 구조 검증
# ─────────────────────────────────────────────
class TestDatabaseModule:
    """database.py 모듈 구조 테스트"""

    def test_engine_module_level_variable(self) -> None:
        """모듈 레벨 engine 변수가 존재해야 함"""
        import app.core.database as db_module

        assert hasattr(db_module, "engine")

    def test_session_factory_module_level_variable(self) -> None:
        """모듈 레벨 session_factory 변수가 존재해야 함"""
        import app.core.database as db_module

        assert hasattr(db_module, "session_factory")

    def test_init_database_function_exists(self) -> None:
        """init_database 비동기 함수가 존재해야 함"""
        import app.core.database as db_module

        assert hasattr(db_module, "init_database")
        assert inspect.iscoroutinefunction(db_module.init_database)

    def test_get_db_function_exists(self) -> None:
        """get_db 제너레이터 함수가 존재해야 함"""
        import app.core.database as db_module

        assert hasattr(db_module, "get_db")
        # get_db는 async generator function이어야 함
        assert inspect.isasyncgenfunction(db_module.get_db)

    def test_init_db_backward_compat(self) -> None:
        """기존 init_db 함수가 여전히 존재해야 함 (하위 호환성)"""
        import app.core.database as db_module

        assert hasattr(db_module, "init_db")
        assert inspect.iscoroutinefunction(db_module.init_db)
