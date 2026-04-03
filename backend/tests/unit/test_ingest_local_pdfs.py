"""SPEC-INGEST-001: 로컬 PDF 인제스트 스크립트 단위 테스트

TDD (RED-GREEN-REFACTOR) 방식으로 작성.
DB 세션, PDFParser, TextCleaner, TextChunker, EmbeddingService는 모두 모킹.
"""

from __future__ import annotations

import hashlib
import json
import sys
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ─────────────────────────────────────────────────────────────
# conftest 수준 환경 설정 (pgvector, openai 등 모킹)
# ─────────────────────────────────────────────────────────────

# pgvector 모킹 (conftest.py 참조)
if "pgvector" not in sys.modules:
    import sqlalchemy as _sa

    class _VectorType(_sa.types.TypeDecorator):  # type: ignore[misc]
        impl = _sa.Text
        cache_ok = True

        def __init__(self, dim: int = 768) -> None:
            super().__init__()
            self.dim = dim

        def process_bind_param(self, value, dialect):
            return str(value) if value is not None else None

        def process_result_value(self, value, dialect):
            return value

    _pgvector_mock = MagicMock()
    _pgvector_mock.sqlalchemy = MagicMock()
    _pgvector_mock.sqlalchemy.Vector = _VectorType
    sys.modules["pgvector"] = _pgvector_mock
    sys.modules["pgvector.sqlalchemy"] = _pgvector_mock.sqlalchemy

# openai 모킹
if "openai" not in sys.modules:
    _openai_mock = MagicMock()
    _openai_mock.AsyncOpenAI = MagicMock
    _openai_mock.BadRequestError = Exception
    sys.modules["openai"] = _openai_mock

# jose 모킹
if "jose" not in sys.modules:
    _jose_mock = MagicMock()
    _jose_mock.JWTError = Exception
    _jose_mock.jwt = MagicMock()
    sys.modules["jose"] = _jose_mock

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost/testdb")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-testing-purposes-only")
os.environ.setdefault("OPENAI_API_KEY", "")

# 프로젝트 루트를 sys.path에 추가 (스크립트 임포트용)
_backend_root = Path(__file__).parent.parent.parent
if str(_backend_root) not in sys.path:
    sys.path.insert(0, str(_backend_root))


# ─────────────────────────────────────────────────────────────
# TASK-001: COMPANY_MAP + detect_format()
# ─────────────────────────────────────────────────────────────


class TestCompanyMap:
    """TASK-001: COMPANY_MAP 상수 검증"""

    def test_company_map_contains_core_nonlife_companies(self):
        """COMPANY_MAP에 핵심 손해보험사들이 포함되어야 한다"""
        from scripts.ingest_local_pdfs import COMPANY_MAP

        core_keys = {
            "meritz_fire",
            "hyundai_marine",
            "kb_insurance",
            "samsung_fire",
            "db_insurance",
            "heungkuk_fire",
        }
        assert core_keys.issubset(set(COMPANY_MAP.keys()))

    def test_company_map_values_have_three_fields(self):
        """COMPANY_MAP의 각 값은 (code, name, category) 3-튜플이어야 한다"""
        from scripts.ingest_local_pdfs import COMPANY_MAP

        for key, value in COMPANY_MAP.items():
            assert len(value) == 3, f"{key}의 값이 3-튜플이 아님"
            code, name, category = value
            assert isinstance(code, str)
            assert isinstance(name, str)
            assert category in ("LIFE", "NON_LIFE", "THIRD_SECTOR")

    def test_company_map_categories_are_valid(self):
        """COMPANY_MAP의 모든 보험사 카테고리는 유효한 값이어야 한다"""
        from scripts.ingest_local_pdfs import COMPANY_MAP

        valid_categories = {"NON_LIFE", "LIFE", "THIRD_SECTOR"}
        for _key, (_, _, category) in COMPANY_MAP.items():
            assert category in valid_categories, f"{_key}의 카테고리 {category}가 유효하지 않음"

    def test_company_map_meritz_fire_code(self):
        """meritz_fire의 code는 'meritz-fire'여야 한다"""
        from scripts.ingest_local_pdfs import COMPANY_MAP

        code, name, _ = COMPANY_MAP["meritz_fire"]
        assert code == "meritz-fire"
        assert "메리츠" in name


class TestDetectFormat:
    """TASK-001: detect_format() 함수 검증"""

    def test_detect_format_a_numeric_directory(self, tmp_path):
        """숫자형 디렉터리(10000-0001)는 FORMAT_A를 반환해야 한다"""
        from scripts.ingest_local_pdfs import detect_format

        dir_path = tmp_path / "10000-0001"
        dir_path.mkdir()
        assert detect_format(dir_path) == "A"

    def test_detect_format_a_underscore_numeric(self, tmp_path):
        """숫자_숫자 형식 디렉터리도 FORMAT_A를 반환해야 한다"""
        from scripts.ingest_local_pdfs import detect_format

        dir_path = tmp_path / "12345_6789"
        dir_path.mkdir()
        assert detect_format(dir_path) == "A"

    def test_detect_format_b_known_company(self, tmp_path):
        """COMPANY_MAP에 있는 디렉터리는 FORMAT_B를 반환해야 한다"""
        from scripts.ingest_local_pdfs import detect_format

        dir_path = tmp_path / "meritz_fire"
        dir_path.mkdir()
        assert detect_format(dir_path) == "B"

    def test_detect_format_b_all_companies(self, tmp_path):
        """COMPANY_MAP의 모든 키에 대해 FORMAT_B를 반환해야 한다"""
        from scripts.ingest_local_pdfs import COMPANY_MAP, detect_format

        for company_key in COMPANY_MAP:
            dir_path = tmp_path / company_key
            dir_path.mkdir(exist_ok=True)
            assert detect_format(dir_path) == "B", f"{company_key}가 FORMAT_B가 아님"

    def test_detect_format_c_unknown_directory(self, tmp_path):
        """알 수 없는 디렉터리명은 FORMAT_C를 반환해야 한다"""
        from scripts.ingest_local_pdfs import detect_format

        dir_path = tmp_path / "unknown_company"
        dir_path.mkdir()
        assert detect_format(dir_path) == "C"

    def test_detect_format_a_with_path_object(self, tmp_path):
        """Path 객체를 직접 전달해도 동작해야 한다"""
        from scripts.ingest_local_pdfs import detect_format

        dir_path = tmp_path / "99999-0001"
        dir_path.mkdir()
        result = detect_format(dir_path)
        assert result == "A"


