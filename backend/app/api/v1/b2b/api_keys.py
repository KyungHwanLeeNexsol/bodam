"""B2B API 키 관리 라우터 (SPEC-B2B-001 Module 4)

API 키 생성, 목록, 폐기, 사용통계 엔드포인트.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_role
from app.core.database import get_db
from app.models.user import User, UserRole
from app.schemas.b2b import APIKeyCreate, APIKeyFullResponse, APIKeyResponse
from app.services.b2b.api_key_service import APIKeyService

router = APIRouter(tags=["b2b-api-keys"])


@router.post("/api-keys", response_model=APIKeyFullResponse, status_code=201)
async def create_api_key(
    data: APIKeyCreate,
    current_user: User = Depends(require_role(UserRole.ORG_OWNER, UserRole.AGENT_ADMIN, UserRole.SYSTEM_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> APIKeyFullResponse:
    """API 키를 생성한다 (AC-007). 생성 시 full_key가 한 번만 반환된다."""
    service = APIKeyService(db=db)
    api_key, full_key = await service.create_api_key(
        org_id=current_user.id,
        user_id=current_user.id,
        name=data.name,
        scopes=data.scopes,
    )
    response = APIKeyFullResponse.model_validate(api_key)
    response.full_key = full_key
    return response


@router.get("/api-keys", response_model=list[APIKeyResponse])
async def list_api_keys(
    current_user: User = Depends(require_role(UserRole.ORG_OWNER, UserRole.AGENT_ADMIN, UserRole.SYSTEM_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> list[APIKeyResponse]:
    """API 키 목록을 조회한다 (마스킹된 정보만 표시)."""
    service = APIKeyService(db=db)
    keys = await service.list_api_keys(org_id=current_user.id)
    return [APIKeyResponse.model_validate(k) for k in keys]


@router.delete("/api-keys/{key_id}", status_code=204)
async def revoke_api_key(
    key_id: uuid.UUID,
    current_user: User = Depends(require_role(UserRole.ORG_OWNER, UserRole.AGENT_ADMIN, UserRole.SYSTEM_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> None:
    """API 키를 폐기한다 (AC-008)."""
    service = APIKeyService(db=db)
    await service.revoke_api_key(key_id=key_id, org_id=current_user.id)


@router.get("/api-keys/{key_id}/usage")
async def get_api_key_usage(
    key_id: uuid.UUID,
    current_user: User = Depends(require_role(UserRole.ORG_OWNER, UserRole.AGENT_ADMIN, UserRole.SYSTEM_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """API 키의 사용 통계를 조회한다."""
    return {"key_id": str(key_id), "usage": 0}
