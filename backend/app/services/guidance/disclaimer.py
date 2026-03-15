"""법적 면책 고지 생성기

SPEC-GUIDANCE-001 Phase G4: 분쟁 가이던스 응답에 포함할 법적 면책 고지.
"""

from __future__ import annotations


class DisclaimerGenerator:
    """법적 면책 고지 생성기

    분쟁 가이던스의 각 영역에 대한 표준화된 면책 고지문 제공.
    """

    @staticmethod
    def get_general_disclaimer() -> str:
        """일반 면책 고지"""
        return (
            "본 정보는 참고용이며 법적 조언이 아닙니다. "
            "구체적인 법률 문제는 반드시 전문 변호사와 상담하시기 바랍니다. "
            "보담(Bodam)은 본 정보의 정확성이나 완전성을 보증하지 않습니다."
        )

    @staticmethod
    def get_probability_disclaimer() -> str:
        """승소 확률 관련 면책 고지"""
        return (
            "승소 확률은 AI 기반 예측으로, 법적 판단이 아닙니다. "
            "실제 결과는 구체적 사실관계, 증거, 판사의 판단에 따라 크게 달라질 수 있습니다. "
            "이 수치를 법적 결정의 근거로 사용하지 마세요."
        )

    @staticmethod
    def get_precedent_disclaimer() -> str:
        """판례 관련 면책 고지"""
        return (
            "제공된 판례는 참고용이며, 귀하의 사안과 동일한 결과를 보장하지 않습니다. "
            "판례의 적용 가능성은 구체적 사실관계에 따라 달라집니다."
        )

    @staticmethod
    def get_escalation_disclaimer() -> str:
        """에스컬레이션 관련 면책 고지"""
        return (
            "권장 대응 단계는 일반적인 가이드라인이며, "
            "실제 상황에 따라 다른 접근이 더 적합할 수 있습니다. "
            "중요한 결정 전 전문가 상담을 권장합니다."
        )
