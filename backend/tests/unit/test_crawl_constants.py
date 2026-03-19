"""크롤링 공통 상수 모듈 테스트 (SPEC-CRAWL-001, TASK-001/002)

RED 단계: crawl_constants.py 구현 전에 먼저 실패해야 하는 테스트들.
"""
from __future__ import annotations

import hashlib
import json
import tempfile
from pathlib import Path

import pytest


# =============================================================================
# COMPANY_NAME_MAP 상수 테스트
# =============================================================================

class TestCompanyNameMap:
    """회사명 매핑 상수 검증"""

    def test_company_name_map_exists(self) -> None:
        """COMPANY_NAME_MAP이 존재해야 한다"""
        from scripts.crawl_constants import COMPANY_NAME_MAP
        assert isinstance(COMPANY_NAME_MAP, dict)

    def test_company_name_map_has_30_plus_unique_ids(self) -> None:
        """COMPANY_NAME_MAP은 30개 이상의 고유 company_id를 포함해야 한다"""
        from scripts.crawl_constants import COMPANY_NAME_MAP
        unique_ids = set(COMPANY_NAME_MAP.values())
        assert len(unique_ids) >= 30, f"고유 company_id 수: {len(unique_ids)}, 기대: 30+"

    def test_life_company_ids_has_22_entries(self) -> None:
        """LIFE_COMPANY_IDS는 22개 항목(18개 공식 + 4개 레거시)을 포함해야 한다"""
        from scripts.crawl_constants import LIFE_COMPANY_IDS
        assert len(LIFE_COMPANY_IDS) == 22, f"생명보험사 ID 수: {len(LIFE_COMPANY_IDS)}, 기대: 22"

    def test_nonlife_company_ids_has_12_entries(self) -> None:
        """NONLIFE_COMPANY_IDS는 12개 항목을 포함해야 한다"""
        from scripts.crawl_constants import NONLIFE_COMPANY_IDS
        assert len(NONLIFE_COMPANY_IDS) == 12, f"손해보험사 ID 수: {len(NONLIFE_COMPANY_IDS)}, 기대: 12"

    def test_samsung_life_mapping(self) -> None:
        """삼성생명 → samsung_life 매핑이 있어야 한다"""
        from scripts.crawl_constants import COMPANY_NAME_MAP
        assert COMPANY_NAME_MAP.get("삼성생명") == "samsung_life"
        assert COMPANY_NAME_MAP.get("삼성생명보험") == "samsung_life"

    def test_samsung_fire_mapping(self) -> None:
        """삼성화재 → samsung_fire 매핑이 있어야 한다"""
        from scripts.crawl_constants import COMPANY_NAME_MAP
        assert COMPANY_NAME_MAP.get("삼성화재") == "samsung_fire"

    def test_all_life_company_ids_in_map_values(self) -> None:
        """LIFE_COMPANY_IDS의 모든 ID가 COMPANY_NAME_MAP 값에 포함되어야 한다"""
        from scripts.crawl_constants import COMPANY_NAME_MAP, LIFE_COMPANY_IDS
        map_values = set(COMPANY_NAME_MAP.values())
        for cid in LIFE_COMPANY_IDS:
            assert cid in map_values, f"{cid}가 COMPANY_NAME_MAP 값에 없음"

    def test_all_nonlife_company_ids_in_map_values(self) -> None:
        """NONLIFE_COMPANY_IDS의 모든 ID가 COMPANY_NAME_MAP 값에 포함되어야 한다"""
        from scripts.crawl_constants import COMPANY_NAME_MAP, NONLIFE_COMPANY_IDS
        map_values = set(COMPANY_NAME_MAP.values())
        for cid in NONLIFE_COMPANY_IDS:
            assert cid in map_values, f"{cid}가 COMPANY_NAME_MAP 값에 없음"

    def test_disease_injury_include_keywords(self) -> None:
        """질병/상해 포함 키워드 상수가 있어야 한다"""
        from scripts.crawl_constants import DISEASE_INJURY_INCLUDE
        assert isinstance(DISEASE_INJURY_INCLUDE, list)
        assert "질병" in DISEASE_INJURY_INCLUDE
        assert "상해" in DISEASE_INJURY_INCLUDE

    def test_disease_injury_exclude_keywords(self) -> None:
        """질병/상해 제외 키워드 상수가 있어야 한다"""
        from scripts.crawl_constants import DISEASE_INJURY_EXCLUDE
        assert isinstance(DISEASE_INJURY_EXCLUDE, list)
        assert "자동차" in DISEASE_INJURY_EXCLUDE


# =============================================================================
# normalize_company_name 함수 테스트
# =============================================================================

