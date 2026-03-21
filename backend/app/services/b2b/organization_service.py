"""B2B 조직 서비스 (SPEC-B2B-001 Phase 1)

조직 생성, 조회, 수정, 멤버 관리, 계층 검증 비즈니스 로직.
"""

from __future__ import annotations

import uuid
from typing import Any

import sqlalchemy as sa
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.organization import Organization
from app.models.organization_member import OrgMemberRole, OrganizationMember
from app.schemas.b2b import OrganizationCreate, OrganizationMemberInvite, OrganizationUpdate


class OrganizationService:
    """조직 비즈니스 로직 서비스"""

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def create_organization(
        self,
        data: OrganizationCreate,
        creator_id: uuid.UUID | None = None,
    ) -> Organization:
        """조직을 생성하고 생성자를 ORG_OWNER로 등록한다.

        Args:
            data: 조직 생성 요청 데이터
            creator_id: 생성자 사용자 UUID (선택)

        Returns:
            생성된 Organization 객체

        Raises:
            HTTPException 400: 계층 구조가 3단계 초과인 경우
            HTTPException 409: 사업자등록번호 중복인 경우
        """
        # 계층 구조 검증
        if data.parent_org_id is not None:
            await self.validate_org_hierarchy(parent_org_id=data.parent_org_id)

        org = Organization(
            name=data.name,
            business_number=data.business_number,
            org_type=data.org_type,
            plan_type=data.plan_type,
            parent_org_id=data.parent_org_id,
            monthly_api_limit=getattr(data, "monthly_api_limit", 1000),
        )
        self._db.add(org)
        await self._db.flush()
        await self._db.refresh(org)

        # 생성자를 ORG_OWNER로 등록
        if creator_id is not None:
            member = OrganizationMember(
                organization_id=org.id,
                user_id=creator_id,
                role=OrgMemberRole.ORG_OWNER,
            )
            self._db.add(member)

        return org

    async def get_organization(self, org_id: uuid.UUID) -> Organization:
        """조직을 ID로 조회한다.

        Args:
            org_id: 조직 UUID

        Returns:
            Organization 객체

        Raises:
            HTTPException 404: 조직을 찾을 수 없는 경우
        """
        result = await self._db.execute(
            sa.select(Organization).where(Organization.id == org_id)
        )
        org = result.scalar_one_or_none()
        if org is None:
            raise HTTPException(status_code=404, detail="조직을 찾을 수 없습니다.")
        return org

    async def update_organization(
        self,
        org_id: uuid.UUID,
        data: OrganizationUpdate,
    ) -> Organization:
        """조직 정보를 수정한다.

        Args:
            org_id: 조직 UUID
            data: 수정 요청 데이터 (부분 업데이트)

        Returns:
            수정된 Organization 객체

        Raises:
            HTTPException 404: 조직을 찾을 수 없는 경우
        """
        org = await self.get_organization(org_id=org_id)
        update_data = data.model_dump(exclude_none=True)
        for field, value in update_data.items():
            setattr(org, field, value)
        await self._db.flush()
        await self._db.refresh(org)
        return org

    async def invite_member(
        self,
        org_id: uuid.UUID,
        invite_data: OrganizationMemberInvite,
        user_id: uuid.UUID,
    ) -> OrganizationMember:
        """조직에 멤버를 초대한다.

        Args:
            org_id: 조직 UUID
            invite_data: 초대 요청 데이터
            user_id: 초대할 사용자 UUID

        Returns:
            생성된 OrganizationMember 객체
        """
        member = OrganizationMember(
            organization_id=org_id,
            user_id=user_id,
            role=invite_data.role,
        )
        self._db.add(member)
        await self._db.flush()
        await self._db.refresh(member)
        return member

    async def list_members(
        self,
        org_id: uuid.UUID,
    ) -> list[OrganizationMember]:
        """조직의 멤버 목록을 조회한다.

        Args:
            org_id: 조직 UUID

        Returns:
            OrganizationMember 목록
        """
        result = await self._db.execute(
            sa.select(OrganizationMember).where(
                OrganizationMember.organization_id == org_id,
                OrganizationMember.is_active.is_(True),
            )
        )
        return result.scalars().all()

    async def validate_org_hierarchy(
        self,
        parent_org_id: uuid.UUID | None,
    ) -> None:
        """조직 계층 구조가 3단계를 초과하는지 검증한다.

        Args:
            parent_org_id: 부모 조직 UUID (None이면 최상위)

        Raises:
            HTTPException 400: 계층이 3단계 초과인 경우
        """
        if parent_org_id is None:
            return

        # 부모 체인을 따라가며 깊이 측정
        depth = 1  # 현재 조직이 부모에 추가되면 최소 2단계
        current_id = parent_org_id

        while current_id is not None:
            result = await self._db.execute(
                sa.select(Organization).where(Organization.id == current_id)
            )
            parent = result.scalar_one_or_none()
            if parent is None:
                break
            depth += 1
            if depth >= 3:
                raise HTTPException(
                    status_code=400,
                    detail="조직 계층은 최대 3단계까지 허용됩니다.",
                )
            current_id = parent.parent_org_id