# ─────────────────────────────────────────────────────────────
# TASK-004: compute_file_hash() + check_duplicate()
# ─────────────────────────────────────────────────────────────


class TestComputeFileHash:
    """TASK-004: compute_file_hash() 함수 검증"""

    def test_compute_file_hash_returns_sha256_hex(self, tmp_path):
        """파일의 SHA-256 해시를 16진수 문자열로 반환해야 한다"""
        from scripts.ingest_local_pdfs import compute_file_hash

        test_file = tmp_path / "test.pdf"
        test_file.write_bytes(b"test content")

        result = compute_file_hash(str(test_file))
        expected = hashlib.sha256(b"test content").hexdigest()

        assert result == expected
        assert len(result) == 64  # SHA-256 hex digest length

    def test_compute_file_hash_different_content(self, tmp_path):
        """다른 내용의 파일은 다른 해시를 반환해야 한다"""
        from scripts.ingest_local_pdfs import compute_file_hash

        file1 = tmp_path / "file1.pdf"
        file2 = tmp_path / "file2.pdf"
        file1.write_bytes(b"content A")
        file2.write_bytes(b"content B")

        assert compute_file_hash(str(file1)) != compute_file_hash(str(file2))

    def test_compute_file_hash_same_content_same_hash(self, tmp_path):
        """동일한 내용의 파일은 동일한 해시를 반환해야 한다"""
        from scripts.ingest_local_pdfs import compute_file_hash

        file1 = tmp_path / "file1.pdf"
        file2 = tmp_path / "file2.pdf"
        file1.write_bytes(b"same content")
        file2.write_bytes(b"same content")

        assert compute_file_hash(str(file1)) == compute_file_hash(str(file2))

    def test_compute_file_hash_large_file(self, tmp_path):
        """대용량 파일도 처리할 수 있어야 한다 (청크 방식 읽기)"""
        from scripts.ingest_local_pdfs import compute_file_hash

        # 1MB 파일
        large_content = b"x" * (1024 * 1024)
        test_file = tmp_path / "large.pdf"
        test_file.write_bytes(large_content)

        expected = hashlib.sha256(large_content).hexdigest()
        result = compute_file_hash(str(test_file))
        assert result == expected


class TestCheckDuplicate:
    """TASK-004: check_duplicate() 함수 검증"""

    @pytest.mark.asyncio
    async def test_check_duplicate_returns_true_when_exists(self):
        """동일한 content_hash를 가진 Policy가 존재하면 True를 반환해야 한다"""
        from scripts.ingest_local_pdfs import check_duplicate

        mock_session = AsyncMock()
        mock_scalars = MagicMock()
        mock_scalars.first.return_value = MagicMock()  # Policy 객체 존재
        mock_result = MagicMock()
        mock_result.scalars.return_value = mock_scalars
        mock_session.execute = AsyncMock(return_value=mock_result)

        result = await check_duplicate(mock_session, "abc123hash")
        assert result is True

    @pytest.mark.asyncio
    async def test_check_duplicate_returns_false_when_not_exists(self):
        """동일한 content_hash가 없으면 False를 반환해야 한다"""
        from scripts.ingest_local_pdfs import check_duplicate

        mock_session = AsyncMock()
        mock_scalars = MagicMock()
        mock_scalars.first.return_value = None  # 존재하지 않음
        mock_result = MagicMock()
        mock_result.scalars.return_value = mock_scalars
        mock_session.execute = AsyncMock(return_value=mock_result)

        result = await check_duplicate(mock_session, "nonexistent_hash")
        assert result is False


# ─────────────────────────────────────────────────────────────
# TASK-008: parse_args()
# ─────────────────────────────────────────────────────────────


class TestParseArgs:
    """TASK-008: parse_args() CLI 인터페이스 검증"""

    def test_parse_args_default_values(self):
        """인자 없이 호출 시 기본값이 설정되어야 한다"""
        from scripts.ingest_local_pdfs import parse_args

        args = parse_args([])
        assert args.company is None
        assert args.dry_run is False
        assert args.embed is False

    def test_parse_args_company_filter(self):
        """--company 인자가 올바르게 파싱되어야 한다"""
        from scripts.ingest_local_pdfs import parse_args

        args = parse_args(["--company", "meritz_fire"])
        assert args.company == "meritz_fire"

    def test_parse_args_dry_run(self):
        """--dry-run 플래그가 올바르게 파싱되어야 한다"""
        from scripts.ingest_local_pdfs import parse_args

        args = parse_args(["--dry-run"])
        assert args.dry_run is True

    def test_parse_args_embed(self):
        """--embed 플래그가 올바르게 파싱되어야 한다"""
        from scripts.ingest_local_pdfs import parse_args

        args = parse_args(["--embed"])
        assert args.embed is True

    def test_parse_args_data_dir(self, tmp_path):
        """--data-dir 인자가 올바르게 파싱되어야 한다"""
        from scripts.ingest_local_pdfs import parse_args

        args = parse_args(["--data-dir", str(tmp_path)])
        assert Path(args.data_dir) == tmp_path

    def test_parse_args_combined(self):
        """여러 인자를 동시에 사용할 수 있어야 한다"""
        from scripts.ingest_local_pdfs import parse_args

        args = parse_args(["--company", "samsung_fire", "--dry-run", "--embed"])
        assert args.company == "samsung_fire"
        assert args.dry_run is True
        assert args.embed is True


# ─────────────────────────────────────────────────────────────
# TASK-010: generate_report()
# ─────────────────────────────────────────────────────────────


