"""대시보드 API 단위 테스트 (SPEC-PIPELINE-001 REQ-17)"""
from __future__ import annotations

import pytest


class TestDashboardEndpoint:
    def test_dashboard_schema_importable(self):
        """대시보드 스키마가 임포트 가능해야 함"""
        from app.schemas.pipeline import DashboardResponse

        assert DashboardResponse is not None

    def test_dashboard_response_schema(self):
        """대시보드 응답 스키마 검증"""
        from app.schemas.pipeline import DashboardResponse

        response = DashboardResponse(
            crawling_status={"total": 5, "healthy": 3},
            embedding_coverage={"total_policies": 100, "coverage_percentage": 75.0},
            pipeline_metrics={"total_runs": 10, "successful_runs": 8},
        )
        assert response.crawling_status["total"] == 5
        assert response.embedding_coverage["coverage_percentage"] == 75.0
