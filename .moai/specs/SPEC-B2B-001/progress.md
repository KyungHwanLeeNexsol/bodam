## SPEC-B2B-001 Progress

- Started: 2026-03-15
- Phase 1 (TDD Implementation): Complete

### Phase 1: RBAC Foundation + Organization Models

**RED-GREEN-REFACTOR 사이클 완료**

#### 테스트 파일 (87개 테스트 추가, 전체 794개 통과)

- `tests/unit/test_b2b_models.py` - Organization, OrganizationMember 모델 구조 테스트 (25 tests)
- `tests/unit/test_b2b_rbac.py` - UserRole enum, require_role 의존성 테스트 (16 tests)
- `tests/unit/test_b2b_schemas.py` - B2B Pydantic 스키마 검증 테스트 (22 tests)
- `tests/unit/test_b2b_org_service.py` - OrganizationService 비즈니스 로직 테스트 (14 tests)
- `tests/unit/test_b2b_org_api.py` - API 라우터 등록 및 모델 export 테스트 (10 tests)

#### 구현 파일

**모델:**
- `app/models/user.py` - UserRole enum 추가, User.role 컬럼 추가 (기본값: B2C_USER)
- `app/models/organization.py` - Organization 모델 신규 생성 (OrgType, PlanType enum 포함)
- `app/models/organization_member.py` - OrganizationMember 모델 신규 생성 (OrgMemberRole enum 포함)
- `app/models/__init__.py` - Organization, OrganizationMember, UserRole, OrgType, OrgMemberRole export 추가

**스키마:**
- `app/schemas/b2b.py` - OrganizationCreate, OrganizationResponse, OrganizationUpdate, OrganizationMemberResponse, B2BRegistrationRequest

**서비스:**
- `app/services/b2b/__init__.py` - B2B 서비스 패키지
- `app/services/b2b/organization_service.py` - OrganizationService (create, get, update, invite_member, list_members, validate_org_hierarchy)

**API:**
- `app/api/v1/b2b/__init__.py` - B2B API 패키지
- `app/api/v1/b2b/organizations.py` - 5개 엔드포인트 (POST, GET, PUT, POST invite, GET members)
- `app/api/deps.py` - require_role(), get_current_org_user() 추가

**마이그레이션:**
- `alembic/versions/i9j0k1l2m3n4_add_b2b_rbac_tables.py` - userrole/orgtype/plantype/orgmemberrole enum 생성, users.role 컬럼, organizations, organization_members 테이블

**main.py:**
- b2b_org_router를 /api/v1/b2b prefix로 등록

#### 수락 기준 (Acceptance Criteria) 달성

- AC-001: UserRole enum, require_role 의존성으로 역할 기반 접근 제어 기반 구축
- AC-002: Organization 계층 구조 최대 3단계 검증 (validate_org_hierarchy), 멤버 초대 엔드포인트

### Status: Phase 1 Complete

- 전체 794/794 단위 테스트 통과
- ruff 린터 통과 (신규 파일 전체)
- 기존 테스트 0건 회귀
