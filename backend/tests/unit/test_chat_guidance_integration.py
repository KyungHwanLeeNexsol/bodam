"""ChatService + IntentClassifier + GuidanceService 통합 테스트

SPEC-GUIDANCE-002 Phase 1 Backend TDD:
- REQ-GC-001: ChatService 의도 분류 통합
- REQ-GC-002: GuidanceService 분쟁 분석 트리거
- REQ-GC-003: SSE 스트리밍 guidance 이벤트
- REQ-GC-004: guidance 메타데이터 스키마 검증
"""

from __future__ import annotations

import uuid
from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.chat import ChatMessage, ChatSession, MessageRole
from app.schemas.guidance import (
    DisputeAnalysisResponse,
    DisputeType,
    EscalationLevel,
    EscalationRecommendation,
    EvidenceStrategy,
    ProbabilityScore,
)
from app.services.llm.models import IntentResult, QueryIntent


# ---------------------------------------------------------------------------
# 공통 픽스처
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_settings():
    """테스트용 Settings 목 픽스처"""
    settings = MagicMock()
    settings.openai_api_key = "test-api-key"
    settings.gemini_api_key = ""
    settings.gemini_api_key_2 = ""
    settings.gemini_api_key_3 = ""
    settings.embedding_model = "text-embedding-3-small"
    settings.embedding_dimensions = 1536
    settings.chat_model = "gpt-4o-mini"
    settings.chat_max_tokens = 1024
    settings.chat_temperature = 0.3
    settings.chat_history_limit = 10
    settings.chat_context_top_k = 5
    settings.chat_context_threshold = 0.3
    return settings


@pytest.fixture
def mock_db():
    """테스트용 AsyncSession 목 픽스처"""
    db = AsyncMock()
    db.flush = AsyncMock()
    db.execute = AsyncMock()
    db.add = MagicMock()
    return db


@pytest.fixture
def mock_intent_classifier():
    """IntentClassifier 목 픽스처 (기본: general_qa, confidence=0.9)"""
    classifier = AsyncMock()
    classifier.classify = AsyncMock(
        return_value=IntentResult(
            intent=QueryIntent.GENERAL_QA,
            confidence=0.9,
            reasoning="일반 질의",
        )
    )
    return classifier


@pytest.fixture
def mock_guidance_service():
    """GuidanceService 목 픽스처"""
    service = AsyncMock()
    service.analyze_dispute = AsyncMock(
        return_value=DisputeAnalysisResponse(
            dispute_type=DisputeType.CLAIM_DENIAL,
            ambiguous_clauses=[],
            precedents=[],
            probability=ProbabilityScore(
                overall_score=0.65,
                factors=["판례 유리"],
                confidence=0.7,
                disclaimer="법적 조언 아님",
            ),
            evidence_strategy=EvidenceStrategy(
                required_documents=["진단서"],
                recommended_documents=["영수증"],
                preparation_tips=["사본 준비"],
                timeline_advice="30일 이내",
            ),
            escalation=EscalationRecommendation(
                recommended_level=EscalationLevel.FSS_COMPLAINT,
                reason="보험사 거절",
                next_steps=["금감원 민원 제기"],
                estimated_duration="3개월",
                cost_estimate="무료",
            ),
            disclaimer="본 분석은 참고용입니다.",
            confidence=0.8,
        )
    )
    return service


def _make_session(session_id: uuid.UUID) -> MagicMock:
    """ChatSession 목 생성 헬퍼"""
    mock_session = MagicMock(spec=ChatSession)
    mock_session.id = session_id
    mock_session.messages = []
    return mock_session


def _make_session_result(session: MagicMock) -> MagicMock:
    """DB execute 결과 목 생성 헬퍼"""
    result = MagicMock()
    result.scalar_one_or_none.return_value = session
    return result


def _make_openai_response(content: str) -> MagicMock:
    """OpenAI ChatCompletion 응답 목 생성 헬퍼"""
    choice = MagicMock()
    choice.message.content = content
    response = MagicMock()
    response.choices = [choice]
    return response


