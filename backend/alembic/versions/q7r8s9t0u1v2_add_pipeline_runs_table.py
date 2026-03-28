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

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "q7r8s9t0u1v2"
down_revision: str | None = "p6q7r8s9t0u1"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    """파이프라인 실행 테이블 및 enum 타입 생성 (순수 SQL)"""

    # pipelinestatus enum 생성
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE pipelinestatus AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """)

    # pipelinetriggertype enum 생성
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE pipelinetriggertype AS ENUM ('SCHEDULED', 'MANUAL');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """)

    # pipeline_runs 테이블 생성 (순수 SQL - asyncpg enum 충돌 방지)
    op.execute("""
CREATE TABLE IF NOT EXISTS pipeline_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status pipelinestatus NOT NULL DEFAULT 'PENDING',
    trigger_type pipelinetriggertype NOT NULL,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    stats JSONB,
    error_details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
""")

    # 인덱스 생성
    op.execute("CREATE INDEX IF NOT EXISTS ix_pipeline_runs_status ON pipeline_runs (status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_pipeline_runs_trigger_type ON pipeline_runs (trigger_type)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_pipeline_runs_created_at ON pipeline_runs (created_at)")


def downgrade() -> None:
    """파이프라인 실행 테이블 및 enum 타입 제거"""
    op.execute("DROP INDEX IF EXISTS ix_pipeline_runs_created_at")
    op.execute("DROP INDEX IF EXISTS ix_pipeline_runs_trigger_type")
    op.execute("DROP INDEX IF EXISTS ix_pipeline_runs_status")
    op.execute("DROP TABLE IF EXISTS pipeline_runs")
    op.execute("DROP TYPE IF EXISTS pipelinetriggertype")
    op.execute("DROP TYPE IF EXISTS pipelinestatus")
