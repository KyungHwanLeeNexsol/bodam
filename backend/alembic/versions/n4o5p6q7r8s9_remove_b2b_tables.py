"""B2B 테이블 제거

Revision ID: n4o5p6q7r8s9
Revises: m3n4o5p6q7r8
Create Date: 2026-03-16

"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = 'n4o5p6q7r8s9'
down_revision = 'm3n4o5p6q7r8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """B2B 관련 테이블 삭제 (B2B 기능 제거)"""
    op.drop_table('usage_records')
    op.drop_table('agent_clients')
    op.drop_table('api_keys')
    op.drop_table('organization_members')
    op.drop_table('organizations')


def downgrade() -> None:
    """B2B 테이블 복구 - 수동 복구 필요"""
    pass
