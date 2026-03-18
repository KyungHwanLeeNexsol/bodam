"""add_pipeline_runs_table

Revision ID: q7r8s9t0u1v2
Revises: p6q7r8s9t0u1
Create Date: 2026-03-18 00:00:00.000000

파이프라인 실행 이력 테이블 생성 마이그레이션 (SPEC-PIPELINE-001 REQ-05):
- pipelinestatus: 파이프라인 실행 상태 enum 타입
- pipelinetriggertype: 파이프라인 트리거 유형 enum 타입
- pipeline_runs: 파이프라인 실행 이력 테이블
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "q7r8s9t0u1v2"
down_revision: str | None = "p6q7r8s9t0u1"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    """파이프라인 실행 테이블 및 enum 타입 생성"""

    # pipelinestatus enum 생성
    op.execute("""DO $$ BEGIN
    CREATE TYPE pipelinestatus AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL');
EXCEPTION WHEN duplicate_object THEN null;
END $$""")

    # pipelinetriggertype enum 생성
    op.execute("""DO $$ BEGIN
    CREATE TYPE pipelinetriggertype AS ENUM ('SCHEDULED', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN null;
END $$""")

    # pipeline_runs 테이블 생성
    op.create_table(
        "pipeline_runs",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "status",
            sa.Enum("PENDING", "RUNNING", "COMPLETED", "FAILED", "PARTIAL", name="pipelinestatus", create_type=False),
            nullable=False,
            server_default="PENDING",
        ),
        sa.Column(
            "trigger_type",
            sa.Enum("SCHEDULED", "MANUAL", name="pipelinetriggertype", create_type=False),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("stats", JSONB, nullable=True),
        sa.Column("error_details", JSONB, nullable=True),
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

    # 인덱스 생성
    op.create_index("ix_pipeline_runs_status", "pipeline_runs", ["status"])
    op.create_index("ix_pipeline_runs_trigger_type", "pipeline_runs", ["trigger_type"])
    op.create_index("ix_pipeline_runs_created_at", "pipeline_runs", ["created_at"])


def downgrade() -> None:
    """파이프라인 실행 테이블 및 enum 타입 제거"""
    # 인덱스 제거
    op.drop_index("ix_pipeline_runs_created_at", table_name="pipeline_runs")
    op.drop_index("ix_pipeline_runs_trigger_type", table_name="pipeline_runs")
    op.drop_index("ix_pipeline_runs_status", table_name="pipeline_runs")

    # 테이블 제거
    op.drop_table("pipeline_runs")

    # enum 타입 제거
    sa.Enum(name="pipelinetriggertype").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="pipelinestatus").drop(op.get_bind(), checkfirst=True)
