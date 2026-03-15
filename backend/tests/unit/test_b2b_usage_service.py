"""Usage Service 단위 테스트 (SPEC-B2B-001 Phase 4)

UsageService 비즈니스 로직 검증:
- record_usage: 사용량 기록 및 Redis 카운터 증가
- check_org_quota: Redis에서 월 사용량 조회 및 한도 비교
- get_usage_summary: 집계 사용량 조회
- get_usage_details: 페이지네이션 상세 조회
- export_usage_csv: CSV 내보내기
- check_usage_threshold: 80% 경고 임계값 확인

AC-009: API 요청 시 사용량 자동 기록
AC-010: 월 한도 초과 시 429
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest


class TestUsageServiceImport:
    """서비스 임포트 테스트"""

    def test_usage_service_importable(self):
        """UsageService가 임포트 가능해야 한다"""
        from app.services.b2b.usage_service import UsageService

        assert UsageService is not None


class TestRecordUsage:
    """record_usage 메서드 테스트"""

    def _make_service(self):
        """모의 DB와 Redis를 주입한 UsageService 반환"""
        from app.services.b2b.usage_service import UsageService

        mock_db = AsyncMock()
        mock_db.add = MagicMock()
        mock_db.flush = AsyncMock()

        mock_redis = AsyncMock()
        mock_redis.incr = AsyncMock(return_value=1)
        mock_redis.expire = AsyncMock()

        return UsageService(db=mock_db, redis=mock_redis), mock_db, mock_redis

    def test_usage_service_has_record_usage_method(self):
        """UsageService는 record_usage 메서드를 가져야 한다"""
        from app.services.b2b.usage_service import UsageService

        assert hasattr(UsageService, "record_usage")

    @pytest.mark.asyncio
    async def test_record_usage_creates_usage_record(self):
        """record_usage는 UsageRecord를 DB에 추가해야 한다"""

        service, mock_db, mock_redis = self._make_service()

        org_id = uuid.uuid4()
        await service.record_usage(
            org_id=org_id,
            api_key_id=None,
            user_id=uuid.uuid4(),
            endpoint="/api/v1/b2b/clients",
            method="GET",
            status_code=200,
            tokens=0,
            response_time_ms=150,
            ip="192.168.1.1",
        )

        # DB에 레코드 추가가 호출되어야 함
        assert mock_db.add.called

    @pytest.mark.asyncio
    async def test_record_usage_increments_redis_counter(self):
        """record_usage는 Redis 월간 사용량 카운터를 증가시켜야 한다"""

        service, mock_db, mock_redis = self._make_service()

        org_id = uuid.uuid4()
        await service.record_usage(
            org_id=org_id,
            api_key_id=None,
            user_id=uuid.uuid4(),
            endpoint="/api/v1/b2b/clients",
            method="GET",
            status_code=200,
            tokens=100,
            response_time_ms=150,
            ip="192.168.1.1",
        )

        # Redis incr이 호출되어야 함
        assert mock_redis.incr.called

    @pytest.mark.asyncio
    async def test_record_usage_redis_key_format(self):
        """Redis 키는 b2b:usage:{org_id}:{YYYY-MM} 형식이어야 한다"""

        service, mock_db, mock_redis = self._make_service()

        org_id = uuid.uuid4()
        now = datetime.now(UTC)
        expected_month = now.strftime("%Y-%m")

        await service.record_usage(
            org_id=org_id,
            api_key_id=None,
            user_id=None,
            endpoint="/api/v1/b2b/test",
            method="POST",
            status_code=201,
            tokens=50,
            response_time_ms=100,
            ip="10.0.0.1",
        )

        # incr에 전달된 키 확인
        call_args = mock_redis.incr.call_args
        key = call_args[0][0]
        assert f"b2b:usage:{org_id}:{expected_month}" == key

    @pytest.mark.asyncio
    async def test_record_usage_sets_ttl_on_new_key(self):
        """새 Redis 키 생성 시 35일 TTL을 설정해야 한다"""

        service, mock_db, mock_redis = self._make_service()
        # count=1이면 새 키 (TTL 설정 필요)
        mock_redis.incr = AsyncMock(return_value=1)

        await service.record_usage(
            org_id=uuid.uuid4(),
            api_key_id=None,
            user_id=None,
            endpoint="/api/v1/b2b/test",
            method="GET",
            status_code=200,
            tokens=0,
            response_time_ms=50,
            ip="127.0.0.1",
        )

        # expire가 35일(3024000초)로 호출되어야 함
        assert mock_redis.expire.called
        call_args = mock_redis.expire.call_args
        ttl = call_args[0][1]
        assert ttl == 35 * 24 * 3600  # 35일


class TestCheckOrgQuota:
    """check_org_quota 메서드 테스트"""

    def _make_service(self, redis_count: int = 500):
        from app.services.b2b.usage_service import UsageService

        mock_db = AsyncMock()
        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value=str(redis_count))

        return UsageService(db=mock_db, redis=mock_redis)

    def test_usage_service_has_check_org_quota_method(self):
        """UsageService는 check_org_quota 메서드를 가져야 한다"""
        from app.services.b2b.usage_service import UsageService

        assert hasattr(UsageService, "check_org_quota")

    @pytest.mark.asyncio
    async def test_check_org_quota_returns_tuple(self):
        """check_org_quota는 (current, limit, is_exceeded) 튜플을 반환해야 한다"""
        pytest.importorskip("app.services.b2b.usage_service")

        service = self._make_service(redis_count=500)

        mock_org = MagicMock()
        mock_org.monthly_api_limit = 1000

        # DB에서 조직 조회 모킹
        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=mock_org)
        service._db.execute = AsyncMock(return_value=mock_result)

        org_id = uuid.uuid4()
        result = await service.check_org_quota(org_id=org_id)

        assert isinstance(result, tuple)
        assert len(result) == 3
        current, limit, is_exceeded = result
        assert current == 500
        assert limit == 1000
        assert is_exceeded is False

    @pytest.mark.asyncio
    async def test_check_org_quota_exceeded(self):
        """사용량이 한도를 초과하면 is_exceeded가 True여야 한다"""
        pytest.importorskip("app.services.b2b.usage_service")

        service = self._make_service(redis_count=1100)

        mock_org = MagicMock()
        mock_org.monthly_api_limit = 1000

        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=mock_org)
        service._db.execute = AsyncMock(return_value=mock_result)

        org_id = uuid.uuid4()
        current, limit, is_exceeded = await service.check_org_quota(org_id=org_id)

        assert current == 1100
        assert limit == 1000
        assert is_exceeded is True

    @pytest.mark.asyncio
    async def test_check_org_quota_redis_none_returns_zero(self):
        """Redis 키가 없으면 current_usage는 0이어야 한다"""
        pytest.importorskip("app.services.b2b.usage_service")

        from app.services.b2b.usage_service import UsageService

        mock_db = AsyncMock()
        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value=None)  # 키 없음

        service = UsageService(db=mock_db, redis=mock_redis)

        mock_org = MagicMock()
        mock_org.monthly_api_limit = 1000

        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=mock_org)
        service._db.execute = AsyncMock(return_value=mock_result)

        current, limit, is_exceeded = await service.check_org_quota(uuid.uuid4())

        assert current == 0
        assert is_exceeded is False


class TestGetUsageSummary:
    """get_usage_summary 메서드 테스트"""

    def test_usage_service_has_get_usage_summary_method(self):
        """UsageService는 get_usage_summary 메서드를 가져야 한다"""
        from app.services.b2b.usage_service import UsageService

        assert hasattr(UsageService, "get_usage_summary")

    @pytest.mark.asyncio
    async def test_get_usage_summary_returns_dict(self):
        """get_usage_summary는 딕셔너리를 반환해야 한다"""
        pytest.importorskip("app.services.b2b.usage_service")

        from app.services.b2b.usage_service import UsageService

        mock_db = AsyncMock()
        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value="42")

        service = UsageService(db=mock_db, redis=mock_redis)

        # 집계 쿼리 모킹
        mock_result = MagicMock()
        mock_result.all = MagicMock(return_value=[])
        mock_result.scalar = MagicMock(return_value=42)
        mock_db.execute = AsyncMock(return_value=mock_result)

        period_start = datetime(2026, 3, 1, tzinfo=UTC)
        period_end = datetime(2026, 3, 31, tzinfo=UTC)

        result = await service.get_usage_summary(
            org_id=uuid.uuid4(),
            period_start=period_start,
            period_end=period_end,
        )

        assert isinstance(result, dict)
        assert "total_requests" in result

    @pytest.mark.asyncio
    async def test_get_usage_summary_has_expected_keys(self):
        """get_usage_summary 결과는 필수 키를 포함해야 한다"""
        pytest.importorskip("app.services.b2b.usage_service")

        from app.services.b2b.usage_service import UsageService

        mock_db = AsyncMock()
        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value="10")

        service = UsageService(db=mock_db, redis=mock_redis)

        mock_result = MagicMock()
        mock_result.all = MagicMock(return_value=[])
        mock_result.scalar = MagicMock(return_value=10)
        mock_db.execute = AsyncMock(return_value=mock_result)

        result = await service.get_usage_summary(
            org_id=uuid.uuid4(),
            period_start=datetime(2026, 3, 1, tzinfo=UTC),
            period_end=datetime(2026, 3, 31, tzinfo=UTC),
        )

        assert "total_requests" in result
        assert "by_endpoint" in result
        assert "by_api_key" in result


class TestExportUsageCsv:
    """export_usage_csv 메서드 테스트"""

    def test_usage_service_has_export_usage_csv_method(self):
        """UsageService는 export_usage_csv 메서드를 가져야 한다"""
        from app.services.b2b.usage_service import UsageService

        assert hasattr(UsageService, "export_usage_csv")

    @pytest.mark.asyncio
    async def test_export_usage_csv_returns_string(self):
        """export_usage_csv는 CSV 문자열을 반환해야 한다"""
        pytest.importorskip("app.services.b2b.usage_service")

        from app.services.b2b.usage_service import UsageService

        mock_db = AsyncMock()
        mock_redis = AsyncMock()
        service = UsageService(db=mock_db, redis=mock_redis)

        mock_result = MagicMock()
        mock_result.all = MagicMock(return_value=[])
        mock_db.execute = AsyncMock(return_value=mock_result)

        csv_str = await service.export_usage_csv(
            org_id=uuid.uuid4(),
            period="2026-03",
        )

        assert isinstance(csv_str, str)

    @pytest.mark.asyncio
    async def test_export_usage_csv_has_header(self):
        """CSV 내보내기 결과는 헤더 행을 포함해야 한다"""
        pytest.importorskip("app.services.b2b.usage_service")

        from app.services.b2b.usage_service import UsageService

        mock_db = AsyncMock()
        mock_redis = AsyncMock()
        service = UsageService(db=mock_db, redis=mock_redis)

        mock_result = MagicMock()
        mock_result.all = MagicMock(return_value=[])
        mock_db.execute = AsyncMock(return_value=mock_result)

        csv_str = await service.export_usage_csv(
            org_id=uuid.uuid4(),
            period="2026-03",
        )

        # CSV 헤더에 필수 컬럼이 있어야 함
        assert "date" in csv_str.lower() or "endpoint" in csv_str.lower()


class TestCheckUsageThreshold:
    """check_usage_threshold 메서드 테스트"""

    def test_usage_service_has_check_usage_threshold_method(self):
        """UsageService는 check_usage_threshold 메서드를 가져야 한다"""
        from app.services.b2b.usage_service import UsageService

        assert hasattr(UsageService, "check_usage_threshold")

    @pytest.mark.asyncio
    async def test_check_usage_threshold_below_80_percent(self):
        """사용량이 80% 미만이면 warning이 False여야 한다"""
        pytest.importorskip("app.services.b2b.usage_service")

        from app.services.b2b.usage_service import UsageService

        mock_db = AsyncMock()
        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value="700")  # 70%

        service = UsageService(db=mock_db, redis=mock_redis)

        mock_org = MagicMock()
        mock_org.monthly_api_limit = 1000

        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=mock_org)
        service._db.execute = AsyncMock(return_value=mock_result)

        result = await service.check_usage_threshold(uuid.uuid4())

        assert result["warning"] is False

    @pytest.mark.asyncio
    async def test_check_usage_threshold_above_80_percent(self):
        """사용량이 80% 이상이면 warning이 True여야 한다"""
        pytest.importorskip("app.services.b2b.usage_service")

        from app.services.b2b.usage_service import UsageService

        mock_db = AsyncMock()
        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value="850")  # 85%

        service = UsageService(db=mock_db, redis=mock_redis)

        mock_org = MagicMock()
        mock_org.monthly_api_limit = 1000

        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=mock_org)
        service._db.execute = AsyncMock(return_value=mock_result)

        result = await service.check_usage_threshold(uuid.uuid4())

        assert result["warning"] is True
        assert "usage_percentage" in result

    @pytest.mark.asyncio
    async def test_check_usage_threshold_returns_percentage(self):
        """check_usage_threshold는 사용 비율(%)을 반환해야 한다"""
        pytest.importorskip("app.services.b2b.usage_service")

        from app.services.b2b.usage_service import UsageService

        mock_db = AsyncMock()
        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value="500")  # 50%

        service = UsageService(db=mock_db, redis=mock_redis)

        mock_org = MagicMock()
        mock_org.monthly_api_limit = 1000

        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=mock_org)
        service._db.execute = AsyncMock(return_value=mock_result)

        result = await service.check_usage_threshold(uuid.uuid4())

        assert result["usage_percentage"] == 50.0
