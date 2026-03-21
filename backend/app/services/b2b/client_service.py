"""B2B 클라이언트(고객) 서비스 (SPEC-B2B-001 Phase 3)

고객 CRUD, PII 암호화/복호화, 동의 관리, 멀티테넌트 격리 비즈니스 로직.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import FieldEncryptor
from app.models.agent_client import AgentClient, ConsentStatus
from app.models.organization_member import OrgMemberRole
from app.schemas.b2b import ClientCreate, ClientUpdate, ConsentUpdateRequest


class ClientService:
    """고객 비즈니스 로직 서비스"""

    def __init__(self, db: AsyncSession, encryptor: FieldEncryptor) -> None:
        self._db = db
        self._enc = encryptor

    def _decrypt_client(self, client: AgentClient) -> AgentClient:
        """고객 PII 필드를 복호화한다 (응답 직전).

        Args:
            client: AgentClient 객체 (암호화된 PII)

        Returns:
            PII가 복호화된 AgentClient 객체
        """
        client.client_name = self._enc.decrypt_field(client.client_name)
        client.client_phone = self._enc.decrypt_field(client.client_phone)
        if client.client_email:
            client.client_email = self._enc.decrypt_field(client.client_email)
        return client

    async def create_client(
        self,
        org_id: uuid.UUID,
        agent_id: uuid.UUID,
        data: ClientCreate,
    ) -> AgentClient:
        """고객을 생성하고 PII를 암호화하여 저장한다.

        Args:
            org_id: 조직 UUID
            agent_id: 담당 설계사 UUID
            data: 고객 생성 요청 데이터

        Returns:
            생성된 AgentClient 객체 (PII 복호화됨)
        """
        # PII 암호화
        enc_name = self._enc.encrypt_field(data.client_name)
        enc_phone = self._enc.encrypt_field(data.client_phone)
        enc_email = self._enc.encrypt_field(data.client_email) if data.client_email else None

        client = AgentClient(
            organization_id=org_id,
            agent_id=agent_id,
            client_name=enc_name,
            client_phone=enc_phone,
            client_email=enc_email,
        )
        self._db.add(client)
        await self._db.flush()
        await self._db.refresh(client)

        # 응답 직전 복호화
        return self._decrypt_client(client)

    async def get_client(
        self,
        client_id: uuid.UUID,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        user_role: OrgMemberRole,
    ) -> AgentClient:
        """고객을 조회하고 PII를 복호화하여 반환한다.

        AGENT는 자신의 고객만 조회 가능.
        AGENT_ADMIN/ORG_OWNER는 조직 내 모든 고객 조회 가능.

        Args:
            client_id: 고객 UUID
            org_id: 조직 UUID
            user_id: 요청자 UUID
            user_role: 요청자 역할

        Returns:
            AgentClient 객체 (PII 복호화됨)

        Raises:
            HTTPException 404: 고객을 찾을 수 없거나 접근 권한 없음
        """
        query = sa.select(AgentClient).where(
            AgentClient.id == client_id,
            AgentClient.organization_id == org_id,
        )

        # AGENT는 자신의 고객만 조회 가능
        if user_role == OrgMemberRole.AGENT:
            query = query.where(AgentClient.agent_id == user_id)

        result = await self._db.execute(query)
        client = result.scalar_one_or_none()

        if client is None:
            raise HTTPException(status_code=404, detail="고객을 찾을 수 없습니다.")

        return self._decrypt_client(client)

    async def list_clients(
        self,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        user_role: OrgMemberRole,
    ) -> list[AgentClient]:
        """고객 목록을 조회하고 PII를 복호화하여 반환한다.

        Args:
            org_id: 조직 UUID
            user_id: 요청자 UUID
            user_role: 요청자 역할

        Returns:
            AgentClient 목록 (PII 복호화됨)
        """
        query = sa.select(AgentClient).where(
            AgentClient.organization_id == org_id,
        )

        # AGENT는 자신의 고객만 조회 가능
        if user_role == OrgMemberRole.AGENT:
            query = query.where(AgentClient.agent_id == user_id)

        result = await self._db.execute(query)
        clients = result.scalars().all()

        return [self._decrypt_client(c) for c in clients]

    async def update_client(
        self,
        client_id: uuid.UUID,
        org_id: uuid.UUID,
        agent_id: uuid.UUID,
        data: ClientUpdate,
    ) -> AgentClient:
        """고객 정보를 수정하고 PII를 재암호화한다.

        소유 설계사만 수정 가능.

        Args:
            client_id: 고객 UUID
            org_id: 조직 UUID
            agent_id: 담당 설계사 UUID (소유 검증용)
            data: 수정 요청 데이터

        Returns:
            수정된 AgentClient 객체 (PII 복호화됨)

        Raises:
            HTTPException 404: 고객을 찾을 수 없거나 소유 설계사가 아님
        """
        result = await self._db.execute(
            sa.select(AgentClient).where(
                AgentClient.id == client_id,
                AgentClient.organization_id == org_id,
                AgentClient.agent_id == agent_id,
            )
        )
        client = result.scalar_one_or_none()

        if client is None:
            raise HTTPException(status_code=404, detail="고객을 찾을 수 없습니다.")

        # 변경된 PII 필드 재암호화
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

        return self._decrypt_client(client)

    async def check_consent_for_analysis(
        self,
        client_id: uuid.UUID,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        user_role: "OrgMemberRole",
    ) -> "AgentClient":
        """분석 요청 전 고객의 ACTIVE 동의 여부를 확인한다 (AC-003).

        Args:
            client_id: 고객 UUID
            org_id: 조직 UUID
            user_id: 요청자 UUID
            user_role: 요청자 역할

        Returns:
            동의 완료된 AgentClient 객체

        Raises:
            HTTPException 404: 고객을 찾을 수 없는 경우
            HTTPException 403: 동의 상태가 ACTIVE가 아닌 경우
        """
        from app.models.agent_client import ConsentStatus

        result = await self._db.execute(
            sa.select(AgentClient).where(
                AgentClient.id == client_id,
                AgentClient.organization_id == org_id,
            )
        )
        client = result.scalar_one_or_none()

        if client is None:
            raise HTTPException(status_code=404, detail="고객을 찾을 수 없습니다.")

        if client.consent_status != ConsentStatus.ACTIVE:
            raise HTTPException(
                status_code=403,
                detail="분석을 위해 고객의 개인정보 이용 동의가 필요합니다.",
            )

        return self._decrypt_client(client)

    async def update_consent(
        self,
        client_id: uuid.UUID,
        org_id: uuid.UUID,
        consent_request: ConsentUpdateRequest,
    ) -> AgentClient:
        """고객의 동의 상태를 업데이트한다.

        Args:
            client_id: 고객 UUID
            org_id: 조직 UUID
            consent_request: 동의 상태 변경 요청

        Returns:
            업데이트된 AgentClient 객체

        Raises:
            HTTPException 404: 고객을 찾을 수 없는 경우
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

        # ACTIVE 또는 REVOKED로 변경 시 동의 날짜 설정
        if consent_request.consent_status in (ConsentStatus.ACTIVE, ConsentStatus.REVOKED):
            client.consent_date = datetime.now(UTC)

        await self._db.flush()

        return self._decrypt_client(client)
