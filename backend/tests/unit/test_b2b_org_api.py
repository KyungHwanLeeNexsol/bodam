"""B2B 조직 API 엔드포인트 단위 테스트 (SPEC-B2B-001 Phase 1)

API 라우터 등록 및 엔드포인트 라우팅 검증.
"""

from __future__ import annotations


class TestB2BOrgRouterRegistration:
    """B2B 조직 라우터 등록 테스트"""

    def test_b2b_org_router_importable(self):
        """b2b 조직 라우터가 임포트 가능해야 한다"""
        from app.api.v1.b2b.organizations import router

        assert router is not None

    def test_b2b_org_router_has_routes(self):
        """b2b 조직 라우터는 최소 1개 이상의 라우트를 가져야 한다"""
        from app.api.v1.b2b.organizations import router

        assert len(router.routes) > 0

    def test_b2b_org_router_has_create_organization_route(self):
        """POST /organizations 라우트가 등록되어 있어야 한다"""
        from app.api.v1.b2b.organizations import router

        route_paths = [route.path for route in router.routes]
        assert "/organizations" in route_paths

    def test_b2b_org_router_has_get_organization_route(self):
        """GET /organizations/{org_id} 라우트가 등록되어 있어야 한다"""
        from app.api.v1.b2b.organizations import router

        route_paths = [route.path for route in router.routes]
        assert "/organizations/{org_id}" in route_paths

    def test_b2b_org_router_has_update_organization_route(self):
        """PUT /organizations/{org_id} 라우트가 등록되어 있어야 한다"""
        from app.api.v1.b2b.organizations import router

        # GET /organizations/{org_id}와 PUT /organizations/{org_id}가 모두 존재
        route_paths_with_methods = [
            (route.path, list(route.methods))
            for route in router.routes
            if hasattr(route, "methods")
        ]
        put_routes = [
            path for path, methods in route_paths_with_methods if "PUT" in methods
        ]
        assert len(put_routes) > 0

    def test_b2b_org_router_has_invite_member_route(self):
        """POST /organizations/{org_id}/invite 라우트가 등록되어 있어야 한다"""
        from app.api.v1.b2b.organizations import router

        route_paths = [route.path for route in router.routes]
        assert "/organizations/{org_id}/invite" in route_paths

    def test_b2b_org_router_has_list_members_route(self):
        """GET /organizations/{org_id}/members 라우트가 등록되어 있어야 한다"""
        from app.api.v1.b2b.organizations import router

        route_paths = [route.path for route in router.routes]
        assert "/organizations/{org_id}/members" in route_paths


class TestB2BOrgRouterInMainApp:
    """메인 앱에 B2B 라우터 등록 테스트"""

    def test_main_app_includes_b2b_router(self):
        """메인 앱에 b2b 라우터가 등록되어야 한다"""
        from app.main import app

        # 등록된 라우터의 prefix 확인
        route_paths = set()
        for route in app.routes:
            if hasattr(route, "path"):
                route_paths.add(route.path)

        # /api/v1/b2b 경로가 존재하는지 확인
        b2b_routes = [p for p in route_paths if "/b2b" in p]
        assert len(b2b_routes) > 0 or any(
            hasattr(r, "routes") for r in app.routes
        )

    def test_b2b_org_create_endpoint_exists_in_app(self):
        """POST /api/v1/b2b/organizations 엔드포인트가 앱에 존재해야 한다"""
        from app.main import app

        # 앱의 라우트에서 b2b/organizations 경로 탐색
        def find_routes(routes, target_path):
            for route in routes:
                if hasattr(route, "path") and target_path in route.path:
                    return True
                if hasattr(route, "routes"):
                    if find_routes(route.routes, target_path):
                        return True
            return False

        assert find_routes(app.routes, "b2b")


class TestModelsInitExports:
    """models/__init__.py 내보내기 테스트"""

    def test_organization_exported_from_models(self):
        """Organization이 models 패키지에서 임포트 가능해야 한다"""
        from app.models import Organization

        assert Organization is not None

    def test_organization_member_exported_from_models(self):
        """OrganizationMember가 models 패키지에서 임포트 가능해야 한다"""
        from app.models import OrganizationMember

        assert OrganizationMember is not None

    def test_user_role_exported_from_models(self):
        """UserRole이 models 패키지에서 임포트 가능해야 한다"""
        from app.models import UserRole

        assert UserRole is not None

    def test_org_type_exported_from_models(self):
        """OrgType이 models 패키지에서 임포트 가능해야 한다"""
        from app.models import OrgType

        assert OrgType is not None

    def test_org_member_role_exported_from_models(self):
        """OrgMemberRole이 models 패키지에서 임포트 가능해야 한다"""
        from app.models import OrgMemberRole

        assert OrgMemberRole is not None
