"""Admin API 라우터 패키지 (TAG-019)

보험사, 보험 상품, 보장 항목 CRUD API를 포함하는 Admin 라우터.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1.admin.companies import router as companies_router
from app.api.v1.admin.coverages import router as coverages_router
from app.api.v1.admin.policies import router as policies_router

# Admin 통합 라우터
admin_router = APIRouter()

# 하위 라우터 등록
admin_router.include_router(companies_router, prefix="/companies")
admin_router.include_router(policies_router, prefix="/policies")
admin_router.include_router(coverages_router)
