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

import dataclasses
import logging
import uuid
from typing import Any

logger = logging.getLogger(__name__)


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

        처리 순서:
        1. content_hash 중복 확인 (REQ-07.5)
        2. InsuranceCompany 조회/생성
        3. Policy upsert - (product_code, company_code) 기준 (REQ-07.2)
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
        from sqlalchemy import select

        from app.models.crawler import CrawlResult
        from app.models.insurance import InsuranceCompany, InsuranceCategory, Policy

        try:
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

            # InsuranceCompany 조회
            company_result = await self.db_session.execute(
                select(InsuranceCompany).where(
                    InsuranceCompany.code == listing.company_code
                )
            )
            company = company_result.scalar_one_or_none()

            if company is None:
                # 보험사가 없으면 신규 생성
                company = InsuranceCompany(
                    name=listing.company_name,
                    code=listing.company_code,
                    is_active=True,
                )
                self.db_session.add(company)
                await self.db_session.flush()

            # Policy 조회 (company_id + product_code 기준)
            policy_result = await self.db_session.execute(
                select(Policy).where(
                    Policy.company_id == company.id,
                    Policy.product_code == listing.product_code,
                )
            )
            policy = policy_result.scalar_one_or_none()

            # REQ-07.1: sale_status 포함하여 저장
            is_new = policy is None
            if is_new:
                # 카테고리 매핑
                category_map = {
                    "LIFE": InsuranceCategory.LIFE,
                    "NON_LIFE": InsuranceCategory.NON_LIFE,
                    "THIRD_SECTOR": InsuranceCategory.THIRD_SECTOR,
                }
                category = category_map.get(
                    listing.category.upper(), InsuranceCategory.LIFE
                )
                policy = Policy(
                    company_id=company.id,
                    name=listing.product_name,
                    product_code=listing.product_code,
                    category=category,
                    effective_date=getattr(listing, "effective_date", None),
                    expiry_date=getattr(listing, "expiry_date", None),
                    sale_status=str(listing.sale_status),
                )
                self.db_session.add(policy)
            else:
                # 기존 Policy 업데이트
                policy.name = listing.product_name
                policy.sale_status = str(listing.sale_status)
                if getattr(listing, "effective_date", None) is not None:
                    policy.effective_date = listing.effective_date
                if getattr(listing, "expiry_date", None) is not None:
                    policy.expiry_date = listing.expiry_date

            await self.db_session.flush()
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
                policy_id=policy.id,
                error=None,
            )

        except Exception as exc:  # noqa: BLE001
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
            return IngestResult(
                status="FAILED",
                policy_id=None,
                error=str(exc),
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
