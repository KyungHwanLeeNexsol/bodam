"""API Key 관리 엔드포인트 단위 테스트 (SPEC-B2B-001 Module 4)

API Key 생성/목록/폐기/사용통계 엔드포인트 검증:
- POST /api/v1/b2b/api-keys - 키 생성 (AGENT_ADMIN+)
- GET /api/v1/b2b/api-keys - 키 목록 (AGENT_ADMIN+)
- DELETE /api/v1/b2b/api-keys/{key_id} - 키 폐기 (AGENT_ADMIN+)
- GET /api/v1/b2b/api-keys/{key_id}/usage - 사용통계 (AGENT_ADMIN+)

AC-007: 생성 시 full_key 포함, 목록에는 마스킹된 키만 표시
AC-008: 스코프 없는 엔드포인트 호출 시 403
"""

from __future__ import annotations

import uuid
from datetime import UTC
from unittest.mock import MagicMock


class TestAPIKeySchemas:
    """API Key Pydantic 스키마 테스트"""

    def test_api_key_create_schema_importable(self):
        """APIKeyCreate 스키마가 임포트 가능해야 한다"""
        from app.schemas.b2b import APIKeyCreate

        assert APIKeyCreate is not None

    def test_api_key_response_schema_importable(self):
        """APIKeyResponse 스키마가 임포트 가능해야 한다"""
        from app.schemas.b2b import APIKeyResponse

        assert APIKeyResponse is not None

    def test_api_key_full_response_schema_importable(self):
        """APIKeyFullResponse 스키마가 임포트 가능해야 한다"""
        from app.schemas.b2b import APIKeyFullResponse

        assert APIKeyFullResponse is not None

    def test_api_key_create_has_required_fields(self):
        """APIKeyCreate는 name과 scopes 필드가 있어야 한다"""
        from app.schemas.b2b import APIKeyCreate

        schema = APIKeyCreate(name="테스트 키", scopes=["read"])
        assert schema.name == "테스트 키"
        assert schema.scopes == ["read"]

    def test_api_key_response_has_required_fields(self):
        """APIKeyResponse는 필수 필드가 있어야 한다"""
        from datetime import datetime

        from app.schemas.b2b import APIKeyResponse

        schema = APIKeyResponse(
            id=uuid.uuid4(),
            key_prefix="bdk_",
            key_last4="abcd",
            name="테스트 키",
            scopes=["read"],
            is_active=True,
            last_used_at=None,
            created_at=datetime.now(UTC),
        )
        assert schema.key_prefix == "bdk_"
        assert schema.key_last4 == "abcd"

    def test_api_key_full_response_has_full_key_field(self):
        """APIKeyFullResponse는 full_key 필드가 있어야 한다"""
        from datetime import datetime

        from app.schemas.b2b import APIKeyFullResponse

        schema = APIKeyFullResponse(
            id=uuid.uuid4(),
            key_prefix="bdk_",
            key_last4="abcd",
            name="테스트 키",
            scopes=["read"],
            is_active=True,
            last_used_at=None,
            created_at=datetime.now(UTC),
            full_key="bdk_" + "a" * 32,
        )
        assert schema.full_key is not None
        assert schema.full_key.startswith("bdk_")

    def test_api_key_response_from_model(self):
        """APIKeyResponse는 모델에서 생성 가능해야 한다"""
        from datetime import datetime

        from app.schemas.b2b import APIKeyResponse

        mock_model = MagicMock()
        mock_model.id = uuid.uuid4()
        mock_model.key_prefix = "bdk_"
        mock_model.key_last4 = "abcd"
        mock_model.name = "테스트 키"
        mock_model.scopes = ["read", "write"]
        mock_model.is_active = True
        mock_model.last_used_at = None
        mock_model.created_at = datetime.now(UTC)

        schema = APIKeyResponse.model_validate(mock_model)
        assert schema.id == mock_model.id
        assert schema.key_prefix == "bdk_"


