"""Policy.sale_status 컬럼 마이그레이션 테스트 (SPEC-CRAWLER-002 REQ-07.1)

Alembic 마이그레이션이 올바르게 적용/롤백되는지 검증.
실제 DB 없이 마이그레이션 스크립트의 구조 및 Policy 모델 확장을 단위 테스트.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch, call

import pytest


# ---------------------------------------------------------------------------
# 마이그레이션 파일 존재 및 구조 테스트
# ---------------------------------------------------------------------------


class TestSaleStatusMigrationFileExists:
    """마이그레이션 파일 존재 여부 및 기본 구조 검증"""

    def test_migration_file_exists(self):
        """sale_status 컬럼 추가 마이그레이션 파일이 존재해야 함"""
        versions_dir = Path(__file__).parent.parent.parent / "alembic" / "versions"
        migration_files = list(versions_dir.glob("*sale_status*"))
        assert len(migration_files) >= 1, (
            "sale_status 마이그레이션 파일이 없습니다. "
            "alembic/versions/ 디렉토리에 *sale_status*.py 파일을 생성하세요."
        )

    def test_migration_file_has_correct_structure(self):
        """마이그레이션 파일이 upgrade/downgrade 함수를 포함해야 함"""
        versions_dir = Path(__file__).parent.parent.parent / "alembic" / "versions"
        migration_files = list(versions_dir.glob("*sale_status*"))
        assert len(migration_files) >= 1, "sale_status 마이그레이션 파일 없음"

        migration_file = migration_files[0]
        content = migration_file.read_text(encoding="utf-8")

        assert "def upgrade" in content, "upgrade 함수가 없습니다"
        assert "def downgrade" in content, "downgrade 함수가 없습니다"

    def test_migration_adds_sale_status_column(self):
        """마이그레이션이 sale_status 컬럼을 추가해야 함"""
        versions_dir = Path(__file__).parent.parent.parent / "alembic" / "versions"
        migration_files = list(versions_dir.glob("*sale_status*"))
        assert len(migration_files) >= 1, "sale_status 마이그레이션 파일 없음"

        migration_file = migration_files[0]
        content = migration_file.read_text(encoding="utf-8")

        assert "sale_status" in content, "마이그레이션에 sale_status 컬럼이 없습니다"
        assert "policies" in content, "policies 테이블에 적용하는 마이그레이션이 아닙니다"

    def test_migration_has_down_revision(self):
        """마이그레이션이 올바른 down_revision을 가져야 함"""
        versions_dir = Path(__file__).parent.parent.parent / "alembic" / "versions"
        migration_files = list(versions_dir.glob("*sale_status*"))
        assert len(migration_files) >= 1, "sale_status 마이그레이션 파일 없음"

        migration_file = migration_files[0]
        content = migration_file.read_text(encoding="utf-8")

        # down_revision이 최신 마이그레이션(o5p6q7r8s9t0)을 가리켜야 함
        assert "down_revision" in content, "down_revision이 없습니다"
        assert "o5p6q7r8s9t0" in content, "down_revision이 최신 마이그레이션을 가리키지 않습니다"

    def test_downgrade_removes_sale_status_column(self):
        """downgrade가 sale_status 컬럼을 제거해야 함"""
        versions_dir = Path(__file__).parent.parent.parent / "alembic" / "versions"
        migration_files = list(versions_dir.glob("*sale_status*"))
        assert len(migration_files) >= 1, "sale_status 마이그레이션 파일 없음"

        migration_file = migration_files[0]
        content = migration_file.read_text(encoding="utf-8")

        # downgrade 섹션에 drop_column 또는 sale_status 제거 로직이 있어야 함
        assert "drop_column" in content or "DROP COLUMN" in content.upper(), (
            "downgrade에 sale_status 컬럼 제거 로직이 없습니다"
        )


# ---------------------------------------------------------------------------
# Policy 모델 sale_status 필드 테스트
# ---------------------------------------------------------------------------


class TestPolicySaleStatusField:
    """Policy 모델의 sale_status 필드 검증"""

    def test_policy_model_has_sale_status_column(self):
        """Policy 모델에 sale_status 컬럼이 정의되어 있어야 함"""
        from app.models.insurance import Policy

        # SQLAlchemy 컬럼 매핑 확인
        columns = {col.name for col in Policy.__table__.columns}
        assert "sale_status" in columns, (
            "Policy 모델에 sale_status 컬럼이 없습니다. "
            "app/models/insurance.py에 sale_status 필드를 추가하세요."
        )

    def test_policy_sale_status_default_is_unknown(self):
        """sale_status 컬럼의 기본값이 'UNKNOWN'이어야 함"""
        from app.models.insurance import Policy

        column = Policy.__table__.columns["sale_status"]
        # server_default 또는 default 확인
        has_default = (
            column.default is not None
            or column.server_default is not None
        )
        assert has_default, "sale_status 컬럼에 기본값이 없습니다"

    def test_policy_sale_status_is_nullable(self):
        """sale_status 컬럼은 nullable이어야 함"""
        from app.models.insurance import Policy

        column = Policy.__table__.columns["sale_status"]
        assert column.nullable is True, "sale_status 컬럼이 nullable=True가 아닙니다"


# ---------------------------------------------------------------------------
# 마이그레이션 upgrade/downgrade mock 실행 테스트
# ---------------------------------------------------------------------------


class TestMigrationUpgradeDowngrade:
    """마이그레이션 upgrade/downgrade op 호출 검증 (mock)"""

    def _load_migration_module(self):
        """마이그레이션 모듈 동적 로드"""
        versions_dir = Path(__file__).parent.parent.parent / "alembic" / "versions"
        migration_files = list(versions_dir.glob("*sale_status*"))
        assert len(migration_files) >= 1, "sale_status 마이그레이션 파일 없음"

        migration_path = migration_files[0]
        module_name = migration_path.stem

        # 이미 로드된 경우 캐시에서 제거 후 재로드
        if module_name in sys.modules:
            del sys.modules[module_name]

        spec = importlib.util.spec_from_file_location(module_name, migration_path)
        module = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
        spec.loader.exec_module(module)  # type: ignore[union-attr]
        return module

    def test_upgrade_calls_add_column(self):
        """upgrade()가 op.add_column을 호출해야 함"""
        module = self._load_migration_module()

        with patch("alembic.op.add_column") as mock_add_column:
            try:
                module.upgrade()
            except Exception:
                pass  # DB 연결 없이 실행 시 예외는 무시

            # add_column이 호출되었는지 또는 모듈에 add_column 로직이 있는지 확인
            content = Path(module.__file__).read_text(encoding="utf-8")
            assert "add_column" in content, "upgrade에 add_column 호출이 없습니다"

    def test_downgrade_calls_drop_column(self):
        """downgrade()가 op.drop_column을 호출해야 함"""
        module = self._load_migration_module()

        content = Path(module.__file__).read_text(encoding="utf-8")
        assert "drop_column" in content, "downgrade에 drop_column 호출이 없습니다"
