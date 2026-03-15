"""B2B 조직 모델 단위 테스트 (SPEC-B2B-001 Phase 1)

Organization, OrganizationMember SQLAlchemy 모델 구조 및 제약 조건 검증.
"""

from __future__ import annotations

import uuid


class TestOrganizationModelStructure:
    """Organization 모델 구조 테스트"""

    def test_organization_model_importable(self):
        """Organization 모델이 임포트 가능해야 한다"""
        from app.models.organization import Organization

        assert Organization is not None

    def test_organization_model_tablename(self):
        """Organization 모델의 테이블명은 'organizations'여야 한다"""
        from app.models.organization import Organization

        assert Organization.__tablename__ == "organizations"

    def test_organization_model_has_required_columns(self):
        """Organization 모델은 필수 컬럼을 모두 가져야 한다"""
        from app.models.organization import Organization

        mapper = Organization.__mapper__
        column_names = {col.key for col in mapper.columns}

        assert "id" in column_names
        assert "name" in column_names
        assert "business_number" in column_names
        assert "org_type" in column_names
        assert "parent_org_id" in column_names
        assert "plan_type" in column_names
        assert "monthly_api_limit" in column_names
        assert "is_active" in column_names
        assert "created_at" in column_names
        assert "updated_at" in column_names

    def test_organization_model_id_is_uuid_pk(self):
        """Organization.id는 UUID PK여야 한다"""
        from app.models.organization import Organization

        id_col = Organization.__mapper__.columns["id"]
        assert id_col.primary_key is True

    def test_organization_model_business_number_unique(self):
        """Organization.business_number는 UNIQUE 제약이 있어야 한다"""
        from app.models.organization import Organization

        col = Organization.__mapper__.columns["business_number"]
        assert col.unique is True

    def test_organization_model_business_number_not_nullable(self):
        """Organization.business_number는 nullable이 아니어야 한다"""
        from app.models.organization import Organization

        col = Organization.__mapper__.columns["business_number"]
        assert col.nullable is False

    def test_organization_model_is_active_default_true(self):
        """Organization.is_active 기본값은 True여야 한다"""
        from app.models.organization import Organization

        col = Organization.__mapper__.columns["is_active"]
        assert col.default is not None or col.server_default is not None

    def test_organization_model_monthly_api_limit_default(self):
        """Organization.monthly_api_limit 기본값은 1000이어야 한다"""
        from app.models.organization import Organization

        col = Organization.__mapper__.columns["monthly_api_limit"]
        assert col.default is not None or col.server_default is not None

    def test_organization_model_parent_org_id_nullable(self):
        """Organization.parent_org_id는 nullable이어야 한다 (최상위 조직)"""
        from app.models.organization import Organization

        col = Organization.__mapper__.columns["parent_org_id"]
        assert col.nullable is True

    def test_organization_model_inherits_timestamp_mixin(self):
        """Organization 모델은 TimestampMixin을 상속해야 한다"""
        from app.models.base import TimestampMixin
        from app.models.organization import Organization

        assert issubclass(Organization, TimestampMixin)

    def test_organization_model_instantiation(self):
        """Organization 인스턴스를 생성할 수 있어야 한다"""
        from app.models.organization import Organization, OrgType, PlanType

        org = Organization(
            name="테스트 GA",
            business_number="123-45-67890",
            org_type=OrgType.GA,
            plan_type=PlanType.FREE_TRIAL,
        )
        assert org.name == "테스트 GA"
        assert org.business_number == "123-45-67890"

    def test_org_type_enum_values(self):
        """OrgType 열거형은 GA, INDEPENDENT, CORPORATE 값을 가져야 한다"""
        from app.models.organization import OrgType

        assert OrgType.GA == "GA"
        assert OrgType.INDEPENDENT == "INDEPENDENT"
        assert OrgType.CORPORATE == "CORPORATE"

    def test_plan_type_enum_values(self):
        """PlanType 열거형은 FREE_TRIAL, BASIC, PROFESSIONAL, ENTERPRISE 값을 가져야 한다"""
        from app.models.organization import PlanType

        assert PlanType.FREE_TRIAL == "FREE_TRIAL"
        assert PlanType.BASIC == "BASIC"
        assert PlanType.PROFESSIONAL == "PROFESSIONAL"
        assert PlanType.ENTERPRISE == "ENTERPRISE"

    def test_organization_repr(self):
        """Organization __repr__이 유용한 정보를 포함해야 한다"""
        from app.models.organization import Organization, OrgType, PlanType

        org = Organization(
            name="테스트 GA",
            business_number="123-45-67890",
            org_type=OrgType.GA,
            plan_type=PlanType.FREE_TRIAL,
        )
        repr_str = repr(org)
        assert "Organization" in repr_str


