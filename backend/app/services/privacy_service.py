"""PIPA 컴플라이언스 개인정보 서비스 (SPEC-SEC-001 M2)

사용자 데이터 삭제(cascade) 및 데이터 내보내기 기능을 제공한다.
대한민국 개인정보보호법(PIPA) 제35조(개인정보의 열람), 제36조(정정·삭제) 준수.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession


class PrivacyService:
    """개인정보 처리 서비스

    # @MX:ANCHOR: PIPA 데이터 삭제/내보내기의 핵심 서비스
    # @MX:REASON: SPEC-SEC-001 REQ-SEC-013~014 구현체
    """

    def __init__(self, session: AsyncSession) -> None:
        """초기화

        Args:
            session: SQLAlchemy 비동기 세션
        """
        self._session = session

    async def export_user_data(self, user: Any) -> dict[str, Any]:
        """사용자 전체 데이터를 JSON 형식으로 내보내기 (PIPA 제35조)

        Args:
            user: User 모델 인스턴스

        Returns:
            dict: 사용자 데이터 전체 (user, conversations, policies, activity_log)
        """
        import sqlalchemy as sa

        # 채팅 세션 조회 (text 쿼리로 ORM import 의존성 최소화)
        stmt = sa.text(
            "SELECT id, title, created_at FROM chat_sessions WHERE user_id = :user_id"
        ).bindparams(user_id=str(user.id))
        result = await self._session.execute(stmt)
        raw_rows = result.fetchall() if hasattr(result, "fetchall") else []
        sessions = raw_rows

        conversations = [
            {
                "id": str(s[0]),
                "title": s[1],
                "created_at": s[2].isoformat() if s[2] else None,
            }
            for s in sessions
        ]

        return {
            "user": {
                "id": str(user.id),
                "email": user.email,
                "full_name": user.full_name,
                "created_at": user.created_at.isoformat() if user.created_at else None,
            },
            "conversations": conversations,
            "policies": [],  # 현재 보험 정책 등록 기능 미구현 - 빈 리스트 반환
            "activity_log": [],  # 활동 로그 - 향후 구현
        }

    async def delete_user_data(self, user: Any) -> None:
        """사용자 데이터 전체 cascade 삭제 (PIPA 제36조)

        SQLAlchemy cascade="all, delete-orphan" 설정으로
        관련 ChatSession, ConsentRecord 등 자동 삭제.

        Args:
            user: 삭제할 User 모델 인스턴스
        """
        await self._session.delete(user)
        await self._session.commit()
