"""API Key 관리 라우터 (SPEC-B2B-001 Module 4)

API 키 생성, 목록 조회, 폐기, 사용통계 엔드포인트.
AGENT_ADMIN 이상의 역할이 필요.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_role
from app.core.database import get_db
from app.models.organization_member import OrgMemberRole
from app.models.user import User, UserRole
from app.schemas.b2b import APIKeyCreate, APIKeyFullResponse, APIKeyResponse
from app.services.b2b.api_key_service import APIKeyService

# API 키 관리 라우터
router = APIRouter(tags=["b2b-api-keys"])

# AGENT_ADMIN 이상 역할 허용 (B2B 키 관리 권한)
_B2B_ROLES = (
    UserRole.AGENT,
    UserRole.AGENT_ADMIN,
    UserRole.ORG_OWNER,
    UserRole.SYSTEM_ADMIN,
)


# @MX:ANCHOR: API 키 생성 엔드포인트 - 전체 키는 여기서만 반환
# @MX:REASON: AC-007 - 전체 키는 생성 시 한 번만 반환, 이후 조회 불가
@router.post("/api-keys", response_model=APIKeyFullResponse, status_code=201)
async def create_api_key(
    data: APIKeyCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(*_B2B_ROLES)),
) -> APIKeyFullResponse:
    """API 키를 생성한다 (AGENT_ADMIN 이상).

    전체 키는 이 응답에서 한 번만 반환된다.
    이후 목록 조회에서는 마스킹된 키 정보만 제공됨.

    Args:
        data: API 키 생성 데이터
        db: DB 세션
        current_user: 현재 인증된 사용자

    Returns:
        생성된 API 키 정보 (full_key 포함)
    """
    # 현재 사용자의 조직 멤버십 확인
    import sqlalchemy as sa

    from app.models.organization_member import OrganizationMember

    result = await db.execute(
        sa.select(OrganizationMember).where(
            OrganizationMember.user_id == current_user.id,
            OrganizationMember.is_active.is_(True),
        )
    )
    org_member = result.scalar_one_or_none()

    if org_member is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=403, detail="조직에 속하지 않은 사용자입니다.")

    # AGENT_ADMIN 이상 권한 확인
    if org_member.role not in (OrgMemberRole.AGENT_ADMIN, OrgMemberRole.ORG_OWNER):
        from fastapi import HTTPException

        raise HTTPException(status_code=403, detail="API 키 생성 권한이 없습니다.")

    service = APIKeyService(db=db)
    api_key, full_key = await service.create_api_key(
        org_id=org_member.organization_id,
        user_id=current_user.id,
        name=data.name,
        scopes=data.scopes,
    )

    return APIKeyFullResponse(
        id=api_key.id,
        key_prefix=api_key.key_prefix,
        key_last4=api_key.key_last4,
        name=api_key.name,
        scopes=api_key.scopes,
        is_active=api_key.is_active,
        last_used_at=api_key.last_used_at,
        created_at=api_key.created_at,
        full_key=full_key,
    )


@router.get("/api-keys", response_model=list[APIKeyResponse])
async def list_api_keys(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(*_B2B_ROLES)),
) -> list[APIKeyResponse]:
    """조직의 API 키 목록을 조회한다 (AGENT_ADMIN 이상).

    마스킹된 키 정보만 반환 (key_hash 미포함).
    AC-007: 목록에 마스킹된 키만 표시

    Args:
        db: DB 세션
        current_user: 현재 인증된 사용자

    Returns:
        마스킹된 API 키 목록
    """
    import sqlalchemy as sa

    from app.models.organization_member import OrganizationMember

    result = await db.execute(
        sa.select(OrganizationMember).where(
            OrganizationMember.user_id == current_user.id,
            OrganizationMember.is_active.is_(True),
        )
    )
    org_member = result.scalar_one_or_none()

    if org_member is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=403, detail="조직에 속하지 않은 사용자입니다.")

    if org_member.role not in (OrgMemberRole.AGENT_ADMIN, OrgMemberRole.ORG_OWNER):
        from fastapi import HTTPException

        raise HTTPException(status_code=403, detail="API 키 목록 조회 권한이 없습니다.")

    service = APIKeyService(db=db)
    api_keys = await service.list_api_keys(org_id=org_member.organization_id)

    return [APIKeyResponse.model_validate(key) for key in api_keys]


@router.delete("/api-keys/{key_id}", status_code=204)
async def revoke_api_key(
    key_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(*_B2B_ROLES)),
) -> None:
    """API 키를 폐기한다 (AGENT_ADMIN 이상).

    폐기된 키로는 더 이상 인증할 수 없다.
    AC-008: 폐기된 키로 접근 시 401

    Args:
        key_id: 폐기할 키의 UUID
        db: DB 세션
        current_user: 현재 인증된 사용자
    """
    import sqlalchemy as sa

    from app.models.organization_member import OrganizationMember

    result = await db.execute(
        sa.select(OrganizationMember).where(
            OrganizationMember.user_id == current_user.id,
            OrganizationMember.is_active.is_(True),
        )
    )
    org_member = result.scalar_one_or_none()

    if org_member is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=403, detail="조직에 속하지 않은 사용자입니다.")

    if org_member.role not in (OrgMemberRole.AGENT_ADMIN, OrgMemberRole.ORG_OWNER):
        from fastapi import HTTPException

        raise HTTPException(status_code=403, detail="API 키 폐기 권한이 없습니다.")

    service = APIKeyService(db=db)
    await service.revoke_api_key(key_id=key_id, org_id=org_member.organization_id)


@router.get("/api-keys/{key_id}/usage", response_model=dict)
async def get_api_key_usage(
    key_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(*_B2B_ROLES)),
) -> dict:
    """API 키의 사용 통계를 조회한다 (AGENT_ADMIN 이상).

    Args:
        key_id: 조회할 키의 UUID
        db: DB 세션
        current_user: 현재 인증된 사용자

    Returns:
        사용 통계 딕셔너리
    """
    import sqlalchemy as sa

    from app.models.api_key import APIKey
    from app.models.organization_member import OrganizationMember

    # 조직 멤버십 확인
    result = await db.execute(
        sa.select(OrganizationMember).where(
            OrganizationMember.user_id == current_user.id,
            OrganizationMember.is_active.is_(True),
        )
    )
    org_member = result.scalar_one_or_none()

    if org_member is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=403, detail="조직에 속하지 않은 사용자입니다.")

    if org_member.role not in (OrgMemberRole.AGENT_ADMIN, OrgMemberRole.ORG_OWNER):
        from fastapi import HTTPException

        raise HTTPException(status_code=403, detail="API 키 사용통계 조회 권한이 없습니다.")

    # 키 조회 및 소유권 확인
    key_result = await db.execute(
        sa.select(APIKey).where(
            APIKey.id == key_id,
            APIKey.organization_id == org_member.organization_id,
        )
    )
    api_key = key_result.scalar_one_or_none()

    if api_key is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="API 키를 찾을 수 없습니다.")

    return {
        "key_id": str(api_key.id),
        "name": api_key.name,
        "is_active": api_key.is_active,
        "last_used_at": api_key.last_used_at.isoformat() if api_key.last_used_at else None,
        "created_at": api_key.created_at.isoformat() if api_key.created_at else None,
        "scopes": api_key.scopes,
    }
