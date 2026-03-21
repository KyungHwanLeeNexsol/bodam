"""B2B 고객(AgentClient) 관리 라우터 (SPEC-B2B-001 Phase 3)

고객 CRUD, 동의 관리, 분석 요청 엔드포인트.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_role
from app.core.database import get_db
from app.core.encryption import FieldEncryptor, get_field_encryptor
from app.models.user import User, UserRole
from app.models.organization_member import OrgMemberRole
from app.schemas.b2b import (
    AnalyzeRequest,
    ClientCreate,
    ClientResponse,
    ClientUpdate,
    ConsentUpdateRequest,
)
from app.services.b2b.client_service import ClientService

router = APIRouter(tags=["b2b-clients"])


def _map_user_role(user_role: UserRole) -> OrgMemberRole:
    """UserRole을 OrgMemberRole로 매핑한다."""
    mapping = {
        UserRole.AGENT: OrgMemberRole.AGENT,
        UserRole.AGENT_ADMIN: OrgMemberRole.AGENT_ADMIN,
        UserRole.ORG_OWNER: OrgMemberRole.ORG_OWNER,
    }
    return mapping.get(user_role, OrgMemberRole.AGENT)


@router.post("/clients", response_model=ClientResponse, status_code=201)
async def create_client(
    data: ClientCreate,
    current_user: User = Depends(require_role(UserRole.AGENT, UserRole.AGENT_ADMIN, UserRole.ORG_OWNER, UserRole.SYSTEM_ADMIN)),
    db: AsyncSession = Depends(get_db),
    encryptor: FieldEncryptor = Depends(get_field_encryptor),
) -> ClientResponse:
    """고객을 생성한다 (PII 암호화 후 저장)."""
    service = ClientService(db=db, encryptor=encryptor)
    # org_id는 실제로는 request state나 멤버 조회로 가져와야 하나 MVP에서는 user.id로 대체
    client = await service.create_client(
        org_id=current_user.id,
        agent_id=current_user.id,
        data=data,
    )
    return ClientResponse.model_validate(client)


@router.get("/clients", response_model=list[ClientResponse])
async def list_clients(
    current_user: User = Depends(require_role(UserRole.AGENT, UserRole.AGENT_ADMIN, UserRole.ORG_OWNER, UserRole.SYSTEM_ADMIN)),
    db: AsyncSession = Depends(get_db),
    encryptor: FieldEncryptor = Depends(get_field_encryptor),
) -> list[ClientResponse]:
    """고객 목록을 조회한다."""
    service = ClientService(db=db, encryptor=encryptor)
    clients = await service.list_clients(
        org_id=current_user.id,
        user_id=current_user.id,
        user_role=_map_user_role(current_user.role),
    )
    return [ClientResponse.model_validate(c) for c in clients]


@router.get("/clients/{client_id}", response_model=ClientResponse)
async def get_client(
    client_id: uuid.UUID,
    current_user: User = Depends(require_role(UserRole.AGENT, UserRole.AGENT_ADMIN, UserRole.ORG_OWNER, UserRole.SYSTEM_ADMIN)),
    db: AsyncSession = Depends(get_db),
    encryptor: FieldEncryptor = Depends(get_field_encryptor),
) -> ClientResponse:
    """고객을 조회한다."""
    service = ClientService(db=db, encryptor=encryptor)
    client = await service.get_client(
        client_id=client_id,
        org_id=current_user.id,
        user_id=current_user.id,
        user_role=_map_user_role(current_user.role),
    )
    return ClientResponse.model_validate(client)


@router.put("/clients/{client_id}", response_model=ClientResponse)
async def update_client(
    client_id: uuid.UUID,
    data: ClientUpdate,
    current_user: User = Depends(require_role(UserRole.AGENT, UserRole.AGENT_ADMIN, UserRole.ORG_OWNER, UserRole.SYSTEM_ADMIN)),
    db: AsyncSession = Depends(get_db),
    encryptor: FieldEncryptor = Depends(get_field_encryptor),
) -> ClientResponse:
    """고객 정보를 수정한다."""
    service = ClientService(db=db, encryptor=encryptor)
    client = await service.update_client(
        client_id=client_id,
        org_id=current_user.id,
        agent_id=current_user.id,
        data=data,
    )
    return ClientResponse.model_validate(client)


@router.put("/clients/{client_id}/consent", response_model=ClientResponse)
async def update_consent(
    client_id: uuid.UUID,
    consent_request: ConsentUpdateRequest,
    current_user: User = Depends(require_role(UserRole.AGENT, UserRole.AGENT_ADMIN, UserRole.ORG_OWNER, UserRole.SYSTEM_ADMIN)),
    db: AsyncSession = Depends(get_db),
    encryptor: FieldEncryptor = Depends(get_field_encryptor),
) -> ClientResponse:
    """고객의 동의 상태를 업데이트한다."""
    service = ClientService(db=db, encryptor=encryptor)
    client = await service.update_consent(
        client_id=client_id,
        org_id=current_user.id,
        consent_request=consent_request,
    )
    return ClientResponse.model_validate(client)


@router.post("/clients/{client_id}/analyze")
async def analyze_client(
    client_id: uuid.UUID,
    request: AnalyzeRequest,
    current_user: User = Depends(require_role(UserRole.AGENT, UserRole.AGENT_ADMIN, UserRole.ORG_OWNER, UserRole.SYSTEM_ADMIN)),
    db: AsyncSession = Depends(get_db),
    encryptor: FieldEncryptor = Depends(get_field_encryptor),
) -> dict:
    """고객 분석 요청 (ACTIVE 동의 필요, AC-003)."""
    service = ClientService(db=db, encryptor=encryptor)
    await service.check_consent_for_analysis(
        client_id=client_id,
        org_id=current_user.id,
        user_id=current_user.id,
        user_role=_map_user_role(current_user.role),
    )
    return {"client_id": str(client_id), "query": request.query, "result": "분석 결과"}
