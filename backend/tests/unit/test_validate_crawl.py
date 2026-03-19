"""크롤링 완료 검증 스크립트 테스트 (SPEC-CRAWL-001, TASK-011/012)

RED 단계: validate_crawl.py 구현 전에 먼저 실패해야 하는 테스트들.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest


# =============================================================================
# get_company_stats 함수 테스트
# =============================================================================

class TestGetCompanyStats:
    """회사별 PDF 통계 수집 함수 검증"""

    def test_returns_dict_with_company_counts(self, tmp_path: Path) -> None:
        """회사별 PDF 수를 담은 dict를 반환해야 한다"""
        from scripts.validate_crawl import get_company_stats

        # 가상의 데이터 디렉토리 구조 생성
        samsung = tmp_path / "samsung_life"
        samsung.mkdir()
        (samsung / "product1.pdf").write_bytes(b"%PDF test")
        (samsung / "product2.pdf").write_bytes(b"%PDF test")

        hyundai = tmp_path / "hyundai_marine"
        hyundai.mkdir()
        (hyundai / "product1.pdf").write_bytes(b"%PDF test")

        stats = get_company_stats(tmp_path)

        assert isinstance(stats, dict)
        assert stats.get("samsung_life") == 2
        assert stats.get("hyundai_marine") == 1

    def test_ignores_non_directory_entries(self, tmp_path: Path) -> None:
        """파일 항목을 무시하고 디렉토리만 처리해야 한다"""
        from scripts.validate_crawl import get_company_stats

        samsung = tmp_path / "samsung_life"
        samsung.mkdir()
        (samsung / "product.pdf").write_bytes(b"%PDF test")

        # 최상위 레벨에 파일 (메타데이터 등) 추가
        (tmp_path / "crawl_validation_report.json").write_text("{}", encoding="utf-8")

        stats = get_company_stats(tmp_path)

        # 파일은 회사 통계에 포함되지 않아야 한다
        assert "crawl_validation_report" not in stats
        assert stats.get("samsung_life") == 1

    def test_counts_only_pdf_files(self, tmp_path: Path) -> None:
        """PDF 파일만 카운트해야 한다 (JSON, txt 제외)"""
        from scripts.validate_crawl import get_company_stats

        samsung = tmp_path / "samsung_life"
        samsung.mkdir()
        (samsung / "product1.pdf").write_bytes(b"%PDF test")
        (samsung / "metadata.json").write_text("{}", encoding="utf-8")
        (samsung / "readme.txt").write_text("readme", encoding="utf-8")

        stats = get_company_stats(tmp_path)

        assert stats.get("samsung_life") == 1

    def test_empty_directory_has_zero_count(self, tmp_path: Path) -> None:
        """PDF가 없는 회사 디렉토리는 0으로 집계해야 한다"""
        from scripts.validate_crawl import get_company_stats

        empty_dir = tmp_path / "db_life"
        empty_dir.mkdir()

        stats = get_company_stats(tmp_path)

        assert stats.get("db_life") == 0

    def test_returns_empty_dict_for_empty_base_dir(self, tmp_path: Path) -> None:
        """빈 기본 디렉토리에 대해 빈 dict를 반환해야 한다"""
        from scripts.validate_crawl import get_company_stats

        stats = get_company_stats(tmp_path)
        assert isinstance(stats, dict)
        assert len(stats) == 0


# =============================================================================
# check_completion 함수 테스트
# =============================================================================

class TestCheckCompletion:
    """완료 여부 검사 함수 검증"""

    def test_returns_list_of_missing_companies(self) -> None:
        """PDF가 없는 회사 목록을 반환해야 한다"""
        from scripts.validate_crawl import check_completion

        stats = {
            "samsung_life": 5,
            "hanwha_life": 3,
            "kyobo_life": 0,  # 없음
            "samsung_fire": 2,
        }

        missing = check_completion(stats)

        assert isinstance(missing, list)
        assert "kyobo_life" in missing

    def test_no_missing_when_all_have_pdfs(self) -> None:
        """모든 회사에 PDF가 있으면 빈 목록을 반환해야 한다"""
        from scripts.validate_crawl import check_completion

        # LIFE_COMPANY_IDS + NONLIFE_COMPANY_IDS의 모든 회사가 있는 경우
        from scripts.crawl_constants import LIFE_COMPANY_IDS, NONLIFE_COMPANY_IDS
        stats = {cid: 1 for cid in LIFE_COMPANY_IDS + NONLIFE_COMPANY_IDS}

        missing = check_completion(stats)
        assert missing == []

    def test_companies_not_in_expected_list_ignored(self) -> None:
        """예상 목록에 없는 회사는 missing 체크에서 무시해야 한다"""
        from scripts.validate_crawl import check_completion

        # 알 수 없는 회사가 stats에 있어도 missing 판단에 영향 없어야 함
        stats = {
            "unknown_company": 5,
        }
        # 모든 예상 회사가 없으므로 missing이 있어야 한다
        missing = check_completion(stats)
        assert len(missing) > 0


# =============================================================================
# generate_report 함수 테스트
# =============================================================================

class TestGenerateReport:
    """완료 검증 리포트 생성 함수 검증"""

    def test_creates_json_report_file(self, tmp_path: Path) -> None:
        """JSON 리포트 파일을 생성해야 한다"""
        from scripts.validate_crawl import generate_report

        stats = {"samsung_life": 3, "hyundai_marine": 2}
        output_path = tmp_path / "report.json"

        generate_report(stats, output_path)

        assert output_path.exists()

    def test_report_has_required_fields(self, tmp_path: Path) -> None:
        """리포트에 필수 필드가 있어야 한다"""
        from scripts.validate_crawl import generate_report

        stats = {"samsung_life": 3, "hyundai_marine": 0}
        output_path = tmp_path / "report.json"
        generate_report(stats, output_path)

        report = json.loads(output_path.read_text(encoding="utf-8"))

        assert "generated_at" in report
        assert "total_companies_expected" in report
        assert "total_companies_with_data" in report
        assert "missing_companies" in report
        assert "company_stats" in report
        assert "verdict" in report

    def test_verdict_pass_when_all_companies_have_data(self, tmp_path: Path) -> None:
        """모든 회사에 데이터가 있으면 verdict가 PASS여야 한다"""
        from scripts.crawl_constants import LIFE_COMPANY_IDS, NONLIFE_COMPANY_IDS
        from scripts.validate_crawl import generate_report

        stats = {cid: 1 for cid in LIFE_COMPANY_IDS + NONLIFE_COMPANY_IDS}
        output_path = tmp_path / "report.json"
        generate_report(stats, output_path)

        report = json.loads(output_path.read_text(encoding="utf-8"))
        assert report["verdict"] == "PASS"

    def test_verdict_fail_when_companies_missing(self, tmp_path: Path) -> None:
        """데이터가 없는 회사가 있으면 verdict가 FAIL이어야 한다"""
        from scripts.validate_crawl import generate_report

        stats = {"samsung_life": 3}  # 대부분 회사 데이터 없음
        output_path = tmp_path / "report.json"
        generate_report(stats, output_path)

        report = json.loads(output_path.read_text(encoding="utf-8"))
        assert report["verdict"] == "FAIL"

    def test_report_includes_per_company_details(self, tmp_path: Path) -> None:
        """리포트에 회사별 상세 정보가 있어야 한다"""
        from scripts.validate_crawl import generate_report

        stats = {"samsung_life": 5, "hyundai_marine": 3}
        output_path = tmp_path / "report.json"
        generate_report(stats, output_path)

        report = json.loads(output_path.read_text(encoding="utf-8"))
        assert "samsung_life" in report["company_stats"]
        assert report["company_stats"]["samsung_life"]["pdf_count"] == 5
