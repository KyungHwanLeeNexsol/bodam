"""QueryIntent enum 확장 및 IntentClassifier 프롬프트 단위 테스트

SPEC-GUIDANCE-001 Phase G1: DISPUTE_GUIDANCE intent 추가 및 기존 intent 유지 검증.
"""

from __future__ import annotations

from app.services.llm.classifier import _CLASSIFIER_SYSTEM_PROMPT
from app.services.llm.models import QueryIntent


class TestQueryIntentDisputeGuidance:
    """DISPUTE_GUIDANCE 값 존재 및 문자열 확인"""

    def test_dispute_guidance_exists_in_query_intent(self) -> None:
        """QueryIntent에 DISPUTE_GUIDANCE 값 존재 확인"""
        assert hasattr(QueryIntent, "DISPUTE_GUIDANCE")

    def test_dispute_guidance_string_value(self) -> None:
        """DISPUTE_GUIDANCE 문자열 값이 'dispute_guidance'인지 확인"""
        assert QueryIntent.DISPUTE_GUIDANCE == "dispute_guidance"

    def test_dispute_guidance_is_str_enum(self) -> None:
        """DISPUTE_GUIDANCE가 StrEnum 인스턴스인지 확인"""
        assert isinstance(QueryIntent.DISPUTE_GUIDANCE, str)


class TestExistingIntentsPreserved:
    """기존 QueryIntent 값들이 유지되는지 확인"""

    def test_policy_lookup_preserved(self) -> None:
        """POLICY_LOOKUP 기존 값 유지 확인"""
        assert QueryIntent.POLICY_LOOKUP == "policy_lookup"

    def test_claim_guidance_preserved(self) -> None:
        """CLAIM_GUIDANCE 기존 값 유지 확인"""
        assert QueryIntent.CLAIM_GUIDANCE == "claim_guidance"

    def test_general_qa_preserved(self) -> None:
        """GENERAL_QA 기존 값 유지 확인"""
        assert QueryIntent.GENERAL_QA == "general_qa"

    def test_total_intent_count_is_four(self) -> None:
        """QueryIntent 총 값 개수가 4개인지 확인"""
        assert len(QueryIntent) == 4

    def test_all_original_intents_in_enum(self) -> None:
        """기존 3개 intent 모두 enum에 포함 확인"""
        values = [item.value for item in QueryIntent]
        assert "policy_lookup" in values
        assert "claim_guidance" in values
        assert "general_qa" in values


class TestIntentClassifierSystemPrompt:
    """IntentClassifier 시스템 프롬프트 업데이트 검증"""

    def test_system_prompt_contains_dispute_guidance(self) -> None:
        """시스템 프롬프트에 'dispute_guidance' 포함 확인"""
        assert "dispute_guidance" in _CLASSIFIER_SYSTEM_PROMPT

    def test_system_prompt_contains_dispute_category_description(self) -> None:
        """시스템 프롬프트에 분쟁 카테고리 설명 포함 확인"""
        # 분쟁 관련 키워드가 프롬프트에 포함되어야 함
        dispute_keywords = ["분쟁", "이의제기", "거절"]
        has_keyword = any(kw in _CLASSIFIER_SYSTEM_PROMPT for kw in dispute_keywords)
        assert has_keyword, "시스템 프롬프트에 분쟁 관련 설명이 없습니다."

    def test_system_prompt_still_contains_policy_lookup(self) -> None:
        """시스템 프롬프트에 기존 policy_lookup 유지 확인"""
        assert "policy_lookup" in _CLASSIFIER_SYSTEM_PROMPT

    def test_system_prompt_still_contains_claim_guidance(self) -> None:
        """시스템 프롬프트에 기존 claim_guidance 유지 확인"""
        assert "claim_guidance" in _CLASSIFIER_SYSTEM_PROMPT

    def test_system_prompt_still_contains_general_qa(self) -> None:
        """시스템 프롬프트에 기존 general_qa 유지 확인"""
        assert "general_qa" in _CLASSIFIER_SYSTEM_PROMPT

    def test_system_prompt_has_four_categories(self) -> None:
        """시스템 프롬프트에 4개 카테고리 번호 포함 확인"""
        # 1., 2., 3., 4. 번호 모두 포함
        for num in ["1.", "2.", "3.", "4."]:
            assert num in _CLASSIFIER_SYSTEM_PROMPT, f"카테고리 번호 '{num}'가 없습니다."
