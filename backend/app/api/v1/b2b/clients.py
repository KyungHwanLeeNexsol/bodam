"""B2B 고객 관리 API 라우터 (SPEC-B2B-001 Phase 3)

고객 등록, 조회, 수정, 동의 관리, 분석 프록시 엔드포인트.
PII 암호화 및 PIPA 동의 검사 포함.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_org_user
from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.encryption import FieldEncryptor
from app.models.user import UserRole
from app.schemas.b2b import (
    AnalysisHistoryResponse,
    AnalyzeRequest,
    ClientCreate,
    ClientResponse,
    ClientUpdate,
    ConsentUpdateRequest,
)
from app.services.b2b.client_service import ClientService

# 고객 관리 라우터 (prefix: /b2b/clients)
router = APIRouter(tags=["b2b-clients"])

# B2B 기능 접근 가능 역할 (AGENT 이상)
_B2B_AGENT_ROLES = (
    UserRole.AGENT,
    UserRole.AGENT_ADMIN,
    UserRole.ORG_OWNER,
    UserRole.SYSTEM_ADMIN,
)


def _get_encryptor(settings: Settings = Depends(get_settings)) -> FieldEncryptor:
    """FieldEncryptor 의존성 팩토리

    설정에서 B2B 암호화 키를 읽어 FieldEncryptor 인스턴스를 반환.
    """
    return FieldEncryptor(key=settings.b2b_encryption_key)


# @MX:ANCHOR: 고객 등록 엔드포인트 - AGENT 이상 접근 가능
# @MX:REASON: AC-003 - 고객 등록 시 PII 암호화 필수
@router.post("/clients", response_model=ClientResponse, status_code=201)
async def create_client(
    data: ClientCreate,
    db: AsyncSession = Depends(get_db),
    auth: tuple = Depends(get_current_org_user),
    encryptor: FieldEncryptor = Depends(_get_encryptor),
) -> ClientResponse:
    """고객을 등록한다 (AGENT 이상).

    PII(이름, 전화, 이메일)는 Fernet 암호화 후 저장.
    동의 상태는 PENDING으로 초기화.

    Args:
        data: 고객 등록 데이터
        db: DB 세션
        auth: (현재 사용자, 조직 멤버) 튜플
        encryptor: PII 암호화 유틸리티

    Returns:
        복호화된 PII를 포함한 ClientResponse
    """
    user, org_member = auth
    service = ClientService(db=db, encryptor=encryptor)
    return await service.create_client(
        org_id=org_member.organization_id,
        agent_id=user.id,
        data=data,
    )


@router.get("/clients", response_model=list[ClientResponse])
async def list_clients(
    db: AsyncSession = Depends(get_db),
    auth: tuple = Depends(get_current_org_user),
    encryptor: FieldEncryptor = Depends(_get_encryptor),
) -> list[ClientResponse]:
    """고객 목록을 조회한다 (AGENT 이상).

    AGENT: 자신의 고객만 반환.
    AGENT_ADMIN, ORG_OWNER: 조직 전체 고객 반환 (AC-004).

    Args:
        db: DB 세션
        auth: (현재 사용자, 조직 멤버) 튜플
        encryptor: PII 암호화 유틸리티

    Returns:
        복호화된 PII를 포함한 ClientResponse 목록
    """
    user, org_member = auth
    service = ClientService(db=db, encryptor=encryptor)
    return await service.list_clients(
        org_id=org_member.organization_id,
        user_id=user.id,
        user_role=org_member.role,
    )


@router.get("/clients/{client_id}", response_model=ClientResponse)
async def get_client(
    client_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    auth: tuple = Depends(get_current_org_user),
    encryptor: FieldEncryptor = Depends(_get_encryptor),
) -> ClientResponse:
    """고객 상세 정보를 조회한다 (AGENT 이상).

    AGENT: 자신의 고객만 조회 가능 (다른 설계사 고객은 404).
    AGENT_ADMIN: 조직 내 모든 고객 조회 가능.

    Args:
        client_id: 조회할 고객 UUID
        db: DB 세션
        auth: (현재 사용자, 조직 멤버) 튜플
        encryptor: PII 암호화 유틸리티

    Returns:
        복호화된 PII를 포함한 ClientResponse

    Raises:
        HTTPException 404: 고객을 찾을 수 없음
    """
    user, org_member = auth
    service = ClientService(db=db, encryptor=encryptor)
    return await service.get_client(
        client_id=client_id,
        org_id=org_member.organization_id,
        user_id=user.id,
        user_role=org_member.role,
    )


@router.put("/clients/{client_id}", response_model=ClientResponse)
async def update_client(
    client_id: uuid.UUID,
    data: ClientUpdate,
    db: AsyncSession = Depends(get_db),
    auth: tuple = Depends(get_current_org_user),
    encryptor: FieldEncryptor = Depends(_get_encryptor),
) -> ClientResponse:
    """고객 정보를 수정한다 (AGENT - 소유 고객만).

    소유 설계사(agent_id)만 수정 가능.
    변경된 PII 필드는 재암호화.

    Args:
        client_id: 수정할 고객 UUID
        data: 수정 데이터
        db: DB 세션
        auth: (현재 사용자, 조직 멤버) 튜플
        encryptor: PII 암호화 유틸리티

    Returns:
        업데이트된 ClientResponse

    Raises:
        HTTPException 404: 고객을 찾을 수 없거나 권한 없음
    """
    user, org_member = auth
    service = ClientService(db=db, encryptor=encryptor)
    return await service.update_client(
        client_id=client_id,
        org_id=org_member.organization_id,
        agent_id=user.id,
        data=data,
    )


# @MX:ANCHOR: 동의 상태 업데이트 엔드포인트 - PIPA 핵심 기능
# @MX:REASON: AC-003 - 동의 철회 시 30일 후 데이터 삭제 스케줄링
@router.post("/clients/{client_id}/consent", response_model=ClientResponse)
async def update_consent(
    client_id: uuid.UUID,
    data: ConsentUpdateRequest,
    db: AsyncSession = Depends(get_db),
    auth: tuple = Depends(get_current_org_user),
    encryptor: FieldEncryptor = Depends(_get_encryptor),
) -> ClientResponse:
    """고객의 개인정보 동의 상태를 업데이트한다.

    ACTIVE: 동의 완료 (분석 허용)
    REVOKED: 동의 철회 (30일 후 데이터 삭제 예약)

    Args:
        client_id: 고객 UUID
        data: 변경할 동의 상태
        db: DB 세션
        auth: (현재 사용자, 조직 멤버) 튜플
        encryptor: PII 암호화 유틸리티

    Returns:
        업데이트된 ClientResponse
    """
    user, org_member = auth
    service = ClientService(db=db, encryptor=encryptor)
    return await service.update_consent(
        client_id=client_id,
        org_id=org_member.organization_id,
        consent_request=data,
    )


@router.post("/clients/{client_id}/analyze")
async def analyze_client(
    client_id: uuid.UUID,
    data: AnalyzeRequest,
    db: AsyncSession = Depends(get_db),
    auth: tuple = Depends(get_current_org_user),
    encryptor: FieldEncryptor = Depends(_get_encryptor),
) -> dict:
    """고객 정보 기반 분석을 요청한다 (ACTIVE 동의 필수).

    동의 미완료(PENDING) 또는 철회(REVOKED) 시 403 반환 (AC-003).
    현재는 플레이스홀더 응답 반환 (실제 LLM 연동은 별도 SPEC).

    Args:
        client_id: 고객 UUID
        data: 분석 요청 데이터
        db: DB 세션
        auth: (현재 사용자, 조직 멤버) 튜플
        encryptor: PII 암호화 유틸리티

    Returns:
        분석 결과 (플레이스홀더)

    Raises:
        HTTPException 403: 동의 미완료
        HTTPException 404: 고객을 찾을 수 없음
    """
    user, org_member = auth
    service = ClientService(db=db, encryptor=encryptor)

    # ACTIVE 동의 확인 (AC-003)
    await service.check_consent_for_analysis(
        client_id=client_id,
        org_id=org_member.organization_id,
        user_id=user.id,
        user_role=org_member.role,
    )

    # 플레이스홀더 응답 (실제 LLM 연동은 별도 SPEC에서 구현)
    return {
        "client_id": str(client_id),
        "query": data.query,
        "result": "분석 기능은 준비 중입니다.",
        "status": "placeholder",
    }


@router.get("/clients/{client_id}/history", response_model=list[AnalysisHistoryResponse])
async def get_analysis_history(
    client_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    auth: tuple = Depends(get_current_org_user),
    encryptor: FieldEncryptor = Depends(_get_encryptor),
) -> list[AnalysisHistoryResponse]:
    """고객 분석 이력을 조회한다 (AGENT 이상).

    현재는 빈 목록 반환 (분석 이력 모델은 별도 SPEC에서 구현).

    Args:
        client_id: 고객 UUID
        db: DB 세션
        auth: (현재 사용자, 조직 멤버) 튜플
        encryptor: PII 암호화 유틸리티

    Returns:
        분석 이력 목록 (현재 빈 목록)
    """
    user, org_member = auth
    service = ClientService(db=db, encryptor=encryptor)

    # 고객 접근 권한 확인 (조회 가능 여부 체크)
    await service.get_client(
        client_id=client_id,
        org_id=org_member.organization_id,
        user_id=user.id,
        user_role=org_member.role,
    )

    # 플레이스홀더: 빈 목록 반환 (분석 이력 모델은 별도 SPEC)
    return []