class TestNormalizeCompanyName:
    """회사명 정규화 함수 검증"""

    def test_normalize_samsung_life(self) -> None:
        """삼성생명 → samsung_life"""
        from scripts.crawl_constants import normalize_company_name
        assert normalize_company_name("삼성생명") == "samsung_life"

    def test_normalize_samsung_life_full(self) -> None:
        """삼성생명보험 → samsung_life"""
        from scripts.crawl_constants import normalize_company_name
        assert normalize_company_name("삼성생명보험") == "samsung_life"

    def test_normalize_samsung_fire(self) -> None:
        """삼성화재 → samsung_fire"""
        from scripts.crawl_constants import normalize_company_name
        assert normalize_company_name("삼성화재") == "samsung_fire"

    def test_normalize_hyundai_marine(self) -> None:
        """현대해상 → hyundai_marine"""
        from scripts.crawl_constants import normalize_company_name
        assert normalize_company_name("현대해상") == "hyundai_marine"

    def test_normalize_unknown_returns_none(self) -> None:
        """알 수 없는 회사명은 None을 반환해야 한다"""
        from scripts.crawl_constants import normalize_company_name
        result = normalize_company_name("알수없는보험사")
        assert result is None

    def test_normalize_with_whitespace(self) -> None:
        """앞뒤 공백이 있어도 정상 처리해야 한다"""
        from scripts.crawl_constants import normalize_company_name
        assert normalize_company_name("  삼성생명  ") == "samsung_life"

    def test_normalize_nh_life(self) -> None:
        """NH농협생명 / 농협생명 → nh_life"""
        from scripts.crawl_constants import normalize_company_name
        assert normalize_company_name("NH농협생명") == "nh_life"
        assert normalize_company_name("농협생명") == "nh_life"

    def test_normalize_db_insurance(self) -> None:
        """DB손해보험 / DB손보 → db_insurance"""
        from scripts.crawl_constants import normalize_company_name
        assert normalize_company_name("DB손해보험") == "db_insurance"
        assert normalize_company_name("DB손보") == "db_insurance"


# =============================================================================
# is_disease_injury_product 함수 테스트
# =============================================================================

class TestIsDiseaseInjuryProduct:
    """질병/상해 상품 필터 함수 검증"""

    def test_disease_product_passes(self) -> None:
        """질병 포함 상품명은 True를 반환해야 한다"""
        from scripts.crawl_constants import is_disease_injury_product
        assert is_disease_injury_product("무배당 삼성생명 질병보험") is True

    def test_injury_product_passes(self) -> None:
        """상해 포함 상품명은 True를 반환해야 한다"""
        from scripts.crawl_constants import is_disease_injury_product
        assert is_disease_injury_product("현대해상 상해보험") is True

    def test_health_product_passes(self) -> None:
        """건강 포함 상품명은 True를 반환해야 한다"""
        from scripts.crawl_constants import is_disease_injury_product
        assert is_disease_injury_product("삼성생명 건강보험") is True

    def test_cancer_product_passes(self) -> None:
        """암 포함 상품명은 True를 반환해야 한다"""
        from scripts.crawl_constants import is_disease_injury_product
        assert is_disease_injury_product("한화생명 암보험") is True

    def test_real손_product_passes(self) -> None:
        """실손 포함 상품명은 True를 반환해야 한다"""
        from scripts.crawl_constants import is_disease_injury_product
        assert is_disease_injury_product("KB손해보험 실손의료보험") is True

    def test_car_insurance_excluded(self) -> None:
        """자동차보험은 False를 반환해야 한다"""
        from scripts.crawl_constants import is_disease_injury_product
        assert is_disease_injury_product("삼성화재 자동차보험") is False

    def test_fire_insurance_excluded(self) -> None:
        """화재보험은 False를 반환해야 한다"""
        from scripts.crawl_constants import is_disease_injury_product
        assert is_disease_injury_product("현대해상 화재보험") is False

    def test_empty_product_name(self) -> None:
        """빈 상품명은 False를 반환해야 한다"""
        from scripts.crawl_constants import is_disease_injury_product
        assert is_disease_injury_product("") is False

    def test_exclude_overrides_include(self) -> None:
        """제외 키워드가 포함 키워드보다 우선해야 한다 (예: 자동차 상해보험)"""
        from scripts.crawl_constants import is_disease_injury_product
        # 자동차보험이면서 상해 포함 → 제외 키워드 우선
        result = is_disease_injury_product("운전자 자동차 상해보험")
        assert result is False

    def test_ci_product_passes(self) -> None:
        """CI 포함 상품명은 True를 반환해야 한다"""
        from scripts.crawl_constants import is_disease_injury_product
        assert is_disease_injury_product("삼성생명 CI보험") is True


# =============================================================================
# save_pdf_with_metadata 함수 테스트
# =============================================================================

