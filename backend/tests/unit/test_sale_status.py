"""SaleStatus 열거형 및 PolicyListing 확장 테스트 (SPEC-CRAWLER-002)

판매 상태(SaleStatus) Enum과 PolicyListing 데이터클래스 확장을 검증.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.services.crawler.base import PolicyListing, SaleStatus


# ---------------------------------------------------------------------------
# SaleStatus Enum 테스트
# ---------------------------------------------------------------------------


class TestSaleStatus:
    """SaleStatus Enum 값 및 속성 검증"""

    def test_on_sale_value(self):
        """ON_SALE 값 확인"""
        assert SaleStatus.ON_SALE == "ON_SALE"

    def test_discontinued_value(self):
        """DISCONTINUED 값 확인"""
        assert SaleStatus.DISCONTINUED == "DISCONTINUED"

    def test_unknown_value(self):
        """UNKNOWN 값 확인"""
        assert SaleStatus.UNKNOWN == "UNKNOWN"

    def test_is_str_enum(self):
        """SaleStatus는 str 서브클래스"""
        assert isinstance(SaleStatus.ON_SALE, str)

    def test_all_members(self):
        """3가지 값이 모두 정의되어야 함"""
        assert len(SaleStatus) == 3
        members = {s.value for s in SaleStatus}
        assert members == {"ON_SALE", "DISCONTINUED", "UNKNOWN"}

    def test_comparison_with_string(self):
        """문자열과 직접 비교 가능"""
        assert SaleStatus.ON_SALE == "ON_SALE"
        assert SaleStatus.DISCONTINUED == "DISCONTINUED"


# ---------------------------------------------------------------------------
# PolicyListing 확장 테스트
# ---------------------------------------------------------------------------


class TestPolicyListingExtension:
    """PolicyListing에 추가된 필드 검증"""

    def test_default_sale_status_is_unknown(self):
        """sale_status 미지정 시 기본값은 UNKNOWN"""
        listing = PolicyListing(
            company_name="흥국생명",
            product_name="종신보험",
            product_code="HL-001",
            category="LIFE",
            pdf_url="https://example.com/file.pdf",
            company_code="heungkuk-life",
        )
        assert listing.sale_status == SaleStatus.UNKNOWN

    def test_default_effective_date_is_none(self):
        """effective_date 미지정 시 기본값은 None"""
        listing = PolicyListing(
            company_name="흥국생명",
            product_name="종신보험",
            product_code="HL-001",
            category="LIFE",
            pdf_url="https://example.com/file.pdf",
            company_code="heungkuk-life",
        )
        assert listing.effective_date is None

    def test_default_expiry_date_is_none(self):
        """expiry_date 미지정 시 기본값은 None"""
        listing = PolicyListing(
            company_name="흥국생명",
            product_name="종신보험",
            product_code="HL-001",
            category="LIFE",
            pdf_url="https://example.com/file.pdf",
            company_code="heungkuk-life",
        )
        assert listing.expiry_date is None

    def test_set_on_sale_status(self):
        """sale_status를 ON_SALE로 설정 가능"""
        listing = PolicyListing(
            company_name="삼성생명",
            product_name="건강보험",
            product_code="SL-001",
            category="LIFE",
            pdf_url="https://example.com/file.pdf",
            company_code="samsung-life",
            sale_status=SaleStatus.ON_SALE,
        )
        assert listing.sale_status == SaleStatus.ON_SALE

    def test_set_discontinued_status(self):
        """sale_status를 DISCONTINUED로 설정 가능"""
        listing = PolicyListing(
            company_name="삼성생명",
            product_name="구형보험",
            product_code="SL-002",
            category="LIFE",
            pdf_url="https://example.com/old.pdf",
            company_code="samsung-life",
            sale_status=SaleStatus.DISCONTINUED,
        )
        assert listing.sale_status == SaleStatus.DISCONTINUED

    def test_set_effective_date(self):
        """effective_date 설정 가능"""
        eff_date = date(2024, 1, 1)
        listing = PolicyListing(
            company_name="흥국생명",
            product_name="종신보험",
            product_code="HL-003",
            category="LIFE",
            pdf_url="https://example.com/file.pdf",
            company_code="heungkuk-life",
            effective_date=eff_date,
        )
        assert listing.effective_date == eff_date

    def test_set_expiry_date(self):
        """expiry_date 설정 가능"""
        exp_date = date(2024, 12, 31)
        listing = PolicyListing(
            company_name="흥국생명",
            product_name="구형종신",
            product_code="HL-004",
            category="LIFE",
            pdf_url="https://example.com/file.pdf",
            company_code="heungkuk-life",
            expiry_date=exp_date,
        )
        assert listing.expiry_date == exp_date

    def test_backward_compatibility_existing_code(self):
        """기존 코드 (sale_status 없이) 생성 시 하위 호환"""
        # 기존 방식으로 생성 (새 필드 없이)
        listing = PolicyListing(
            company_name="테스트",
            product_name="테스트상품",
            product_code="T-001",
            category="LIFE",
            pdf_url="https://example.com/t.pdf",
            company_code="test",
        )
        # 기존 필드 정상 작동 확인
        assert listing.company_name == "테스트"
        assert listing.product_name == "테스트상품"
        # 새 필드 기본값 확인
        assert listing.sale_status == SaleStatus.UNKNOWN
        assert listing.effective_date is None
        assert listing.expiry_date is None

    def test_all_three_new_fields_set_together(self):
        """세 필드 동시 설정"""
        listing = PolicyListing(
            company_name="흥국생명",
            product_name="복합보험",
            product_code="HL-010",
            category="LIFE",
            pdf_url="https://example.com/mix.pdf",
            company_code="heungkuk-life",
            sale_status=SaleStatus.ON_SALE,
            effective_date=date(2023, 6, 1),
            expiry_date=date(2025, 12, 31),
        )
        assert listing.sale_status == SaleStatus.ON_SALE
        assert listing.effective_date == date(2023, 6, 1)
        assert listing.expiry_date == date(2025, 12, 31)
