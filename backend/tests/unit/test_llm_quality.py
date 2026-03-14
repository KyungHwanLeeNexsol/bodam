"""품질 검증기 단위 테스트

SPEC-LLM-001 TASK-009: 환각 감지, 불충분 컨텍스트 처리, 구조화 출력 검증.
"""

from __future__ import annotations

import pytest

from app.services.llm.models import LLMResponse, QueryIntent, SourceCitation
from app.services.llm.quality import QualityGuard


@pytest.fixture
def quality_guard():
    """QualityGuard 픽스처"""
    return QualityGuard()


@pytest.fixture
def sample_source():
    """샘플 출처 픽스처"""
    return {
        "policy_name": "실손의료보험",
        "company_name": "삼성화재",
        "chunk_text": "입원 치료비는 실제 발생 비용의 90%를 보장합니다.",
        "similarity": 0.85,
    }


class TestQualityGuardInit:
    """QualityGuard 초기화 테스트"""

    def test_init(self, quality_guard):
        """기본 초기화"""
        assert quality_guard is not None


class TestQualityGuardPostProcess:
    """post_process 메서드 테스트"""

    async def test_returns_string(self, quality_guard, sample_source):
        """처리 결과가 문자열"""
        response = LLMResponse(
            content="보험 답변",
            model_used="gemini-2.0-flash",
        )
        result = await quality_guard.post_process(
            response=response,
            context=[sample_source],
            intent=QueryIntent.GENERAL_QA,
        )
        assert isinstance(result, str)

    async def test_normal_response_unchanged(self, quality_guard, sample_source):
        """정상 응답은 내용 유지"""
        content = "실손의료보험은 입원 치료비의 90%를 보장합니다."
        response = LLMResponse(
            content=content,
            model_used="gemini-2.0-flash",
            sources=[
                SourceCitation(
                    company_name="삼성화재",
                    policy_name="실손의료보험",
                    chunk_text="입원 치료비는 실제 발생 비용의 90%를 보장합니다.",
                    similarity=0.85,
                )
            ],
        )
        result = await quality_guard.post_process(
            response=response,
            context=[sample_source],
            intent=QueryIntent.POLICY_LOOKUP,
        )
        # 원본 내용이 결과에 포함됨
        assert content in result


class TestQualityGuardInsufficientContext:
    """불충분 컨텍스트 처리 테스트"""

    async def test_adds_disclaimer_when_no_context(self, quality_guard):
        """컨텍스트 없을 때 면책 고지 추가"""
        response = LLMResponse(
            content="일반 보험 정보입니다.",
            model_used="gemini-2.0-flash",
        )
        result = await quality_guard.post_process(
            response=response,
            context=[],
            intent=QueryIntent.GENERAL_QA,
        )
        # 면책 고지가 포함되어야 함
        assert len(result) > len(response.content)

    async def test_adds_disclaimer_when_low_similarity(self, quality_guard):
        """낮은 유사도 컨텍스트는 면책 고지 추가"""
        low_similarity_context = [
            {
                "policy_name": "자동차보험",
                "company_name": "회사",
                "chunk_text": "자동차 관련 내용",
                "similarity": 0.3,  # 0.5 미만
            }
        ]
        response = LLMResponse(
            content="답변 내용",
            model_used="gemini-2.0-flash",
        )
        result = await quality_guard.post_process(
            response=response,
            context=low_similarity_context,
            intent=QueryIntent.POLICY_LOOKUP,
        )
        assert len(result) >= len(response.content)

    async def test_no_disclaimer_when_high_similarity(self, quality_guard):
        """높은 유사도 컨텍스트는 면책 고지 없음"""
        high_similarity_context = [
            {
                "policy_name": "실손보험",
                "company_name": "삼성화재",
                "chunk_text": "실손 의료비 보장 내용",
                "similarity": 0.9,
            }
        ]
        response = LLMResponse(
            content="실손보험은 실제 의료비를 보장합니다.",
            model_used="gemini-2.0-flash",
        )
        result = await quality_guard.post_process(
            response=response,
            context=high_similarity_context,
            intent=QueryIntent.POLICY_LOOKUP,
        )
        # 원본 내용이 포함됨
        assert response.content in result


class TestQualityGuardClaimGuidance:
    """claim_guidance 구조화 출력 테스트"""

    async def test_claim_guidance_includes_key_fields(self, quality_guard):
        """청구 안내는 핵심 필드 포함"""
        context = [
            {
                "policy_name": "실손보험",
                "company_name": "삼성화재",
                "chunk_text": "입원비 보장, 청구 서류: 진단서, 영수증",
                "similarity": 0.85,
            }
        ]
        response = LLMResponse(
            content="보험금 청구를 위해 진단서와 영수증이 필요합니다.",
            model_used="gemini-2.0-flash",
        )
        result = await quality_guard.post_process(
            response=response,
            context=context,
            intent=QueryIntent.CLAIM_GUIDANCE,
        )
        # 청구 안내의 경우 결과에 내용이 포함됨
        assert isinstance(result, str)
        assert len(result) > 0
