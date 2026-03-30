"""RAG 기반 AI 채팅 서비스 모듈

VectorSearchService로 관련 약관을 검색한 후
OpenAI ChatCompletion으로 AI 응답을 생성하는 채팅 서비스.

Strangler Fig 패턴:
- gemini_api_key가 있으면 새 LLM 파이프라인 사용
- 없으면 기존 OpenAI 파이프라인으로 폴백
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncIterator
from typing import TYPE_CHECKING

from sqlalchemy import select

from app.models.chat import ChatMessage, ChatSession, MessageRole
from app.services.llm.models import QueryIntent
from app.services.llm.router import FallbackChain
from app.services.rag.embeddings import get_embedding_service
from app.services.rag.vector_store import VectorSearchService

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.core.config import Settings
    from app.services.guidance.guidance_service import GuidanceService
    from app.services.llm.classifier import IntentClassifier

logger = logging.getLogger(__name__)

# 보담 AI 시스템 프롬프트
_SYSTEM_PROMPT = """당신은 '보담'이라는 한국 보험 전문 AI 상담사입니다.
사용자의 보험 관련 질문에 친절하고 정확하게 답변해주세요.

규칙:
1. 제공된 약관 정보를 기반으로 답변하세요.
2. 확실하지 않은 정보는 "정확한 확인이 필요합니다"라고 안내하세요.
3. 답변 시 관련 약관의 출처를 언급하세요.
4. 전문 용어는 쉬운 말로 풀어서 설명하세요."""


class ChatService:
    """RAG 기반 AI 채팅 서비스

    VectorSearchService로 관련 약관 검색 후 OpenAI ChatCompletion으로 응답 생성.
    세션 관리, 메시지 저장, 스트리밍 응답 기능을 포함.
    """

    # # @MX:ANCHOR: [AUTO] ChatService는 채팅 API의 핵심 서비스
    # # @MX:REASON: 채팅 API 라우터, 스트리밍 엔드포인트 등 여러 호출자가 사용

    def __init__(
        self,
        db: AsyncSession,
        settings: Settings,
        intent_classifier: IntentClassifier | None = None,
        guidance_service: GuidanceService | None = None,
    ) -> None:
        """ChatService 초기화

        Args:
            db: SQLAlchemy 비동기 세션
            settings: 애플리케이션 설정
            intent_classifier: 의도 분류기 (선택, None이면 분류 미수행)
            guidance_service: 분쟁 가이던스 서비스 (선택, None이면 가이던스 미수행)
        """
        self._db = db
        self._settings = settings
        self._intent_classifier = intent_classifier
        self._guidance_service = guidance_service
        self._llm_chain = FallbackChain(settings)
        # API 키가 없는 경우 임베딩 서비스 초기화 스킵 (테스트 환경 등)
        if settings.gemini_api_key:
            self._embedding_service = get_embedding_service()
            self._vector_search = VectorSearchService(db, self._embedding_service)
        else:
            self._embedding_service = None
            self._vector_search = None

    async def create_session(self, title: str = "새 대화", user_id: str | uuid.UUID | None = None) -> ChatSession:
        """새 채팅 세션 생성

        Args:
            title: 세션 제목 (기본값: '새 대화')
            user_id: 사용자 식별자 (선택)

        Returns:
            생성된 ChatSession 인스턴스
        """
        session = ChatSession(title=title, user_id=user_id)
        self._db.add(session)
        await self._db.flush()
        return session

    async def list_sessions(self) -> list[ChatSession]:
        """모든 채팅 세션 목록 반환 (최신순)

        Returns:
            ChatSession 목록 (updated_at 내림차순)
        """
        stmt = select(ChatSession).order_by(ChatSession.updated_at.desc())
        result = await self._db.execute(stmt)
        return result.scalars().all()

    async def get_session(self, session_id: uuid.UUID) -> ChatSession | None:
        """세션 ID로 채팅 세션 조회

        Args:
            session_id: 조회할 세션 UUID

        Returns:
            ChatSession 또는 None (존재하지 않는 경우)
        """
        stmt = select(ChatSession).where(ChatSession.id == session_id)
        result = await self._db.execute(stmt)
        return result.scalar_one_or_none()

    async def delete_session(self, session_id: uuid.UUID) -> bool:
        """채팅 세션 삭제

        Args:
            session_id: 삭제할 세션 UUID

        Returns:
            True: 삭제 성공, False: 세션 없음
        """
        session = await self.get_session(session_id)
        if session is None:
            return False

        await self._db.delete(session)
        await self._db.flush()
        return True

    async def send_message(
        self,
        session_id: uuid.UUID,
        content: str,
    ) -> tuple[ChatMessage, ChatMessage]:
        """메시지 전송 및 AI 응답 생성 (RAG 파이프라인)

        1. 사용자 메시지 저장
        2. 이전 대화 히스토리 조회 (최근 N개)
        3. VectorSearchService로 관련 약관 검색
        4. OpenAI ChatCompletion 호출
        5. AI 응답 메시지 저장 (메타데이터 포함)

        Args:
            session_id: 메시지를 전송할 세션 UUID
            content: 사용자 메시지 내용

        Returns:
            (user_message, assistant_message) 튜플
        """
        # 세션 조회
        session = await self.get_session(session_id)

        # 사용자 메시지 저장
        user_msg = ChatMessage(
            session_id=session_id,
            role=MessageRole.USER,
            content=content,
        )
        self._db.add(user_msg)
        await self._db.flush()

        # 이전 대화 히스토리 구성
        history = self._get_chat_history(session, self._settings.chat_history_limit)

        # RAG: 관련 약관 검색 (벡터 검색 서비스 미설정 시 빈 결과)
        if self._vector_search is not None:
            search_results = await self._vector_search.search(
                query=content,
                top_k=self._settings.chat_context_top_k,
                threshold=self._settings.chat_context_threshold,
            )
        else:
            search_results = []

        # 컨텍스트 프롬프트 구성
        context_prompt = self._build_context_prompt(search_results)

        # OpenAI 메시지 배열 구성
        messages = [{"role": "system", "content": self._build_system_prompt()}]
        messages.extend(history)

        # 사용자 메시지에 컨텍스트 추가
        user_content = content
        if context_prompt:
            user_content = f"{context_prompt}\n\n사용자 질문: {content}"

        messages.append({"role": "user", "content": user_content})

        # LLM FallbackChain 호출 (Gemini → OpenAI 폴백)
        try:
            llm_response = await self._llm_chain.generate(messages)
            ai_content = llm_response.content or ""
        except Exception as e:
            logger.error("LLM 호출 실패: %s", str(e))
            ai_content = "AI 서비스에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요."

        # 출처 메타데이터 구성
        sources = [
            {
                "policy_name": r.get("policy_name"),
                "company_name": r.get("company_name"),
                "chunk_text": r.get("chunk_text", "")[:200],  # 200자 제한
                "similarity": r.get("similarity", 0.0),
            }
            for r in search_results
        ]

        # 의도 분류 및 분쟁 가이던스 분석
        intent_str, confidence = await self._classify_intent(content)
        guidance_data = await self._analyze_guidance(content, intent_str, confidence)

        # AI 응답 메시지 저장 (확장된 메타데이터)
        assistant_msg = ChatMessage(
            session_id=session_id,
            role=MessageRole.ASSISTANT,
            content=ai_content,
            metadata_={
                "model": self._settings.chat_model,
                "sources": sources,
                # 의도 분류 결과
                "intent": intent_str,
                "cost": 0.0,
                "tokens": 0,
                "confidence": confidence,
                # 분쟁 가이던스 (해당하는 경우만 포함)
                "guidance": guidance_data,
            },
        )
        self._db.add(assistant_msg)
        await self._db.flush()

        return user_msg, assistant_msg

    async def send_message_stream(
        self,
        session_id: uuid.UUID,
        content: str,
    ) -> AsyncIterator[dict]:
        """스트리밍 메시지 전송 및 AI 응답 생성

        SSE(Server-Sent Events)용 비동기 제너레이터.
        token -> sources -> done 순서로 이벤트 생성.

        Args:
            session_id: 메시지를 전송할 세션 UUID
            content: 사용자 메시지 내용

        Yields:
            {"type": "token", "content": str}: AI 응답 토큰
            {"type": "sources", "content": list}: 참조 약관 출처
            {"type": "done", "message_id": str}: 완료 신호
        """
        # 세션 조회
        session = await self.get_session(session_id)

        # 사용자 메시지 저장
        user_msg = ChatMessage(
            session_id=session_id,
            role=MessageRole.USER,
            content=content,
        )
        self._db.add(user_msg)
        await self._db.flush()

        # 이전 대화 히스토리 구성
        history = self._get_chat_history(session, self._settings.chat_history_limit)

        # RAG: 관련 약관 검색 (벡터 검색 서비스 미설정 시 빈 결과)
        if self._vector_search is not None:
            search_results = await self._vector_search.search(
                query=content,
                top_k=self._settings.chat_context_top_k,
                threshold=self._settings.chat_context_threshold,
            )
        else:
            search_results = []

        # 컨텍스트 프롬프트 구성
        context_prompt = self._build_context_prompt(search_results)

        # OpenAI 메시지 배열 구성
        messages = [{"role": "system", "content": self._build_system_prompt()}]
        messages.extend(history)

        user_content = content
        if context_prompt:
            user_content = f"{context_prompt}\n\n사용자 질문: {content}"
        messages.append({"role": "user", "content": user_content})

        # 출처 메타데이터 구성
        sources = [
            {
                "policy_name": r.get("policy_name"),
                "company_name": r.get("company_name"),
                "chunk_text": r.get("chunk_text", "")[:200],
                "similarity": r.get("similarity", 0.0),
            }
            for r in search_results
        ]

        # LLM FallbackChain으로 응답 생성 (Gemini → OpenAI 폴백)
        full_content = ""
        try:
            llm_response = await self._llm_chain.generate(messages)
            full_content = llm_response.content or ""
            # 전체 응답을 한번에 전송 (스트리밍 미지원 시)
            yield {"type": "token", "content": full_content}
        except Exception as e:
            logger.error("LLM 스트리밍 호출 실패: %s", str(e))
            full_content = "AI 서비스에 일시적인 문제가 발생했습니다."
            yield {"type": "token", "content": full_content}

        # 의도 분류 및 분쟁 가이던스 분석
        intent_str_stream, confidence_stream = await self._classify_intent(content)
        guidance_data_stream = await self._analyze_guidance(content, intent_str_stream, confidence_stream)

        # 출처 이벤트 전송
        yield {"type": "sources", "content": sources}

        # guidance 이벤트 전송 (sources 이후, done 이전)
        if guidance_data_stream is not None:
            yield {"type": "guidance", "content": guidance_data_stream}

        # AI 응답 메시지 저장 (전체 내용, 확장된 메타데이터)
        assistant_msg = ChatMessage(
            session_id=session_id,
            role=MessageRole.ASSISTANT,
            content=full_content,
            metadata_={
                "model": self._settings.chat_model,
                "sources": sources,
                # 의도 분류 결과
                "intent": intent_str_stream,
                "cost": 0.0,
                "tokens": 0,
                "confidence": confidence_stream,
                # 분쟁 가이던스 (해당하는 경우만 포함)
                "guidance": guidance_data_stream,
            },
        )
        self._db.add(assistant_msg)
        await self._db.flush()

        # 완료 이벤트 전송
        yield {"type": "done", "message_id": str(assistant_msg.id)}

    async def _classify_intent(self, content: str) -> tuple[str | None, float]:
        """쿼리 의도 분류 (classifier 미주입 시 None 반환)

        Args:
            content: 분류할 사용자 쿼리

        Returns:
            (intent_str, confidence) 튜플.
            classifier 없으면 (None, 0.0) 반환.
            오류 발생 시 (general_qa, 0.0) 폴백.
        """
        if self._intent_classifier is None:
            return None, 0.0
        try:
            result = await self._intent_classifier.classify(content)
            return str(result.intent), result.confidence
        except Exception as e:
            logger.error("의도 분류 오류 발생, general_qa로 폴백: %s", str(e))
            return str(QueryIntent.GENERAL_QA), 0.0

    async def _analyze_guidance(
        self,
        content: str,
        intent_str: str | None,
        confidence: float,
    ) -> dict | None:
        """분쟁 가이던스 분석 (dispute_guidance + confidence >= 0.6인 경우)

        Args:
            content: 분석할 사용자 쿼리
            intent_str: 분류된 의도 문자열
            confidence: 분류 신뢰도

        Returns:
            DisputeAnalysisResponse.model_dump() 딕셔너리 또는 None.
            분석 불필요 또는 오류 시 None 반환.
        """
        if (
            intent_str != str(QueryIntent.DISPUTE_GUIDANCE)
            or confidence < 0.6
            or self._guidance_service is None
        ):
            return None
        try:
            result = await self._guidance_service.analyze_dispute(content)
            return result.model_dump()
        except Exception as e:
            logger.error("분쟁 가이던스 분석 오류 발생: %s", str(e))
            return None

    def _get_chat_history(
        self,
        session: ChatSession | None,
        limit: int,
    ) -> list[dict]:
        """세션의 이전 대화 히스토리를 OpenAI 형식으로 반환

        Args:
            session: 채팅 세션 인스턴스 (None이면 빈 리스트)
            limit: 포함할 최대 메시지 수

        Returns:
            OpenAI 메시지 형식 딕셔너리 목록
        """
        if session is None or not session.messages:
            return []

        # 최근 N개 메시지만 사용
        recent_messages = session.messages[-limit:]

        return [{"role": str(msg.role), "content": msg.content} for msg in recent_messages]

    def _build_system_prompt(self) -> str:
        """보담 AI 시스템 프롬프트 반환

        Returns:
            한국 보험 전문가 페르소나 시스템 프롬프트
        """
        return _SYSTEM_PROMPT

    def _build_context_prompt(self, search_results: list[dict]) -> str:
        """검색 결과를 컨텍스트 프롬프트로 변환

        Args:
            search_results: VectorSearchService.search() 반환값

        Returns:
            약관 컨텍스트 프롬프트 문자열 (결과 없으면 안내 메시지)
        """
        if not search_results:
            return "참고: 관련 약관 정보를 찾지 못했습니다. 일반적인 보험 지식을 바탕으로 답변해주세요."

        context_parts = ["다음은 관련 약관 정보입니다:\n"]

        for i, result in enumerate(search_results, 1):
            policy_name = result.get("policy_name", "알 수 없음")
            company_name = result.get("company_name", "알 수 없음")
            chunk_text = result.get("chunk_text", "")

            context_parts.append(f"[출처 {i}] {company_name} - {policy_name}\n{chunk_text}\n")

        return "\n".join(context_parts)
