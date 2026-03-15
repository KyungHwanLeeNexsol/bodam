"""add_case_precedents_table

Revision ID: m3n4o5p6q7r8
Revises: l2m3n4o5p6q7
Create Date: 2026-03-15 00:00:00.000000

SPEC-GUIDANCE-001 Phase G1:
- case_precedents 테이블 추가
- pgvector HNSW 인덱스 (embedding, vector_cosine_ops)
- case_number 유니크 인덱스
- decision_date 인덱스
- case_type 인덱스
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "m3n4o5p6q7r8"
down_revision: str | None = "l2m3n4o5p6q7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """case_precedents 테이블 생성"""
    op.create_table(
        "case_precedents",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("case_number", sa.String(100), nullable=False),
        sa.Column("court_name", sa.String(200), nullable=False),
        sa.Column("decision_date", sa.Date(), nullable=False),
        sa.Column("case_type", sa.String(100), nullable=False),
        sa.Column("insurance_type", sa.String(100), nullable=True),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("ruling", sa.Text(), nullable=False),
        sa.Column("key_clauses", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("embedding", sa.Text(), nullable=True),  # pgvector는 DDL에서 직접 처리
        sa.Column("source_url", sa.String(500), nullable=True),
        sa.Column("metadata_", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("case_number", name="uq_case_precedents_case_number"),
    )

    # embedding 컬럼을 vector(1536) 타입으로 변경 (pgvector)
    op.execute("ALTER TABLE case_precedents ALTER COLUMN embedding TYPE vector(1536) USING NULL")

    # HNSW 인덱스: 코사인 유사도 검색
    op.execute(
        "CREATE INDEX ix_case_precedents_embedding "
        "ON case_precedents USING hnsw (embedding vector_cosine_ops)"
    )

    # 기타 인덱스
    op.create_index(
        "ix_case_precedents_case_number",
        "case_precedents",
        ["case_number"],
        unique=True,
    )
    op.create_index(
        "ix_case_precedents_decision_date",
        "case_precedents",
        ["decision_date"],
    )
    op.create_index(
        "ix_case_precedents_case_type",
        "case_precedents",
        ["case_type"],
    )


def downgrade() -> None:
    """case_precedents 테이블 삭제"""
    op.drop_index("ix_case_precedents_case_type", table_name="case_precedents")
    op.drop_index("ix_case_precedents_decision_date", table_name="case_precedents")
    op.drop_index("ix_case_precedents_case_number", table_name="case_precedents")
    op.execute("DROP INDEX IF EXISTS ix_case_precedents_embedding")
    op.drop_table("case_precedents")
