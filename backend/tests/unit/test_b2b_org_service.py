"""B2B OrganizationService 단위 테스트 (SPEC-B2B-001 Phase 1)

조직 생성, 조회, 업데이트, 계층 검증 비즈니스 로직 테스트.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest


class TestOrganizationServiceImport:
    """OrganizationService 임포트 테스트"""

    def test_organization_service_importable(self):
        """OrganizationService가 임포트 가능해야 한다"""
        from app.services.b2b.organization_service import OrganizationService

        assert OrganizationService is not None

    def test_create_organization_function_exists(self):
        """OrganizationService.create_organization 메서드가 존재해야 한다"""
        from app.services.b2b.organization_service import OrganizationService

        assert hasattr(OrganizationService, "create_organization")

    def test_get_organization_function_exists(self):
        """OrganizationService.get_organization 메서드가 존재해야 한다"""
        from app.services.b2b.organization_service import OrganizationService

        assert hasattr(OrganizationService, "get_organization")

    def test_update_organization_function_exists(self):
        """OrganizationService.update_organization 메서드가 존재해야 한다"""
        from app.services.b2b.organization_service import OrganizationService

        assert hasattr(OrganizationService, "update_organization")

    def test_invite_member_function_exists(self):
        """OrganizationService.invite_member 메서드가 존재해야 한다"""
        from app.services.b2b.organization_service import OrganizationService

        assert hasattr(OrganizationService, "invite_member")

    def test_list_members_function_exists(self):
        """OrganizationService.list_members 메서드가 존재해야 한다"""
        from app.services.b2b.organization_service import OrganizationService

        assert hasattr(OrganizationService, "list_members")

    def test_validate_org_hierarchy_function_exists(self):
        """OrganizationService.validate_org_hierarchy 메서드가 존재해야 한다"""
        from app.services.b2b.organization_service import OrganizationService

        assert hasattr(OrganizationService, "validate_org_hierarchy")


class TestCreateOrganization:
    """create_organization 비즈니스 로직 테스트"""

    @pytest.mark.asyncio
    async def test_create_organization_returns_organization(self):
        """create_organization은 생성된 Organization 객체를 반환해야 한다"""
        from app.models.organization import Organization
        from app.schemas.b2b import OrganizationCreate
        from app.services.b2b.organization_service import OrganizationService

        # DB 세션 목
        mock_db = AsyncMock()
        mock_db.add = MagicMock()
        mock_db.flush = AsyncMock()
        mock_db.refresh = AsyncMock()

        # 생성될 조직 목
        mock_org = MagicMock(spec=Organization)
        mock_org.id = uuid.uuid4()
        mock_org.name = "테스트 GA"

        # add 후 refresh 시 mock_org 속성 설정 시뮬레이션
        async def mock_refresh(obj):
            obj.id = mock_org.id

        mock_db.refresh.side_effect = mock_refresh

        create_data = OrganizationCreate(
            name="테스트 GA",
            business_number="123-45-67890",
            org_type="GA",
            plan_type="FREE_TRIAL",
        )

        service = OrganizationService(db=mock_db)
        org = await service.create_organization(data=create_data)

        # DB에 add 호출 확인
        mock_db.add.assert_called_once()

    @pytest.mark.asyncio
    async def test_create_organization_with_hierarchy_validates_depth(self):
        """create_organization은 3단계 초과 계층 구조를 거부해야 한다"""
        from fastapi import HTTPException

        from app.schemas.b2b import OrganizationCreate
        from app.services.b2b.organization_service import OrganizationService

        mock_db = AsyncMock()

        # 이미 2단계 깊이인 부모 조직 목
        # validate_org_hierarchy에서 3단계 초과를 감지해야 함
        create_data = OrganizationCreate(
            name="4단계 하위 조직 (거부되어야 함)",
            business_number="111-22-33333",
            org_type="INDEPENDENT",
            plan_type="BASIC",
            parent_org_id=uuid.uuid4(),
        )

        service = OrganizationService(db=mock_db)

        # validate_org_hierarchy가 3단계 초과를 감지하도록 모킹
        service.validate_org_hierarchy = AsyncMock(
            side_effect=HTTPException(status_code=400, detail="조직 계층은 최대 3단계까지 허용됩니다")
        )

        with pytest.raises(HTTPException) as exc_info:
            await service.create_organization(data=create_data)

        assert exc_info.value.status_code == 400


class TestGetOrganization:
    """get_organization 비즈니스 로직 테스트"""

    @pytest.mark.asyncio
    async def test_get_organization_returns_organization(self):
        """get_organization은 조직 객체를 반환해야 한다"""
        from app.models.organization import Organization
        from app.services.b2b.organization_service import OrganizationService

        org_id = uuid.uuid4()
        mock_org = MagicMock(spec=Organization)
        mock_org.id = org_id

        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_org
        mock_db.execute = AsyncMock(return_value=mock_result)

        service = OrganizationService(db=mock_db)
        result = await service.get_organization(org_id=org_id)

        assert result == mock_org

    @pytest.mark.asyncio
    async def test_get_organization_raises_404_if_not_found(self):
        """get_organization은 조직이 없으면 404를 반환해야 한다"""
        from fastapi import HTTPException

        from app.services.b2b.organization_service import OrganizationService

        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute = AsyncMock(return_value=mock_result)

        service = OrganizationService(db=mock_db)

        with pytest.raises(HTTPException) as exc_info:
            await service.get_organization(org_id=uuid.uuid4())

        assert exc_info.value.status_code == 404


class TestValidateOrgHierarchy:
    """validate_org_hierarchy 비즈니스 로직 테스트"""

    @pytest.mark.asyncio
    async def test_validate_org_hierarchy_allows_root_org(self):
        """최상위 조직(부모 없음)은 계층 검증을 통과해야 한다"""
        from app.services.b2b.organization_service import OrganizationService

        mock_db = AsyncMock()
        service = OrganizationService(db=mock_db)

        # 부모 없는 경우 예외 없이 통과
        await service.validate_org_hierarchy(parent_org_id=None)

    @pytest.mark.asyncio
    async def test_validate_org_hierarchy_raises_400_beyond_3_levels(self):
        """3단계 초과 계층은 400 오류를 반환해야 한다"""
        from fastapi import HTTPException

        from app.models.organization import Organization
        from app.services.b2b.organization_service import OrganizationService

        # depth=3인 부모 조직 목 (3단계에 추가하면 4단계가 됨)
        mock_depth_3_org = MagicMock(spec=Organization)
        mock_depth_3_org.parent_org_id = uuid.uuid4()  # 부모 있음

        # 부모의 부모 (depth=2)
        mock_depth_2_org = MagicMock(spec=Organization)
        mock_depth_2_org.parent_org_id = uuid.uuid4()  # 부모 있음

        # 부모의 부모의 부모 (depth=1, 최상위)
        mock_depth_1_org = MagicMock(spec=Organization)
        mock_depth_1_org.parent_org_id = None  # 최상위

        # DB 조회 순서: depth3_id -> depth2_id -> depth1_id
        mock_db = AsyncMock()
        org_map = {
            mock_depth_3_org.id: mock_depth_3_org,
            mock_depth_2_org.id: mock_depth_2_org,
            mock_depth_1_org.id: mock_depth_1_org,
        }

        # 3개의 결과를 순서대로 반환 (부모 체인 탐색)
        mock_results = []
        for org in [mock_depth_3_org, mock_depth_2_org, mock_depth_1_org]:
            mock_r = MagicMock()
            mock_r.scalar_one_or_none.return_value = org
            mock_results.append(mock_r)

        mock_db.execute = AsyncMock(side_effect=mock_results)

        service = OrganizationService(db=mock_db)

        with pytest.raises(HTTPException) as exc_info:
            await service.validate_org_hierarchy(parent_org_id=mock_depth_3_org.id)

        assert exc_info.value.status_code == 400
        assert "3단계" in exc_info.value.detail or "계층" in exc_info.value.detail


class TestListMembers:
    """list_members 비즈니스 로직 테스트"""

    @pytest.mark.asyncio
    async def test_list_members_returns_list(self):
        """list_members는 멤버 목록을 반환해야 한다"""
        from app.models.organization_member import OrganizationMember
        from app.services.b2b.organization_service import OrganizationService

        org_id = uuid.uuid4()
        mock_members = [
            MagicMock(spec=OrganizationMember),
            MagicMock(spec=OrganizationMember),
        ]

        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = mock_members
        mock_db.execute = AsyncMock(return_value=mock_result)

        service = OrganizationService(db=mock_db)
        members = await service.list_members(org_id=org_id)

        assert len(members) == 2

    @pytest.mark.asyncio
    async def test_list_members_returns_empty_for_no_members(self):
        """list_members는 멤버가 없으면 빈 목록을 반환해야 한다"""
        from app.services.b2b.organization_service import OrganizationService

        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        mock_db.execute = AsyncMock(return_value=mock_result)

        service = OrganizationService(db=mock_db)
        members = await service.list_members(org_id=uuid.uuid4())

        assert members == []