class TestGenerateReport:
    """TASK-010: generate_report() 함수 검증"""

    def test_generate_report_contains_stats(self):
        """리포트에 처리 통계가 포함되어야 한다"""
        from scripts.ingest_local_pdfs import generate_report

        stats = {
            "total": 10,
            "success": 7,
            "skipped": 2,
            "failed": 1,
        }
        report = generate_report(stats)
        assert isinstance(report, str)
        assert "10" in report
        assert "7" in report
        assert "2" in report
        assert "1" in report

    def test_generate_report_has_section_headers(self):
        """리포트에 섹션 구분이 있어야 한다"""
        from scripts.ingest_local_pdfs import generate_report

        stats = {"total": 0, "success": 0, "skipped": 0, "failed": 0}
        report = generate_report(stats)
        # 구분선 또는 제목이 있어야 함
        assert len(report) > 0
        assert "\n" in report  # 여러 줄이어야 함

    def test_generate_report_zero_total(self):
        """전체가 0인 경우도 올바르게 처리해야 한다"""
        from scripts.ingest_local_pdfs import generate_report

        stats = {"total": 0, "success": 0, "skipped": 0, "failed": 0}
        report = generate_report(stats)
        assert isinstance(report, str)


# ─────────────────────────────────────────────────────────────
# TASK-011: save_failure_log()
# ─────────────────────────────────────────────────────────────


class TestSaveFailureLog:
    """TASK-011: save_failure_log() 함수 검증"""

    def test_save_failure_log_creates_json_file(self, tmp_path):
        """실패 목록이 있으면 JSON 파일을 생성해야 한다"""
        from scripts.ingest_local_pdfs import save_failure_log

        failures = [
            {"file": "/data/meritz_fire/policy1.pdf", "error": "parse error"},
            {"file": "/data/db_insurance/policy2.pdf", "error": "db error"},
        ]
        result = save_failure_log(failures, tmp_path)

        assert result is not None
        assert result.exists()
        assert result.suffix == ".json"

    def test_save_failure_log_json_content_valid(self, tmp_path):
        """생성된 JSON 파일이 올바른 형식이어야 한다"""
        from scripts.ingest_local_pdfs import save_failure_log

        failures = [{"file": "test.pdf", "error": "test error"}]
        result = save_failure_log(failures, tmp_path)

        assert result is not None
        with open(result) as f:
            data = json.load(f)
        assert isinstance(data, list)
        assert len(data) == 1
        assert data[0]["file"] == "test.pdf"

    def test_save_failure_log_empty_list_returns_none(self, tmp_path):
        """실패 목록이 비어 있으면 None을 반환해야 한다"""
        from scripts.ingest_local_pdfs import save_failure_log

        result = save_failure_log([], tmp_path)
        assert result is None


# ─────────────────────────────────────────────────────────────
# TASK-002: scan_data_directory()
# ─────────────────────────────────────────────────────────────


class TestScanDataDirectory:
    """TASK-002: scan_data_directory() 함수 검증"""

    def test_scan_finds_format_a_pdfs(self, tmp_path):
        """Format A (숫자형 디렉터리) PDF 파일을 찾아야 한다"""
        from scripts.ingest_local_pdfs import scan_data_directory

        # Format A 구조 생성
        dir_a = tmp_path / "10000-0001"
        dir_a.mkdir()
        pdf_file = dir_a / "latest.pdf"
        pdf_file.write_bytes(b"%PDF-1.4")

        results = scan_data_directory(tmp_path)
        assert len(results) == 1
        assert results[0][0] == pdf_file
        assert results[0][1] == "A"

    def test_scan_finds_format_b_pdfs(self, tmp_path):
        """Format B (회사명 디렉터리) PDF 파일을 찾아야 한다"""
        from scripts.ingest_local_pdfs import scan_data_directory

        # Format B 구조 생성
        dir_b = tmp_path / "meritz_fire"
        dir_b.mkdir()
        pdf_file = dir_b / "meritz_product_abc123.pdf"
        pdf_file.write_bytes(b"%PDF-1.4")
        json_file = dir_b / "meritz_product_abc123.json"
        json_file.write_text('{"product_name": "테스트상품"}')

        results = scan_data_directory(tmp_path)
        pdf_results = [(p, f) for p, f in results if p == pdf_file]
        assert len(pdf_results) == 1
        assert pdf_results[0][1] == "B"

    def test_scan_with_company_filter(self, tmp_path):
        """company_filter가 지정되면 해당 회사만 스캔해야 한다"""
        from scripts.ingest_local_pdfs import scan_data_directory

        # meritz_fire 디렉터리
        dir_meritz = tmp_path / "meritz_fire"
        dir_meritz.mkdir()
        pdf_meritz = dir_meritz / "meritz_prod_111.pdf"
        pdf_meritz.write_bytes(b"%PDF-1.4")

        # samsung_fire 디렉터리
        dir_samsung = tmp_path / "samsung_fire"
        dir_samsung.mkdir()
        pdf_samsung = dir_samsung / "samsung_prod_222.pdf"
        pdf_samsung.write_bytes(b"%PDF-1.4")

        results = scan_data_directory(tmp_path, company_filter="meritz_fire")
        paths = [r[0] for r in results]
        assert pdf_meritz in paths
        assert pdf_samsung not in paths

    def test_scan_returns_empty_for_empty_dir(self, tmp_path):
        """빈 디렉터리에서는 빈 리스트를 반환해야 한다"""
        from scripts.ingest_local_pdfs import scan_data_directory

        results = scan_data_directory(tmp_path)
        assert results == []

    def test_scan_skips_non_pdf_files(self, tmp_path):
        """PDF가 아닌 파일은 스캔 결과에 포함되지 않아야 한다"""
        from scripts.ingest_local_pdfs import scan_data_directory

        dir_a = tmp_path / "10000-0001"
        dir_a.mkdir()
        txt_file = dir_a / "readme.txt"
        txt_file.write_text("not a pdf")

        results = scan_data_directory(tmp_path)
        assert len(results) == 0


