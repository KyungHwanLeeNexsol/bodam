"""JIT RAG 세션 스토어 (SPEC-JIT-001)

Redis 기반 JIT 문서 세션 저장소.
세션 ID를 키로 DocumentData를 JSON 직렬화하여 Redis에 저장.
"""

from __future__ import annotations

import json
import logging

from app.services.jit_rag.models import DocumentData

logger = logging.getLogger(__name__)

# Redis 키 형식: jit_doc:{session_id}
_KEY_PREFIX = "jit_doc"
# 세션 TTL: 1시간
_TTL_SECONDS = 3600


class JITSessionStore:
    """Redis 기반 JIT 문서 세션 스토어

    # @MX:ANCHOR: [AUTO] JIT 문서의 Redis 저장/조회 인터페이스
    # @MX:REASON: jit.py 라우터, chat_service.py 등 여러 호출자가 사용
    """

    def __init__(self, redis_client) -> None:
        """JITSessionStore 초기화

        Args:
            redis_client: redis.asyncio 클라이언트 인스턴스
        """
        self._redis = redis_client

    def _make_key(self, session_id: str) -> str:
        """Redis 키 생성

        Args:
            session_id: 세션 식별자

        Returns:
            Redis 키 문자열 (예: "jit_doc:abc123")
        """
        return f"{_KEY_PREFIX}:{session_id}"

    async def save(self, session_id: str, document: DocumentData) -> None:
        """문서 데이터를 Redis에 저장

        Args:
            session_id: 세션 식별자
            document: 저장할 DocumentData 인스턴스
        """
        key = self._make_key(session_id)
        data = document.model_dump_json().encode("utf-8")
        await self._redis.setex(key, _TTL_SECONDS, data)
        logger.debug("JIT 문서 저장: session_id=%s, product=%s", session_id, document.product_name)

    async def get(self, session_id: str) -> DocumentData | None:
        """Redis에서 문서 데이터 조회

        Args:
            session_id: 세션 식별자

        Returns:
            DocumentData 또는 None (존재하지 않거나 만료된 경우)
        """
        key = self._make_key(session_id)
        raw = await self._redis.get(key)
        if raw is None:
            return None
        try:
            data = json.loads(raw)
            return DocumentData.model_validate(data)
        except Exception as e:
            logger.error("JIT 문서 역직렬화 실패: session_id=%s, error=%s", session_id, str(e))
            return None

    async def delete(self, session_id: str) -> None:
        """Redis에서 문서 데이터 삭제

        Args:
            session_id: 세션 식별자
        """
        key = self._make_key(session_id)
        await self._redis.delete(key)
        logger.debug("JIT 문서 삭제: session_id=%s", session_id)
