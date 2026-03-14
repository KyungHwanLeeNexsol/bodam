"""사용자 PIPA 엔드포인트 라우터 (SPEC-SEC-001 M2 TAG-1)

계정 삭제(PIPA 제36조) 및 데이터 내보내기(PIPA 제35조) 엔드포인트.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.security import verify_password
from app.models.user import User
from app.schemas.users import DeleteAccountRequest, DeleteAccountResponse, UserDataExportResponse
from app.services.privacy_service import PrivacyService

# 사용자 라우터 (prefix: /users)
router = APIRouter(prefix="/users", tags=["users"])


def get_privacy_service(
    db: AsyncSession = Depends(get_db),
) -> PrivacyService:
    """PrivacyService 의존성 주입 팩토리

    Args:
        db: 비동기 DB 세션

    Returns:
        PrivacyService 인스턴스
    """
    return PrivacyService(session=db)


# @MX:ANCHOR: PIPA 계정 삭제 엔드포인트 - 본인 인증 후 cascade 삭제
# @MX:REASON: SPEC-SEC-001 REQ-SEC-010 구현체. 비밀번호 검증 필수
@router.delete(
    "/me",
    response_model=DeleteAccountResponse,
    status_code=status.HTTP_200_OK,
    summary="계정 삭제 (PIPA 제36조)",
)
async def delete_account(
    body: DeleteAccountRequest,
    current_user: User = Depends(get_current_user),
    privacy_service: PrivacyService = Depends(get_privacy_service),
) -> DeleteAccountResponse:
    """현재 인증된 사용자의 계정과 모든 관련 데이터를 삭제합니다.

    비밀번호 재확인 후 cascade 삭제를 수행합니다 (PIPA 제36조).
    """
    # 비밀번호 검증 (본인 확인)
    if not verify_password(body.password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="비밀번호가 일치하지 않습니다",
        )

    # cascade 삭제 (ChatSession, ConsentRecord 등 자동 삭제)
    await privacy_service.delete_user_data(current_user)

    return DeleteAccountResponse(
        message="계정이 삭제되었습니다",
        deleted_at=datetime.now(tz=UTC).isoformat(),
    )


@router.get(
    "/me/data",
    response_model=UserDataExportResponse,
    status_code=status.HTTP_200_OK,
    summary="내 데이터 내보내기 (PIPA 제35조)",
)
async def export_user_data(
    current_user: User = Depends(get_current_user),
    privacy_service: PrivacyService = Depends(get_privacy_service),
) -> UserDataExportResponse:
    """현재 인증된 사용자의 모든 개인 데이터를 내보냅니다.

    PIPA 제35조(개인정보의 열람)에 따른 데이터 제공 엔드포인트.
    """
    data = await privacy_service.export_user_data(current_user)

    return UserDataExportResponse(
        user=data["user"],
        conversations=data["conversations"],
        policies=data["policies"],
        activity_log=data["activity_log"],
    )