def _make_stream_cm(tokens: list[str]) -> MagicMock:
    """스트리밍 컨텍스트 매니저 목 생성 헬퍼"""

    async def _stream():
        for token in tokens:
            chunk = MagicMock()
            chunk.choices = [MagicMock()]
            chunk.choices[0].delta.content = token
            yield chunk

    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=_stream())
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


def _make_chat_service(mock_db, mock_settings, intent_classifier=None, guidance_service=None):
    """ChatService 인스턴스 생성 헬퍼 (선택적 의존성 주입)"""
    from app.services.chat_service import ChatService

    with (
        patch("app.services.chat_service.FallbackChain") as mock_chain_cls,
        patch("app.services.chat_service.get_embedding_service"),
        patch("app.services.chat_service.VectorSearchService"),
    ):
        mock_chain_cls.return_value = AsyncMock()
        service = ChatService(
            db=mock_db,
            settings=mock_settings,
            intent_classifier=intent_classifier,
            guidance_service=guidance_service,
        )
        mock_llm_resp = MagicMock()
        mock_llm_resp.content = "테스트 응답입니다."
        service._llm_chain = AsyncMock()
        service._llm_chain.generate = AsyncMock(return_value=mock_llm_resp)
        service._vector_search = AsyncMock()
        service._vector_search.search = AsyncMock(return_value=[])
    return service


# ---------------------------------------------------------------------------
# REQ-GC-001: ChatService 의도 분류 통합
# ---------------------------------------------------------------------------


class TestIntentClassifierIntegration:
    """REQ-GC-001: IntentClassifier ChatService 통합 테스트"""

    @pytest.mark.asyncio
    async def test_send_message_calls_intent_classifier(
        self, mock_db, mock_settings, mock_intent_classifier
    ) -> None:
        """ACC-01: send_message에서 IntentClassifier.classify()가 사용자 content로 호출됨"""
        session_id = uuid.uuid4()
        mock_db.execute = AsyncMock(return_value=_make_session_result(_make_session(session_id)))

        service = _make_chat_service(mock_db, mock_settings, intent_classifier=mock_intent_classifier)

        await service.send_message(session_id=session_id, content="보험금 거절당했어요")

        mock_intent_classifier.classify.assert_called_once_with("보험금 거절당했어요")

    @pytest.mark.asyncio
    async def test_send_message_stores_intent_in_metadata(
        self, mock_db, mock_settings, mock_intent_classifier
    ) -> None:
        """ACC-02: 분류된 intent가 metadata_['intent']에 문자열로 저장됨"""
        session_id = uuid.uuid4()
        mock_db.execute = AsyncMock(return_value=_make_session_result(_make_session(session_id)))

        mock_intent_classifier.classify = AsyncMock(
            return_value=IntentResult(
                intent=QueryIntent.DISPUTE_GUIDANCE,
                confidence=0.85,
                reasoning="분쟁 관련",
            )
        )
        service = _make_chat_service(mock_db, mock_settings, intent_classifier=mock_intent_classifier)

        _, assistant_msg = await service.send_message(session_id=session_id, content="보험 분쟁")

        assert assistant_msg.metadata_["intent"] == "dispute_guidance"

    @pytest.mark.asyncio
    async def test_send_message_stores_confidence_in_metadata(
        self, mock_db, mock_settings, mock_intent_classifier
    ) -> None:
        """ACC-02: 분류 신뢰도가 metadata_['confidence']에 저장됨"""
        session_id = uuid.uuid4()
        mock_db.execute = AsyncMock(return_value=_make_session_result(_make_session(session_id)))

        mock_intent_classifier.classify = AsyncMock(
            return_value=IntentResult(
                intent=QueryIntent.GENERAL_QA,
                confidence=0.75,
                reasoning="일반",
            )
        )
        service = _make_chat_service(mock_db, mock_settings, intent_classifier=mock_intent_classifier)

        _, assistant_msg = await service.send_message(session_id=session_id, content="일반 질문")

        assert assistant_msg.metadata_["confidence"] == 0.75

    @pytest.mark.asyncio
    async def test_intent_classifier_error_fallback(
        self, mock_db, mock_settings
    ) -> None:
        """ACC-03: IntentClassifier 오류 시 general_qa로 폴백하고 정상 응답 반환"""
        session_id = uuid.uuid4()
        mock_db.execute = AsyncMock(return_value=_make_session_result(_make_session(session_id)))

        # 오류를 발생시키는 classifier
        failing_classifier = AsyncMock()
        failing_classifier.classify = AsyncMock(side_effect=Exception("API 오류"))

        service = _make_chat_service(mock_db, mock_settings, intent_classifier=failing_classifier)

        # 오류에도 불구하고 정상 응답 반환
        user_msg, assistant_msg = await service.send_message(session_id=session_id, content="질문")

        assert user_msg is not None
        assert assistant_msg is not None
        assert assistant_msg.metadata_["intent"] == "general_qa"

    @pytest.mark.asyncio
    async def test_no_classifier_skips_classification(
        self, mock_db, mock_settings
    ) -> None:
        """ACC-10 (no classifier): intent_classifier=None이면 분류 없이 정상 작동"""
        session_id = uuid.uuid4()
        mock_db.execute = AsyncMock(return_value=_make_session_result(_make_session(session_id)))

        service = _make_chat_service(mock_db, mock_settings, intent_classifier=None)

        user_msg, assistant_msg = await service.send_message(session_id=session_id, content="질문")

        assert user_msg is not None
        assert assistant_msg is not None
        # classifier 없으면 intent는 None 유지
        assert assistant_msg.metadata_["intent"] is None


