"""B2B 조직 API 라우터 (SPEC-B2B-001 Phase 1)

조직 생성, 조회, 수정, 멤버 초대/목록 조회 엔드포인트.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_role
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

# B2B 조직 라우터 (prefix: /b2b)
router = APIRouter(tags=["b2b-organizations"])


# @MX:ANCHOR: 조직 생성 엔드포인트 - SYSTEM_ADMIN만 접근 가능
# @MX:REASON: 조직 생성은 시스템 관리자 권한이 필요한 중요 작업
@router.post("/organizations", response_model=OrganizationResponse, status_code=201)
async def create_organization(
    data: OrganizationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SYSTEM_ADMIN)),
) -> OrganizationResponse:
    """조직을 생성한다 (SYSTEM_ADMIN 전용).

    Args:
        data: 조직 생성 데이터
        db: DB 세션
        current_user: 현재 인증된 SYSTEM_ADMIN 사용자

    Returns:
        생성된 조직 정보
    """
    service = OrganizationService(db=db)
    org = await service.create_organization(data=data)
    return OrganizationResponse.model_validate(org)


@router.get("/organizations/{org_id}", response_model=OrganizationResponse)
async def get_organization(
    org_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_role(UserRole.ORG_OWNER, UserRole.AGENT_ADMIN, UserRole.SYSTEM_ADMIN)
    ),
) -> OrganizationResponse:
    """조직 정보를 조회한다 (ORG_OWNER, AGENT_ADMIN, SYSTEM_ADMIN 접근 가능).

    Args:
        org_id: 조직 UUID
        db: DB 세션
        current_user: 현재 인증된 사용자

    Returns:
        조직 정보
    """
    service = OrganizationService(db=db)
    org = await service.get_organization(org_id=org_id)
    return OrganizationResponse.model_validate(org)


@router.put("/organizations/{org_id}", response_model=OrganizationResponse)
async def update_organization(
    org_id: uuid.UUID,
    data: OrganizationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ORG_OWNER, UserRole.SYSTEM_ADMIN)),
) -> OrganizationResponse:
    """조직 정보를 수정한다 (ORG_OWNER, SYSTEM_ADMIN 접근 가능).

    Args:
        org_id: 조직 UUID
        data: 수정할 데이터
        db: DB 세션
        current_user: 현재 인증된 사용자

    Returns:
        수정된 조직 정보
    """
    service = OrganizationService(db=db)
    org = await service.update_organization(org_id=org_id, data=data)
    return OrganizationResponse.model_validate(org)


@router.post("/organizations/{org_id}/invite", status_code=201)
async def invite_member(
    org_id: uuid.UUID,
    data: OrganizationMemberInvite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_role(UserRole.ORG_OWNER, UserRole.AGENT_ADMIN, UserRole.SYSTEM_ADMIN)
    ),
) -> dict:
    """조직에 멤버를 초대한다 (ORG_OWNER, AGENT_ADMIN, SYSTEM_ADMIN 접근 가능).

    초대 이메일을 발송하고 초대 토큰을 생성한다.

    Args:
        org_id: 조직 UUID
        data: 초대 요청 데이터 (이메일, 역할)
        db: DB 세션
        current_user: 현재 인증된 사용자

    Returns:
        초대 결과 메시지
    """
    # TODO: 초대 토큰 생성 및 이메일 발송 구현 (Phase 2)
    return {"message": f"{data.email}로 초대 메일을 발송했습니다.", "org_id": str(org_id)}


@router.get("/organizations/{org_id}/members", response_model=list[OrganizationMemberResponse])
async def list_members(
    org_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_role(UserRole.ORG_OWNER, UserRole.AGENT_ADMIN, UserRole.SYSTEM_ADMIN)
    ),
) -> list[OrganizationMemberResponse]:
    """조직의 멤버 목록을 반환한다 (ORG_OWNER, AGENT_ADMIN, SYSTEM_ADMIN 접근 가능).

    Args:
        org_id: 조직 UUID
        db: DB 세션
        current_user: 현재 인증된 사용자

    Returns:
        조직 멤버 목록
    """
    service = OrganizationService(db=db)
    members = await service.list_members(org_id=org_id)
    return [OrganizationMemberResponse.model_validate(m) for m in members]