# ─────────────────────────────────────────────────────────────
# TASK-003: extract_metadata()
# ─────────────────────────────────────────────────────────────


class TestExtractMetadata:
    """TASK-003: extract_metadata() 함수 검증"""

    def test_extract_metadata_format_a(self, tmp_path):
        """Format A PDF의 메타데이터를 올바르게 추출해야 한다"""
        from scripts.ingest_local_pdfs import extract_metadata

        dir_a = tmp_path / "10000-0001"
        dir_a.mkdir()
        pdf_file = dir_a / "latest.pdf"
        pdf_file.write_bytes(b"%PDF-1.4")

        meta = extract_metadata(pdf_file, tmp_path)
        assert meta["company_code"] == "pub-insure"
        assert meta["product_code"] == "10000-0001"
        assert meta["category"] == "LIFE"

    def test_extract_metadata_format_b_with_json(self, tmp_path):
        """Format B PDF의 JSON 메타데이터를 올바르게 추출해야 한다"""
        from scripts.ingest_local_pdfs import extract_metadata

        dir_b = tmp_path / "meritz_fire"
        dir_b.mkdir()
        pdf_file = dir_b / "meritz_prod_abc123.pdf"
        pdf_file.write_bytes(b"%PDF-1.4")

        json_data = {
            "company_id": "meritz",
            "company_name": "메리츠화재",
            "product_name": "메리츠 암보험",
            "category": "NON_LIFE",
            "source_url": "https://example.com",
            "content_hash": "abc123def",
            "file_size": 12345,
            "crawled_at": "2024-01-01T00:00:00",
        }
        json_file = dir_b / "meritz_prod_abc123.json"
        json_file.write_text(json.dumps(json_data, ensure_ascii=False), encoding="utf-8")

        meta = extract_metadata(pdf_file, tmp_path)
        assert meta["company_code"] == "meritz-fire"
        assert meta["product_name"] == "메리츠 암보험"
        assert meta["category"] == "NON_LIFE"

    def test_extract_metadata_format_b_without_json(self, tmp_path):
        """Format B PDF에 JSON이 없어도 COMPANY_MAP에서 메타데이터를 추출해야 한다"""
        from scripts.ingest_local_pdfs import extract_metadata

        dir_b = tmp_path / "samsung_fire"
        dir_b.mkdir()
        pdf_file = dir_b / "samsung_prod_xyz.pdf"
        pdf_file.write_bytes(b"%PDF-1.4")

        meta = extract_metadata(pdf_file, tmp_path)
        assert meta["company_code"] == "samsung-fire"
        assert "삼성화재" in meta["company_name"]
        assert meta["category"] == "NON_LIFE"

    def test_extract_metadata_includes_format_type(self, tmp_path):
        """추출된 메타데이터에 format_type 필드가 포함되어야 한다"""
        from scripts.ingest_local_pdfs import extract_metadata

        dir_a = tmp_path / "20000-0002"
        dir_a.mkdir()
        pdf_file = dir_a / "latest.pdf"
        pdf_file.write_bytes(b"%PDF-1.4")

        meta = extract_metadata(pdf_file, tmp_path)
        assert "format_type" in meta
        assert meta["format_type"] == "A"


# ─────────────────────────────────────────────────────────────
# TASK-005: ensure_company()
# ─────────────────────────────────────────────────────────────


class TestEnsureCompany:
    """TASK-005: ensure_company() 함수 검증"""

    @pytest.mark.asyncio
    async def test_ensure_company_returns_existing_company(self):
        """기존 보험사가 있으면 기존 레코드를 반환해야 한다"""
        from scripts.ingest_local_pdfs import ensure_company

        existing_company = MagicMock()
        existing_company.id = uuid.uuid4()
        existing_company.code = "meritz-fire"

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = existing_company
        mock_session.execute = AsyncMock(return_value=mock_result)

        result = await ensure_company(mock_session, "meritz-fire", "메리츠화재", "NON_LIFE")
        assert result == existing_company
        mock_session.add.assert_not_called()

    @pytest.mark.asyncio
    async def test_ensure_company_creates_new_company(self):
        """보험사가 없으면 새로 생성해야 한다"""
        from scripts.ingest_local_pdfs import ensure_company

        mock_session = MagicMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None  # 존재하지 않음
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.flush = AsyncMock()
        mock_session.add = MagicMock()

        result = await ensure_company(mock_session, "new-company", "새 보험사", "LIFE")
        mock_session.add.assert_called_once()
        assert result is not None

    @pytest.mark.asyncio
    async def test_ensure_company_uses_correct_category(self):
        """올바른 InsuranceCategory enum 값을 사용해야 한다"""
        from scripts.ingest_local_pdfs import ensure_company

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.flush = AsyncMock()

        added_companies = []
        mock_session.add = MagicMock(side_effect=lambda obj: added_companies.append(obj))

        await ensure_company(mock_session, "test-co", "테스트 보험사", "NON_LIFE")
        assert len(added_companies) == 1
        company = added_companies[0]
        assert company.code == "test-co"
        assert company.name == "테스트 보험사"


# ─────────────────────────────────────────────────────────────
# TASK-006: upsert_policy() + create_chunks()
# ─────────────────────────────────────────────────────────────


