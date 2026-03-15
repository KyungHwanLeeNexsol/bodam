"""DisclaimerGenerator 단위 테스트

SPEC-GUIDANCE-001 Phase G4: 법적 면책 고지 생성기 검증.
"""

from __future__ import annotations

from app.services.guidance.disclaimer import DisclaimerGenerator


class TestDisclaimerGeneratorContent:
    """DisclaimerGenerator 내용 검증"""

    def test_general_disclaimer_not_empty(self) -> None:
        """일반 면책 고지문 비어있지 않음"""
        result = DisclaimerGenerator.get_general_disclaimer()
        assert result
        assert isinstance(result, str)

    def test_general_disclaimer_contains_legal_advice(self) -> None:
        """일반 면책 고지문에 '법적 조언' 포함"""
        result = DisclaimerGenerator.get_general_disclaimer()
        assert "법적 조언" in result

    def test_probability_disclaimer_not_empty(self) -> None:
        """승소 확률 면책 고지문 비어있지 않음"""
        result = DisclaimerGenerator.get_probability_disclaimer()
        assert result
        assert isinstance(result, str)

    def test_probability_disclaimer_contains_ai(self) -> None:
        """승소 확률 면책 고지문에 'AI' 포함"""
        result = DisclaimerGenerator.get_probability_disclaimer()
        assert "AI" in result

    def test_precedent_disclaimer_not_empty_and_contains_precedent(self) -> None:
        """판례 면책 고지문 비어있지 않음 및 '판례' 포함"""
        result = DisclaimerGenerator.get_precedent_disclaimer()
        assert result
        assert "판례" in result

    def test_escalation_disclaimer_not_empty(self) -> None:
        """에스컬레이션 면책 고지문 비어있지 않음"""
        result = DisclaimerGenerator.get_escalation_disclaimer()
        assert result
        assert isinstance(result, str)

    def test_all_disclaimers_are_different(self) -> None:
        """모든 면책 고지문이 서로 다름"""
        general = DisclaimerGenerator.get_general_disclaimer()
        probability = DisclaimerGenerator.get_probability_disclaimer()
        precedent = DisclaimerGenerator.get_precedent_disclaimer()
        escalation = DisclaimerGenerator.get_escalation_disclaimer()
        disclaimers = [general, probability, precedent, escalation]
        assert len(set(disclaimers)) == 4

    def test_all_disclaimers_minimum_length(self) -> None:
        """모든 면책 고지문 최소 20자 이상"""
        general = DisclaimerGenerator.get_general_disclaimer()
        probability = DisclaimerGenerator.get_probability_disclaimer()
        precedent = DisclaimerGenerator.get_precedent_disclaimer()
        escalation = DisclaimerGenerator.get_escalation_disclaimer()
        for disclaimer in [general, probability, precedent, escalation]:
            assert len(disclaimer) >= 20
