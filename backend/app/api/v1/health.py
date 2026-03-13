# 헬스체크 엔드포인트
# 서비스 상태 확인을 위한 API 엔드포인트
from fastapi import APIRouter

from app.core.config import get_settings

router = APIRouter()


@router.get("/health")
async def health_check() -> dict:
    """서비스 헬스체크 엔드포인트

    Returns:
        dict: 서비스 상태와 버전 정보
    """
    settings = get_settings()
    return {
        "status": "ok",
        "version": settings.app_version,
    }
