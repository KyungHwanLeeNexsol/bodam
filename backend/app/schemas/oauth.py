"""OAuth2 관련 Pydantic 스키마 (SPEC-OAUTH-001 TAG-003)

요청/응답 데이터 검증 및 직렬화 스키마 정의.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class OAuthUserInfo(BaseModel):
    """OAuth2 프로바이더에서 받은 사용자 정보

    각 프로바이더가 반환하는 형식을 통일된 구조로 변환.
    """

    # 프로바이더 식별자
    provider: str

    # 프로바이더 내 고유 사용자 ID
    provider_user_id: str

    # 프로바이더 이메일 (카카오는 선택 동의라 None 가능)
    email: str | None = None

    # 프로바이더 이름
    name: str | None = None

    # 프로필 이미지 URL
    profile_image: str | None = None


class OAuthToken(BaseModel):
    """OAuth2 액세스 토큰 정보"""

    # 액세스 토큰 (API 호출에 사용)
    access_token: str

    # 리프레시 토큰 (일부 프로바이더에서 제공)
    refresh_token: str | None = None

    # 토큰 타입 (기본값: bearer)
    token_type: str = "bearer"

    # 만료 시간 (초)
    expires_in: int | None = None


class OAuthCallbackResponse(BaseModel):
    """OAuth2 콜백 처리 후 반환하는 JWT 토큰 응답"""

    # 보담 플랫폼 JWT 액세스 토큰
    access_token: str

    # 토큰 타입
    token_type: str = "bearer"

    # 신규 사용자 여부 (프론트엔드 온보딩 처리용)
    is_new_user: bool = False


class OAuthMergeRequest(BaseModel):
    """기존 계정과 소셜 계정 병합 요청

    이메일이 이미 존재하는 경우 비밀번호 확인 후 병합.
    """

    # 병합할 소셜 프로바이더
    provider: str

    # OAuthService.get_or_create_user()에서 발급한 임시 병합 토큰
    merge_token: str

    # 기존 계정 비밀번호 확인용
    password: str


class SocialAccountResponse(BaseModel):
    """연결된 소셜 계정 정보 응답"""

    # 프로바이더 식별자
    provider: str

    # 프로바이더 이메일
    provider_email: str | None = None

    # 프로바이더 이름
    provider_name: str | None = None

    # 연결 시각
    connected_at: datetime

    model_config = {"from_attributes": True}
