"""파이프라인 헬스 체커 및 알림 서비스 (SPEC-PIPELINE-001 REQ-14, REQ-15, REQ-16)

임베딩 커버리지 추적, 파이프라인 메트릭 수집, 실패 알림 발송 기능을 제공.
"""
from __future__ import annotations

import structlog

# @MX:ANCHOR: 외부에서 직접 사용하는 모듈 수준 로거 - 테스트에서 패칭 대상
# @MX:REASON: [AUTO] test_send_alert_logs_error에서 patch("...health_checker.logger")로 모킹
logger = structlog.get_logger(__name__)


class PipelineHealthChecker:
    """파이프라인 헬스 체커

    임베딩 커버리지(REQ-14)와 파이프라인 메트릭(REQ-15)을 조회.
    """

    def __init__(self, db_session) -> None:
        # 비동기 DB 세션 주입
        self._session = db_session

    async def get_embedding_coverage(self) -> dict:
        """임베딩 커버리지 조회 (REQ-14)

        전체 Policy 수 대비 임베딩이 존재하는 Policy 수를 계산.

        Returns:
            total_policies, policies_with_embeddings, coverage_percentage 포함 딕셔너리
        """
        from sqlalchemy import func, select

        from app.models.insurance import Policy, PolicyChunk

        # 전체 Policy 수 조회
        total_result = await self._session.execute(select(func.count(Policy.id)))
        total_policies: int = total_result.scalar_one()

        # 임베딩이 있는 Policy 수 (PolicyChunk가 하나라도 있는 Policy)
        with_embed_result = await self._session.execute(
            select(func.count(func.distinct(PolicyChunk.policy_id)))
        )
        policies_with_embeddings: int = with_embed_result.scalar_one()

        coverage_pct = (
            (policies_with_embeddings / total_policies * 100) if total_policies > 0 else 0.0
        )

        return {
            "total_policies": total_policies,
            "policies_with_embeddings": policies_with_embeddings,
            "coverage_percentage": round(coverage_pct, 2),
        }

    async def get_pipeline_metrics(self) -> dict:
        """파이프라인 건강 메트릭 조회 (REQ-15)

        전체/성공/실패 파이프라인 실행 횟수를 집계.

        Returns:
            total_runs, successful_runs, failed_runs 포함 딕셔너리
        """
        from sqlalchemy import func, select

        from app.models.pipeline import PipelineRun, PipelineStatus

        # 전체 실행 수
        total_result = await self._session.execute(select(func.count(PipelineRun.id)))
        total_runs: int = total_result.scalar_one()

        # 성공 실행 수
        success_result = await self._session.execute(
            select(func.count(PipelineRun.id)).where(
                PipelineRun.status == PipelineStatus.COMPLETED
            )
        )
        successful_runs: int = success_result.scalar_one()

        # 실패 실행 수
        failed_result = await self._session.execute(
            select(func.count(PipelineRun.id)).where(
                PipelineRun.status == PipelineStatus.FAILED
            )
        )
        failed_runs: int = failed_result.scalar_one()

        return {
            "total_runs": total_runs,
            "successful_runs": successful_runs,
            "failed_runs": failed_runs,
        }


class AlertNotifier:
    """파이프라인 실패 알림 발송기 (REQ-16)

    심각한 오류 발생 시 ERROR 로그 기록 및 웹훅 알림을 전송.
    """

    def __init__(self, webhook_url: str | None = None) -> None:
        # 웹훅 URL (None이면 로깅만 수행)
        self._webhook_url = webhook_url

    async def send_alert(
        self,
        step_name: str,
        error_message: str,
        pipeline_run_id: str,
    ) -> None:
        """파이프라인 실패 알림 발송 (REQ-16)

        ERROR 레벨 로그를 기록하고, webhook_url이 설정된 경우 HTTP POST 전송.

        Args:
            step_name: 실패가 발생한 파이프라인 단계 이름
            error_message: 오류 메시지
            pipeline_run_id: 파이프라인 실행 ID
        """
        # REQ-16: 심각한 오류 발생 시 ERROR 레벨 로그 기록 (structlog)
        logger.error(
            "파이프라인 단계 실패",
            step=step_name,
            error=error_message,
            pipeline_run_id=pipeline_run_id,
        )

        if self._webhook_url:
            import httpx

            payload = {
                "step": step_name,
                "error": error_message,
                "pipeline_run_id": pipeline_run_id,
            }
            try:
                async with httpx.AsyncClient() as client:
                    await client.post(self._webhook_url, json=payload, timeout=10.0)
            except Exception as exc:
                # 웹훅 발송 실패는 파이프라인 중단 없이 경고만 기록
                logger.warning("Webhook 발송 실패", error=str(exc))