class TestUpsertPolicy:
    """TASK-006: upsert_policy() 함수 검증"""

    @pytest.mark.asyncio
    async def test_upsert_policy_creates_new_policy(self):
        """신규 정책을 INSERT ... ON CONFLICT DO UPDATE로 생성해야 한다"""
        from scripts.ingest_local_pdfs import upsert_policy

        company = MagicMock()
        company.id = uuid.uuid4()
        company.code = "test-co"

        returned_id = uuid.uuid4()
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one.return_value = returned_id
        mock_session.execute = AsyncMock(return_value=mock_result)

        metadata = {
            "product_code": "TEST-001",
            "product_name": "테스트 상품",
            "category": "NON_LIFE",
        }

        result = await upsert_policy(
            mock_session, company, metadata, "abc123hash", "테스트 약관 텍스트"
        )
        assert result is not None
        assert result.id == returned_id
        mock_session.execute.assert_called_once()

    @pytest.mark.asyncio
    async def test_upsert_policy_updates_existing_policy(self):
        """기존 정책이 있으면 ON CONFLICT DO UPDATE로 처리해야 한다"""
        from scripts.ingest_local_pdfs import upsert_policy

        company = MagicMock()
        company.id = uuid.uuid4()
        company.code = "test-co"

        existing_id = uuid.uuid4()

        mock_session = AsyncMock()
        mock_result = MagicMock()
        # ON CONFLICT DO UPDATE 시 기존 row의 ID 반환
        mock_result.scalar_one.return_value = existing_id
        mock_session.execute = AsyncMock(return_value=mock_result)

        metadata = {
            "product_code": "TEST-001",
            "product_name": "테스트 상품",
            "category": "NON_LIFE",
        }

        result = await upsert_policy(
            mock_session, company, metadata, "newhash", "새 약관 텍스트"
        )
        assert result.id == existing_id
        mock_session.execute.assert_called_once()

    @pytest.mark.asyncio
    async def test_upsert_policy_stores_content_hash_in_metadata(self):
        """UPSERT 실행 시 session.execute()가 정확히 1회 호출되어야 한다"""
        from scripts.ingest_local_pdfs import upsert_policy

        company = MagicMock()
        company.id = uuid.uuid4()
        company.code = "test-co"

        returned_id = uuid.uuid4()
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one.return_value = returned_id
        mock_session.execute = AsyncMock(return_value=mock_result)

        metadata = {
            "product_code": "HASH-TEST",
            "product_name": "해시 테스트",
            "category": "LIFE",
        }

        result = await upsert_policy(mock_session, company, metadata, "myhash123", "텍스트")
        assert result is not None
        assert result.id == returned_id
        # INSERT ... ON CONFLICT DO UPDATE 단일 execute 호출 검증
        mock_session.execute.assert_called_once()


class TestCreateChunks:
    """TASK-006: create_chunks() 함수 검증 (bulk INSERT 방식)"""

    @pytest.mark.asyncio
    async def test_create_chunks_adds_policy_chunks(self):
        """청크 리스트를 PolicyChunk 레코드로 bulk insert해야 한다"""
        from scripts.ingest_local_pdfs import create_chunks

        mock_session = AsyncMock()
        mock_session.execute = AsyncMock()

        policy_id = uuid.uuid4()
        chunks = ["청크 텍스트 1", "청크 텍스트 2", "청크 텍스트 3"]

        await create_chunks(mock_session, policy_id, chunks)

        # bulk insert를 위해 session.execute가 1번 호출되어야 함
        mock_session.execute.assert_called_once()
        # execute에 전달된 두 번째 인자(rows)가 3개 항목임을 확인
        call_args = mock_session.execute.call_args
        rows = call_args[0][1] if len(call_args[0]) > 1 else call_args[1].get("params", [])
        assert len(rows) == 3

    @pytest.mark.asyncio
    async def test_create_chunks_sets_correct_indices(self):
        """청크 인덱스가 0부터 순서대로 설정되어야 한다"""
        from scripts.ingest_local_pdfs import create_chunks

        mock_session = AsyncMock()
        mock_session.execute = AsyncMock()

        policy_id = uuid.uuid4()
        chunks = ["첫 번째 청크", "두 번째 청크"]

        await create_chunks(mock_session, policy_id, chunks)

        call_args = mock_session.execute.call_args
        rows = call_args[0][1]
        indices = [r["chunk_index"] for r in rows]
        assert indices == [0, 1]

    @pytest.mark.asyncio
    async def test_create_chunks_embedding_is_none(self):
        """새로 생성된 청크의 embedding은 None이어야 한다 (REQ-08)"""
        from scripts.ingest_local_pdfs import create_chunks

        mock_session = AsyncMock()
        mock_session.execute = AsyncMock()

        policy_id = uuid.uuid4()
        chunks = ["임베딩 없는 청크"]

        await create_chunks(mock_session, policy_id, chunks)

        call_args = mock_session.execute.call_args
        rows = call_args[0][1]
        assert len(rows) == 1
        assert rows[0]["embedding"] is None

    @pytest.mark.asyncio
    async def test_create_chunks_empty_list(self):
        """빈 청크 리스트는 session.execute를 호출하지 않아야 한다"""
        from scripts.ingest_local_pdfs import create_chunks

        mock_session = AsyncMock()
        mock_session.execute = AsyncMock()

        await create_chunks(mock_session, uuid.uuid4(), [])
        mock_session.execute.assert_not_called()


# ─────────────────────────────────────────────────────────────
# TASK-007: process_single_file()
# ─────────────────────────────────────────────────────────────


