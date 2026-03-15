"""B2B 고객 관리 서비스 (SPEC-B2B-001 Phase 3 - Module 2)

고객 CRUD, PII 암호화/복호화, PIPA 동의 관리, 멀티테넌트 격리 비즈니스 로직.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import FieldEncryptor
from app.models.agent_client import AgentClient, ConsentStatus
from app.models.organization_member import OrgMemberRole
from app.schemas.b2b import (
    ClientCreate,
    ClientResponse,
    ClientUpdate,
    ConsentUpdateRequest,
)


# @MX:ANCHOR: ClientService - 고객 관리 비즈니스 로직의 단일 진입점
# @MX:REASON: PII 암호화, 멀티테넌트 격리, 동의 검사 등 복잡한 로직 집중 관리
class ClientService:
    """고객 관리 서비스

    설계사의 고객 정보 CRUD, PII 암호화, 동의 상태 관리를 담당.
    모든 PII 접근은 이 서비스를 통해 이루어져야 함.
    """

    def __init__(self, db: AsyncSession, encryptor: FieldEncryptor) -> None:
        """ClientService 초기화

        Args:
            db: 비동기 DB 세션
            encryptor: PII 암호화/복호화 유틸리티
        """
        self._db = db
        self._enc = encryptor

    def _to_response(self, client: AgentClient) -> ClientResponse:
        """AgentClient ORM 객체를 복호화된 ClientResponse로 변환한다.

        Args:
            client: AgentClient ORM 객체 (암호화된 PII 포함)

        Returns:
            복호화된 PII를 포함한 ClientResponse
        """
        return ClientResponse(
            id=client.id,
            org_id=client.organization_id,
            agent_id=client.agent_id,
            client_name=self._enc.decrypt_field(client.client_name),
            client_phone=self._enc.decrypt_field(client.client_phone),
            client_email=self._enc.decrypt_field(client.client_email) if client.client_email else None,
            consent_status=client.consent_status,
            consent_date=client.consent_date,
            notes=client.notes,
            created_at=client.created_at,
            updated_at=client.updated_at,
        )

    async def create_client(
        self,
        org_id: uuid.UUID,
        agent_id: uuid.UUID,
        data: ClientCreate,
    ) -> ClientResponse:
        """고객을 등록한다.

        PII 필드(이름, 전화, 이메일)를 암호화하여 저장.
        동의 상태는 PENDING으로 초기화.

        Args:
            org_id: 조직 UUID
            agent_id: 담당 설계사 UUID
            data: 고객 등록 데이터 (평문 PII)

        Returns:
            복호화된 PII를 포함한 ClientResponse
        """
        # PII 필드 암호화
        encrypted_name = self._enc.encrypt_field(data.client_name)
        encrypted_phone = self._enc.encrypt_field(data.client_phone)
        encrypted_email = self._enc.encrypt_field(data.client_email) if data.client_email else None

        client = AgentClient(
            organization_id=org_id,
            agent_id=agent_id,
            client_name=encrypted_name,
            client_phone=encrypted_phone,
            client_email=encrypted_email,
            consent_status=ConsentStatus.PENDING,
        )

        self._db.add(client)
        await self._db.flush()
        await self._db.refresh(client)

        return self._to_response(client)

    def _build_client_query(
        self,
        client_id: uuid.UUID,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        user_role: OrgMemberRole,
    ) -> sa.Select:
        """역할에 따른 고객 조회 쿼리를 생성한다.

        AGENT: 자신의 고객만 조회 (agent_id 필터 추가)
        AGENT_ADMIN, ORG_OWNER: 조직 전체 고객 조회

        Args:
            client_id: 조회할 고객 UUID
            org_id: 조직 UUID (멀티테넌트 격리)
            user_id: 현재 사용자 UUID
            user_role: 현재 사용자의 조직 역할

        Returns:
            SQLAlchemy Select 쿼리
        """
        query = sa.select(AgentClient).where(
            AgentClient.id == client_id,
            AgentClient.organization_id == org_id,
        )

        # AGENT는 자신의 고객만 조회 가능 (AC-004)
        if user_role == OrgMemberRole.AGENT:
            query = query.where(AgentClient.agent_id == user_id)

        return query

    async def get_client(
        self,
        client_id: uuid.UUID,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        user_role: OrgMemberRole,
    ) -> ClientResponse:
        """고객 상세 정보를 조회한다.

        멀티테넌트 격리 적용: org_id가 일치해야 함.
        역할 기반 접근 제어:
        - AGENT: 자신의 고객만 조회 가능
        - AGENT_ADMIN, ORG_OWNER: 조직 전체 고객 조회 가능

        Args:
            client_id: 조회할 고객 UUID
            org_id: 조직 UUID
            user_id: 현재 사용자 UUID
            user_role: 현재 사용자의 조직 역할

        Returns:
            복호화된 PII를 포함한 ClientResponse

        Raises:
            HTTPException 404: 고객을 찾을 수 없음 (다른 조직/설계사 포함)
        """
        query = self._build_client_query(
            client_id=client_id,
            org_id=org_id,
            user_id=user_id,
            user_role=user_role,
        )
        result = await self._db.execute(query)
        client = result.scalar_one_or_none()

        if client is None:
            raise HTTPException(status_code=404, detail="고객을 찾을 수 없습니다.")

        return self._to_response(client)

    async def list_clients(
        self,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        user_role: OrgMemberRole,
    ) -> list[ClientResponse]:
        """고객 목록을 조회한다.

        역할 기반 접근 제어:
        - AGENT: 자신의 고객만 목록 반환
        - AGENT_ADMIN, ORG_OWNER: 조직 전체 고객 목록 반환

        Args:
            org_id: 조직 UUID
            user_id: 현재 사용자 UUID
            user_role: 현재 사용자의 조직 역할

        Returns:
            복호화된 PII를 포함한 ClientResponse 목록
        """
        query = sa.select(AgentClient).where(
            AgentClient.organization_id == org_id,
        )

        # AGENT는 자신의 고객만 조회 (AC-004)
        if user_role == OrgMemberRole.AGENT:
            query = query.where(AgentClient.agent_id == user_id)

        result = await self._db.execute(query)
        clients = result.scalars().all()

        return [self._to_response(c) for c in clients]

    async def update_client(
        self,
        client_id: uuid.UUID,
        org_id: uuid.UUID,
        agent_id: uuid.UUID,
        data: ClientUpdate,
    ) -> ClientResponse:
        """고객 정보를 업데이트한다.

        변경된 PII 필드는 재암호화.
        소유 설계사(agent_id)만 업데이트 가능.

        Args:
            client_id: 수정할 고객 UUID
            org_id: 조직 UUID
            agent_id: 소유 설계사 UUID
            data: 수정 데이터

        Returns:
            업데이트된 ClientResponse

        Raises:
            HTTPException 404: 고객을 찾을 수 없거나 권한 없음
        """
        result = await self._db.execute(
            sa.select(AgentClient).where(
                AgentClient.id == client_id,
                AgentClient.organization_id == org_id,
                AgentClient.agent_id == agent_id,  # 소유 설계사만 수정 가능
            )
        )
        client = result.scalar_one_or_none()

        if client is None:
            raise HTTPException(status_code=404, detail="고객을 찾을 수 없거나 수정 권한이 없습니다.")

        # PII 필드 재암호화 (변경된 필드만)
        if data.client_name is not None:
            client.client_name = self._enc.encrypt_field(data.client_name)
        if data.client_phone is not None:
            client.client_phone = self._enc.encrypt_field(data.client_phone)
        if data.client_email is not None:
            client.client_email = self._enc.encrypt_field(data.client_email)
        if data.notes is not None:
            client.notes = data.notes

        await self._db.flush()
        await self._db.refresh(client)

        return self._to_response(client)

    async def update_consent(
        self,
        client_id: uuid.UUID,
        org_id: uuid.UUID,
        consent_request: ConsentUpdateRequest,
    ) -> ClientResponse:
        """고객의 개인정보 동의 상태를 업데이트한다.

        ACTIVE: 동의 완료, consent_date 현재 시각으로 설정
        REVOKED: 동의 철회, consent_date 현재 시각으로 설정
                 (실제 데이터 삭제는 30일 후 스케줄러에서 처리)

        Args:
            client_id: 고객 UUID
            org_id: 조직 UUID
            consent_request: 변경할 동의 상태

        Returns:
            업데이트된 ClientResponse

        Raises:
            HTTPException 404: 고객을 찾을 수 없음
        """
        result = await self._db.execute(
            sa.select(AgentClient).where(
                AgentClient.id == client_id,
                AgentClient.organization_id == org_id,
            )
        )
        client = result.scalar_one_or_none()

        if client is None:
            raise HTTPException(status_code=404, detail="고객을 찾을 수 없습니다.")

        client.consent_status = consent_request.consent_status
        client.consent_date = datetime.now(UTC)

        await self._db.flush()

        return self._to_response(client)

    async def check_consent_for_analysis(
        self,
        client_id: uuid.UUID,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        user_role: OrgMemberRole,
    ) -> AgentClient:
        """분석 요청 전 ACTIVE 동의 여부를 확인한다.

        동의 미완료(PENDING) 또는 철회(REVOKED) 시 403 반환 (AC-003).

        Args:
            client_id: 고객 UUID
            org_id: 조직 UUID
            user_id: 현재 사용자 UUID
            user_role: 현재 사용자의 조직 역할

        Returns:
            동의 검증을 통과한 AgentClient 객체

        Raises:
            HTTPException 403: 동의 미완료 또는 동의 철회
            HTTPException 404: 고객을 찾을 수 없음
        """
        query = self._build_client_query(
            client_id=client_id,
            org_id=org_id,
            user_id=user_id,
            user_role=user_role,
        )
        result = await self._db.execute(query)
        client = result.scalar_one_or_none()

        if client is None:
            raise HTTPException(status_code=404, detail="고객을 찾을 수 없습니다.")

        if client.consent_status != ConsentStatus.ACTIVE:
            raise HTTPException(
                status_code=403,
                detail="개인정보 동의가 완료되지 않아 분석을 수행할 수 없습니다.",
            )

        return client
