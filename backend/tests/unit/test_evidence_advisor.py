"""EvidenceAdvisor 단위 테스트

SPEC-GUIDANCE-001 Phase G4: 증거 전략 자문 서비스 검증.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.schemas.guidance import DisputeType, EvidenceStrategy
from app.services.guidance.evidence_advisor import EvidenceAdvisor


def _make_mock_client(content: str) -> AsyncMock:
    """OpenAI client mock 생성 헬퍼"""
    mock_client = AsyncMock()
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = content
    mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
    return mock_client


def _make_error_client() -> AsyncMock:
    """오류를 발생시키는 OpenAI client mock 생성 헬퍼"""
    mock_client = AsyncMock()
    mock_client.chat.completions.create = AsyncMock(side_effect=Exception("API 오류"))
    return mock_client


# ---------------------------------------------------------------------------
# EvidenceAdvisor.advise 분쟁 유형별 기본 서류 포함 테스트
# ---------------------------------------------------------------------------


class TestEvidenceAdvisorDefaultDocuments:
    """advise 메서드 - 분쟁 유형별 기본 서류 포함"""

    @pytest.mark.asyncio
    async def test_advise_claim_denial_includes_required_docs(self) -> None:
        """CLAIM_DENIAL - 보험금 청구서 사본 포함"""
        content = json.dumps({"additional_required": [], "additional_recommended": [], "preparation_tips": [], "timeline_advice": ""})
        advisor = EvidenceAdvisor(client=_make_mock_client(content))
        result = await advisor.advise("보험금 거절", DisputeType.CLAIM_DENIAL)
        assert isinstance(result, EvidenceStrategy)
        assert any("보험금 청구서" in doc for doc in result.required_documents)

    @pytest.mark.asyncio
    async def test_advise_coverage_dispute_includes_required_docs(self) -> None:
        """COVERAGE_DISPUTE - 약관 전문 포함"""
        content = json.dumps({"additional_required": [], "additional_recommended": [], "preparation_tips": [], "timeline_advice": ""})
        advisor = EvidenceAdvisor(client=_make_mock_client(content))
        result = await advisor.advise("보장 범위 분쟁", DisputeType.COVERAGE_DISPUTE)
        assert any("약관" in doc for doc in result.required_documents)

    @pytest.mark.asyncio
    async def test_advise_incomplete_sale_includes_required_docs(self) -> None:
        """INCOMPLETE_SALE - 보험 가입 신청서 포함"""
        content = json.dumps({"additional_required": [], "additional_recommended": [], "preparation_tips": [], "timeline_advice": ""})
        advisor = EvidenceAdvisor(client=_make_mock_client(content))
        result = await advisor.advise("불완전판매", DisputeType.INCOMPLETE_SALE)
        assert any("신청서" in doc for doc in result.required_documents)

    @pytest.mark.asyncio
    async def test_advise_premium_dispute_includes_required_docs(self) -> None:
        """PREMIUM_DISPUTE - 보험료 납입 내역서 포함"""
        content = json.dumps({"additional_required": [], "additional_recommended": [], "preparation_tips": [], "timeline_advice": ""})
        advisor = EvidenceAdvisor(client=_make_mock_client(content))
        result = await advisor.advise("보험료 분쟁", DisputeType.PREMIUM_DISPUTE)
        assert any("납입 내역서" in doc for doc in result.required_documents)

    @pytest.mark.asyncio
    async def test_advise_contract_cancel_includes_required_docs(self) -> None:
        """CONTRACT_CANCEL - 해지 통지서 포함"""
        content = json.dumps({"additional_required": [], "additional_recommended": [], "preparation_tips": [], "timeline_advice": ""})
        advisor = EvidenceAdvisor(client=_make_mock_client(content))
        result = await advisor.advise("계약 해지 분쟁", DisputeType.CONTRACT_CANCEL)
        assert any("해지" in doc for doc in result.required_documents)

    @pytest.mark.asyncio
    async def test_advise_other_has_required_docs(self) -> None:
        """OTHER - 기본 필수 서류 포함"""
        content = json.dumps({"additional_required": [], "additional_recommended": [], "preparation_tips": [], "timeline_advice": ""})
        advisor = EvidenceAdvisor(client=_make_mock_client(content))
        result = await advisor.advise("기타 분쟁", DisputeType.OTHER)
        assert len(result.required_documents) > 0


# ---------------------------------------------------------------------------
# EvidenceAdvisor.advise LLM 통합 테스트
# ---------------------------------------------------------------------------


class TestEvidenceAdvisorLlmIntegration:
    """advise 메서드 - LLM 추가 서류 통합"""

    @pytest.mark.asyncio
    async def test_advise_merges_llm_additional_required(self) -> None:
        """LLM 추가 필수 서류 기본 목록에 병합"""
        content = json.dumps({
            "additional_required": ["LLM 추가 서류"],
            "additional_recommended": [],
            "preparation_tips": [],
            "timeline_advice": "",
        })
        advisor = EvidenceAdvisor(client=_make_mock_client(content))
        result = await advisor.advise("분쟁 상황", DisputeType.CLAIM_DENIAL)
        assert "LLM 추가 서류" in result.required_documents

    @pytest.mark.asyncio
    async def test_advise_deduplicates_documents(self) -> None:
        """LLM 중복 서류 제거"""
        # 기본 서류 중 하나와 동일한 항목 반환
        content = json.dumps({
            "additional_required": ["보험금 청구서 사본"],  # 이미 기본에 있음
            "additional_recommended": [],
            "preparation_tips": [],
            "timeline_advice": "",
        })
        advisor = EvidenceAdvisor(client=_make_mock_client(content))
        result = await advisor.advise("분쟁 상황", DisputeType.CLAIM_DENIAL)
        # 중복 없이 하나만 있어야 함
        claim_docs = [d for d in result.required_documents if d == "보험금 청구서 사본"]
        assert len(claim_docs) == 1

    @pytest.mark.asyncio
    async def test_advise_api_error_returns_default_docs_only(self) -> None:
        """API 오류 시 기본 서류만 반환"""
        advisor = EvidenceAdvisor(client=_make_error_client())
        result = await advisor.advise("분쟁 상황", DisputeType.CLAIM_DENIAL)
        # 기본 서류는 포함, LLM 추가 서류 없음
        assert len(result.required_documents) > 0

    @pytest.mark.asyncio
    async def test_advise_includes_preparation_tips(self) -> None:
        """advise 결과에 preparation_tips 포함"""
        content = json.dumps({
            "additional_required": [],
            "additional_recommended": [],
            "preparation_tips": ["서류 원본 준비", "공증 권장"],
            "timeline_advice": "",
        })
        advisor = EvidenceAdvisor(client=_make_mock_client(content))
        result = await advisor.advise("분쟁 상황", DisputeType.CLAIM_DENIAL)
        assert "서류 원본 준비" in result.preparation_tips

    @pytest.mark.asyncio
    async def test_advise_includes_timeline_advice(self) -> None:
        """advise 결과에 timeline_advice 포함"""
        content = json.dumps({
            "additional_required": [],
            "additional_recommended": [],
            "preparation_tips": [],
            "timeline_advice": "민원 제기 기한은 3년",
        })
        advisor = EvidenceAdvisor(client=_make_mock_client(content))
        result = await advisor.advise("분쟁 상황", DisputeType.CLAIM_DENIAL)
        assert result.timeline_advice == "민원 제기 기한은 3년"


# ---------------------------------------------------------------------------
# EvidenceAdvisor.get_default_documents 테스트
# ---------------------------------------------------------------------------


class TestEvidenceAdvisorGetDefaultDocuments:
    """get_default_documents 메서드 테스트"""

    def test_get_default_documents_claim_denial(self) -> None:
        """CLAIM_DENIAL 기본 서류 조회"""
        advisor = EvidenceAdvisor(client=AsyncMock())
        result = advisor.get_default_documents(DisputeType.CLAIM_DENIAL)
        assert "required" in result
        assert "recommended" in result
        assert len(result["required"]) > 0

    def test_get_default_documents_other(self) -> None:
        """OTHER 기본 서류 조회"""
        advisor = EvidenceAdvisor(client=AsyncMock())
        result = advisor.get_default_documents(DisputeType.OTHER)
        assert "required" in result
        assert len(result["required"]) > 0


# ---------------------------------------------------------------------------
# EvidenceAdvisor._parse_response 테스트
# ---------------------------------------------------------------------------


class TestEvidenceAdvisorParseResponse:
    """_parse_response 메서드 테스트"""

    def test_parse_response_valid_json(self) -> None:
        """유효한 JSON 파싱"""
        advisor = EvidenceAdvisor(client=AsyncMock())
        content = json.dumps({"additional_required": ["서류1"], "preparation_tips": ["팁1"]})
        result = advisor._parse_response(content)
        assert result["additional_required"] == ["서류1"]
        assert result["preparation_tips"] == ["팁1"]

    def test_parse_response_invalid_json_returns_empty_dict(self) -> None:
        """잘못된 JSON - 빈 dict 반환"""
        advisor = EvidenceAdvisor(client=AsyncMock())
        result = advisor._parse_response("not json {{")
        assert result == {}
