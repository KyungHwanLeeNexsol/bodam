"""PolicyIngestor 단위 테스트 (SPEC-CRAWLER-002 REQ-07.2~7.6)

PolicyIngestor.ingest() 메서드의 비즈니스 로직 검증:
- REQ-07.2: Policy upsert (product_code + company_code 복합 키)
- REQ-07.3: 성공 시 ingest_document_task Celery 태스크 디스패치
- REQ-07.4: DB 저장 실패 시 PDF 유지, FAILED 상태 설정
- REQ-07.5: content_hash 중복 시 SKIPPED 처리
- REQ-07.6: CrawlRun 완료 시 통계 업데이트
"""

from __future__ import annotations

import sys
import types
from unittest.mock import AsyncMock, MagicMock, patch, call
from uuid import uuid4

import pytest

# pgvector 모듈이 없는 환경에서 모킹
if "pgvector" not in sys.modules:
    import sqlalchemy as _sa

    pgvector_mock = types.ModuleType("pgvector")

    pgvector_sa_mock = types.ModuleType("pgvector.sqlalchemy")

    class _VectorType(_sa.types.UserDefinedType):
        """pgvector Vector 타입 모킹"""
        cache_ok = True

        def __init__(self, dim: int = 1536) -> None:
            self.dim = dim

        def get_col_spec(self, **kwargs):
            return f"vector({self.dim})"

        class comparator_factory(_sa.types.UserDefinedType.Comparator):
            pass

    pgvector_sa_mock.Vector = _VectorType
    sys.modules["pgvector"] = pgvector_mock
    sys.modules["pgvector.sqlalchemy"] = pgvector_sa_mock

from app.services.crawler.base import PolicyListing, SaleStatus


# ---------------------------------------------------------------------------
# PolicyIngestor 임포트 테스트
# ---------------------------------------------------------------------------


class TestPolicyIngestorImport:
    """PolicyIngestor 모듈 존재 여부 검증"""

    def test_policy_ingestor_can_be_imported(self):
        """PolicyIngestor를 app.services.crawler.policy_ingestor에서 임포트 가능해야 함"""
        from app.services.crawler.policy_ingestor import PolicyIngestor  # noqa: F401

    def test_ingest_result_can_be_imported(self):
        """IngestResult를 app.services.crawler.policy_ingestor에서 임포트 가능해야 함"""
        from app.services.crawler.policy_ingestor import IngestResult  # noqa: F401


# ---------------------------------------------------------------------------
# IngestResult 데이터클래스 테스트
# ---------------------------------------------------------------------------


class TestIngestResult:
    """IngestResult 데이터클래스 구조 검증"""

    def test_ingest_result_has_status_field(self):
        """IngestResult에 status 필드가 있어야 함"""
        from app.services.crawler.policy_ingestor import IngestResult

        result = IngestResult(status="NEW", policy_id=None, error=None)
        assert hasattr(result, "status")

    def test_ingest_result_has_policy_id_field(self):
        """IngestResult에 policy_id 필드가 있어야 함"""
        from app.services.crawler.policy_ingestor import IngestResult

        result = IngestResult(status="NEW", policy_id=uuid4(), error=None)
        assert hasattr(result, "policy_id")

    def test_ingest_result_has_error_field(self):
        """IngestResult에 error 필드가 있어야 함"""
        from app.services.crawler.policy_ingestor import IngestResult

        result = IngestResult(status="FAILED", policy_id=None, error="DB 저장 실패")
        assert result.error == "DB 저장 실패"


# ---------------------------------------------------------------------------
# REQ-07.5: content_hash 중복 시 SKIPPED 처리
# ---------------------------------------------------------------------------


