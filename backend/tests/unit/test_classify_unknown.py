"""klia-unknown PDF 분류 스크립트 테스트 (SPEC-CRAWL-001, TASK-009/010)

RED 단계: classify_unknown.py 구현 전에 먼저 실패해야 하는 테스트들.
"""
from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


# =============================================================================
# extract_company_from_pdf 함수 테스트
# =============================================================================

class TestExtractCompanyFromPdf:
    """PDF에서 회사명 추출 함수 검증"""

    def test_returns_none_for_nonexistent_file(self, tmp_path: Path) -> None:
        """존재하지 않는 파일에 대해 None을 반환해야 한다"""
        from scripts.classify_unknown import extract_company_from_pdf
        result = extract_company_from_pdf(tmp_path / "nonexistent.pdf")
        assert result is None

    def test_returns_company_id_when_found(self, tmp_path: Path) -> None:
        """PDF 텍스트에서 회사명을 찾으면 company_id를 반환해야 한다"""
        from scripts.classify_unknown import extract_company_from_pdf

        # pdfplumber를 모킹하여 삼성생명 텍스트를 반환하도록 설정
        pdf_path = tmp_path / "test.pdf"
        pdf_path.write_bytes(b"%PDF-1.4 fake pdf content")

        mock_page = MagicMock()
        mock_page.extract_text.return_value = "삼성생명 건강보험 약관 제1조 피보험자"

        mock_pdf = MagicMock()
        mock_pdf.__enter__ = MagicMock(return_value=mock_pdf)
        mock_pdf.__exit__ = MagicMock(return_value=False)
        mock_pdf.pages = [mock_page, mock_page]

        with patch("pdfplumber.open", return_value=mock_pdf):
            result = extract_company_from_pdf(pdf_path)

        assert result == "samsung_life"

    def test_returns_none_when_no_match(self, tmp_path: Path) -> None:
        """회사명이 없으면 None을 반환해야 한다"""
        from scripts.classify_unknown import extract_company_from_pdf

        pdf_path = tmp_path / "unknown.pdf"
        pdf_path.write_bytes(b"%PDF-1.4 fake pdf content")

        mock_page = MagicMock()
        mock_page.extract_text.return_value = "일반적인 보험 약관 내용입니다."

        mock_pdf = MagicMock()
        mock_pdf.__enter__ = MagicMock(return_value=mock_pdf)
        mock_pdf.__exit__ = MagicMock(return_value=False)
        mock_pdf.pages = [mock_page]

        with patch("pdfplumber.open", return_value=mock_pdf):
            result = extract_company_from_pdf(pdf_path)

        assert result is None

    def test_reads_only_first_two_pages(self, tmp_path: Path) -> None:
        """PDF의 첫 2페이지만 읽어야 한다 (extract_text 호출 횟수 기준)"""
        from scripts.classify_unknown import extract_company_from_pdf

        pdf_path = tmp_path / "test.pdf"
        pdf_path.write_bytes(b"%PDF-1.4 fake pdf content")

        extract_text_calls = []

        class FakePage:
            def __init__(self, idx: int) -> None:
                self.idx = idx

            def extract_text(self) -> str:
                extract_text_calls.append(self.idx)
                return f"페이지 {self.idx} 내용"

        mock_pdf = MagicMock()
        mock_pdf.__enter__ = MagicMock(return_value=mock_pdf)
        mock_pdf.__exit__ = MagicMock(return_value=False)
        mock_pdf.pages = [FakePage(0), FakePage(1), FakePage(2), FakePage(3)]

        with patch("pdfplumber.open", return_value=mock_pdf):
            extract_company_from_pdf(pdf_path)

        # extract_text가 2번 이하 호출되어야 한다
        assert len(extract_text_calls) <= 2

    def test_handles_pdfplumber_exception(self, tmp_path: Path) -> None:
        """pdfplumber 오류 시 None을 반환해야 한다"""
        from scripts.classify_unknown import extract_company_from_pdf

        pdf_path = tmp_path / "broken.pdf"
        pdf_path.write_bytes(b"not a pdf")

        with patch("pdfplumber.open", side_effect=Exception("PDF 파싱 오류")):
            result = extract_company_from_pdf(pdf_path)

        assert result is None

    def test_handles_none_text(self, tmp_path: Path) -> None:
        """페이지 텍스트가 None일 때도 처리해야 한다"""
        from scripts.classify_unknown import extract_company_from_pdf

        pdf_path = tmp_path / "image_pdf.pdf"
        pdf_path.write_bytes(b"%PDF-1.4 fake pdf content")

        mock_page = MagicMock()
        mock_page.extract_text.return_value = None

        mock_pdf = MagicMock()
        mock_pdf.__enter__ = MagicMock(return_value=mock_pdf)
        mock_pdf.__exit__ = MagicMock(return_value=False)
        mock_pdf.pages = [mock_page]

        with patch("pdfplumber.open", return_value=mock_pdf):
            result = extract_company_from_pdf(pdf_path)

        assert result is None

    def test_extracts_nonlife_company(self, tmp_path: Path) -> None:
        """손해보험사도 정확히 추출해야 한다"""
        from scripts.classify_unknown import extract_company_from_pdf

        pdf_path = tmp_path / "nonlife.pdf"
        pdf_path.write_bytes(b"%PDF-1.4 fake pdf content")

        mock_page = MagicMock()
        mock_page.extract_text.return_value = "현대해상화재보험 상해보험 약관"

        mock_pdf = MagicMock()
        mock_pdf.__enter__ = MagicMock(return_value=mock_pdf)
        mock_pdf.__exit__ = MagicMock(return_value=False)
        mock_pdf.pages = [mock_page]

        with patch("pdfplumber.open", return_value=mock_pdf):
            result = extract_company_from_pdf(pdf_path)

        assert result == "hyundai_marine"


