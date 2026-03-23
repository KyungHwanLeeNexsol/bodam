"""add_search_vector_to_cockroachdb

Revision ID: t0u1v2w3x4y5
Revises: s9t0u1v2w3x4
Create Date: 2026-03-23 00:00:00.000000

r8s9t0u1v2w3 마이그레이션에서 CockroachDB는 tsvector 미지원으로 search_vector 컬럼 추가를
스킵했음. 하지만 SQLAlchemy 모델에 search_vector가 FetchedValue()로 정의되어 있어
INSERT 시 RETURNING 절에 포함되어 에러 발생.

해결: CockroachDB에 search_vector TEXT NULL 컬럼 추가 (tsvector 없이 단순 TEXT로).
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "t0u1v2w3x4y5"
down_revision: str | None = "s9t0u1v2w3x4"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    """CockroachDB에 search_vector TEXT NULL 컬럼 추가 (IF NOT EXISTS)"""
    op.execute(
        "ALTER TABLE policy_chunks ADD COLUMN IF NOT EXISTS search_vector TEXT NULL"
    )


def downgrade() -> None:
    """search_vector 컬럼 제거"""
    op.execute(
        "ALTER TABLE policy_chunks DROP COLUMN IF EXISTS search_vector"
    )