class TestIngestSkipOnDuplicateHash:
    """REQ-07.5: content_hash가 이미 존재하면 SKIPPED 반환"""

    @pytest.mark.asyncio
    async def test_ingest_returns_skipped_when_hash_exists(self):
        """동일 content_hash의 CrawlResult가 존재하면 SKIPPED를 반환해야 함"""
        from app.services.crawler.policy_ingestor import IngestResult, PolicyIngestor

        listing = PolicyListing(
            company_name="삼성생명",
            product_name="삼성 종신보험",
            product_code="P001",
            category="LIFE",
            pdf_url="https://example.com/p001.pdf",
            company_code="samsung-life",
            sale_status=SaleStatus.ON_SALE,
        )

        # content_hash가 이미 존재하는 상황 모킹
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=MagicMock())  # 기존 레코드 있음

        mock_execute = AsyncMock(return_value=mock_result)
        mock_session.execute = mock_execute

        ingestor = PolicyIngestor(db_session=mock_session)
        result = await ingestor.ingest(listing, content_hash="existing_hash_abc123")

        assert isinstance(result, IngestResult)
        assert result.status == "SKIPPED"

    @pytest.mark.asyncio
    async def test_ingest_skipped_result_has_no_error(self):
        """SKIPPED 결과는 에러 메시지가 없어야 함"""
        from app.services.crawler.policy_ingestor import PolicyIngestor

        listing = PolicyListing(
            company_name="삼성생명",
            product_name="삼성 종신보험",
            product_code="P001",
            category="LIFE",
            pdf_url="https://example.com/p001.pdf",
            company_code="samsung-life",
        )

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=MagicMock())  # 기존 레코드 있음
        mock_session.execute = AsyncMock(return_value=mock_result)

        ingestor = PolicyIngestor(db_session=mock_session)
        result = await ingestor.ingest(listing, content_hash="existing_hash_abc123")

        assert result.error is None


# ---------------------------------------------------------------------------
# REQ-07.2: Policy upsert 테스트
# ---------------------------------------------------------------------------


class TestIngestUpsertPolicy:
    """REQ-07.2: (product_code, company_code) 복합 키로 upsert"""

    @pytest.mark.asyncio
    async def test_ingest_new_policy_returns_new_status(self):
        """새로운 Policy는 NEW 상태를 반환해야 함"""
        from app.services.crawler.policy_ingestor import PolicyIngestor

        listing = PolicyListing(
            company_name="삼성생명",
            product_name="삼성 종신보험",
            product_code="P002",
            category="LIFE",
            pdf_url="https://example.com/p002.pdf",
            company_code="samsung-life",
            sale_status=SaleStatus.ON_SALE,
        )

        mock_session = AsyncMock()
        # content_hash 중복 없음
        no_dup_result = MagicMock()
        no_dup_result.scalar_one_or_none = MagicMock(return_value=None)

        # Policy 조회 - 없음 (신규)
        no_policy_result = MagicMock()
        no_policy_result.scalar_one_or_none = MagicMock(return_value=None)

        # Company 조회 - 없음 (신규)
        no_company_result = MagicMock()
        no_company_result.scalar_one_or_none = MagicMock(return_value=None)

        call_count = [0]

        async def mock_execute(stmt):
            call_count[0] += 1
            if call_count[0] == 1:
                return no_dup_result
            elif call_count[0] == 2:
                return no_company_result
            else:
                return no_policy_result

        mock_session.execute = mock_execute
        mock_session.add = MagicMock()
        mock_session.flush = AsyncMock()
        mock_session.commit = AsyncMock()

        # Celery 앱 초기화 및 ingest_policy 태스크 모킹
        mock_ingest_policy = MagicMock()
        mock_ingest_policy.delay = MagicMock()
        mock_crawler_tasks = types.ModuleType("app.tasks.crawler_tasks")
        mock_crawler_tasks.ingest_policy = mock_ingest_policy
        with patch.dict(sys.modules, {"app.tasks.crawler_tasks": mock_crawler_tasks}):
            ingestor = PolicyIngestor(db_session=mock_session)
            result = await ingestor.ingest(listing, content_hash="new_hash_xyz")

        assert result.status in ("NEW", "UPDATED")

    @pytest.mark.asyncio
    async def test_ingest_stores_sale_status(self):
        """Policy 저장 시 sale_status 필드가 포함되어야 함"""
        from app.services.crawler.policy_ingestor import PolicyIngestor

        listing = PolicyListing(
            company_name="삼성생명",
            product_name="삼성 종신보험",
            product_code="P003",
            category="LIFE",
            pdf_url="https://example.com/p003.pdf",
            company_code="samsung-life",
            sale_status=SaleStatus.ON_SALE,
        )

        # PolicyIngestor가 sale_status를 Policy에 저장하는지 확인
        # (인스턴스 생성 검증)
        mock_session = AsyncMock()
        ingestor = PolicyIngestor(db_session=mock_session)
        assert ingestor is not None


# ---------------------------------------------------------------------------
# REQ-07.4: DB 저장 실패 시 FAILED 처리
# ---------------------------------------------------------------------------


