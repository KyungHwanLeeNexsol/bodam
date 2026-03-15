"""분쟁 가이던스 API 엔드포인트 단위 테스트

SPEC-GUIDANCE-001 Phase G5: /api/v1/guidance 라우터 엔드포인트 검증.
"""

from __future__ import annotations

import uuid
from datetime import date
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.schemas.guidance import (
    CasePrecedentResponse,
    DisputeAnalysisResponse,
    DisputeType,
    EscalationLevel,
    EscalationRecommendation,
    EvidenceStrategy,
    PrecedentSummary,
    ProbabilityScore,
)


def _make_dispute_response() -> DisputeAnalysisResponse:
    """테스트용 DisputeAnalysisResponse 생성"""
    return DisputeAnalysisResponse(
        dispute_type=DisputeType.CLAIM_DENIAL,
        ambiguous_clauses=[],
        precedents=[
            PrecedentSummary(
                case_number="2023가단1234",
                court_name="서울중앙지법",
                decision_date=date(2023, 6, 1),
                summary="보험금 지급 거절 사건",
                relevance_score=0.85,
                key_ruling="원고 승소",
            )
        ],
        probability=ProbabilityScore(
            overall_score=0.6,
            factors=["판례 다수"],
            confidence=0.8,
            disclaimer="법적 조언 아님",
        ),
        evidence_strategy=EvidenceStrategy(
            required_documents=["보험증권"],
            recommended_documents=["진단서"],
            preparation_tips=["원본 보관"],
            timeline_advice="30일 이내",
        ),
        escalation=EscalationRecommendation(
            recommended_level=EscalationLevel.COMPANY_COMPLAINT,
            reason="초기 단계",
            next_steps=["민원 접수"],
            estimated_duration="2주",
            cost_estimate="무료",
        ),
        disclaimer="본 정보는 참고용이며 법적 조언이 아닙니다.",
        confidence=0.9,
    )


def _make_precedent_summary() -> PrecedentSummary:
    """테스트용 PrecedentSummary 생성"""
    return PrecedentSummary(
        case_number="2023가단1234",
        court_name="서울중앙지법",
        decision_date=date(2023, 6, 1),
        summary="보험금 지급 거절 사건",
        relevance_score=0.85,
        key_ruling="원고 승소",
    )


def _make_case_precedent_response() -> CasePrecedentResponse:
    """테스트용 CasePrecedentResponse 생성"""
    return CasePrecedentResponse(
        id=uuid.uuid4(),
        case_number="2023가단1234",
        court_name="서울중앙지법",
        decision_date=date(2023, 6, 1),
        case_type="보험금청구",
        insurance_type="생명보험",
        summary="보험금 지급 거절 사건",
        ruling="원고 승소",
        source_url=None,
    )


@pytest.fixture()
def mock_guidance_service() -> MagicMock:
    """GuidanceService mock"""
    svc = MagicMock()
    svc.analyze_dispute = AsyncMock(return_value=_make_dispute_response())
    return svc


@pytest.fixture()
def mock_precedent_service() -> MagicMock:
    """PrecedentService mock"""
    svc = MagicMock()
    svc.hybrid_search = AsyncMock(return_value=[_make_precedent_summary()])
    svc.get_by_id = AsyncMock(return_value=None)
    return svc


@pytest.fixture()
def client(mock_guidance_service: MagicMock, mock_precedent_service: MagicMock) -> TestClient:
    """TestClient with dependency overrides"""
    from app.api.v1.guidance import _get_guidance_service, _get_precedent_service
    from app.main import app

    app.dependency_overrides[_get_guidance_service] = lambda: mock_guidance_service
    app.dependency_overrides[_get_precedent_service] = lambda: mock_precedent_service

    with TestClient(app, raise_server_exceptions=True) as c:
        yield c

    app.dependency_overrides.clear()


