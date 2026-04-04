"""T-002: ProductNameExtractor 클래스 테스트 (SPEC-JIT-002)

메시지에서 보험 상품명과 회사명을 추출하는 기능 검증.
"""

from __future__ import annotations

import pytest


class TestProductNameExtractor:
    """ProductNameExtractor 단위 테스트"""

    def test_extract_db_insurance_with_product(self) -> None:
        """DB손보 + 상품명 추출 테스트"""
        from app.services.jit_rag.product_extractor import ProductInfo, ProductNameExtractor

        extractor = ProductNameExtractor()
        result = extractor.extract("DB손보 아이사랑보험 2104에서 용종수술 보장 알려줘")

        assert result is not None
        assert result.company == "DB손보"
        assert "DB손보" in result.product_name
        assert "아이사랑보험" in result.product_name

    def test_extract_samsung_fire_with_product(self) -> None:
        """삼성화재 + 운전자보험 추출 테스트"""
        from app.services.jit_rag.product_extractor import ProductInfo, ProductNameExtractor

        extractor = ProductNameExtractor()
        result = extractor.extract("삼성화재 운전자보험에서 벌금 보장되나요?")

        assert result is not None
        assert result.company == "삼성화재"
        assert "삼성화재" in result.product_name
        assert "운전자보험" in result.product_name

    def test_extract_no_insurance(self) -> None:
        """보험사명이 없는 메시지는 None 반환"""
        from app.services.jit_rag.product_extractor import ProductNameExtractor

        extractor = ProductNameExtractor()
        result = extractor.extract("실손보험이 뭐야?")

        assert result is None

    def test_extract_no_insurance_general_query(self) -> None:
        """일반 질문에서 None 반환"""
        from app.services.jit_rag.product_extractor import ProductNameExtractor

        extractor = ProductNameExtractor()
        result = extractor.extract("보험에 대해 알려줘")

        assert result is None

    def test_extract_insurer_only(self) -> None:
        """보험사 이름만 있을 때 ProductInfo 반환"""
        from app.services.jit_rag.product_extractor import ProductNameExtractor

        extractor = ProductNameExtractor()
        result = extractor.extract("한화생명에 대해 알려줘")

        assert result is not None
        assert result.company == "한화생명"

    def test_extract_greedy_matching_db(self) -> None:
        """DB손해보험은 DB손보보다 먼저 매칭되어야 함 (긴 이름 우선)"""
        from app.services.jit_rag.product_extractor import ProductNameExtractor

        extractor = ProductNameExtractor()
        result = extractor.extract("DB손해보험 상품 알려줘")

        assert result is not None
        assert result.company == "DB손해보험"

    def test_extract_greedy_matching_kb(self) -> None:
        """KB손해보험은 KB손보보다 먼저 매칭되어야 함"""
        from app.services.jit_rag.product_extractor import ProductNameExtractor

        extractor = ProductNameExtractor()
        result = extractor.extract("KB손해보험 약관 보여줘")

        assert result is not None
        assert result.company == "KB손해보험"

    def test_extract_full_query_set(self) -> None:
        """full_query가 product_name과 동일하게 설정되어야 함"""
        from app.services.jit_rag.product_extractor import ProductNameExtractor

        extractor = ProductNameExtractor()
        result = extractor.extract("삼성화재 운전자보험 벌금 보장")

        assert result is not None
        assert result.full_query == result.product_name

    def test_extract_product_info_dataclass(self) -> None:
        """ProductInfo 데이터클래스의 필드 확인"""
        from app.services.jit_rag.product_extractor import ProductInfo

        info = ProductInfo(
            company="DB손보",
            product_name="DB손보 아이사랑보험",
            full_query="DB손보 아이사랑보험",
        )

        assert info.company == "DB손보"
        assert info.product_name == "DB손보 아이사랑보험"
        assert info.full_query == "DB손보 아이사랑보험"


