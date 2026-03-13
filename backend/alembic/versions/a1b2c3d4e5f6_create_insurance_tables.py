"""create_insurance_tables

Revision ID: a1b2c3d4e5f6
Revises: 390ce6302c19
Create Date: 2026-03-13 22:00:00.000000

보험 도메인 테이블 생성 마이그레이션 (TAG-005):
- insurance_companies: 보험사 마스터 테이블
- policies: 보험 상품(약관) 테이블
- coverages: 보장 항목 테이블
- policy_chunks: 약관 청크 (RAG용) 테이블
- HNSW 벡터 인덱스: 코사인 유사도 기반 검색 최적화
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: str | Sequence[str] | None = "390ce6302c19"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """보험 도메인 테이블 및 인덱스 생성"""

    # ─────────────────────────────────────────────
    # InsuranceCategory enum 타입 생성
    # ─────────────────────────────────────────────
    op.execute(
        "CREATE TYPE insurance_category_enum AS ENUM ('LIFE', 'NON_LIFE', 'THIRD_SECTOR')"
    )

    # ─────────────────────────────────────────────
    # insurance_companies 테이블 생성
    # ─────────────────────────────────────────────
    op.create_table(
        "insurance_companies",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("code", sa.String(100), nullable=False),
        sa.Column("logo_url", sa.String(500), nullable=True),
        sa.Column("website_url", sa.String(500), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("metadata_", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
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
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code", name="uq_insurance_companies_code"),
    )
    # 보험사 코드 인덱스 (검색 최적화)
    op.create_index("idx_insurance_companies_code", "insurance_companies", ["code"])
    op.create_index("idx_insurance_companies_is_active", "insurance_companies", ["is_active"])

    # ─────────────────────────────────────────────
    # policies 테이블 생성
    # ─────────────────────────────────────────────
    op.create_table(
        "policies",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("product_code", sa.String(100), nullable=False),
        sa.Column(
            "category",
            sa.Enum("LIFE", "NON_LIFE", "THIRD_SECTOR", name="insurance_category_enum", create_type=False),
            nullable=False,
        ),
        sa.Column("effective_date", sa.Date(), nullable=True),
        sa.Column("expiry_date", sa.Date(), nullable=True),
        sa.Column("is_discontinued", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("raw_text", sa.Text(), nullable=True),
        sa.Column("metadata_", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["company_id"],
            ["insurance_companies.id"],
            name="fk_policies_company_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "product_code", name="uq_policy_company_product"),
    )
    op.create_index("idx_policies_company_id", "policies", ["company_id"])
    op.create_index("idx_policies_category", "policies", ["category"])
    op.create_index("idx_policies_is_discontinued", "policies", ["is_discontinued"])

    # ─────────────────────────────────────────────
    # coverages 테이블 생성
    # ─────────────────────────────────────────────
    op.create_table(
        "coverages",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("policy_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("coverage_type", sa.String(100), nullable=False),
        sa.Column("eligibility_criteria", sa.Text(), nullable=True),
        sa.Column("exclusions", sa.Text(), nullable=True),
        sa.Column("compensation_rules", sa.Text(), nullable=True),
        sa.Column("max_amount", sa.BigInteger(), nullable=True),
        sa.Column("metadata_", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["policy_id"],
            ["policies.id"],
            name="fk_coverages_policy_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_coverages_policy_id", "coverages", ["policy_id"])
    op.create_index("idx_coverages_coverage_type", "coverages", ["coverage_type"])

    # ─────────────────────────────────────────────
    # policy_chunks 테이블 생성
    # ─────────────────────────────────────────────
    op.create_table(
        "policy_chunks",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("policy_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("coverage_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("chunk_text", sa.Text(), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        # pgvector 1536차원 임베딩 (text-embedding-3-small 기준)
        sa.Column("embedding", sa.UserDefinedType().with_variant(sa.Text(), "postgresql"), nullable=True),
        sa.Column("metadata_", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["policy_id"],
            ["policies.id"],
            name="fk_policy_chunks_policy_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["coverage_id"],
            ["coverages.id"],
            name="fk_policy_chunks_coverage_id",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_policy_chunks_policy_id", "policy_chunks", ["policy_id"])
    op.create_index("idx_policy_chunks_coverage_id", "policy_chunks", ["coverage_id"])
    op.create_index("idx_policy_chunks_chunk_index", "policy_chunks", ["policy_id", "chunk_index"])

    # ─────────────────────────────────────────────
    # HNSW 벡터 인덱스 생성 (코사인 유사도 최적화)
    # m=16: 노드당 최대 연결 수, ef_construction=64: 인덱스 구축 시 탐색 범위
    # ─────────────────────────────────────────────
    op.execute("""
        ALTER TABLE policy_chunks
        ALTER COLUMN embedding TYPE vector(1536)
        USING embedding::vector(1536)
    """)

    op.execute("""
        CREATE INDEX idx_policy_chunks_embedding
        ON policy_chunks
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
    """)


def downgrade() -> None:
    """보험 도메인 테이블 및 인덱스 제거"""

    # 인덱스 제거
    op.drop_index("idx_policy_chunks_embedding", table_name="policy_chunks")
    op.drop_index("idx_policy_chunks_chunk_index", table_name="policy_chunks")
    op.drop_index("idx_policy_chunks_coverage_id", table_name="policy_chunks")
    op.drop_index("idx_policy_chunks_policy_id", table_name="policy_chunks")

    # 테이블 제거 (FK 순서에 맞게 역순으로 삭제)
    op.drop_table("policy_chunks")

    op.drop_index("idx_coverages_coverage_type", table_name="coverages")
    op.drop_index("idx_coverages_policy_id", table_name="coverages")
    op.drop_table("coverages")

    op.drop_index("idx_policies_is_discontinued", table_name="policies")
    op.drop_index("idx_policies_category", table_name="policies")
    op.drop_index("idx_policies_company_id", table_name="policies")
    op.drop_table("policies")

    op.drop_index("idx_insurance_companies_is_active", table_name="insurance_companies")
    op.drop_index("idx_insurance_companies_code", table_name="insurance_companies")
    op.drop_table("insurance_companies")

    # enum 타입 제거
    op.execute("DROP TYPE IF EXISTS insurance_category_enum")
