"""쿼리 재작성기 단위 테스트

SPEC-LLM-001 TASK-007: 한국 보험 용어 사전 기반 쿼리 재작성 검증.
"""

from __future__ import annotations

import pytest

from app.services.rag.rewriter import QueryRewriter


@pytest.fixture
def rewriter():
    """QueryRewriter 픽스처"""
    return QueryRewriter()


class TestQueryRewriterBasic:
    """기본 재작성 테스트"""

    def test_rewrite_returns_string(self, rewriter):
        """재작성 결과가 문자열"""
        result = rewriter.rewrite("보험 질문")
        assert isinstance(result, str)

    def test_rewrite_non_insurance_query_unchanged(self, rewriter):
        """비보험 관련 쿼리는 변경 없음"""
        query = "오늘 날씨가 어때요?"
        result = rewriter.rewrite(query)
        assert result == query

    def test_rewrite_empty_query(self, rewriter):
        """빈 쿼리는 그대로 반환"""
        result = rewriter.rewrite("")
        assert result == ""


class TestQueryRewriterInsuranceTerm:
    """보험 용어 확장 테스트"""

    def test_expand_silson(self, rewriter):
        """실손 → 실손의료보험 확장"""
        result = rewriter.rewrite("실손 보장 내용이 뭔가요?")
        assert "실손의료보험" in result

    def test_expand_tongwon(self, rewriter):
        """통원 → 통원치료비 확장"""
        result = rewriter.rewrite("통원 한도가 얼마예요?")
        assert "통원치료비" in result

    def test_expand_multiple_terms(self, rewriter):
        """여러 용어 동시 확장"""
        result = rewriter.rewrite("실손 통원 한도는?")
        assert "실손의료보험" in result
        assert "통원치료비" in result

    def test_expand_ipwon(self, rewriter):
        """입원 → 입원치료비 확장 (또는 유지)"""
        result = rewriter.rewrite("입원비 보장이 어떻게 되나요?")
        assert isinstance(result, str)
        assert len(result) > 0

    def test_query_with_no_abbreviations_unchanged(self, rewriter):
        """축약어 없는 보험 쿼리는 변경 없음"""
        query = "자동차보험 보장 내용을 알려주세요"
        result = rewriter.rewrite(query)
        assert result == query


class TestQueryRewriterDictionary:
    """용어 사전 테스트"""

    def test_has_insurance_dictionary(self, rewriter):
        """보험 용어 사전이 있음"""
        assert hasattr(rewriter, "_term_dict") or hasattr(rewriter, "term_dict")
        # 사전에 항목이 있음
        term_dict = getattr(rewriter, "_term_dict", getattr(rewriter, "term_dict", {}))
        assert len(term_dict) > 0

    def test_silson_in_dictionary(self, rewriter):
        """실손이 사전에 있음"""
        term_dict = getattr(rewriter, "_term_dict", getattr(rewriter, "term_dict", {}))
        assert "실손" in term_dict

    def test_tongwon_in_dictionary(self, rewriter):
        """통원이 사전에 있음"""
        term_dict = getattr(rewriter, "_term_dict", getattr(rewriter, "term_dict", {}))
        assert "통원" in term_dict
