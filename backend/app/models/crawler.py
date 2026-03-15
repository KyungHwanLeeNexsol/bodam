"""크롤러 도메인 SQLAlchemy 모델 (SPEC-CRAWLER-001)

CrawlRun, CrawlResult 모델과
CrawlStatus, CrawlResultStatus 열거형을 정의.
크롤링 실행 이력과 개별 결과를 추적.
"""

from __future__ import annotations

import uuid
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy import DateTime, Enum, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class CrawlStatus(StrEnum):
    """크롤링 실행 상태

    RUNNING: 크롤링 진행 중
    COMPLETED: 정상 완료
    FAILED: 오류로 인한 실패
    """

    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class CrawlResultStatus(StrEnum):
    """개별 크롤링 결과 상태

    NEW: 새로 발견된 상품
    UPDATED: 기존 상품 변경 감지
    SKIPPED: 변경 없어 건너뜀
    FAILED: 개별 항목 처리 실패
    """

    NEW = "NEW"
    UPDATED = "UPDATED"
    SKIPPED = "SKIPPED"
    FAILED = "FAILED"


class CrawlRun(Base, TimestampMixin):
    """크롤링 실행 이력 테이블

    크롤러 1회 실행에 대한 메타데이터와 집계 통계를 저장.
    CrawlResult와 1:N 관계 (cascade 삭제).
    """

    __tablename__ = "crawl_runs"

    # 기본 키: UUID v4
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=sa.text("gen_random_uuid()"),
    )

    # 크롤러 식별자 (예: klia, knia)
    crawler_name: Mapped[str] = mapped_column(sa.String(100), nullable=False)

    # 실행 상태
    status: Mapped[CrawlStatus] = mapped_column(
        Enum(CrawlStatus, name="crawl_status_enum", values_callable=lambda e: [x.value for x in e]),
        nullable=False,
        default=CrawlStatus.RUNNING,
    )

    # 크롤링 시작 시각
    started_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # 크롤링 완료 시각 (진행 중이면 NULL)
    finished_at: Mapped[DateTime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # 총 발견 상품 수
    total_found: Mapped[int] = mapped_column(
        sa.Integer,
        nullable=False,
        default=0,
        server_default=sa.text("0"),
    )

    # 신규 상품 수
    new_count: Mapped[int] = mapped_column(
        sa.Integer,
        nullable=False,
        default=0,
        server_default=sa.text("0"),
    )

    # 업데이트된 상품 수
    updated_count: Mapped[int] = mapped_column(
        sa.Integer,
        nullable=False,
        default=0,
        server_default=sa.text("0"),
    )

    # 건너뛴 상품 수 (변경 없음)
    skipped_count: Mapped[int] = mapped_column(
        sa.Integer,
        nullable=False,
        default=0,
        server_default=sa.text("0"),
    )

    # 실패한 상품 수
    failed_count: Mapped[int] = mapped_column(
        sa.Integer,
        nullable=False,
        default=0,
        server_default=sa.text("0"),
    )

    # 오류 로그 (JSONB: 상세 오류 메시지 목록)
    error_log: Mapped[dict | None] = mapped_column("error_log", JSONB, nullable=True)

    # 관계: 실행 -> 결과 목록 (cascade 삭제)
    results: Mapped[list[CrawlResult]] = relationship(
        "CrawlResult",
        back_populates="crawl_run",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return f"<CrawlRun id={self.id} crawler={self.crawler_name!r} status={self.status!r}>"


class CrawlResult(Base):
    """크롤링 개별 결과 테이블

    크롤러가 발견한 개별 보험 상품의 처리 결과.
    Policy 테이블과 선택적 연계 (신규/실패 시 NULL 가능).
    """

    __tablename__ = "crawl_results"

    # 기본 키: UUID v4
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=sa.text("gen_random_uuid()"),
    )

    # FK: 소속 크롤링 실행
    crawl_run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("crawl_runs.id", ondelete="CASCADE"),
        nullable=False,
    )

    # FK: 연관 보험 상품 (미등록/실패 시 NULL)
    policy_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("policies.id", ondelete="SET NULL"),
        nullable=True,
    )

    # 보험사 상품 코드 (금감원 등록 코드)
    product_code: Mapped[str] = mapped_column(sa.String(100), nullable=False)

    # 보험사 코드 (예: samsung-life)
    company_code: Mapped[str] = mapped_column(sa.String(100), nullable=False)

    # 처리 결과 상태
    status: Mapped[CrawlResultStatus] = mapped_column(
        Enum(CrawlResultStatus, name="crawl_result_status_enum", values_callable=lambda e: [x.value for x in e]),
        nullable=False,
    )

    # 오류 메시지 (실패 시 사용)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 저장된 PDF 파일 경로 (로컬 또는 S3 키)
    pdf_path: Mapped[str | None] = mapped_column(sa.String(1000), nullable=True)

    # PDF 콘텐츠 SHA-256 해시 (변경 감지용)
    content_hash: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)

    # 생성 시각
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # 관계: 결과 -> 실행
    crawl_run: Mapped[CrawlRun] = relationship("CrawlRun", back_populates="results")

    def __repr__(self) -> str:
        return f"<CrawlResult id={self.id} product={self.product_code!r} status={self.status!r}>"