# ---------------------------------------------------------------------------
# REQ-GC-002: Guidance Analysis Trigger
# ---------------------------------------------------------------------------


class TestGuidanceAnalysisTrigger:
    """REQ-GC-002: GuidanceService 분쟁 분석 트리거 테스트"""

    @pytest.mark.asyncio
    async def test_dispute_guidance_triggers_guidance_service(
        self, mock_db, mock_settings, mock_guidance_service
    ) -> None:
        """ACC-04: dispute_guidance intent + confidence>=0.6 이면 GuidanceService.analyze_dispute 호출"""
        session_id = uuid.uuid4()
        mock_db.execute = AsyncMock(return_value=_make_session_result(_make_session(session_id)))

        dispute_classifier = AsyncMock()
        dispute_classifier.classify = AsyncMock(
            return_value=IntentResult(
                intent=QueryIntent.DISPUTE_GUIDANCE,
                confidence=0.85,
                reasoning="분쟁",
            )
        )
        service = _make_chat_service(
            mock_db,
            mock_settings,
            intent_classifier=dispute_classifier,
            guidance_service=mock_guidance_service,
        )

        await service.send_message(session_id=session_id, content="보험금 거절당했어요")

        mock_guidance_service.analyze_dispute.assert_called_once_with("보험금 거절당했어요")

    @pytest.mark.asyncio
    async def test_guidance_result_stored_in_metadata(
        self, mock_db, mock_settings, mock_guidance_service
    ) -> None:
        """ACC-05: guidance 결과가 metadata_['guidance']에 직렬화되어 저장됨"""
        session_id = uuid.uuid4()
        mock_db.execute = AsyncMock(return_value=_make_session_result(_make_session(session_id)))

        dispute_classifier = AsyncMock()
        dispute_classifier.classify = AsyncMock(
            return_value=IntentResult(
                intent=QueryIntent.DISPUTE_GUIDANCE,
                confidence=0.85,
                reasoning="분쟁",
            )
        )
        service = _make_chat_service(
            mock_db,
            mock_settings,
            intent_classifier=dispute_classifier,
            guidance_service=mock_guidance_service,
        )

        _, assistant_msg = await service.send_message(session_id=session_id, content="보험금 분쟁")

        assert "guidance" in assistant_msg.metadata_
        guidance = assistant_msg.metadata_["guidance"]
        assert isinstance(guidance, dict)
        # DisputeAnalysisResponse 핵심 필드 존재 확인 (ACC-10)
        assert "dispute_type" in guidance
        assert "precedents" in guidance
        assert "probability" in guidance
        assert "evidence_strategy" in guidance
        assert "escalation" in guidance
        assert "disclaimer" in guidance

    @pytest.mark.asyncio
    async def test_guidance_below_confidence_threshold_skipped(
        self, mock_db, mock_settings, mock_guidance_service
    ) -> None:
        """ACC-07: confidence < 0.6이면 guidance 분석 건너뜀"""
        session_id = uuid.uuid4()
        mock_db.execute = AsyncMock(return_value=_make_session_result(_make_session(session_id)))

        low_confidence_classifier = AsyncMock()
        low_confidence_classifier.classify = AsyncMock(
            return_value=IntentResult(
                intent=QueryIntent.DISPUTE_GUIDANCE,
                confidence=0.5,  # 임계값 미달
                reasoning="분쟁 추정",
            )
        )
        service = _make_chat_service(
            mock_db,
            mock_settings,
            intent_classifier=low_confidence_classifier,
            guidance_service=mock_guidance_service,
        )

        await service.send_message(session_id=session_id, content="분쟁인지 모르겠어요")

        # guidance 호출 없음
        mock_guidance_service.analyze_dispute.assert_not_called()

    @pytest.mark.asyncio
    async def test_guidance_service_error_still_returns_response(
        self, mock_db, mock_settings
    ) -> None:
        """ACC-06: guidance 분석 실패 시 기본 채팅 응답은 정상 반환 (guidance만 누락)"""
        session_id = uuid.uuid4()
        mock_db.execute = AsyncMock(return_value=_make_session_result(_make_session(session_id)))

        dispute_classifier = AsyncMock()
        dispute_classifier.classify = AsyncMock(
            return_value=IntentResult(
                intent=QueryIntent.DISPUTE_GUIDANCE,
                confidence=0.85,
                reasoning="분쟁",
            )
        )
        failing_guidance = AsyncMock()
        failing_guidance.analyze_dispute = AsyncMock(side_effect=Exception("guidance 오류"))

        service = _make_chat_service(
            mock_db,
            mock_settings,
            intent_classifier=dispute_classifier,
            guidance_service=failing_guidance,
        )

        # 오류에도 불구하고 정상 응답 반환
        user_msg, assistant_msg = await service.send_message(session_id=session_id, content="분쟁")

        assert user_msg is not None
        assert assistant_msg is not None
        # guidance 키 없거나 None
        assert assistant_msg.metadata_.get("guidance") is None

    @pytest.mark.asyncio
    async def test_non_dispute_intent_skips_guidance(
        self, mock_db, mock_settings, mock_guidance_service
    ) -> None:
        """ACC-09: policy_lookup intent는 guidance 분석 건너뜀"""
        session_id = uuid.uuid4()
        mock_db.execute = AsyncMock(return_value=_make_session_result(_make_session(session_id)))

        policy_classifier = AsyncMock()
        policy_classifier.classify = AsyncMock(
            return_value=IntentResult(
                intent=QueryIntent.POLICY_LOOKUP,
                confidence=0.9,
                reasoning="약관 조회",
            )
        )
        service = _make_chat_service(
            mock_db,
            mock_settings,
            intent_classifier=policy_classifier,
            guidance_service=mock_guidance_service,
        )

        await service.send_message(session_id=session_id, content="암 보장 내용 알고 싶어요")

        mock_guidance_service.analyze_dispute.assert_not_called()