# =============================================================================
# classify_file 함수 테스트
# =============================================================================

class TestClassifyFile:
    """PDF 파일 분류 및 이동 함수 검증"""

    def test_classify_copies_file_to_correct_dir(self, tmp_path: Path) -> None:
        """분류된 파일을 올바른 company_id 디렉토리에 복사해야 한다"""
        from scripts.classify_unknown import classify_file

        # 소스 파일 생성
        src_path = tmp_path / "unknown" / "klia-10-samsung.pdf"
        src_path.parent.mkdir(parents=True)
        src_path.write_bytes(b"%PDF-1.4 samsung content")

        base_dir = tmp_path / "data"
        base_dir.mkdir()

        mock_page = MagicMock()
        mock_page.extract_text.return_value = "삼성생명 건강보험 약관"

        mock_pdf = MagicMock()
        mock_pdf.__enter__ = MagicMock(return_value=mock_pdf)
        mock_pdf.__exit__ = MagicMock(return_value=False)
        mock_pdf.pages = [mock_page]

        with patch("pdfplumber.open", return_value=mock_pdf):
            result = classify_file(src_path, base_dir)

        assert result is not None
        assert result["company_id"] == "samsung_life"
        dest_path = base_dir / "samsung_life" / src_path.name
        assert dest_path.exists()

    def test_classify_preserves_original_file(self, tmp_path: Path) -> None:
        """원본 파일을 삭제하지 않고 보존해야 한다 (복사, 이동 아님)"""
        from scripts.classify_unknown import classify_file

        src_path = tmp_path / "unknown" / "klia-10-test.pdf"
        src_path.parent.mkdir(parents=True)
        src_path.write_bytes(b"%PDF-1.4 samsung content")

        base_dir = tmp_path / "data"
        base_dir.mkdir()

        mock_page = MagicMock()
        mock_page.extract_text.return_value = "삼성생명 건강보험"

        mock_pdf = MagicMock()
        mock_pdf.__enter__ = MagicMock(return_value=mock_pdf)
        mock_pdf.__exit__ = MagicMock(return_value=False)
        mock_pdf.pages = [mock_page]

        with patch("pdfplumber.open", return_value=mock_pdf):
            classify_file(src_path, base_dir)

        # 원본이 여전히 존재해야 한다
        assert src_path.exists()

    def test_classify_returns_none_when_no_match(self, tmp_path: Path) -> None:
        """회사명 매칭 실패 시 None을 반환해야 한다"""
        from scripts.classify_unknown import classify_file

        src_path = tmp_path / "unknown" / "unknown.pdf"
        src_path.parent.mkdir(parents=True)
        src_path.write_bytes(b"%PDF-1.4 unknown content")

        base_dir = tmp_path / "data"
        base_dir.mkdir()

        mock_page = MagicMock()
        mock_page.extract_text.return_value = "알 수 없는 내용입니다"

        mock_pdf = MagicMock()
        mock_pdf.__enter__ = MagicMock(return_value=mock_pdf)
        mock_pdf.__exit__ = MagicMock(return_value=False)
        mock_pdf.pages = [mock_page]

        with patch("pdfplumber.open", return_value=mock_pdf):
            result = classify_file(src_path, base_dir)

        assert result is None

    def test_classify_creates_metadata_json(self, tmp_path: Path) -> None:
        """분류된 파일에 대해 메타데이터 JSON을 생성해야 한다"""
        from scripts.classify_unknown import classify_file

        src_path = tmp_path / "unknown" / "klia-101-db.pdf"
        src_path.parent.mkdir(parents=True)
        src_path.write_bytes(b"%PDF-1.4 DB life content")

        base_dir = tmp_path / "data"
        base_dir.mkdir()

        mock_page = MagicMock()
        mock_page.extract_text.return_value = "DB생명 건강보험 약관"

        mock_pdf = MagicMock()
        mock_pdf.__enter__ = MagicMock(return_value=mock_pdf)
        mock_pdf.__exit__ = MagicMock(return_value=False)
        mock_pdf.pages = [mock_page]

        with patch("pdfplumber.open", return_value=mock_pdf):
            result = classify_file(src_path, base_dir)

        assert result is not None
        dest_pdf = base_dir / "db_life" / src_path.name
        meta_json = dest_pdf.with_suffix(".json")
        assert meta_json.exists()


