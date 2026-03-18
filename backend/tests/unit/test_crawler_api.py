"""크롤러 헬스 API 단위 테스트 (SPEC-PIPELINE-001 REQ-03)

GET /api/v1/crawler/health 엔드포인트 테스트.
app.main 전체 임포트 없이 라우터 함수 직접 테스트.
"""

from __future__ import annotations

# pgvector가 설치되지 않은 환경에서 SQLAlchemy 모델 임포트가 가능하도록 모킹
import sys
import types

import sqlalchemy as _sa

if "pgvector" not in sys.modules:
    _pgvector_mock = types.ModuleType("pgvector")
    _pgvector_sa_mock = types.ModuleType("pgvector.sqlalchemy")

    class _VectorType(_sa.types.UserDefinedType):
        cache_ok = True

        def __init__(self, dim: int = 1536) -> None:
            self.dim = dim

        def get_col_spec(self, **kw):
            return f"vector({self.dim})"

        class comparator_factory(_sa.types.UserDefinedType.Comparator):  # type: ignore[misc]
            pass

    _pgvector_sa_mock.Vector = _VectorType
    sys.modules["pgvector"] = _pgvector_mock
    sys.modules["pgvector.sqlalchemy"] = _pgvector_sa_mock

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestCrawlerHealthAPIFunction:
    """crawler_health 라우터 함수 직접 테스트"""

    async def test_crawler_health_returns_dict(self):
        """crawler_health 함수는 딕셔너리를 반환해야 함"""
        from app.api.v1.crawler import crawler_health

        mock_health_data = {
            "test-company": {
                "company_code": "test-company",
                "success_rate": 85.0,
                "last_success_at": None,
                "total_pdfs": 50,
                "status": "HEALTHY",
            }
        }

        result = await crawler_health(health_data=mock_health_data)
        assert isinstance(result, dict)

    async def test_crawler_health_passes_through_data(self):
        """crawler_health 함수는 데이터를 그대로 반환해야 함"""
        from app.api.v1.crawler import crawler_health

        mock_health_data = {
            "test-company": {
                "company_code": "test-company",
                "success_rate": 90.0,
                "last_success_at": None,
                "total_pdfs": 100,
                "status": "HEALTHY",
            }
        }

        result = await crawler_health(health_data=mock_health_data)
        assert "test-company" in result
        company = result["test-company"]
        assert company["success_rate"] == 90.0
        assert company["total_pdfs"] == 100
        assert company["status"] == "HEALTHY"

    async def test_crawler_health_empty_data(self):
        """데이터가 없을 때도 정상 반환되어야 함"""
        from app.api.v1.crawler import crawler_health

        result = await crawler_health(health_data={})
        assert result == {}

    async def test_get_crawler_health_serializes_datetime(self):
        """get_crawler_health 함수는 datetime을 ISO 문자열로 직렬화해야 함"""
        from app.api.v1.crawler import get_crawler_health
        from app.services.crawler.health_monitor import CompanyHealthStatus, HealthStatus

        now = datetime.now(tz=timezone.utc)
        mock_health = {
            "test-company": CompanyHealthStatus(
                company_code="test-company",
                success_rate=85.0,
                last_success_at=now,
                total_pdfs=50,
                status=HealthStatus.HEALTHY,
            )
        }

        mock_session = AsyncMock()
        mock_monitor = MagicMock()
        mock_monitor.get_all_health = AsyncMock(return_value=mock_health)

        with patch("app.api.v1.crawler.CrawlerHealthMonitor", return_value=mock_monitor):
            result = await get_crawler_health(db=mock_session)

        assert "test-company" in result
        # last_success_at은 ISO 문자열이어야 함
        last_success = result["test-company"]["last_success_at"]
        assert isinstance(last_success, str)
        # ISO 형식 파싱 가능 여부 확인
        parsed = datetime.fromisoformat(last_success)
        assert parsed is not None

    async def test_get_crawler_health_none_datetime_stays_none(self):
        """last_success_at이 None이면 None으로 유지되어야 함"""
        from app.api.v1.crawler import get_crawler_health
        from app.services.crawler.health_monitor import CompanyHealthStatus, HealthStatus

        mock_health = {
            "test-company": CompanyHealthStatus(
                company_code="test-company",
                success_rate=0.0,
                last_success_at=None,
                total_pdfs=0,
                status=HealthStatus.FAILED,
            )
        }

        mock_session = AsyncMock()
        mock_monitor = MagicMock()
        mock_monitor.get_all_health = AsyncMock(return_value=mock_health)

        with patch("app.api.v1.crawler.CrawlerHealthMonitor", return_value=mock_monitor):
            result = await get_crawler_health(db=mock_session)

        assert result["test-company"]["last_success_at"] is None


class TestCrawlerRouterRegistration:
    """crawler 라우터 등록 검증"""

    def test_crawler_router_has_health_route(self):
        """crawler 라우터에 /crawler/health 경로가 등록되어야 함"""
        from app.api.v1.crawler import router

        routes = [route.path for route in router.routes]  # type: ignore[attr-defined]
        assert "/crawler/health" in routes

    def test_crawler_router_health_is_get(self):
        """crawler/health 라우트는 GET 메서드여야 함"""
        from app.api.v1.crawler import router

        health_routes = [
            route for route in router.routes  # type: ignore[attr-defined]
            if hasattr(route, "path") and route.path == "/crawler/health"
        ]
        assert len(health_routes) == 1
        assert "GET" in health_routes[0].methods


class TestStructureChangedError:
    """STRUCTURE_CHANGED 에러 타입 테스트 (REQ-02)"""

    def test_structure_changed_error_exists(self):
        """StructureChangedError 예외 클래스가 존재해야 함"""
        from app.services.crawler.base import StructureChangedError

        assert StructureChangedError is not None

    def test_structure_changed_error_is_exception(self):
        """StructureChangedError는 Exception을 상속해야 함"""
        from app.services.crawler.base import StructureChangedError

        assert issubclass(StructureChangedError, Exception)

    def test_structure_changed_error_can_be_raised(self):
        """StructureChangedError를 raise 할 수 있어야 함"""
        from app.services.crawler.base import StructureChangedError

        with pytest.raises(StructureChangedError):
            raise StructureChangedError("CSS 선택자 '.product-list'가 예상 요소를 찾지 못함")

    def test_structure_changed_error_has_message(self):
        """StructureChangedError는 메시지를 포함해야 함"""
        from app.services.crawler.base import StructureChangedError

        error = StructureChangedError("페이지 구조 변경 감지")
        assert str(error) == "페이지 구조 변경 감지"


class TestCrawlResultStatusExtension:
    """CrawlResultStatus 확장 테스트 (REQ-02)"""

    def test_crawl_result_status_has_structure_changed(self):
        """CrawlResultStatus에 STRUCTURE_CHANGED 값이 있어야 함"""
        from app.models.crawler import CrawlResultStatus

        assert hasattr(CrawlResultStatus, "STRUCTURE_CHANGED")
        assert CrawlResultStatus.STRUCTURE_CHANGED == "STRUCTURE_CHANGED"