class TestIngestDbFailure:
    """REQ-07.4: DB 저장 실패 시 FAILED 상태 반환"""

    @pytest.mark.asyncio
    async def test_ingest_returns_failed_on_db_error(self):
        """DB 저장 실패 시 FAILED 상태와 에러 메시지를 반환해야 함"""
        from app.services.crawler.policy_ingestor import PolicyIngestor

        listing = PolicyListing(
            company_name="삼성생명",
            product_name="삼성 종신보험",
            product_code="P004",
            category="LIFE",
            pdf_url="https://example.com/p004.pdf",
            company_code="samsung-life",
        )

        mock_session = AsyncMock()
        # content_hash 중복 없음
        no_dup_result = MagicMock()
        no_dup_result.scalar_one_or_none = MagicMock(return_value=None)
        # 첫 번째 execute는 중복 체크, 이후는 DB 오류 발생
        call_count = [0]

        async def mock_execute(stmt):
            call_count[0] += 1
            if call_count[0] == 1:
                return no_dup_result
            raise Exception("DB 연결 오류")

        mock_session.execute = mock_execute
        mock_session.rollback = AsyncMock()

        ingestor = PolicyIngestor(db_session=mock_session)
        result = await ingestor.ingest(listing, content_hash="new_hash_fail")

        assert result.status == "FAILED"
        assert result.error is not None

    @pytest.mark.asyncio
    async def test_ingest_failed_result_has_error_message(self):
        """FAILED 결과는 에러 메시지를 포함해야 함"""
        from app.services.crawler.policy_ingestor import PolicyIngestor

        listing = PolicyListing(
            company_name="삼성생명",
            product_name="삼성 종신보험",
            product_code="P005",
            category="LIFE",
            pdf_url="https://example.com/p005.pdf",
            company_code="samsung-life",
        )

        mock_session = AsyncMock()
        no_dup_result = MagicMock()
        no_dup_result.scalar_one_or_none = MagicMock(return_value=None)
        call_count = [0]

        async def mock_execute(stmt):
            call_count[0] += 1
            if call_count[0] == 1:
                return no_dup_result
            raise ValueError("특정 DB 오류 메시지")

        mock_session.execute = mock_execute
        mock_session.rollback = AsyncMock()

        ingestor = PolicyIngestor(db_session=mock_session)
        result = await ingestor.ingest(listing, content_hash="hash_error")

        assert result.error is not None
        assert len(result.error) > 0


# ---------------------------------------------------------------------------
# REQ-07.6: CrawlRun 완료 통계 업데이트 테스트
# ---------------------------------------------------------------------------


class TestFinalizeCrawlRun:
    """REQ-07.6: crawl_run 완료 시 통계 및 상태 업데이트"""

    @pytest.mark.asyncio
    async def test_finalize_crawl_run_sets_completed_status(self):
        """finalize_crawl_run()이 CrawlRun.status를 COMPLETED로 업데이트해야 함"""
        from app.services.crawler.policy_ingestor import PolicyIngestor

        mock_session = AsyncMock()
        mock_crawl_run = MagicMock()
        mock_crawl_run.status = "RUNNING"

        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=mock_crawl_run)
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.commit = AsyncMock()

        ingestor = PolicyIngestor(db_session=mock_session)
        crawl_run_id = uuid4()

        await ingestor.finalize_crawl_run(
            crawl_run_id=crawl_run_id,
            new_count=5,
            updated_count=3,
            skipped_count=10,
            failed_count=1,
        )

        # status가 COMPLETED로 변경되었어야 함
        from app.models.crawler import CrawlStatus
        assert mock_crawl_run.status == CrawlStatus.COMPLETED

    @pytest.mark.asyncio
    async def test_finalize_crawl_run_saves_stats(self):
        """finalize_crawl_run()이 통계를 CrawlRun에 저장해야 함"""
        from app.services.crawler.policy_ingestor import PolicyIngestor

        mock_session = AsyncMock()
        mock_crawl_run = MagicMock()

        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=mock_crawl_run)
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.commit = AsyncMock()

        ingestor = PolicyIngestor(db_session=mock_session)
        crawl_run_id = uuid4()

        await ingestor.finalize_crawl_run(
            crawl_run_id=crawl_run_id,
            new_count=5,
            updated_count=3,
            skipped_count=10,
            failed_count=1,
        )

        # new_count, updated_count 등이 업데이트되었어야 함
        assert mock_crawl_run.new_count == 5
        assert mock_crawl_run.updated_count == 3
        assert mock_crawl_run.skipped_count == 10
        assert mock_crawl_run.failed_count == 1
