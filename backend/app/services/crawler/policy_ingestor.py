"""PolicyIngestor 서비스 (SPEC-CRAWLER-002 REQ-07.2~7.6)

크롤러가 발견한 보험 상품 정보를 DB에 저장하고
DocumentProcessor 파이프라인을 트리거하는 서비스.

주요 기능:
- Policy upsert: (product_code, company_code) 복합 키 기반
- content_hash 중복 감지: 변경 없는 상품 SKIPPED 처리
- DB 실패 처리: FAILED 상태 반환, PDF 파일 보존
- Celery 태스크 디스패치: 성공 시 ingest_policy 태스크 실행
- CrawlRun 통계 업데이트: 완료 후 집계 통계 저장
"""

from __future__ import annotations

import asyncio
import dataclasses
import logging
import random
import uuid
from typing import Any

logger = logging.getLogger(__name__)


def _is_serialization_error(exc: BaseException) -> bool:
    """CockroachDB RETRY_SERIALIZABLE 에러 여부 확인."""
    err: BaseException | None = exc
    while err is not None:
        if type(err).__name__ == "SerializationError":
            return True
        if "SerializationError" in str(type(err)):
            return True
        err = err.__cause__ or err.__context__
    return "RETRY_SERIALIZABLE" in str(exc) or "SerializationError" in str(exc)


@dataclasses.dataclass
class IngestResult:
    """단일 상품 인제스트 결과

    status: NEW (신규), UPDATED (변경), SKIPPED (동일), FAILED (오류)
    policy_id: 저장된 Policy UUID (실패 시 None)
    error: 오류 메시지 (성공/건너뜀 시 None)
    """

    status: str
    policy_id: uuid.UUID | None
    error: str | None


