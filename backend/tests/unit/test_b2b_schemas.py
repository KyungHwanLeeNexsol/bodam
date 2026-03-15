"""B2B 스키마 단위 테스트 (SPEC-B2B-001 Phase 1)

OrganizationCreate, OrganizationResponse, OrganizationUpdate, B2BRegistrationRequest 스키마 검증.
"""

from __future__ import annotations

import uuid
from datetime import datetime

import pytest


class TestOrganizationCreateSchema:
    """OrganizationCreate 스키마 테스트"""

    def test_organization_create_importable(self):
        """OrganizationCreate 스키마가 임포트 가능해야 한다"""
        from app.schemas.b2b import OrganizationCreate

        assert OrganizationCreate is not None

    def test_organization_create_valid_data(self):
        """OrganizationCreate는 유효한 데이터를 수락해야 한다"""
        from app.schemas.b2b import OrganizationCreate

        data = OrganizationCreate(
            name="테스트 보험 GA",
            business_number="123-45-67890",
            org_type="GA",
            plan_type="FREE_TRIAL",
        )
        assert data.name == "테스트 보험 GA"
        assert data.business_number == "123-45-67890"

    def test_organization_create_name_required(self):
        """OrganizationCreate는 name이 필수여야 한다"""
        from pydantic import ValidationError

        from app.schemas.b2b import OrganizationCreate

        with pytest.raises(ValidationError):
            OrganizationCreate(
                business_number="123-45-67890",
                org_type="GA",
                plan_type="FREE_TRIAL",
            )

    def test_organization_create_business_number_required(self):
        """OrganizationCreate는 business_number가 필수여야 한다"""
        from pydantic import ValidationError

        from app.schemas.b2b import OrganizationCreate

        with pytest.raises(ValidationError):
            OrganizationCreate(
                name="테스트 GA",
                org_type="GA",
                plan_type="FREE_TRIAL",
            )

    def test_organization_create_invalid_org_type(self):
        """OrganizationCreate는 유효하지 않은 org_type을 거부해야 한다"""
        from pydantic import ValidationError

        from app.schemas.b2b import OrganizationCreate

        with pytest.raises(ValidationError):
            OrganizationCreate(
                name="테스트 GA",
                business_number="123-45-67890",
                org_type="INVALID_TYPE",
                plan_type="FREE_TRIAL",
            )

    def test_organization_create_parent_org_id_optional(self):
        """OrganizationCreate의 parent_org_id는 선택적이어야 한다"""
        from app.schemas.b2b import OrganizationCreate

        # parent_org_id 없이 생성
        data = OrganizationCreate(
            name="최상위 조직",
            business_number="123-45-67890",
            org_type="GA",
            plan_type="BASIC",
        )
        assert data.parent_org_id is None

    def test_organization_create_with_parent_org_id(self):
        """OrganizationCreate는 parent_org_id를 받을 수 있어야 한다"""
        from app.schemas.b2b import OrganizationCreate

        parent_id = uuid.uuid4()
        data = OrganizationCreate(
            name="하위 조직",
            business_number="098-76-54321",
            org_type="INDEPENDENT",
            plan_type="BASIC",
            parent_org_id=parent_id,
        )
        assert data.parent_org_id == parent_id


class TestOrganizationResponseSchema:
    """OrganizationResponse 스키마 테스트"""

    def test_organization_response_importable(self):
        """OrganizationResponse 스키마가 임포트 가능해야 한다"""
        from app.schemas.b2b import OrganizationResponse

        assert OrganizationResponse is not None

    def test_organization_response_has_required_fields(self):
        """OrganizationResponse는 필수 필드를 모두 가져야 한다"""
        from app.schemas.b2b import OrganizationResponse

        org_id = uuid.uuid4()
        resp = OrganizationResponse(
            id=org_id,
            name="테스트 GA",
            business_number="123-45-67890",
            org_type="GA",
            plan_type="FREE_TRIAL",
            monthly_api_limit=1000,
            is_active=True,
            created_at=datetime.now(),
            updated_at=datetime.now(),
        )
        assert resp.id == org_id
        assert resp.name == "테스트 GA"
        assert resp.monthly_api_limit == 1000


