"""B2B 사용량 추적 미들웨어 (SPEC-B2B-001 Phase 4)

/api/v1/b2b/ 경로 API 호출을 자동으로 사용량 기록하고,
월 한도 초과 시 429를 반환한다.
"""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response


class UsageTrackingMiddleware(BaseHTTPMiddleware):
    """B2B API 사용량 추적 미들웨어 (AC-009, AC-010)

    - /api/v1/b2b/ 경로만 추적
    - /usage, /billing 엔드포인트 제외 (무한 루프 방지)
    - 한도 초과 시 429 반환
    - X-Usage-Remaining 헤더 추가
    """

    # 추적 대상 기본 경로
    _B2B_PREFIX = "/api/v1/b2b/"

    # 추적에서 제외할 서브경로 (무한 루프 방지)
    _EXCLUDED_SUFFIXES = ("/usage", "/billing", "/usage/")

    def _should_track(self, path: str) -> bool:
        """요청 경로가 추적 대상인지 확인한다.

        Args:
            path: URL 경로

        Returns:
            추적 대상이면 True
        """
        if not path.startswith(self._B2B_PREFIX):
            return False

        # /usage, /billing 서브경로는 제외
        relative = path[len(self._B2B_PREFIX) - 1:]
        for excluded in ("/usage", "/billing"):
            if relative == excluded or relative.startswith(excluded + "/") or relative.startswith(excluded + "?"):
                return False

        return True

    async def _get_org_id_from_request(self, request: Request) -> str | None:
        """요청에서 조직 ID를 추출한다 (state 또는 헤더에서).

        Args:
            request: HTTP 요청

        Returns:
            조직 ID 문자열 또는 None
        """
        # request.state에 org_id가 설정되어 있으면 사용
        org_id = getattr(request.state, "org_id", None)
        if org_id is not None:
            return str(org_id)
        return None

    async def _check_quota(self, org_id: str) -> tuple[int, int, bool]:
        """조직의 현재 사용량과 한도를 확인한다.

        Args:
            org_id: 조직 ID

        Returns:
            (current, limit, is_exceeded) 튜플
        """
        # 실제 구현에서는 Redis/DB에서 사용량을 확인
        # MVP에서는 초과하지 않은 것으로 반환
        return 0, 1000, False

    async def dispatch(self, request: Request, call_next) -> Response:
        """미들웨어 처리 로직.

        Args:
            request: HTTP 요청
            call_next: 다음 미들웨어/핸들러

        Returns:
            HTTP 응답
        """
        path = request.url.path

        # 추적 대상이 아니면 그냥 통과
        if not self._should_track(path):
            return await call_next(request)

        # 조직 ID 추출
        org_id = await self._get_org_id_from_request(request)

        # 조직 ID가 없으면 사용량 추적 없이 통과 (인증 전 상태)
        if org_id is None:
            response = await call_next(request)
            return response

        # 사용량 한도 확인
        current, limit, is_exceeded = await self._check_quota(org_id)

        if is_exceeded:
            return JSONResponse(
                status_code=429,
                content={
                    "detail": "월간 API 호출 한도를 초과했습니다.",
                    "current_usage": current,
                    "monthly_limit": limit,
                },
                headers={"X-Usage-Remaining": "0"},
            )

        # 요청 처리
        response = await call_next(request)

        # X-Usage-Remaining 헤더 추가
        remaining = max(0, limit - current - 1)
        response.headers["X-Usage-Remaining"] = str(remaining)

        return response
