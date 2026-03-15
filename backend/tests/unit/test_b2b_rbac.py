"""B2B RBAC 단위 테스트 (SPEC-B2B-001 Phase 1)

UserRole 열거형 및 require_role 의존성 검증.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest


class TestUserRoleEnum:
    """UserRole 열거형 테스트"""

    def test_user_role_importable(self):
        """UserRole이 user 모듈에서 임포트 가능해야 한다"""
        from app.models.user import UserRole

        assert UserRole is not None

    def test_user_role_b2c_user_value(self):
        """UserRole.B2C_USER 값이 'B2C_USER'여야 한다"""
        from app.models.user import UserRole

        assert UserRole.B2C_USER == "B2C_USER"

    def test_user_role_agent_value(self):
        """UserRole.AGENT 값이 'AGENT'여야 한다"""
        from app.models.user import UserRole

        assert UserRole.AGENT == "AGENT"

    def test_user_role_agent_admin_value(self):
        """UserRole.AGENT_ADMIN 값이 'AGENT_ADMIN'여야 한다"""
        from app.models.user import UserRole

        assert UserRole.AGENT_ADMIN == "AGENT_ADMIN"

    def test_user_role_org_owner_value(self):
        """UserRole.ORG_OWNER 값이 'ORG_OWNER'여야 한다"""
        from app.models.user import UserRole

        assert UserRole.ORG_OWNER == "ORG_OWNER"

    def test_user_role_system_admin_value(self):
        """UserRole.SYSTEM_ADMIN 값이 'SYSTEM_ADMIN'여야 한다"""
        from app.models.user import UserRole

        assert UserRole.SYSTEM_ADMIN == "SYSTEM_ADMIN"

    def test_user_role_has_five_values(self):
        """UserRole 열거형은 정확히 5개의 값을 가져야 한다"""
        from app.models.user import UserRole

        assert len(UserRole) == 5

    def test_user_model_has_role_column(self):
        """User 모델은 role 컬럼을 가져야 한다"""
        from app.models.user import User

        mapper = User.__mapper__
        column_names = {col.key for col in mapper.columns}
        assert "role" in column_names

    def test_user_model_role_default_b2c_user(self):
        """User.role 기본값은 B2C_USER여야 한다"""
        from app.models.user import User

        col = User.__mapper__.columns["role"]
        assert col.default is not None or col.server_default is not None

    def test_user_model_role_instantiation_default(self):
        """User 인스턴스 생성 시 role 기본값이 B2C_USER여야 한다"""
        from app.models.user import User, UserRole

        user = User(email="test@example.com")
        assert user.role == UserRole.B2C_USER

    def test_user_model_role_can_be_set(self):
        """User 인스턴스의 role을 지정할 수 있어야 한다"""
        from app.models.user import User, UserRole

        user = User(email="agent@example.com", role=UserRole.AGENT)
        assert user.role == UserRole.AGENT


class TestRequireRoleDependency:
    """require_role 의존성 함수 테스트"""

    def test_require_role_importable(self):
        """require_role이 deps 모듈에서 임포트 가능해야 한다"""
        from app.api.deps import require_role

        assert require_role is not None

    def test_require_role_returns_callable(self):
        """require_role()은 호출 가능한 의존성 함수를 반환해야 한다"""
        from app.api.deps import require_role
        from app.models.user import UserRole

        dependency = require_role(UserRole.AGENT)
        assert callable(dependency)

    @pytest.mark.asyncio
    async def test_require_role_passes_for_matching_role(self):
        """require_role은 허용된 역할의 사용자를 통과시켜야 한다"""
        from app.api.deps import require_role
        from app.models.user import User, UserRole

        # AGENT 역할을 가진 사용자 목
        user = MagicMock(spec=User)
        user.role = UserRole.AGENT

        dependency = require_role(UserRole.AGENT)
        result = await dependency(user=user)
        assert result == user

    @pytest.mark.asyncio
    async def test_require_role_raises_403_for_wrong_role(self):
        """require_role은 허용되지 않은 역할의 사용자에게 403을 반환해야 한다"""
        from fastapi import HTTPException

        from app.api.deps import require_role
        from app.models.user import User, UserRole

        # B2C_USER 역할을 가진 사용자 목
        user = MagicMock(spec=User)
        user.role = UserRole.B2C_USER

        dependency = require_role(UserRole.AGENT)
        with pytest.raises(HTTPException) as exc_info:
            await dependency(user=user)

        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_require_role_passes_for_multiple_allowed_roles(self):
        """require_role은 여러 허용 역할 중 하나에 속하면 통과해야 한다"""
        from app.api.deps import require_role
        from app.models.user import User, UserRole

        user = MagicMock(spec=User)
        user.role = UserRole.AGENT_ADMIN

        # ORG_OWNER 또는 AGENT_ADMIN 허용
        dependency = require_role(UserRole.ORG_OWNER, UserRole.AGENT_ADMIN)
        result = await dependency(user=user)
        assert result == user

    @pytest.mark.asyncio
    async def test_require_role_error_message_korean(self):
        """require_role 오류 메시지는 한국어여야 한다"""
        from fastapi import HTTPException

        from app.api.deps import require_role
        from app.models.user import User, UserRole

        user = MagicMock(spec=User)
        user.role = UserRole.B2C_USER

        dependency = require_role(UserRole.SYSTEM_ADMIN)
        with pytest.raises(HTTPException) as exc_info:
            await dependency(user=user)

        # 오류 메시지에 한국어 포함 확인
        assert "권한" in exc_info.value.detail or "접근" in exc_info.value.detail