# @MX:ANCHOR: [AUTO] PolicyIngestor는 크롤러 파이프라인의 핵심 저장 서비스
# @MX:REASON: GenericLifeCrawler, GenericNonlifeCrawler 등 모든 크롤러가 이 서비스를 통해 DB에 저장
class PolicyIngestor:
    """크롤링 결과를 DB에 저장하는 인제스터

    REQ-07.2: (product_code, company_code) 복합 키로 Policy upsert
    REQ-07.3: 성공 시 ingest_policy Celery 태스크 디스패치
    REQ-07.4: DB 저장 실패 시 FAILED 반환 (PDF 파일 보존)
    REQ-07.5: content_hash 이미 존재하면 SKIPPED 반환
    REQ-07.6: CrawlRun 완료 시 통계 업데이트
    """

    def __init__(self, db_session: Any) -> None:
        """초기화

        Args:
            db_session: SQLAlchemy 비동기 세션
        """
        self.db_session = db_session

    async def ingest(
        self,
        listing: Any,
        content_hash: str | None = None,
        crawl_result_id: uuid.UUID | None = None,
        pdf_path: str | None = None,
    ) -> IngestResult:
        """보험 상품 정보를 DB에 upsert하고 DocumentProcessor를 트리거

        CockroachDB RETRY_SERIALIZABLE 에러 발생 시 지수 백오프로 재시도.
        실제 처리 로직은 _ingest_once()에 위임.

        처리 순서:
        1. content_hash 중복 확인 (REQ-07.5)
        2. InsuranceCompany 원자적 UPSERT (경쟁 조건 방지)
        3. Policy 원자적 UPSERT - (company_id, product_code) 기준 (REQ-07.2)
        4. Celery 태스크 디스패치 (REQ-07.3)
        5. 오류 발생 시 FAILED 반환 (REQ-07.4)

        Args:
            listing: PolicyListing 인스턴스
            content_hash: PDF 콘텐츠 SHA-256 해시 (선택)
            crawl_result_id: 연관 CrawlResult UUID (선택)
            pdf_path: PDF 파일 저장 경로 (선택, Celery 태스크 전달용)

        Returns:
            IngestResult (status: NEW/UPDATED/SKIPPED/FAILED)
        """
        max_retries = 5
        base_backoff = 0.2

        for attempt in range(max_retries):
            try:
                return await self._ingest_once(listing, content_hash, crawl_result_id, pdf_path)
            except Exception as exc:  # noqa: BLE001
                if _is_serialization_error(exc) and attempt < max_retries - 1:
                    wait = base_backoff * (2**attempt) + random.uniform(0, 0.05)
                    logger.warning(
                        "CockroachDB 직렬화 충돌 → %d/%d 재시도 (%.2fs 후): product_code=%s",
                        attempt + 1,
                        max_retries,
                        wait,
                        listing.product_code,
                    )
                    try:
                        await self.db_session.rollback()
                    except Exception:  # noqa: BLE001
                        pass
                    await asyncio.sleep(wait)
                    continue
                # REQ-07.4: DB 저장 실패 시 FAILED 반환
                logger.error(
                    "Policy 저장 실패: product_code=%s, error=%s",
                    listing.product_code,
                    str(exc),
                )
                try:
                    await self.db_session.rollback()
                except Exception:  # noqa: BLE001
                    pass
                return IngestResult(status="FAILED", policy_id=None, error=str(exc))

        return IngestResult(status="FAILED", policy_id=None, error="최대 재시도 횟수 초과")

    async def _ingest_once(
        self,
        listing: Any,
        content_hash: str | None = None,
        crawl_result_id: uuid.UUID | None = None,
        pdf_path: str | None = None,
    ) -> IngestResult:
        """실제 인제스트 로직 (재시도 없음 - 예외는 ingest()로 전파)

        원자적 UPSERT 패턴으로 CockroachDB 직렬화 충돌 최소화.
        """
        from sqlalchemy import func, select
        from sqlalchemy.dialects.postgresql import insert as pg_insert

        from app.models.crawler import CrawlResult
        from app.models.insurance import InsuranceCompany, InsuranceCategory, Policy

        # REQ-07.5: content_hash 중복 확인
        if content_hash:
            dup_result = await self.db_session.execute(
                select(CrawlResult).where(
                    CrawlResult.content_hash == content_hash,
                    CrawlResult.status.in_(["NEW", "UPDATED"]),
                )
            )
            existing = dup_result.scalar_one_or_none()
            if existing is not None:
                logger.debug(
                    "content_hash 중복 감지, SKIPPED: product_code=%s, hash=%s",
                    listing.product_code,
                    content_hash[:8],
                )
                return IngestResult(status="SKIPPED", policy_id=None, error=None)

        # InsuranceCompany 원자적 UPSERT (경쟁 조건 방지)
        # 동시 트랜잭션이 동일 company_code를 삽입해도 ON CONFLICT DO NOTHING으로 안전
        await self.db_session.execute(
            pg_insert(InsuranceCompany)
            .values(
                name=listing.company_name,
                code=listing.company_code,
                is_active=True,
            )
            .on_conflict_do_nothing(index_elements=["code"])
        )
        await self.db_session.flush()

        company_result = await self.db_session.execute(
            select(InsuranceCompany).where(InsuranceCompany.code == listing.company_code)
        )
        company = company_result.scalar_one()

        # Policy 존재 여부 확인 (NEW/UPDATED 상태 결정용)
        policy_check = await self.db_session.execute(
            select(Policy.id).where(
                Policy.company_id == company.id,
                Policy.product_code == listing.product_code,
            )
        )
        is_new = policy_check.scalar_one_or_none() is None

        # REQ-07.1: sale_status 포함하여 저장
        category_map = {
            "LIFE": InsuranceCategory.LIFE,
            "NON_LIFE": InsuranceCategory.NON_LIFE,
            "THIRD_SECTOR": InsuranceCategory.THIRD_SECTOR,
        }
        category = category_map.get(listing.category.upper(), InsuranceCategory.LIFE)

        # 충돌 시 업데이트할 필드 구성
        update_set: dict = {
            "name": listing.product_name,
            "sale_status": str(listing.sale_status),
            "updated_at": func.now(),
        }
        if getattr(listing, "effective_date", None) is not None:
            update_set["effective_date"] = listing.effective_date
        if getattr(listing, "expiry_date", None) is not None:
            update_set["expiry_date"] = listing.expiry_date

        # Policy 원자적 UPSERT (경쟁 조건 방지)
        # 동시 트랜잭션이 동일 (company_id, product_code)를 삽입해도 ON CONFLICT DO UPDATE로 안전
        policy_id_result = await self.db_session.execute(
            pg_insert(Policy)
            .values(
                company_id=company.id,
                name=listing.product_name,
                product_code=listing.product_code,
                category=category,
                effective_date=getattr(listing, "effective_date", None),
                expiry_date=getattr(listing, "expiry_date", None),
                sale_status=str(listing.sale_status),
            )
            .on_conflict_do_update(
                constraint="uq_policy_company_product",
                set_=update_set,
            )
            .returning(Policy.id)
        )
        policy_id = policy_id_result.scalar_one()

        await self.db_session.commit()

        result_status = "NEW" if is_new else "UPDATED"

        # REQ-07.3: Celery 태스크 디스패치 (성공 시)
        if crawl_result_id and pdf_path:
            try:
                from app.tasks.crawler_tasks import ingest_policy
                ingest_policy.delay(str(crawl_result_id), pdf_path)
                logger.info(
                    "ingest_policy 태스크 디스패치: crawl_result_id=%s",
                    crawl_result_id,
                )
            except Exception as exc:  # noqa: BLE001
                # Celery 연결 실패 시에도 인제스트 결과는 반환
                logger.warning("Celery 태스크 디스패치 실패: %s", str(exc))

        logger.info(
            "Policy 저장 완료: product_code=%s, company=%s, status=%s",
            listing.product_code,
            listing.company_code,
            result_status,
        )
        return IngestResult(
            status=result_status,
            policy_id=policy_id,
            error=None,
        )

    async def finalize_crawl_run(
        self,
        crawl_run_id: uuid.UUID,
        new_count: int,
        updated_count: int,
        skipped_count: int,
        failed_count: int,
    ) -> None:
        """크롤링 완료 후 CrawlRun 통계 및 상태 업데이트 (REQ-07.6)

        Args:
            crawl_run_id: 업데이트할 CrawlRun UUID
            new_count: 신규 상품 수
            updated_count: 업데이트된 상품 수
            skipped_count: 건너뛴 상품 수 (변경 없음)
            failed_count: 실패한 상품 수
        """
        from datetime import datetime, timezone

        from sqlalchemy import select

        from app.models.crawler import CrawlRun, CrawlStatus

        try:
            result = await self.db_session.execute(
                select(CrawlRun).where(CrawlRun.id == crawl_run_id)
            )
            crawl_run = result.scalar_one_or_none()

            if crawl_run is None:
                logger.warning("CrawlRun을 찾을 수 없음: id=%s", crawl_run_id)
                return

            # REQ-07.6: 통계 업데이트 및 완료 상태 설정
            crawl_run.status = CrawlStatus.COMPLETED
            crawl_run.new_count = new_count
            crawl_run.updated_count = updated_count
            crawl_run.skipped_count = skipped_count
            crawl_run.failed_count = failed_count
            crawl_run.total_found = new_count + updated_count + skipped_count + failed_count
            crawl_run.finished_at = datetime.now(timezone.utc)

            await self.db_session.commit()
            logger.info(
                "CrawlRun 완료 처리: id=%s, new=%d, updated=%d, skipped=%d, failed=%d",
                crawl_run_id,
                new_count,
                updated_count,
                skipped_count,
                failed_count,
            )

        except Exception as exc:  # noqa: BLE001
            logger.error("CrawlRun 완료 처리 실패: id=%s, error=%s", crawl_run_id, str(exc))
            try:
                await self.db_session.rollback()
            except Exception:  # noqa: BLE001
                pass