# ---------------------------------------------------------------------------
# REQ-GC-003: SSE Streaming Guidance Event
# ---------------------------------------------------------------------------


class TestStreamingGuidanceEvent:
    """REQ-GC-003: 스트리밍 guidance 이벤트 테스트"""

    @pytest.mark.asyncio
    async def test_stream_yields_guidance_event(
        self, mock_db, mock_settings, mock_guidance_service
    ) -> None:
        """ACC-08: send_message_stream에서 guidance 이벤트 생성"""
        session_id = uuid.uuid4()
        mock_db.execute = AsyncMock(return_value=_make_session_result(_make_session(session_id)))

        dispute_classifier = AsyncMock()
        dispute_classifier.classify = AsyncMock(
            return_value=IntentResult(
                intent=QueryIntent.DISPUTE_GUIDANCE,
                confidence=0.85,
                reasoning="분쟁",
            )
        )
        service = _make_chat_service(
            mock_db,
            mock_settings,
            intent_classifier=dispute_classifier,
            guidance_service=mock_guidance_service,
        )
        mock_llm_resp = MagicMock()
        mock_llm_resp.content = "답변 내용"
        service._llm_chain.generate = AsyncMock(return_value=mock_llm_resp)

        events = []
        async for event in service.send_message_stream(session_id=session_id, content="보험금 분쟁"):
            events.append(event)

        guidance_events = [e for e in events if e.get("type") == "guidance"]
        assert len(guidance_events) == 1
        assert "content" in guidance_events[0]

    @pytest.mark.asyncio
    async def test_stream_guidance_event_after_sources_before_done(
        self, mock_db, mock_settings, mock_guidance_service
    ) -> None:
        """ACC-09: guidance 이벤트는 sources 이후, done 이전에 발생"""
        session_id = uuid.uuid4()
        mock_db.execute = AsyncMock(return_value=_make_session_result(_make_session(session_id)))

        dispute_classifier = AsyncMock()
        dispute_classifier.classify = AsyncMock(
            return_value=IntentResult(
                intent=QueryIntent.DISPUTE_GUIDANCE,
                confidence=0.85,
                reasoning="분쟁",
            )
        )
        service = _make_chat_service(
            mock_db,
            mock_settings,
            intent_classifier=dispute_classifier,
            guidance_service=mock_guidance_service,
        )
        mock_llm_resp2 = MagicMock()
        mock_llm_resp2.content = "토큰"
        service._llm_chain.generate = AsyncMock(return_value=mock_llm_resp2)

        events = []
        async for event in service.send_message_stream(session_id=session_id, content="분쟁"):
            events.append(event)

        event_types = [e["type"] for e in events]
        sources_idx = event_types.index("sources")
        guidance_idx = event_types.index("guidance")
        done_idx = event_types.index("done")

        # sources < guidance < done 순서 보장
        assert sources_idx < guidance_idx < done_idx

    @pytest.mark.asyncio
    async def test_stream_no_guidance_event_when_not_dispute(
        self, mock_db, mock_settings, mock_guidance_service
    ) -> None:
        """ACC-08 보완: 비분쟁 intent이면 guidance 이벤트 없음"""
        session_id = uuid.uuid4()
        mock_db.execute = AsyncMock(return_value=_make_session_result(_make_session(session_id)))

        general_classifier = AsyncMock()
        general_classifier.classify = AsyncMock(
            return_value=IntentResult(
                intent=QueryIntent.GENERAL_QA,
                confidence=0.9,
                reasoning="일반",
            )
        )
        service = _make_chat_service(
            mock_db,
            mock_settings,
            intent_classifier=general_classifier,
            guidance_service=mock_guidance_service,
        )
        mock_llm_resp3 = MagicMock()
        mock_llm_resp3.content = "답변"
        service._llm_chain.generate = AsyncMock(return_value=mock_llm_resp3)

        events = []
        async for event in service.send_message_stream(session_id=session_id, content="일반 질문"):
            events.append(event)

        guidance_events = [e for e in events if e.get("type") == "guidance"]
        assert len(guidance_events) == 0