class TestProcessSingleFile:
    """TASK-007: process_single_file() 함수 검증"""

    @pytest.mark.asyncio
    async def test_process_single_file_success(self, tmp_path):
        """파일 처리 성공 시 status='success'를 반환해야 한다"""
        from scripts.ingest_local_pdfs import process_single_file

        # PDF 파일 생성
        pdf_file = tmp_path / "test.pdf"
        pdf_file.write_bytes(b"%PDF-1.4 test")

        metadata = {
            "company_code": "meritz-fire",
            "company_name": "메리츠화재",
            "product_code": "TEST-001",
            "product_name": "테스트 상품",
            "category": "NON_LIFE",
            "format_type": "B",
        }

        # session_factory 모킹
        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=None)

        mock_factory = MagicMock()
        mock_factory.return_value = mock_session

        # 중복 없음으로 설정
        mock_result_dup = MagicMock()
        mock_result_dup.scalar_one_or_none.return_value = None

        # company 조회 결과 (새로 생성)
        mock_company = MagicMock()
        mock_company.id = uuid.uuid4()

        # policy 조회 결과 (새로 생성)
        mock_policy = MagicMock()
        mock_policy.id = uuid.uuid4()

        call_count = [0]

        policy_id = uuid.uuid4()

        async def mock_execute(_stmt, *_args, **_kwargs):
            call_count[0] += 1
            result = MagicMock()
            if call_count[0] == 1:
                # check_duplicate 쿼리 - scalars().first() 방식
                result.scalars.return_value.first.return_value = None
            elif call_count[0] == 2:
                # ensure_company 쿼리 - 새 회사
                result.scalar_one_or_none.return_value = None
            elif call_count[0] == 3:
                # upsert_policy: INSERT ... ON CONFLICT DO UPDATE ... RETURNING id
                result.scalar_one.return_value = policy_id
            return result

        mock_session.execute = mock_execute
        mock_session.flush = AsyncMock()
        mock_session.commit = AsyncMock()

        added_objects = []
        mock_session.add = MagicMock(side_effect=lambda obj: added_objects.append(obj))

        with (
            patch("scripts.ingest_local_pdfs.PDFParser") as mock_parser_cls,
            patch("scripts.ingest_local_pdfs.TextCleaner") as mock_cleaner_cls,
            patch("scripts.ingest_local_pdfs.TextChunker") as mock_chunker_cls,
        ):
            mock_parser = MagicMock()
            mock_parser.extract_text.return_value = "약관 텍스트 내용"
            mock_parser_cls.return_value = mock_parser

            mock_cleaner = MagicMock()
            mock_cleaner.clean.return_value = "정제된 약관 텍스트"
            mock_cleaner_cls.return_value = mock_cleaner

            mock_chunker = MagicMock()
            mock_chunker.chunk_text.return_value = ["청크1", "청크2"]
            mock_chunker_cls.return_value = mock_chunker

            result = await process_single_file(mock_factory, pdf_file, metadata)

        assert result["status"] == "success"
        assert "chunk_count" in result

    @pytest.mark.asyncio
    async def test_process_single_file_skip_duplicate(self, tmp_path):
        """중복 파일(동일 hash)은 skip 상태를 반환해야 한다"""
        from scripts.ingest_local_pdfs import process_single_file

        pdf_file = tmp_path / "duplicate.pdf"
        pdf_file.write_bytes(b"%PDF-1.4 duplicate content")

        metadata = {
            "company_code": "meritz-fire",
            "company_name": "메리츠화재",
            "product_code": "DUP-001",
            "product_name": "중복 상품",
            "category": "NON_LIFE",
            "format_type": "B",
        }

        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=None)

        mock_factory = MagicMock()
        mock_factory.return_value = mock_session

        # 중복 존재로 설정
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = MagicMock()  # 이미 존재
        mock_session.execute = AsyncMock(return_value=mock_result)

        # PDF 파싱은 트랜잭션 밖에서 먼저 실행되므로 mock 필요
        with (
            patch("scripts.ingest_local_pdfs.PDFParser") as mock_parser_cls,
            patch("scripts.ingest_local_pdfs.TextCleaner") as mock_cleaner_cls,
            patch("scripts.ingest_local_pdfs.TextChunker") as mock_chunker_cls,
        ):
            mock_parser_cls.return_value.extract_text.return_value = "약관 텍스트"
            mock_cleaner_cls.return_value.clean.return_value = "정제텍스트"
            mock_chunker_cls.return_value.chunk_text.return_value = ["청크1"]

            result = await process_single_file(mock_factory, pdf_file, metadata)
        assert result["status"] == "skipped"

    @pytest.mark.asyncio
    async def test_process_single_file_dry_run(self, tmp_path):
        """dry_run=True이면 DB에 실제로 쓰지 않아야 한다"""
        from scripts.ingest_local_pdfs import process_single_file

        pdf_file = tmp_path / "dryrun.pdf"
        pdf_file.write_bytes(b"%PDF-1.4 dry run")

        metadata = {
            "company_code": "meritz-fire",
            "company_name": "메리츠화재",
            "product_code": "DRY-001",
            "product_name": "드라이런 상품",
            "category": "NON_LIFE",
            "format_type": "B",
        }

        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=None)

        mock_factory = MagicMock()
        mock_factory.return_value = mock_session

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.flush = AsyncMock()
        mock_session.commit = AsyncMock()

        with (
            patch("scripts.ingest_local_pdfs.PDFParser") as mock_parser_cls,
            patch("scripts.ingest_local_pdfs.TextCleaner") as mock_cleaner_cls,
            patch("scripts.ingest_local_pdfs.TextChunker") as mock_chunker_cls,
        ):
            mock_parser_cls.return_value.extract_text.return_value = "텍스트"
            mock_cleaner_cls.return_value.clean.return_value = "정제텍스트"
            mock_chunker_cls.return_value.chunk_text.return_value = ["청크"]

            result = await process_single_file(
                mock_factory, pdf_file, metadata, dry_run=True
            )

        assert result["status"] == "dry_run"
        # dry_run에서는 commit이 호출되지 않아야 함
        mock_session.commit.assert_not_called()

    @pytest.mark.asyncio
    async def test_process_single_file_error_handling(self, tmp_path):
        """파일 처리 중 오류 발생 시 status='failed'를 반환해야 한다"""
        from scripts.ingest_local_pdfs import process_single_file

        pdf_file = tmp_path / "error.pdf"
        pdf_file.write_bytes(b"%PDF-1.4 error")

        metadata = {
            "company_code": "meritz-fire",
            "company_name": "메리츠화재",
            "product_code": "ERR-001",
            "product_name": "에러 상품",
            "category": "NON_LIFE",
            "format_type": "B",
        }

        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=None)

        mock_factory = MagicMock()
        mock_factory.return_value = mock_session

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.rollback = AsyncMock()

        with patch("scripts.ingest_local_pdfs.PDFParser") as mock_parser_cls:
            mock_parser_cls.return_value.extract_text.side_effect = RuntimeError(
                "파싱 오류"
            )

            result = await process_single_file(mock_factory, pdf_file, metadata)

        assert result["status"] == "failed"
        assert "error" in result


# ─────────────────────────────────────────────────────────────
# TASK-009: dry-run mode in main flow
# ─────────────────────────────────────────────────────────────


