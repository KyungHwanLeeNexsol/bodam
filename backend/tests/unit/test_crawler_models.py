"""크롤러 모델 단위 테스트 (SPEC-CRAWLER-001)

CrawlRun, CrawlResult 모델의 구조와 열거형 값을 테스트.
실제 DB 연결 없이 SQLAlchemy 모델 정의만 검증.
"""

from __future__ import annotations

from app.models.crawler import CrawlResult, CrawlResultStatus, CrawlRun, CrawlStatus


class TestCrawlStatus:
    """CrawlStatus 열거형 테스트"""

    def test_crawl_status_values(self):
        """CrawlStatus에 필수 값이 존재해야 함"""
        assert CrawlStatus.RUNNING == "RUNNING"
        assert CrawlStatus.COMPLETED == "COMPLETED"
        assert CrawlStatus.FAILED == "FAILED"

    def test_crawl_status_is_str_enum(self):
        """CrawlStatus는 StrEnum이어야 함"""
        from enum import StrEnum

        assert issubclass(CrawlStatus, str)
        assert issubclass(CrawlStatus, StrEnum)

    def test_crawl_status_count(self):
        """CrawlStatus 값은 정확히 3개여야 함"""
        assert len(CrawlStatus) == 3


class TestCrawlResultStatus:
    """CrawlResultStatus 열거형 테스트"""

    def test_crawl_result_status_values(self):
        """CrawlResultStatus에 필수 값이 존재해야 함"""
        assert CrawlResultStatus.NEW == "NEW"
        assert CrawlResultStatus.UPDATED == "UPDATED"
        assert CrawlResultStatus.SKIPPED == "SKIPPED"
        assert CrawlResultStatus.FAILED == "FAILED"

    def test_crawl_result_status_is_str_enum(self):
        """CrawlResultStatus는 StrEnum이어야 함"""
        from enum import StrEnum

        assert issubclass(CrawlResultStatus, str)
        assert issubclass(CrawlResultStatus, StrEnum)

    def test_crawl_result_status_count(self):
        """CrawlResultStatus 값은 정확히 5개여야 함"""
        assert len(CrawlResultStatus) == 5


class TestCrawlRunModel:
    """CrawlRun 모델 구조 테스트"""

    def test_crawl_run_table_name(self):
        """CrawlRun 테이블명은 'crawl_runs'이어야 함"""
        assert CrawlRun.__tablename__ == "crawl_runs"

    def test_crawl_run_has_required_columns(self):
        """CrawlRun에 필수 컬럼이 모두 존재해야 함"""
        columns = {col.name for col in CrawlRun.__table__.columns}
        required = {
            "id",
            "crawler_name",
            "status",
            "started_at",
            "finished_at",
            "total_found",
            "new_count",
            "updated_count",
            "skipped_count",
            "failed_count",
            "error_log",
            "created_at",
            "updated_at",
        }
        assert required.issubset(columns), f"누락된 컬럼: {required - columns}"

    def test_crawl_run_id_is_uuid(self):
        """CrawlRun.id는 UUID 타입이어야 함"""
        from sqlalchemy.dialects.postgresql import UUID

        id_col = CrawlRun.__table__.columns["id"]
        assert isinstance(id_col.type, UUID)

    def test_crawl_run_id_is_primary_key(self):
        """CrawlRun.id는 기본 키여야 함"""
        id_col = CrawlRun.__table__.columns["id"]
        assert id_col.primary_key

    def test_crawl_run_has_server_default_uuid(self):
        """CrawlRun.id에 gen_random_uuid() 서버 기본값이 있어야 함"""
        id_col = CrawlRun.__table__.columns["id"]
        assert id_col.server_default is not None

    def test_crawl_run_inherits_timestamp_mixin(self):
        """CrawlRun은 TimestampMixin을 상속해야 함"""
        from app.models.base import TimestampMixin

        assert issubclass(CrawlRun, TimestampMixin)

    def test_crawl_run_count_columns_default_zero(self):
        """카운트 컬럼들은 기본값이 0이어야 함"""
        count_cols = ["total_found", "new_count", "updated_count", "skipped_count", "failed_count"]
        for col_name in count_cols:
            col = CrawlRun.__table__.columns[col_name]
            # server_default 또는 default가 있어야 함
            assert col.server_default is not None or col.default is not None, f"{col_name}에 기본값 없음"

    def test_crawl_run_error_log_nullable(self):
        """error_log 컬럼은 nullable이어야 함"""
        col = CrawlRun.__table__.columns["error_log"]
        assert col.nullable

    def test_crawl_run_finished_at_nullable(self):
        """finished_at 컬럼은 nullable이어야 함"""
        col = CrawlRun.__table__.columns["finished_at"]
        assert col.nullable


class TestCrawlResultModel:
    """CrawlResult 모델 구조 테스트"""

    def test_crawl_result_table_name(self):
        """CrawlResult 테이블명은 'crawl_results'이어야 함"""
        assert CrawlResult.__tablename__ == "crawl_results"

    def test_crawl_result_has_required_columns(self):
        """CrawlResult에 필수 컬럼이 모두 존재해야 함"""
        columns = {col.name for col in CrawlResult.__table__.columns}
        required = {
            "id",
            "crawl_run_id",
            "policy_id",
            "product_code",
            "company_code",
            "status",
            "error_message",
            "pdf_path",
            "content_hash",
            "created_at",
        }
        assert required.issubset(columns), f"누락된 컬럼: {required - columns}"

    def test_crawl_result_crawl_run_fk(self):
        """crawl_run_id는 crawl_runs 테이블을 참조하는 FK여야 함"""
        col = CrawlResult.__table__.columns["crawl_run_id"]
        fks = list(col.foreign_keys)
        assert len(fks) == 1
        assert "crawl_runs.id" in str(fks[0])

    def test_crawl_result_policy_id_nullable(self):
        """policy_id는 nullable FK여야 함"""
        col = CrawlResult.__table__.columns["policy_id"]
        assert col.nullable

    def test_crawl_result_optional_columns_nullable(self):
        """선택적 컬럼들은 nullable이어야 함"""
        nullable_cols = ["error_message", "pdf_path", "content_hash"]
        for col_name in nullable_cols:
            col = CrawlResult.__table__.columns[col_name]
            assert col.nullable, f"{col_name}는 nullable이어야 함"


class TestModelsInit:
    """models/__init__.py 재내보내기 테스트"""

    def test_crawler_models_exported(self):
        """크롤러 모델이 models 패키지에서 임포트 가능해야 함"""
        from app.models import CrawlResult, CrawlRun

        assert CrawlResult is not None
        assert CrawlRun is not None

    def test_crawler_enums_exported(self):
        """크롤러 열거형이 models 패키지에서 임포트 가능해야 함"""
        from app.models import CrawlResultStatus, CrawlStatus

        assert CrawlStatus is not None
        assert CrawlResultStatus is not None