class TestOrganizationUpdateSchema:
    """OrganizationUpdate 스키마 테스트"""

    def test_organization_update_importable(self):
        """OrganizationUpdate 스키마가 임포트 가능해야 한다"""
        from app.schemas.b2b import OrganizationUpdate

        assert OrganizationUpdate is not None

    def test_organization_update_all_fields_optional(self):
        """OrganizationUpdate는 모든 필드가 선택적이어야 한다"""
        from app.schemas.b2b import OrganizationUpdate

        # 빈 업데이트도 허용
        update = OrganizationUpdate()
        assert update.name is None
        assert update.plan_type is None

    def test_organization_update_partial_update(self):
        """OrganizationUpdate는 일부 필드만 업데이트할 수 있어야 한다"""
        from app.schemas.b2b import OrganizationUpdate

        update = OrganizationUpdate(name="새로운 이름")
        assert update.name == "새로운 이름"
        assert update.plan_type is None


class TestOrganizationMemberResponseSchema:
    """OrganizationMemberResponse 스키마 테스트"""

    def test_organization_member_response_importable(self):
        """OrganizationMemberResponse 스키마가 임포트 가능해야 한다"""
        from app.schemas.b2b import OrganizationMemberResponse

        assert OrganizationMemberResponse is not None

    def test_organization_member_response_has_required_fields(self):
        """OrganizationMemberResponse는 필수 필드를 가져야 한다"""
        from app.schemas.b2b import OrganizationMemberResponse

        member_id = uuid.uuid4()
        org_id = uuid.uuid4()
        user_id = uuid.uuid4()

        resp = OrganizationMemberResponse(
            id=member_id,
            organization_id=org_id,
            user_id=user_id,
            role="AGENT",
            is_active=True,
            joined_at=datetime.now(),
        )
        assert resp.id == member_id
        assert resp.role == "AGENT"


class TestB2BRegistrationRequestSchema:
    """B2BRegistrationRequest 스키마 테스트"""

    def test_b2b_registration_request_importable(self):
        """B2BRegistrationRequest 스키마가 임포트 가능해야 한다"""
        from app.schemas.b2b import B2BRegistrationRequest

        assert B2BRegistrationRequest is not None

    def test_b2b_registration_request_inherits_register_fields(self):
        """B2BRegistrationRequest는 RegisterRequest의 필드를 포함해야 한다"""
        from app.schemas.b2b import B2BRegistrationRequest

        req = B2BRegistrationRequest(
            email="agent@example.com",
            password="password123",
            full_name="보험 설계사",
            business_number="123-45-67890",
            organization_name="테스트 GA",
            org_type="GA",
        )
        assert req.email == "agent@example.com"
        assert req.business_number == "123-45-67890"

    def test_b2b_registration_request_business_number_required(self):
        """B2BRegistrationRequest는 business_number가 필수여야 한다"""
        from pydantic import ValidationError

        from app.schemas.b2b import B2BRegistrationRequest

        with pytest.raises(ValidationError):
            B2BRegistrationRequest(
                email="agent@example.com",
                password="password123",
                full_name="보험 설계사",
                # business_number 누락
                organization_name="테스트 GA",
                org_type="GA",
            )

    def test_b2b_registration_request_email_normalized(self):
        """B2BRegistrationRequest 이메일은 소문자로 정규화되어야 한다"""
        from app.schemas.b2b import B2BRegistrationRequest

        req = B2BRegistrationRequest(
            email="AGENT@EXAMPLE.COM",
            password="password123",
            full_name="보험 설계사",
            business_number="123-45-67890",
            organization_name="테스트 GA",
            org_type="GA",
        )
        assert req.email == "agent@example.com"
