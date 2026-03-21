"""B2B 조직 관리 API 라우터 (SPEC-B2B-001 Phase 1)

조직 CRUD 및 멤버 관리 엔드포인트.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_role
from app.core.database import get_db
from app.models.user import User, UserRole
from app.schemas.b2b import (
    OrganizationCreate,
    OrganizationMemberInvite,
    OrganizationMemberResponse,
    OrganizationResponse,
    OrganizationUpdate,
)
from app.services.b2b.organization_service import OrganizationService

router = APIRouter(tags=["b2b-organizations"])


@router.post("/organizations", response_model=OrganizationResponse, status_code=201)
async def create_organization(
    data: OrganizationCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OrganizationResponse:
    """조직을 생성한다."""
    service = OrganizationService(db=db)
    org = await service.create_organization(data=data, creator_id=current_user.id)
    return OrganizationResponse.model_validate(org)


@router.get("/organizations/{org_id}", response_model=OrganizationResponse)
async def get_organization(
    org_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OrganizationResponse:
    """조직을 조회한다."""
    service = OrganizationService(db=db)
    org = await service.get_organization(org_id=org_id)
    return OrganizationResponse.model_validate(org)


@router.put("/organizations/{org_id}", response_model=OrganizationResponse)
async def update_organization(
    org_id: uuid.UUID,
    data: OrganizationUpdate,
    current_user: User = Depends(require_role(UserRole.ORG_OWNER, UserRole.AGENT_ADMIN, UserRole.SYSTEM_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> OrganizationResponse:
    """조직 정보를 수정한다."""
    service = OrganizationService(db=db)
    org = await service.update_organization(org_id=org_id, data=data)
    return OrganizationResponse.model_validate(org)


@router.post("/organizations/{org_id}/invite", response_model=OrganizationMemberResponse, status_code=201)
async def invite_member(
    org_id: uuid.UUID,
    invite_data: OrganizationMemberInvite,
    current_user: User = Depends(require_role(UserRole.ORG_OWNER, UserRole.AGENT_ADMIN, UserRole.SYSTEM_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> OrganizationMemberResponse:
    """조직에 멤버를 초대한다."""
    service = OrganizationService(db=db)
    # 이메일로 사용자 조회 (간단한 처리: UUID 생성 후 멤버 추가)
    import sqlalchemy as sa
    from app.models.user import User as UserModel
    result = await db.execute(sa.select(UserModel).where(UserModel.email == invite_data.email))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    member = await service.invite_member(org_id=org_id, invite_data=invite_data, user_id=user.id)
    return OrganizationMemberResponse.model_validate(member)


@router.get("/organizations/{org_id}/members", response_model=list[OrganizationMemberResponse])
async def list_members(
    org_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[OrganizationMemberResponse]:
    """조직 멤버 목록을 조회한다."""
    service = OrganizationService(db=db)
    members = await service.list_members(org_id=org_id)
    return [OrganizationMemberResponse.model_validate(m) for m in members]
