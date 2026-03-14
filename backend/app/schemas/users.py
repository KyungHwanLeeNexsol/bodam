"""사용자 PIPA 엔드포인트 스키마 (SPEC-SEC-001 TAG-1)

계정 삭제 요청 및 사용자 데이터 내보내기 응답 스키마.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class DeleteAccountRequest(BaseModel):
    """계정 삭제 요청 스키마"""

    # 현재 비밀번호 (계정 삭제 전 본인 인증용)
    password: str


class DeleteAccountResponse(BaseModel):
    """계정 삭제 응답 스키마"""

    # 삭제 완료 메시지
    message: str
    # 삭제 시각 (ISO8601 형식)
    deleted_at: str


class UserDataExportResponse(BaseModel):
    """사용자 데이터 내보내기 응답 스키마 (PIPA 제35조)"""

    # 사용자 기본 정보
    user: dict[str, Any]
    # 채팅 대화 목록
    conversations: list[dict[str, Any]]
    # 보험 정책 목록
    policies: list[dict[str, Any]]
    # 활동 로그
    activity_log: list[dict[str, Any]]
