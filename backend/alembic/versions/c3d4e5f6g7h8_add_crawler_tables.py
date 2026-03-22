"""add_crawler_tables

Revision ID: c3d4e5f6g7h8
Revises: b2c3d4e5f6g7
Create Date: 2026-03-14 00:00:00.000000

크롤러 도메인 테이블 생성 마이그레이션 (SPEC-CRAWLER-001):
- crawl_status_enum: 크롤링 실행 상태 enum 타입
- crawl_result_status_enum: 크롤링 결과 상태 enum 타입
- crawl_runs: 크롤링 실행 이력 테이블
- crawl_results: 크롤링 개별 결과 테이블
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3d4e5f6g7h8"
down_revision: str | None = "b2c3d4e5f6g7"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    """크롤러 테이블 및 enum 타입 생성"""

    # crawl_status_enum 생성
    op.execute("CREATE TYPE IF NOT EXISTS crawl_status_enum AS ENUM ('RUNNING', 'COMPLETED', 'FAILED')")

    # crawl_result_status_enum 생성
    op.execute("CREATE TYPE IF NOT EXISTS crawl_result_status_enum AS ENUM ('NEW', 'UPDATED', 'SKIPPED', 'FAILED')")

    # crawl_runs 테이블 생성
    op.create_table(
        "crawl_runs",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("crawler_name", sa.String(100), nullable=False),
        sa.Column(
            "status",
            postgresql.ENUM("RUNNING", "COMPLETED", "FAILED", name="crawl_status_enum", create_type=False),
            nullable=False,
            server_default="RUNNING",
        ),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("total_found", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("new_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("updated_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("skipped_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("failed_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("error_log", JSONB, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    # crawl_results 테이블 생성
    op.create_table(
        "crawl_results",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "crawl_run_id",
            UUID(as_uuid=True),
            sa.ForeignKey("crawl_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "policy_id",
            UUID(as_uuid=True),
            sa.ForeignKey("policies.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("product_code", sa.String(100), nullable=False),
        sa.Column("company_code", sa.String(100), nullable=False),
        sa.Column(
            "status",
            postgresql.ENUM("NEW", "UPDATED", "SKIPPED", "FAILED", name="crawl_result_status_enum", create_type=False),
            nullable=False,
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("pdf_path", sa.String(1000), nullable=True),
        sa.Column("content_hash", sa.String(64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    # 인덱스 생성
    op.create_index("ix_crawl_runs_crawler_name", "crawl_runs", ["crawler_name"])
    op.create_index("ix_crawl_runs_status", "crawl_runs", ["status"])
    op.create_index("ix_crawl_results_crawl_run_id", "crawl_results", ["crawl_run_id"])
    op.create_index("ix_crawl_results_product_code", "crawl_results", ["product_code"])
    op.create_index("ix_crawl_results_company_code", "crawl_results", ["company_code"])


def downgrade() -> None:
    """크롤러 테이블 및 enum 타입 제거"""
    # 인덱스 제거
    op.drop_index("ix_crawl_results_company_code", table_name="crawl_results")
    op.drop_index("ix_crawl_results_product_code", table_name="crawl_results")
    op.drop_index("ix_crawl_results_crawl_run_id", table_name="crawl_results")
    op.drop_index("ix_crawl_runs_status", table_name="crawl_runs")
    op.drop_index("ix_crawl_runs_crawler_name", table_name="crawl_runs")

    # 테이블 제거
    op.drop_table("crawl_results")
    op.drop_table("crawl_runs")

    # enum 타입 제거
    sa.Enum(name="crawl_result_status_enum").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="crawl_status_enum").drop(op.get_bind(), checkfirst=True)