# =============================================================================
# generate_classification_report 함수 테스트
# =============================================================================

class TestGenerateClassificationReport:
    """분류 결과 리포트 생성 함수 검증"""

    def test_report_has_required_fields(self, tmp_path: Path) -> None:
        """리포트에 필수 필드가 있어야 한다"""
        from scripts.classify_unknown import generate_classification_report

        classified = [
            {"company_id": "samsung_life", "src_file": "a.pdf"},
            {"company_id": "samsung_life", "src_file": "b.pdf"},
            {"company_id": "hyundai_marine", "src_file": "c.pdf"},
        ]
        unclassified = ["x.pdf", "y.pdf"]

        output_path = tmp_path / "report.json"
        generate_classification_report(classified, unclassified, output_path)

        assert output_path.exists()
        report = json.loads(output_path.read_text(encoding="utf-8"))

        assert "total_files" in report
        assert "classified_count" in report
        assert "unclassified_count" in report
        assert "by_company" in report
        assert "unclassified_files" in report

    def test_report_counts_correctly(self, tmp_path: Path) -> None:
        """리포트가 분류 결과를 정확하게 집계해야 한다"""
        from scripts.classify_unknown import generate_classification_report

        classified = [
            {"company_id": "samsung_life", "src_file": "a.pdf"},
            {"company_id": "samsung_life", "src_file": "b.pdf"},
            {"company_id": "hyundai_marine", "src_file": "c.pdf"},
        ]
        unclassified = ["x.pdf", "y.pdf"]

        output_path = tmp_path / "report.json"
        generate_classification_report(classified, unclassified, output_path)

        report = json.loads(output_path.read_text(encoding="utf-8"))

        assert report["total_files"] == 5
        assert report["classified_count"] == 3
        assert report["unclassified_count"] == 2
        assert report["by_company"]["samsung_life"] == 2
        assert report["by_company"]["hyundai_marine"] == 1