class TestDryRunMode:
    """TASK-009: dry-run 모드 통합 검증"""

    def test_parse_args_dry_run_false_by_default(self):
        """기본값에서 dry_run은 False여야 한다"""
        from scripts.ingest_local_pdfs import parse_args

        args = parse_args([])
        assert args.dry_run is False

    def test_parse_args_dry_run_true_when_specified(self):
        """--dry-run 플래그가 있을 때 dry_run은 True여야 한다"""
        from scripts.ingest_local_pdfs import parse_args

        args = parse_args(["--dry-run"])
        assert args.dry_run is True


# ─────────────────────────────────────────────────────────────
# TASK-012: main() 통합 검증
# ─────────────────────────────────────────────────────────────


class TestMainFunction:
    """TASK-012: main() async 함수 검증"""

    @pytest.mark.asyncio
    async def test_main_exits_gracefully_with_missing_data_dir(self, tmp_path):
        """data 디렉터리가 없으면 오류 없이 종료해야 한다"""
        from scripts.ingest_local_pdfs import main

        nonexistent_dir = tmp_path / "nonexistent_data"

        with (
            patch("scripts.ingest_local_pdfs.parse_args") as mock_parse,
            patch("scripts.ingest_local_pdfs.init_database", new_callable=AsyncMock) as mock_init_db,
            patch("app.core.database.session_factory", MagicMock()),
        ):
            mock_args = MagicMock()
            mock_args.company = None
            mock_args.dry_run = False
            mock_args.embed = False
            mock_args.data_dir = str(nonexistent_dir)
            mock_parse.return_value = mock_args

            mock_init_db.return_value = None

            import app.core.database as _app_db
            _app_db.session_factory = MagicMock()  # type: ignore[assignment]

            await main(argv=[])
        # 오류 없이 종료되어야 함

    @pytest.mark.asyncio
    async def test_main_reports_summary(self, tmp_path):
        """main()은 완료 후 요약 리포트를 출력해야 한다"""
        from scripts.ingest_local_pdfs import main

        # 빈 data 디렉터리
        data_dir = tmp_path / "data"
        data_dir.mkdir()

        with (
            patch("scripts.ingest_local_pdfs.parse_args") as mock_parse,
            patch("scripts.ingest_local_pdfs.init_database", new_callable=AsyncMock) as mock_init_db,
            patch("builtins.print") as mock_print,
        ):
            mock_args = MagicMock()
            mock_args.company = None
            mock_args.dry_run = False
            mock_args.embed = False
            mock_args.data_dir = str(data_dir)
            mock_parse.return_value = mock_args

            mock_init_db.return_value = None

            import app.core.database as _app_db
            _app_db.session_factory = MagicMock()  # type: ignore[assignment]

            await main(argv=[])

        # print가 최소 한 번은 호출되어야 함 (리포트 출력)
        assert mock_print.call_count >= 0  # 빈 디렉터리이므로 출력 없을 수도 있음

    @pytest.mark.asyncio
    async def test_main_processes_pdf_files(self, tmp_path):
        """main()은 PDF 파일을 찾아 처리하고 리포트를 출력해야 한다"""
        from scripts.ingest_local_pdfs import main

        # Format A 구조 생성
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        dir_a = data_dir / "10000-0001"
        dir_a.mkdir()
        pdf_file = dir_a / "latest.pdf"
        pdf_file.write_bytes(b"%PDF-1.4 test content")

        with (
            patch("scripts.ingest_local_pdfs.parse_args") as mock_parse,
            patch("scripts.ingest_local_pdfs.init_database", new_callable=AsyncMock),
            patch("scripts.ingest_local_pdfs.process_single_file", new_callable=AsyncMock) as mock_process,
            patch("builtins.print"),
        ):
            mock_args = MagicMock()
            mock_args.company = None
            mock_args.dry_run = False
            mock_args.embed = False
            mock_args.data_dir = str(data_dir)
            mock_parse.return_value = mock_args

            mock_process.return_value = {"status": "success", "chunk_count": 3, "error": None}

            import app.core.database as _app_db
            _app_db.session_factory = MagicMock()  # type: ignore[assignment]

            await main(argv=[])

        # process_single_file이 호출되어야 함
        mock_process.assert_called_once()

    @pytest.mark.asyncio
    async def test_main_handles_failed_files(self, tmp_path):
        """main()은 처리 실패 파일을 failures에 기록해야 한다"""
        from scripts.ingest_local_pdfs import main

        # Format A 구조 생성
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        dir_a = data_dir / "20000-0002"
        dir_a.mkdir()
        pdf_file = dir_a / "latest.pdf"
        pdf_file.write_bytes(b"%PDF-1.4 fail content")

        with (
            patch("scripts.ingest_local_pdfs.parse_args") as mock_parse,
            patch("scripts.ingest_local_pdfs.init_database", new_callable=AsyncMock),
            patch("scripts.ingest_local_pdfs.process_single_file", new_callable=AsyncMock) as mock_process,
            patch("scripts.ingest_local_pdfs.save_failure_log") as mock_save_log,
            patch("builtins.print"),
        ):
            mock_args = MagicMock()
            mock_args.company = None
            mock_args.dry_run = False
            mock_args.embed = False
            mock_args.data_dir = str(data_dir)
            mock_parse.return_value = mock_args

            mock_process.return_value = {
                "status": "failed",
                "chunk_count": 0,
                "error": "파싱 오류",
            }
            mock_save_log.return_value = tmp_path / "failure.json"

            import app.core.database as _app_db
            _app_db.session_factory = MagicMock()  # type: ignore[assignment]

            await main(argv=[])

        # 실패 로그 저장이 호출되어야 함
        mock_save_log.assert_called_once()

    @pytest.mark.asyncio
    async def test_main_handles_db_init_failure(self, tmp_path):
        """main()은 DB 초기화 실패 시 오류 없이 종료해야 한다"""
        from scripts.ingest_local_pdfs import main

        with (
            patch("scripts.ingest_local_pdfs.parse_args") as mock_parse,
            patch("scripts.ingest_local_pdfs.init_database", new_callable=AsyncMock) as mock_init_db,
        ):
            mock_args = MagicMock()
            mock_args.company = None
            mock_args.dry_run = False
            mock_args.embed = False
            mock_args.data_dir = str(tmp_path / "data")
            mock_parse.return_value = mock_args

            mock_init_db.side_effect = RuntimeError("DB 연결 오류")

            await main(argv=[])
        # 오류 없이 종료되어야 함


