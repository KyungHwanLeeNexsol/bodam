"""B2B 조직 서비스 (SPEC-B2B-001 Phase 1)

조직 생성, 조회, 업데이트, 멤버 관리 비즈니스 로직.
계층 구조 최대 3단계 제한 검증 포함.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

import sqlalchemy as sa
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.organization import Organization
from app.models.organization_member import OrganizationMember
from app.schemas.b2b import OrganizationCreate, OrganizationUpdate

if TYPE_CHECKING:
    pass


# @MX:ANCHOR: 조직 서비스 - 모든 조직 관련 비즈니스 로직의 단일 진입점
# @MX:REASON: 계층 검증, 권한 검사 등 복잡한 비즈니스 로직 집중 관리
class OrganizationService:
    """조직 관리 서비스

    B2B 조직의 생성, 조회, 업데이트, 멤버 초대/목록 조회를 담당.
    """

    def __init__(self, db: AsyncSession) -> None:
        """OrganizationService 초기화

        Args:
            db: 비동기 DB 세션
        """
        self._db = db

    @property
    def db(self) -> AsyncSession:
        """DB 세션 접근자"""
        return self._db

    async def create_organization(self, data: OrganizationCreate) -> Organization:
        """조직을 생성한다.

        부모 조직이 있으면 계층 깊이를 검증한다 (최대 3단계).

        Args:
            data: 조직 생성 데이터

        Returns:
            생성된 Organization 객체

        Raises:
            HTTPException 400: 계층 깊이 초과
        """
        # 부모 조직이 있으면 계층 검증
        if data.parent_org_id is not None:
            await self.validate_org_hierarchy(parent_org_id=data.parent_org_id)

        # Organization 인스턴스 생성
        org = Organization(
            name=data.name,
            business_number=data.business_number,
            org_type=data.org_type,
            plan_type=data.plan_type,
            parent_org_id=data.parent_org_id,
            monthly_api_limit=data.monthly_api_limit,
        )

        self._db.add(org)
        await self._db.flush()
        await self._db.refresh(org)

        return org

    async def get_organization(self, org_id: uuid.UUID) -> Organization:
        """조직을 조회한다.

        Args:
            org_id: 조직 UUID

        Returns:
            Organization 객체

        Raises:
            HTTPException 404: 조직을 찾을 수 없음
        """
        result = await self._db.execute(
            sa.select(Organization).where(Organization.id == org_id)
        )
        org = result.scalar_one_or_none()

        if org is None:
            raise HTTPException(
                status_code=404,
                detail="조직을 찾을 수 없습니다.",
            )

        return org

    async def update_organization(
        self,
        org_id: uuid.UUID,
        data: OrganizationUpdate,
    ) -> Organization:
        """조직 정보를 수정한다.

        Args:
            org_id: 조직 UUID
            data: 수정할 데이터 (부분 업데이트 허용)

        Returns:
            수정된 Organization 객체

        Raises:
            HTTPException 404: 조직을 찾을 수 없음
        """
        org = await self.get_organization(org_id=org_id)

        # 변경된 필드만 업데이트
        update_data = data.model_dump(exclude_none=True)
        for field, value in update_data.items():
            setattr(org, field, value)

        await self._db.flush()
        await self._db.refresh(org)

        return org

    async def invite_member(
        self,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        role: str,
    ) -> OrganizationMember:
        """조직에 멤버를 초대한다.

        Args:
            org_id: 조직 UUID
            user_id: 초대할 사용자 UUID
            role: 부여할 역할

        Returns:
            생성된 OrganizationMember 객체
        """
        from app.models.organization_member import OrgMemberRole

        member = OrganizationMember(
            organization_id=org_id,
            user_id=user_id,
            role=OrgMemberRole(role),
        )

        self._db.add(member)
        await self._db.flush()
        await self._db.refresh(member)

        return member

    async def list_members(self, org_id: uuid.UUID) -> list[OrganizationMember]:
        """조직의 멤버 목록을 반환한다.

        Args:
            org_id: 조직 UUID

        Returns:
            OrganizationMember 목록
        """
        result = await self._db.execute(
            sa.select(OrganizationMember).where(
                OrganizationMember.organization_id == org_id
            )
        )
        return result.scalars().all()

    async def validate_org_hierarchy(
        self,
        parent_org_id: uuid.UUID | None,
    ) -> None:
        """조직 계층 깊이를 검증한다.

        최대 3단계 계층 구조만 허용. 3단계를 초과하면 400 오류를 반환.

        Args:
            parent_org_id: 부모 조직 UUID (None이면 최상위 조직)

        Raises:
            HTTPException 400: 3단계 초과 계층 구조
        """
        # 부모 없으면 최상위 조직 (항상 허용)
        if parent_org_id is None:
            return

        # 부모 체인을 따라 올라가며 깊이 계산
        # 현재 부모부터 시작해 최대 3번 추적 (3단계 = 루트 > 1단계 > 2단계)
        current_id = parent_org_id
        depth = 1  # 부모가 있으므로 최소 depth=1

        for _ in range(3):
            result = await self._db.execute(
                sa.select(Organization).where(Organization.id == current_id)
            )
            org = result.scalar_one_or_none()

            if org is None:
                # 부모 조직이 존재하지 않으면 검증 통과
                return

            if org.parent_org_id is None:
                # 최상위 조직에 도달 - 현재 depth가 3 이하면 허용
                if depth <= 2:
                    return
                break

            # 한 단계 더 위로
            current_id = org.parent_org_id
            depth += 1

        # 3단계 초과
        raise HTTPException(
            status_code=400,
            detail="조직 계층은 최대 3단계까지 허용됩니다.",
        )
