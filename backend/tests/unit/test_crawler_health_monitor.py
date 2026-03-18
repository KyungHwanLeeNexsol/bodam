"""CrawlerHealthMonitor 단위 테스트 (SPEC-PIPELINE-001 REQ-03)

CrawlerHealthMonitor 클래스의 헬스 상태 조회 테스트.
DB 쿼리를 모킹하여 실제 DB 접근 없이 테스트.
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

from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone

import pytest

from app.services.crawler.health_monitor import CompanyHealthStatus, CrawlerHealthMonitor, HealthStatus


class TestHealthStatus:
    """HealthStatus 열거형 테스트"""

    def test_health_status_healthy_exists(self):
        """HEALTHY 상태가 존재해야 함"""
        assert HealthStatus.HEALTHY == "HEALTHY"

    def test_health_status_degraded_exists(self):
        """DEGRADED 상태가 존재해야 함"""
        assert HealthStatus.DEGRADED == "DEGRADED"

    def test_health_status_failed_exists(self):
        """FAILED 상태가 존재해야 함"""
        assert HealthStatus.FAILED == "FAILED"


class TestCompanyHealthStatus:
    """CompanyHealthStatus 데이터클래스 테스트"""

    def test_company_health_status_creation(self):
        """CompanyHealthStatus 인스턴스 생성"""
        now = datetime.now(tz=timezone.utc)
        status = CompanyHealthStatus(
            company_code="test-company",
            success_rate=85.0,
            last_success_at=now,
            total_pdfs=100,
            status=HealthStatus.HEALTHY,
        )
        assert status.company_code == "test-company"
        assert status.success_rate == 85.0
        assert status.total_pdfs == 100
        assert status.status == HealthStatus.HEALTHY

    def test_company_health_status_is_dataclass(self):
        """CompanyHealthStatus는 dataclass여야 함"""
        import dataclasses

        assert dataclasses.is_dataclass(CompanyHealthStatus)

    def test_company_health_status_last_success_at_nullable(self):
        """last_success_at은 None이 될 수 있어야 함"""
        status = CompanyHealthStatus(
            company_code="test-company",
            success_rate=0.0,
            last_success_at=None,
            total_pdfs=0,
            status=HealthStatus.FAILED,
        )
        assert status.last_success_at is None


class TestCrawlerHealthMonitorCreation:
    """CrawlerHealthMonitor 생성 테스트"""

    def test_health_monitor_can_be_instantiated(self):
        """CrawlerHealthMonitor 인스턴스 생성"""
        mock_session = AsyncMock()
        monitor = CrawlerHealthMonitor(db_session=mock_session)
        assert monitor is not None

    def test_health_monitor_has_get_all_health(self):
        """get_all_health 메서드가 존재해야 함"""
        mock_session = AsyncMock()
        monitor = CrawlerHealthMonitor(db_session=mock_session)
        assert hasattr(monitor, "get_all_health")
        assert callable(monitor.get_all_health)

    def test_health_monitor_has_get_company_health(self):
        """get_company_health 메서드가 존재해야 함"""
        mock_session = AsyncMock()
        monitor = CrawlerHealthMonitor(db_session=mock_session)
        assert hasattr(monitor, "get_company_health")
        assert callable(monitor.get_company_health)


class TestHealthStatusCalculation:
    """헬스 상태 계산 로직 테스트"""

    def test_success_rate_above_80_is_healthy(self):
        """성공률 80% 이상이면 HEALTHY"""
        mock_session = AsyncMock()
        monitor = CrawlerHealthMonitor(db_session=mock_session)
        status = monitor._calculate_status(success_rate=80.0, consecutive_failures=0)
        assert status == HealthStatus.HEALTHY

    def test_success_rate_100_is_healthy(self):
        """성공률 100%이면 HEALTHY"""
        mock_session = AsyncMock()
        monitor = CrawlerHealthMonitor(db_session=mock_session)
        status = monitor._calculate_status(success_rate=100.0, consecutive_failures=0)
        assert status == HealthStatus.HEALTHY

    def test_success_rate_50_to_79_is_degraded(self):
        """성공률 50-79%이면 DEGRADED"""
        mock_session = AsyncMock()
        monitor = CrawlerHealthMonitor(db_session=mock_session)
        status = monitor._calculate_status(success_rate=65.0, consecutive_failures=0)
        assert status == HealthStatus.DEGRADED

    def test_success_rate_below_50_is_failed(self):
        """성공률 50% 미만이면 FAILED"""
        mock_session = AsyncMock()
        monitor = CrawlerHealthMonitor(db_session=mock_session)
        status = monitor._calculate_status(success_rate=49.9, consecutive_failures=0)
        assert status == HealthStatus.FAILED

    def test_three_consecutive_failures_is_failed(self):
        """연속 3회 실패하면 FAILED (성공률과 관계없이)"""
        mock_session = AsyncMock()
        monitor = CrawlerHealthMonitor(db_session=mock_session)
        status = monitor._calculate_status(success_rate=90.0, consecutive_failures=3)
        assert status == HealthStatus.FAILED

    def test_two_consecutive_failures_is_not_forced_failed(self):
        """연속 2회 실패는 FAILED를 강제하지 않음"""
        mock_session = AsyncMock()
        monitor = CrawlerHealthMonitor(db_session=mock_session)
        status = monitor._calculate_status(success_rate=90.0, consecutive_failures=2)
        # 성공률이 높으면 HEALTHY 유지
        assert status == HealthStatus.HEALTHY


class TestGetCompanyHealth:
    """get_company_health 메서드 테스트"""

    async def test_get_company_health_returns_status(self):
        """get_company_health는 CompanyHealthStatus를 반환해야 함"""
        mock_session = AsyncMock()

        # CrawlResult 모의 데이터 - 최근 10개 실행 결과
        mock_results = []
        for i in range(8):
            r = MagicMock()
            r.status = "NEW"  # 성공
            r.created_at = datetime.now(tz=timezone.utc)
            mock_results.append(r)
        for i in range(2):
            r = MagicMock()
            r.status = "FAILED"  # 실패
            r.created_at = datetime.now(tz=timezone.utc)
            mock_results.append(r)

        mock_execute_result = MagicMock()
        mock_execute_result.scalars.return_value.all.return_value = mock_results
        mock_session.execute = AsyncMock(return_value=mock_execute_result)

        monitor = CrawlerHealthMonitor(db_session=mock_session)
        result = await monitor.get_company_health("test-company")

        assert isinstance(result, CompanyHealthStatus)
        assert result.company_code == "test-company"

    async def test_get_company_health_calculates_success_rate(self):
        """성공률을 올바르게 계산해야 함 (80%)"""
        mock_session = AsyncMock()

        # 10개 중 8개 성공
        mock_results = []
        for _ in range(8):
            r = MagicMock()
            r.status = "NEW"
            r.created_at = datetime.now(tz=timezone.utc)
            mock_results.append(r)
        for _ in range(2):
            r = MagicMock()
            r.status = "FAILED"
            r.created_at = datetime.now(tz=timezone.utc)
            mock_results.append(r)

        mock_execute_result = MagicMock()
        mock_execute_result.scalars.return_value.all.return_value = mock_results
        mock_session.execute = AsyncMock(return_value=mock_execute_result)

        monitor = CrawlerHealthMonitor(db_session=mock_session)
        result = await monitor.get_company_health("test-company")

        assert result.success_rate == 80.0

    async def test_get_company_health_no_data_returns_failed(self):
        """데이터가 없으면 FAILED 반환"""
        mock_session = AsyncMock()

        mock_execute_result = MagicMock()
        mock_execute_result.scalars.return_value.all.return_value = []
        mock_session.execute = AsyncMock(return_value=mock_execute_result)

        monitor = CrawlerHealthMonitor(db_session=mock_session)
        result = await monitor.get_company_health("test-company")

        assert result.status == HealthStatus.FAILED
        assert result.success_rate == 0.0

    async def test_get_company_health_counts_total_pdfs(self):
        """total_pdfs를 올바르게 계산해야 함"""
        mock_session = AsyncMock()

        # 3개 성공 결과
        mock_results = []
        for _ in range(3):
            r = MagicMock()
            r.status = "NEW"
            r.created_at = datetime.now(tz=timezone.utc)
            mock_results.append(r)

        # 총 PDF 수 모의 (scalar 반환)
        call_count = 0

        async def multi_execute(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                # 첫 번째 호출: 최근 결과 목록
                result = MagicMock()
                result.scalars.return_value.all.return_value = mock_results
                return result
            else:
                # 두 번째 호출: 총 PDF 수
                result = MagicMock()
                result.scalar.return_value = 150
                return result

        mock_session.execute = AsyncMock(side_effect=multi_execute)

        monitor = CrawlerHealthMonitor(db_session=mock_session)
        result = await monitor.get_company_health("test-company")

        assert result.total_pdfs == 150


class TestGetAllHealth:
    """get_all_health 메서드 테스트"""

    async def test_get_all_health_returns_dict(self):
        """get_all_health는 딕셔너리를 반환해야 함"""
        mock_session = AsyncMock()

        # 회사 목록 모의
        mock_company_rows = [("company-a",), ("company-b",)]
        mock_list_result = MagicMock()
        mock_list_result.fetchall.return_value = mock_company_rows

        mock_execute_result = MagicMock()
        mock_execute_result.scalars.return_value.all.return_value = []
        mock_execute_result.scalar.return_value = 0

        call_count = 0

        async def multi_execute(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return mock_list_result
            result = MagicMock()
            result.scalars.return_value.all.return_value = []
            result.scalar.return_value = 0
            return result

        mock_session.execute = AsyncMock(side_effect=multi_execute)

        with patch("app.services.crawler.config_validator.list_company_configs", return_value=[]):
            monitor = CrawlerHealthMonitor(db_session=mock_session)
            result = await monitor.get_all_health()

        assert isinstance(result, dict)

    async def test_get_all_health_empty_when_no_companies(self):
        """회사가 없으면 빈 딕셔너리 반환"""
        mock_session = AsyncMock()

        mock_list_result = MagicMock()
        mock_list_result.fetchall.return_value = []
        mock_session.execute = AsyncMock(return_value=mock_list_result)

        monitor = CrawlerHealthMonitor(db_session=mock_session)
        result = await monitor.get_all_health()

        assert result == {}
