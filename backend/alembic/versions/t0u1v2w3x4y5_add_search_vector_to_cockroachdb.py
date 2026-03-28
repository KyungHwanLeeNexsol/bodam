"""add_search_vector_to_cockroachdb (no-op: PostgreSQL 전용 환경)

Revision ID: t0u1v2w3x4y5
Revises: s9t0u1v2w3x4
Create Date: 2026-03-23 00:00:00.000000

기존 CockroachDB 환경에서 search_vector TEXT NULL 컬럼을 추가했던 마이그레이션.
PostgreSQL로 마이그레이션 완료 후에는 r8s9t0u1v2w3에서 이미 tsvector 컬럼이 생성되므로
이 마이그레이션은 no-op. 체인 유지를 위해 남겨둠.
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "t0u1v2w3x4y5"
down_revision: str | None = "s9t0u1v2w3x4"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    """no-op: 표준 PostgreSQL에서는 r8s9t0u1v2w3에서 tsvector 컬럼이 이미 생성됨"""
    pass


def downgrade() -> None:
    """no-op"""
    pass
