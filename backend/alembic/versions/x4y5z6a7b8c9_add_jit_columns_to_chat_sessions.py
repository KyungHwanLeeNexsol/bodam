"""JIT RAG 컬럼 추가: chat_sessions (SPEC-JIT-001)

document_source_type: JIT 문서 소스 타입 ("pdf", "html")
document_source_meta: JIT 문서 소스 메타데이터 (JSONB)

Revision ID: x4y5z6a7b8c9
Revises: w3x4y5z6a7b8
Create Date: 2024-01-01 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic
revision = "x4y5z6a7b8c9"
down_revision = "w3x4y5z6a7b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """JIT RAG 컬럼 추가"""
    op.add_column(
        "chat_sessions",
        sa.Column(
            "document_source_type",
            sa.String(20),
            nullable=True,
            comment="JIT 문서 소스 타입 (pdf, html)",
        ),
    )
    op.add_column(
        "chat_sessions",
        sa.Column(
            "document_source_meta",
            JSONB,
            nullable=True,
            comment="JIT 문서 소스 메타데이터",
        ),
    )


def downgrade() -> None:
    """JIT RAG 컬럼 제거"""
    op.drop_column("chat_sessions", "document_source_meta")
    op.drop_column("chat_sessions", "document_source_type")