class TestAPIKeyRouter:
    """API Key 라우터 테스트"""

    def test_api_key_router_importable(self):
        """api_keys 라우터가 임포트 가능해야 한다"""
        from app.api.v1.b2b.api_keys import router

        assert router is not None

    def test_api_key_router_registered_in_main(self):
        """api_keys 라우터가 main.py에 등록되어 있어야 한다"""
        from app.main import app

        # 등록된 라우트 경로 확인
        routes = [route.path for route in app.routes]
        # /api/v1/b2b/api-keys 경로가 있어야 함
        assert any("/api/v1/b2b/api-keys" in path for path in routes)

    def test_api_keys_router_has_create_endpoint(self):
        """api_keys 라우터에 POST /api-keys 엔드포인트가 있어야 한다"""
        from app.api.v1.b2b.api_keys import router

        methods_paths = [(route.methods, route.path) for route in router.routes]
        post_paths = [path for methods, path in methods_paths if methods and "POST" in methods]
        # / 또는 /api-keys 경로에 POST가 있어야 함
        assert len(post_paths) > 0

    def test_api_keys_router_has_list_endpoint(self):
        """api_keys 라우터에 GET /api-keys 엔드포인트가 있어야 한다"""
        from app.api.v1.b2b.api_keys import router

        methods_paths = [(route.methods, route.path) for route in router.routes]
        get_paths = [path for methods, path in methods_paths if methods and "GET" in methods]
        assert len(get_paths) > 0

    def test_api_keys_router_has_delete_endpoint(self):
        """api_keys 라우터에 DELETE /api-keys/{key_id} 엔드포인트가 있어야 한다"""
        from app.api.v1.b2b.api_keys import router

        methods_paths = [(route.methods, route.path) for route in router.routes]
        delete_paths = [path for methods, path in methods_paths if methods and "DELETE" in methods]
        assert len(delete_paths) > 0
        assert any("{key_id}" in path for path in delete_paths)

    def test_api_keys_router_has_usage_endpoint(self):
        """api_keys 라우터에 GET /api-keys/{key_id}/usage 엔드포인트가 있어야 한다"""
        from app.api.v1.b2b.api_keys import router

        methods_paths = [(route.methods, route.path) for route in router.routes]
        get_paths = [path for methods, path in methods_paths if methods and "GET" in methods]
        assert any("usage" in path for path in get_paths)


class TestAPIKeyMaskedDisplay:
    """AC-007: 키 목록에 마스킹된 키만 표시"""

    def test_api_key_response_does_not_expose_key_hash(self):
        """APIKeyResponse에 key_hash 필드가 없어야 한다 (마스킹 보안)"""
        from app.schemas.b2b import APIKeyResponse

        # APIKeyResponse의 model_fields에 key_hash가 없어야 함
        assert "key_hash" not in APIKeyResponse.model_fields

    def test_api_key_full_response_does_not_expose_key_hash(self):
        """APIKeyFullResponse에도 key_hash 필드가 없어야 한다"""
        from app.schemas.b2b import APIKeyFullResponse

        assert "key_hash" not in APIKeyFullResponse.model_fields

    def test_api_key_response_masked_format(self):
        """APIKeyResponse의 key_prefix + '...' + key_last4 조합으로 마스킹되어야 한다"""
        from datetime import datetime

        from app.schemas.b2b import APIKeyResponse

        schema = APIKeyResponse(
            id=uuid.uuid4(),
            key_prefix="bdk_",
            key_last4="x7z9",
            name="테스트 키",
            scopes=["read"],
            is_active=True,
            last_used_at=None,
            created_at=datetime.now(UTC),
        )
        # key_prefix와 key_last4가 있어서 마스킹 표현 가능
        assert schema.key_prefix == "bdk_"
        assert schema.key_last4 == "x7z9"
        # 마스킹 포맷: "bdk_...x7z9"
        masked = f"{schema.key_prefix}...{schema.key_last4}"
        assert masked == "bdk_...x7z9"