class TestAnalyzeDisputeEndpoint:
    """POST /api/v1/guidance/analyze 테스트"""

    def test_analyze_dispute_success_returns_200(self, client: TestClient) -> None:
        """유효한 요청 시 200 응답 반환"""
        resp = client.post(
            "/api/v1/guidance/analyze",
            json={"query": "보험금 청구가 거절되었습니다 도움이 필요합니다"},
        )
        assert resp.status_code == 200

    def test_analyze_dispute_response_has_required_fields(self, client: TestClient) -> None:
        """응답이 DisputeAnalysisResponse 구조를 갖는다"""
        resp = client.post(
            "/api/v1/guidance/analyze",
            json={"query": "보험금 청구가 거절되었습니다 도움이 필요합니다"},
        )
        data = resp.json()
        assert "dispute_type" in data
        assert "precedents" in data
        assert "disclaimer" in data
        assert "confidence" in data

    def test_analyze_dispute_short_query_returns_422(self, client: TestClient) -> None:
        """query 가 10자 미만이면 422 반환"""
        resp = client.post(
            "/api/v1/guidance/analyze",
            json={"query": "짧은"},
        )
        assert resp.status_code == 422

    def test_analyze_dispute_long_query_returns_422(self, client: TestClient) -> None:
        """query 가 2000자 초과이면 422 반환"""
        resp = client.post(
            "/api/v1/guidance/analyze",
            json={"query": "가" * 2001},
        )
        assert resp.status_code == 422

    def test_analyze_dispute_with_dispute_type_specified(self, client: TestClient) -> None:
        """dispute_type 지정 시 정상 처리"""
        resp = client.post(
            "/api/v1/guidance/analyze",
            json={
                "query": "보험금 청구가 거절되었습니다 도움이 필요합니다",
                "dispute_type": "claim_denial",
            },
        )
        assert resp.status_code == 200

    def test_analyze_dispute_with_insurance_type(self, client: TestClient) -> None:
        """insurance_type 전달 시 정상 처리"""
        resp = client.post(
            "/api/v1/guidance/analyze",
            json={
                "query": "화재보험 관련 분쟁이 발생했습니다 도움이 필요합니다",
                "insurance_type": "화재보험",
            },
        )
        assert resp.status_code == 200


class TestPrecedentSearchEndpoint:
    """GET /api/v1/guidance/precedents/search 테스트"""

    def test_search_precedents_success(self, client: TestClient, mock_precedent_service: MagicMock) -> None:
        """유효한 쿼리로 200 응답 반환"""
        mock_precedent_service.hybrid_search = AsyncMock(return_value=[
            {
                "case_number": "2023가단1234",
                "court_name": "서울중앙지법",
                "decision_date": date(2023, 6, 1),
                "summary": "보험금 지급 거절 사건",
                "ruling": "원고 승소",
                "relevance_score": 0.85,
            }
        ])
        resp = client.get("/api/v1/guidance/precedents/search?query=보험금+거절")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    def test_search_precedents_without_query_returns_422(self, client: TestClient) -> None:
        """query 파라미터 없으면 422 반환"""
        resp = client.get("/api/v1/guidance/precedents/search")
        assert resp.status_code == 422

    def test_search_precedents_with_top_k(self, client: TestClient, mock_precedent_service: MagicMock) -> None:
        """top_k 파라미터 전달 시 정상 처리"""
        mock_precedent_service.hybrid_search = AsyncMock(return_value=[])
        resp = client.get("/api/v1/guidance/precedents/search?query=보험금+거절&top_k=3")
        assert resp.status_code == 200


class TestPrecedentDetailEndpoint:
    """GET /api/v1/guidance/precedents/{id} 테스트"""

    def test_get_precedent_found_returns_200(
        self, client: TestClient, mock_precedent_service: MagicMock
    ) -> None:
        """존재하는 판례 ID 조회 시 200 반환"""
        existing_id = uuid.uuid4()
        mock_precedent_service.get_by_id = AsyncMock(return_value={
            "id": existing_id,
            "case_number": "2023가단1234",
            "court_name": "서울중앙지법",
            "decision_date": date(2023, 6, 1),
            "case_type": "보험금청구",
            "insurance_type": "생명보험",
            "summary": "보험금 지급 거절 사건",
            "ruling": "원고 승소",
            "source_url": None,
        })
        resp = client.get(f"/api/v1/guidance/precedents/{existing_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["case_number"] == "2023가단1234"

    def test_get_precedent_not_found_returns_404(
        self, client: TestClient, mock_precedent_service: MagicMock
    ) -> None:
        """존재하지 않는 판례 ID 조회 시 404 반환"""
        mock_precedent_service.get_by_id = AsyncMock(return_value=None)
        resp = client.get(f"/api/v1/guidance/precedents/{uuid.uuid4()}")
        assert resp.status_code == 404


class TestDisclaimerEndpoint:
    """GET /api/v1/guidance/disclaimer 테스트"""

    def test_get_disclaimers_returns_200(self, client: TestClient) -> None:
        """면책 고지 조회 시 200 반환"""
        resp = client.get("/api/v1/guidance/disclaimer")
        assert resp.status_code == 200

    def test_get_disclaimers_has_four_keys(self, client: TestClient) -> None:
        """면책 고지 응답에 4개 키가 포함된다"""
        resp = client.get("/api/v1/guidance/disclaimer")
        data = resp.json()
        assert "general" in data
        assert "probability" in data
        assert "precedent" in data
        assert "escalation" in data


class TestGuidanceRouterRegistration:
    """main.py 라우터 등록 확인"""

    def test_guidance_router_is_registered(self, client: TestClient) -> None:
        """guidance 라우터가 app 에 등록되어 있다"""
        from app.main import app

        routes = [r.path for r in app.routes]
        guidance_routes = [r for r in routes if "/guidance" in r]
        assert len(guidance_routes) > 0