@pytest.mark.parametrize(
    "insurer_name",
    [
        "삼성화재",
        "현대해상",
        "KB손보",
        "KB손해보험",
        "DB손보",
        "DB손해보험",
        "메리츠화재",
        "메리츠",
        "롯데손보",
        "롯데손해보험",
        "한화손보",
        "한화손해보험",
        "흥국화재",
        "MG손보",
        "삼성생명",
        "교보생명",
        "한화생명",
        "신한라이프",
        "NH농협생명",
        "미래에셋생명",
        "동양생명",
        "ABL생명",
        "흥국생명",
        "DB생명",
        "KDB생명",
        "메트라이프",
    ],
)
def test_extract_all_insurer_names(insurer_name: str) -> None:
    """모든 보험사명이 추출되어야 함 (파라미터화 테스트)"""
    from app.services.jit_rag.product_extractor import ProductNameExtractor

    extractor = ProductNameExtractor()
    message = f"{insurer_name} 약관 알려줘"
    result = extractor.extract(message)

    assert result is not None, f"{insurer_name}이 추출되지 않았습니다"
    assert result.company == insurer_name


# ─────────────────────────────────────────────
# Bug 1: 축약 보험사명 alias 매칭 테스트 (RED)
# ─────────────────────────────────────────────


class TestProductNameExtractorAlias:
    """축약/브랜드명으로 보험사 매칭 테스트"""

    def test_extract_db_lowercase_abbreviation(self) -> None:
        """'db아이사랑보험 2104' → DB손보로 매칭"""
        from app.services.jit_rag.product_extractor import ProductNameExtractor

        extractor = ProductNameExtractor()
        result = extractor.extract("db아이사랑보험 2104")

        assert result is not None, "db 소문자 축약어가 추출되지 않았습니다"
        assert result.company == "DB손보"
        assert "아이사랑보험" in result.product_name

    def test_extract_samsung_abbreviation(self) -> None:
        """'삼성 운전자보험' → 삼성화재로 매칭"""
        from app.services.jit_rag.product_extractor import ProductNameExtractor

        extractor = ProductNameExtractor()
        result = extractor.extract("삼성 운전자보험")

        assert result is not None, "삼성 축약어가 추출되지 않았습니다"
        assert result.company == "삼성화재"
        assert "운전자보험" in result.product_name

    def test_extract_kb_uppercase_abbreviation(self) -> None:
        """'KB 다이렉트 자동차보험' → KB손보로 매칭"""
        from app.services.jit_rag.product_extractor import ProductNameExtractor

        extractor = ProductNameExtractor()
        result = extractor.extract("KB 다이렉트 자동차보험")

        assert result is not None, "KB 대문자 축약어가 추출되지 않았습니다"
        assert result.company == "KB손보"

    def test_extract_db_uppercase_abbreviation(self) -> None:
        """'DB 암보험 약관 알려줘' → DB손보로 매칭"""
        from app.services.jit_rag.product_extractor import ProductNameExtractor

        extractor = ProductNameExtractor()
        result = extractor.extract("DB 암보험 약관 알려줘")

        assert result is not None, "DB 대문자 축약어가 추출되지 않았습니다"
        assert result.company == "DB손보"

    def test_extract_alias_does_not_override_full_name(self) -> None:
        """'DB손해보험 상품' 입력 시 full 이름(DB손해보험)이 축약(DB손보)보다 우선"""
        from app.services.jit_rag.product_extractor import ProductNameExtractor

        extractor = ProductNameExtractor()
        result = extractor.extract("DB손해보험 상품 알려줘")

        assert result is not None
        # 긴 이름 우선 매칭 유지
        assert result.company == "DB손해보험"

    def test_extract_hyundai_abbreviation(self) -> None:
        """'현대 운전자보험' → 현대해상으로 매칭"""
        from app.services.jit_rag.product_extractor import ProductNameExtractor

        extractor = ProductNameExtractor()
        result = extractor.extract("현대 운전자보험 약관")

        assert result is not None, "현대 축약어가 추출되지 않았습니다"
        assert result.company == "현대해상"

    def test_alias_product_name_uses_full_insurer_name(self) -> None:
        """alias 매칭 시 product_name에 full 보험사명이 포함되어야 함"""
        from app.services.jit_rag.product_extractor import ProductNameExtractor

        extractor = ProductNameExtractor()
        result = extractor.extract("삼성 화재보험 약관")

        assert result is not None
        # product_name에 alias("삼성")가 아닌 full name("삼성화재")이 포함
        assert "삼성화재" in result.product_name
        assert result.full_query == result.product_name