class TestSavePdfWithMetadata:
    """PDF 저장 및 메타데이터 생성 함수 검증"""

    def test_save_pdf_creates_file(self, tmp_path: Path) -> None:
        """PDF 데이터를 파일로 저장해야 한다"""
        from scripts.crawl_constants import save_pdf_with_metadata
        pdf_data = b"%PDF-1.4 test content for bodam"
        result = save_pdf_with_metadata(
            data=pdf_data,
            company_id="samsung_life",
            company_name="삼성생명",
            product_name="삼성생명 건강보험",
            product_type="질병보험",
            source_url="https://pub.insure.or.kr/test.pdf",
            base_dir=tmp_path,
        )
        assert result is not None
        assert Path(result["file_path"]).exists()

    def test_save_pdf_creates_metadata_json(self, tmp_path: Path) -> None:
        """메타데이터 JSON 파일을 생성해야 한다"""
        from scripts.crawl_constants import save_pdf_with_metadata
        pdf_data = b"%PDF-1.4 test content"
        result = save_pdf_with_metadata(
            data=pdf_data,
            company_id="samsung_life",
            company_name="삼성생명",
            product_name="삼성생명 건강보험",
            product_type="질병보험",
            source_url="https://pub.insure.or.kr/test.pdf",
            base_dir=tmp_path,
        )
        meta_path = Path(result["file_path"]).with_suffix(".json")
        assert meta_path.exists()

    def test_metadata_json_structure(self, tmp_path: Path) -> None:
        """메타데이터 JSON이 올바른 구조를 가져야 한다"""
        from scripts.crawl_constants import save_pdf_with_metadata
        pdf_data = b"%PDF-1.4 test content"
        result = save_pdf_with_metadata(
            data=pdf_data,
            company_id="samsung_life",
            company_name="삼성생명",
            product_name="삼성생명 건강보험",
            product_type="질병보험",
            source_url="https://pub.insure.or.kr/test.pdf",
            base_dir=tmp_path,
        )
        meta_path = Path(result["file_path"]).with_suffix(".json")
        meta = json.loads(meta_path.read_text(encoding="utf-8"))

        assert meta["company_id"] == "samsung_life"
        assert meta["company_name"] == "삼성생명"
        assert meta["product_name"] == "삼성생명 건강보험"
        assert meta["product_type"] == "질병보험"
        assert meta["source_url"] == "https://pub.insure.or.kr/test.pdf"
        assert "file_path" in meta
        assert "file_hash" in meta
        assert meta["file_hash"].startswith("sha256:")
        assert "crawled_at" in meta
        assert "file_size_bytes" in meta

    def test_save_pdf_to_correct_company_dir(self, tmp_path: Path) -> None:
        """PDF를 회사 ID 디렉토리에 저장해야 한다"""
        from scripts.crawl_constants import save_pdf_with_metadata
        pdf_data = b"%PDF-1.4 test content"
        result = save_pdf_with_metadata(
            data=pdf_data,
            company_id="hyundai_marine",
            company_name="현대해상",
            product_name="현대해상 상해보험",
            product_type="상해보험",
            source_url="https://kpub.knia.or.kr/test.pdf",
            base_dir=tmp_path,
        )
        file_path = Path(result["file_path"])
        # 파일이 hyundai_marine 디렉토리 아래에 있어야 한다
        assert "hyundai_marine" in str(file_path)

    def test_file_hash_is_sha256(self, tmp_path: Path) -> None:
        """파일 해시가 sha256:으로 시작해야 한다"""
        from scripts.crawl_constants import save_pdf_with_metadata
        pdf_data = b"%PDF-1.4 known content"
        expected_hash = hashlib.sha256(pdf_data).hexdigest()
        result = save_pdf_with_metadata(
            data=pdf_data,
            company_id="samsung_fire",
            company_name="삼성화재",
            product_name="삼성화재 건강보험",
            product_type="건강보험",
            source_url="https://kpub.knia.or.kr/test2.pdf",
            base_dir=tmp_path,
        )
        meta_path = Path(result["file_path"]).with_suffix(".json")
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        assert meta["file_hash"] == f"sha256:{expected_hash}"

    def test_file_size_bytes_correct(self, tmp_path: Path) -> None:
        """파일 크기가 정확하게 기록되어야 한다"""
        from scripts.crawl_constants import save_pdf_with_metadata
        pdf_data = b"%PDF-1.4 " + b"x" * 1000
        result = save_pdf_with_metadata(
            data=pdf_data,
            company_id="kb_insurance",
            company_name="KB손해보험",
            product_name="KB손해보험 실손보험",
            product_type="실손보험",
            source_url="https://kpub.knia.or.kr/kb.pdf",
            base_dir=tmp_path,
        )
        meta_path = Path(result["file_path"]).with_suffix(".json")
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        assert meta["file_size_bytes"] == len(pdf_data)

    def test_duplicate_pdf_handled(self, tmp_path: Path) -> None:
        """동일한 PDF를 두 번 저장해도 오류 없이 처리되어야 한다"""
        from scripts.crawl_constants import save_pdf_with_metadata
        pdf_data = b"%PDF-1.4 duplicate test"
        kwargs = dict(
            data=pdf_data,
            company_id="samsung_life",
            company_name="삼성생명",
            product_name="삼성생명 건강보험",
            product_type="질병보험",
            source_url="https://pub.insure.or.kr/test.pdf",
            base_dir=tmp_path,
        )
        result1 = save_pdf_with_metadata(**kwargs)
        result2 = save_pdf_with_metadata(**kwargs)
        # 두 번 저장 후 각 파일이 존재해야 한다
        assert Path(result1["file_path"]).exists()
        assert Path(result2["file_path"]).exists()
