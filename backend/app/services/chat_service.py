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

from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.models.chat import ChatMessage, ChatSession, MessageRole
from app.services.jit_rag.document_fetcher import DocumentFetcher
from app.services.jit_rag.document_finder import DocumentFinder
from app.services.jit_rag.models import DocumentData
from app.services.jit_rag.product_extractor import ProductNameExtractor
from app.services.jit_rag.section_finder import SectionFinder
from app.services.jit_rag.session_store import JITSessionStore
from app.services.jit_rag.text_extractor import TextExtractor
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
        jit_session_store: JITSessionStore | None = None,
    ) -> None:
        """ChatService 초기화

        Args:
            db: SQLAlchemy 비동기 세션
            settings: 애플리케이션 설정
            intent_classifier: 의도 분류기 (선택, None이면 분류 미수행)
            guidance_service: 분쟁 가이던스 서비스 (선택, None이면 가이던스 미수행)
            jit_session_store: JIT 문서 세션 스토어 (선택, None이면 JIT 미사용)
        """
        self._db = db
        self._settings = settings
        self._intent_classifier = intent_classifier
        self._guidance_service = guidance_service
        self._jit_store = jit_session_store
        self._jit_section_finder = SectionFinder()
        # 자동 JIT 트리거를 위한 보험 상품명 추출기
        self._product_extractor = ProductNameExtractor()
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

    # @MX:ANCHOR: [AUTO] list_sessions - 채팅 세션 목록 API의 핵심 조회 메서드
    # @MX:REASON: chat.py 라우터, 테스트 등 다수 호출자가 사용하는 공개 API
    async def list_sessions(
        self,
        limit: int = 20,
        offset: int = 0,
        user_id: uuid.UUID | None = None,
    ) -> tuple[list[tuple[ChatSession, int]], int]:
        """채팅 세션 목록 반환 (페이지네이션 + SQL COUNT 최적화)

        messages 관계를 로드하지 않고 SQL COUNT 서브쿼리로
        메시지 수를 산출하여 N+1 쿼리 및 메모리 과부하를 방지.

        Args:
            limit: 최대 반환 개수 (기본값: 20)
            offset: 건너뛸 개수 (기본값: 0)
            user_id: 사용자 ID 필터 (None이면 전체 반환)

        Returns:
            (sessions_with_counts, total_count) 튜플
            - sessions_with_counts: [(ChatSession, message_count), ...] 목록
            - total_count: 전체 세션 수 (필터 적용 후)
        """
        # SQL COUNT 서브쿼리로 메시지 수 산출
        message_count_subquery = (
            select(func.count(ChatMessage.id))
            .where(ChatMessage.session_id == ChatSession.id)
            .correlate(ChatSession)
            .scalar_subquery()
        )

        # 세션 목록 쿼리 (message_count 컬럼 포함)
        stmt = (
            select(ChatSession, message_count_subquery.label("message_count"))
            .order_by(ChatSession.updated_at.desc())
            .limit(limit)
            .offset(offset)
        )

        # user_id 필터 적용
        if user_id is not None:
            stmt = stmt.where(ChatSession.user_id == user_id)

        result = await self._db.execute(stmt)
        sessions_with_counts = result.all()

        # 전체 개수 쿼리
        count_stmt = select(func.count(ChatSession.id))
        if user_id is not None:
            count_stmt = count_stmt.where(ChatSession.user_id == user_id)

        count_result = await self._db.execute(count_stmt)
        total_count = count_result.scalar_one()

        return list(sessions_with_counts), total_count

    async def get_session(self, session_id: uuid.UUID) -> ChatSession | None:
        """세션 ID로 채팅 세션 조회 (messages eager load 포함)

        lazy="noload" 기본값으로 인해 명시적으로 selectinload를 지정.
        세션 상세 조회 및 채팅 히스토리 구성에 사용됨.

        Args:
            session_id: 조회할 세션 UUID

        Returns:
            ChatSession (messages 포함) 또는 None (존재하지 않는 경우)
        """
        stmt = (
            select(ChatSession)
            .where(ChatSession.id == session_id)
            .options(selectinload(ChatSession.messages))
        )
        result = await self._db.execute(stmt)
        return result.scalar_one_or_none()

    async def update_session_title(self, session_id: uuid.UUID, title: str) -> ChatSession | None:
        """세션 제목 업데이트

        Args:
            session_id: 업데이트할 세션 UUID
            title: 새 세션 제목

        Returns:
            업데이트된 ChatSession 또는 None (존재하지 않는 경우)
        """
        stmt = select(ChatSession).where(ChatSession.id == session_id)
        result = await self._db.execute(stmt)
        session = result.scalar_one_or_none()
        if session is None:
            return None
        session.title = title
        await self._db.flush()
        return session

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

        # JIT 소스 우선 조회: Redis에서 세션 문서 확인
        jit_document: DocumentData | None = None
        if self._jit_store is not None:
            try:
                jit_document = await self._jit_store.get(str(session_id))
            except Exception as e:
                logger.warning("JIT 문서 조회 실패, 벡터 검색으로 폴백: %s", str(e))

        if jit_document is not None:
            # JIT 소스: 세션에 업로드된 약관 문서 사용
            relevant_sections = self._jit_section_finder.find_relevant(
                content, jit_document.sections
            )
            context_prompt = self._build_jit_context_prompt(jit_document, relevant_sections)
            search_results = []
            sources = [
                {
                    "policy_name": jit_document.product_name,
                    "company_name": "",
                    "chunk_text": s.content[:200],
                    "similarity": 1.0,
                    "section_title": s.title,
                }
                for s in relevant_sections
            ]
        else:
            # 벡터 검색 폴백 (기존 RAG 파이프라인)
            if self._vector_search is not None:
                search_results = await self._vector_search.search(
                    query=content,
                    top_k=self._settings.chat_context_top_k,
                    threshold=self._settings.chat_context_threshold,
                )
            else:
                search_results = []
            context_prompt = self._build_context_prompt(search_results)
            sources = [
                {
                    "policy_name": r.get("policy_name"),
                    "company_name": r.get("company_name"),
                    "chunk_text": r.get("chunk_text", "")[:200],
                    "similarity": r.get("similarity", 0.0),
                }
                for r in search_results
            ]

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

        # 첫 메시지 여부 확인 (lazy="noload"로 session.messages 접근 불가 → SQL COUNT 사용)
        count_stmt = select(func.count(ChatMessage.id)).where(ChatMessage.session_id == session_id)
        count_result = await self._db.execute(count_stmt)
        existing_message_count = count_result.scalar() or 0

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

        # JIT 소스 우선 조회: Redis에서 세션 문서 확인
        jit_document_stream: DocumentData | None = None
        if self._jit_store is not None:
            try:
                jit_document_stream = await self._jit_store.get(str(session_id))
            except Exception as e:
                logger.warning("JIT 문서 조회 실패 (stream), 벡터 검색으로 폴백: %s", str(e))

        # 자동 JIT 트리거: 캐시 없고 JIT 스토어 있고 상품명 감지 시 파이프라인 실행
        if jit_document_stream is None and self._jit_store is not None:
            product_info = self._product_extractor.extract(content)
            if product_info is not None:
                try:
                    from datetime import UTC, datetime

                    yield {"type": "searching_document", "product_name": product_info.product_name}
                    url = await DocumentFinder().find_url(product_info.full_query)
                    fetch_result = await DocumentFetcher().fetch(url)
                    extractor = TextExtractor()
                    # Content-Type에 따라 PDF 또는 HTML 파싱
                    if "pdf" in fetch_result.content_type:
                        sections = extractor.extract_from_pdf(fetch_result.data)
                        source_type = "pdf"
                        try:
                            import pymupdf
                            doc = pymupdf.open(stream=fetch_result.data, filetype="pdf")
                            page_count = len(doc)
                            doc.close()
                        except Exception:
                            page_count = len(sections) if sections else 1
                    else:
                        html_content = fetch_result.data.decode("utf-8", errors="replace")
                        sections = extractor.extract_from_html(html_content)
                        source_type = "html"
                        page_count = 1
                    extracted = DocumentData(
                        product_name=product_info.product_name,
                        source_url=fetch_result.url,
                        source_type=source_type,
                        sections=sections,
                        extracted_at=datetime.now(UTC).isoformat(),
                        page_count=page_count,
                    )
                    await self._jit_store.save(str(session_id), extracted)
                    jit_document_stream = extracted
                    yield {
                        "type": "document_ready",
                        "product_name": product_info.product_name,
                        "page_count": extracted.page_count,
                        "source_url": fetch_result.url,
                    }
                except Exception as e:
                    logger.warning("자동 JIT 파이프라인 실패, 벡터 검색으로 폴백: %s", str(e))

        if jit_document_stream is not None:
            # JIT 소스: 세션에 업로드된 약관 문서 사용
            relevant_sections_stream = self._jit_section_finder.find_relevant(
                content, jit_document_stream.sections
            )
            context_prompt = self._build_jit_context_prompt(
                jit_document_stream, relevant_sections_stream
            )
            search_results = []
            sources = [
                {
                    "policy_name": jit_document_stream.product_name,
                    "company_name": "",
                    "chunk_text": s.content[:200],
                    "similarity": 1.0,
                    "section_title": s.title,
                }
                for s in relevant_sections_stream
            ]
        else:
            # 벡터 검색 폴백 (기존 RAG 파이프라인)
            if self._vector_search is not None:
                search_results = await self._vector_search.search(
                    query=content,
                    top_k=self._settings.chat_context_top_k,
                    threshold=self._settings.chat_context_threshold,
                )
            else:
                search_results = []
            context_prompt = self._build_context_prompt(search_results)
            sources = [
                {
                    "policy_name": r.get("policy_name"),
                    "company_name": r.get("company_name"),
                    "chunk_text": r.get("chunk_text", "")[:200],
                    "similarity": r.get("similarity", 0.0),
                }
                for r in search_results
            ]

        # OpenAI 메시지 배열 구성
        messages = [{"role": "system", "content": self._build_system_prompt()}]
        messages.extend(history)

        user_content = content
        if context_prompt:
            user_content = f"{context_prompt}\n\n사용자 질문: {content}"
        messages.append({"role": "user", "content": user_content})

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

        # 첫 메시지인 경우 세션 제목 자동 생성
        if existing_message_count == 0:
            generated_title = await self._generate_session_title(content)
            if generated_title:
                await self.update_session_title(session_id, generated_title)
                yield {"type": "title_update", "title": generated_title}

    async def _generate_session_title(self, user_message: str) -> str | None:
        """첫 메시지 기반 세션 제목 자동 생성 (15자 이내)

        Args:
            user_message: 사용자의 첫 번째 메시지

        Returns:
            생성된 제목 문자열 (최대 15자) 또는 None (생성 실패 시)
        """
        try:
            prompt_messages = [
                {
                    "role": "system",
                    "content": (
                        "당신은 채팅 제목 생성기입니다. "
                        "사용자의 질문을 10자 이내의 한국어로 간결하게 요약하세요. "
                        "제목만 출력하세요."
                    ),
                },
                {"role": "user", "content": user_message},
            ]
            response = await self._llm_chain.generate(prompt_messages)
            title = (response.content or "").strip().rstrip(".")
            # 15자 초과 시 잘라내기
            if len(title) > 15:
                title = title[:15]
            return title if title else None
        except Exception as e:
            logger.warning("세션 제목 자동 생성 실패: %s", str(e))
            return None

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

    def _build_jit_context_prompt(
        self,
        document: DocumentData,
        sections: list,
    ) -> str:
        """JIT 문서 섹션을 컨텍스트 프롬프트로 변환

        JIT 모드에서 약관 섹션을 LLM 컨텍스트로 구성.
        "다음 약관 조항을 기반으로 답변하세요" 형식 사용.

        Args:
            document: JIT 문서 데이터
            sections: 관련 섹션 목록

        Returns:
            약관 섹션 컨텍스트 프롬프트
        """
        if not sections:
            return f"참고: {document.product_name} 약관이 로드되었으나 관련 조항을 찾지 못했습니다."

        context_parts = [f"다음 {document.product_name} 약관 조항을 기반으로 답변하세요:\n"]

        for section in sections:
            title_line = f"[{section.title}]" if section.title else f"[{section.page_number}페이지]"
            context_parts.append(f"{title_line}\n{section.content}\n")

        return "\n".join(context_parts)

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