class TestOrganizationMemberModelStructure:
    """OrganizationMember 모델 구조 테스트"""

    def test_organization_member_model_importable(self):
        """OrganizationMember 모델이 임포트 가능해야 한다"""
        from app.models.organization_member import OrganizationMember

        assert OrganizationMember is not None

    def test_organization_member_model_tablename(self):
        """OrganizationMember 모델의 테이블명은 'organization_members'여야 한다"""
        from app.models.organization_member import OrganizationMember

        assert OrganizationMember.__tablename__ == "organization_members"

    def test_organization_member_model_has_required_columns(self):
        """OrganizationMember 모델은 필수 컬럼을 모두 가져야 한다"""
        from app.models.organization_member import OrganizationMember

        mapper = OrganizationMember.__mapper__
        column_names = {col.key for col in mapper.columns}

        assert "id" in column_names
        assert "organization_id" in column_names
        assert "user_id" in column_names
        assert "role" in column_names
        assert "is_active" in column_names
        assert "joined_at" in column_names

    def test_organization_member_id_is_uuid_pk(self):
        """OrganizationMember.id는 UUID PK여야 한다"""
        from app.models.organization_member import OrganizationMember

        id_col = OrganizationMember.__mapper__.columns["id"]
        assert id_col.primary_key is True

    def test_organization_member_is_active_default_true(self):
        """OrganizationMember.is_active 기본값은 True여야 한다"""
        from app.models.organization_member import OrganizationMember

        col = OrganizationMember.__mapper__.columns["is_active"]
        assert col.default is not None or col.server_default is not None

    def test_org_member_role_enum_values(self):
        """OrgMemberRole 열거형은 ORG_OWNER, AGENT_ADMIN, AGENT 값을 가져야 한다"""
        from app.models.organization_member import OrgMemberRole

        assert OrgMemberRole.ORG_OWNER == "ORG_OWNER"
        assert OrgMemberRole.AGENT_ADMIN == "AGENT_ADMIN"
        assert OrgMemberRole.AGENT == "AGENT"

    def test_organization_member_instantiation(self):
        """OrganizationMember 인스턴스를 생성할 수 있어야 한다"""
        from app.models.organization_member import OrganizationMember, OrgMemberRole

        org_id = uuid.uuid4()
        user_id = uuid.uuid4()

        member = OrganizationMember(
            organization_id=org_id,
            user_id=user_id,
            role=OrgMemberRole.AGENT,
        )
        assert member.organization_id == org_id
        assert member.user_id == user_id
        assert member.role == OrgMemberRole.AGENT

    def test_organization_member_repr(self):
        """OrganizationMember __repr__이 유용한 정보를 포함해야 한다"""
        from app.models.organization_member import OrganizationMember, OrgMemberRole

        member = OrganizationMember(
            organization_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            role=OrgMemberRole.AGENT,
        )
        repr_str = repr(member)
        assert "OrganizationMember" in repr_str

    def test_organization_member_unique_constraint_exists(self):
        """OrganizationMember는 (organization_id, user_id) 복합 유니크 제약이 있어야 한다"""
        from app.models.organization_member import OrganizationMember

        # 테이블 제약 조건 확인
        table = OrganizationMember.__table__
        unique_constraints = [c for c in table.constraints if hasattr(c, "columns")]
        constraint_column_sets = [
            frozenset(col.name for col in uc.columns) for uc in unique_constraints
        ]
        assert frozenset({"organization_id", "user_id"}) in constraint_column_sets