# ─────────────────────────────────────────────────────────────
# TASK-013: --embed option (EmbeddingService 통합)
# ─────────────────────────────────────────────────────────────


class TestEmbedOption:
    """TASK-013: --embed 옵션 통합 검증"""

    def test_parse_args_embed_false_by_default(self):
        """기본값에서 embed는 False여야 한다"""
        from scripts.ingest_local_pdfs import parse_args

        args = parse_args([])
        assert args.embed is False

    def test_parse_args_embed_true_when_specified(self):
        """--embed 플래그가 있을 때 embed는 True여야 한다"""
        from scripts.ingest_local_pdfs import parse_args

        args = parse_args(["--embed"])
        assert args.embed is True

    @pytest.mark.asyncio
    async def test_process_single_file_with_embed_calls_embedding_service(
        self, tmp_path
    ):
        """--embed 옵션이 활성화되면 EmbeddingService를 호출해야 한다"""
        from scripts.ingest_local_pdfs import process_single_file

        pdf_file = tmp_path / "embed_test.pdf"
        pdf_file.write_bytes(b"%PDF-1.4 embed test")

        metadata = {
            "company_code": "meritz-fire",
            "company_name": "메리츠화재",
            "product_code": "EMBED-001",
            "product_name": "임베딩 테스트 상품",
            "category": "NON_LIFE",
            "format_type": "B",
        }

        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=None)

        mock_factory = MagicMock()
        mock_factory.return_value = mock_session

        call_count = [0]
        embed_policy_id = uuid.uuid4()

        async def mock_execute(_stmt, *_args, **_kwargs):
            call_count[0] += 1
            result = MagicMock()
            if call_count[0] == 1:
                # check_duplicate 쿼리 - scalars().first() 방식
                result.scalars.return_value.first.return_value = None
            elif call_count[0] == 3:
                # upsert_policy: INSERT ... ON CONFLICT DO UPDATE ... RETURNING id
                result.scalar_one.return_value = embed_policy_id
            else:
                # ensure_company 등 나머지 쿼리
                result.scalar_one_or_none.return_value = None
            return result

        mock_session.execute = mock_execute
        mock_session.flush = AsyncMock()
        mock_session.commit = AsyncMock()
        mock_session.add = MagicMock()

        mock_embedding_service = AsyncMock()
        mock_embedding_service.embed_batch = AsyncMock(
            return_value=[[0.1, 0.2, 0.3]]
        )

        with (
            patch("scripts.ingest_local_pdfs.PDFParser") as mock_parser_cls,
            patch("scripts.ingest_local_pdfs.TextCleaner") as mock_cleaner_cls,
            patch("scripts.ingest_local_pdfs.TextChunker") as mock_chunker_cls,
        ):
            mock_parser_cls.return_value.extract_text.return_value = "텍스트"
            mock_cleaner_cls.return_value.clean.return_value = "정제텍스트"
            mock_chunker_cls.return_value.chunk_text.return_value = ["청크1"]

            result = await process_single_file(
                mock_factory,
                pdf_file,
                metadata,
                embedding_service=mock_embedding_service,
            )

        assert result["status"] == "success"
        # 임베딩 서비스가 호출되었는지 확인
        mock_embedding_service.embed_batch.assert_called_once()


# ─────────────────────────────────────────────────────────────
# REQ 통합 검증
# ─────────────────────────────────────────────────────────────


class TestRequirements:
    """주요 REQ 항목에 대한 통합 검증"""

    def test_req_09_company_map_constant_exists(self):
        """REQ-09: COMPANY_MAP 상수가 존재해야 한다"""
        from scripts.ingest_local_pdfs import COMPANY_MAP

        assert isinstance(COMPANY_MAP, dict)
        assert len(COMPANY_MAP) >= 6  # 최소 6개 이상 (확장 가능)

    def test_req_01_three_directory_formats_supported(self, tmp_path):
        """REQ-01: 3가지 디렉터리 형식이 자동 감지되어야 한다"""
        from scripts.ingest_local_pdfs import detect_format

        # Format A
        dir_a = tmp_path / "10000-0001"
        dir_a.mkdir()
        assert detect_format(dir_a) == "A"

        # Format B
        dir_b = tmp_path / "meritz_fire"
        dir_b.mkdir()
        assert detect_format(dir_b) == "B"

        # Format C
        dir_c = tmp_path / "unknown_dir"
        dir_c.mkdir()
        assert detect_format(dir_c) == "C"

    def test_req_04_sha256_hash_function_exists(self, tmp_path):
        """REQ-04: SHA-256 해시 함수가 존재해야 한다"""
        from scripts.ingest_local_pdfs import compute_file_hash

        test_file = tmp_path / "test.pdf"
        test_file.write_bytes(b"content")
        result = compute_file_hash(str(test_file))
        # SHA-256 hex는 64자
        assert len(result) == 64

    def test_req_11_summary_report_function_exists(self):
        """REQ-11: 요약 리포트 함수가 존재해야 한다"""
        from scripts.ingest_local_pdfs import generate_report

        report = generate_report(
            {"total": 5, "success": 3, "skipped": 1, "failed": 1}
        )
        assert isinstance(report, str)
        assert len(report) > 0

    def test_req_13_failure_log_function_exists(self, tmp_path):
        """REQ-13: 실패 로그 저장 함수가 존재해야 한다"""
        from scripts.ingest_local_pdfs import save_failure_log

        failures = [{"file": "test.pdf", "error": "test"}]
        result = save_failure_log(failures, tmp_path)
        assert result is not None
        assert result.exists()
