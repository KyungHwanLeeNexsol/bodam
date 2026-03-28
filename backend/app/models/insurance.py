"""보험 도메인 SQLAlchemy 모델 (TAG-003)

InsuranceCompany, Policy, Coverage, PolicyChunk 모델과
InsuranceCategory enum을 정의.
pgvector Vector(1536)을 사용하여 청크 임베딩 저장.
"""

from __future__ import annotations

import uuid
from enum import StrEnum

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector
from sqlalchemy import BigInteger, DateTime, Enum, ForeignKey, Text, UniqueConstraint, func
from sqlalchemy.schema import FetchedValue
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class InsuranceCategory(StrEnum):
    """보험 상품 분류

    LIFE: 생명보험 (사망, 생존 관련)
    NON_LIFE: 손해보험 (재산, 배상 관련)
    THIRD_SECTOR: 제3보험 (질병, 상해, 간병 관련)
    """

    LIFE = "LIFE"
    NON_LIFE = "NON_LIFE"
    THIRD_SECTOR = "THIRD_SECTOR"


class InsuranceCompany(Base, TimestampMixin):
    """보험사 정보 테이블

    한국 내 보험사 마스터 데이터.
    하나의 보험사는 여러 보험 상품(Policy)을 보유.
    """

    __tablename__ = "insurance_companies"

    # 기본 키: UUID v4
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=sa.text("gen_random_uuid()"),
    )

    # 보험사 공식 명칭
    name: Mapped[str] = mapped_column(sa.String(200), nullable=False)

    # 보험사 고유 코드 (슬러그 형태, 예: samsung-life)
    code: Mapped[str] = mapped_column(sa.String(100), nullable=False, unique=True)

    # 보험사 로고 이미지 URL (선택)
    logo_url: Mapped[str | None] = mapped_column(sa.String(500), nullable=True)

    # 보험사 공식 웹사이트 URL (선택)
    website_url: Mapped[str | None] = mapped_column(sa.String(500), nullable=True)

    # 활성화 여부 (비활성: 검색 제외)
    is_active: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=True, server_default=sa.text("true"))

    # 추가 메타데이터 (JSONB: 색인 지원, 설립일, 자본금 등)
    metadata_: Mapped[dict | None] = mapped_column("metadata_", JSONB, nullable=True)

    # 관계: 보험사 -> 보험 상품 (cascade 삭제)
    policies: Mapped[list[Policy]] = relationship(
        "Policy",
        back_populates="company",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return f"<InsuranceCompany id={self.id} code={self.code!r}>"


class Policy(Base, TimestampMixin):
    """보험 상품(약관) 테이블

    특정 보험사의 개별 상품. 보장 항목(Coverage)과 청크(PolicyChunk)를 포함.
    (company_id, product_code) 조합은 유일해야 함.
    """

    __tablename__ = "policies"

    # 기본 키: UUID v4
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=sa.text("gen_random_uuid()"),
    )

    # FK: 소속 보험사
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("insurance_companies.id", ondelete="CASCADE"),
        nullable=False,
    )

    # 상품명 (예: 삼성 종신보험 2024)
    name: Mapped[str] = mapped_column(sa.String(300), nullable=False)

    # 금융감독원 등록 상품 코드
    product_code: Mapped[str] = mapped_column(sa.String(100), nullable=False)

    # 보험 분류
    category: Mapped[InsuranceCategory] = mapped_column(
        Enum(InsuranceCategory, name="insurance_category_enum", values_callable=lambda e: [x.value for x in e]),
        nullable=False,
    )

    # 약관 시행일
    effective_date: Mapped[sa.Date | None] = mapped_column(sa.Date, nullable=True)

    # 약관 만료일 (NULL: 현행)
    expiry_date: Mapped[sa.Date | None] = mapped_column(sa.Date, nullable=True)

    # 판매 중단 여부
    is_discontinued: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, default=False, server_default=sa.text("false")
    )

    # 판매 상태 (ON_SALE, DISCONTINUED, UNKNOWN) - SPEC-CRAWLER-002 REQ-07.1
    sale_status: Mapped[str | None] = mapped_column(
        sa.String(20),
        nullable=True,
        default="UNKNOWN",
        server_default=sa.text("'UNKNOWN'"),
    )

    # 원본 약관 전문 (OCR/PDF 추출 텍스트)
    raw_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 추가 메타데이터 (JSONB)
    metadata_: Mapped[dict | None] = mapped_column("metadata_", JSONB, nullable=True)

    # 테이블 제약 조건
    __table_args__ = (
        # 같은 보험사 내 상품 코드 중복 불가
        UniqueConstraint("company_id", "product_code", name="uq_policy_company_product"),
    )

    # 관계: 상품 -> 보험사
    company: Mapped[InsuranceCompany] = relationship("InsuranceCompany", back_populates="policies")

    # 관계: 상품 -> 보장 항목 (cascade 삭제)
    coverages: Mapped[list[Coverage]] = relationship(
        "Coverage",
        back_populates="policy",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    # 관계: 상품 -> 청크 (cascade 삭제)
    chunks: Mapped[list[PolicyChunk]] = relationship(
        "PolicyChunk",
        back_populates="policy",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return f"<Policy id={self.id} code={self.product_code!r}>"


class Coverage(Base, TimestampMixin):
    """보장 항목 테이블

    보험 상품 내 개별 보장 조항.
    가입 자격, 면책 사항, 보상 규정, 최대 보상 금액을 저장.
    """

    __tablename__ = "coverages"

    # 기본 키: UUID v4
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=sa.text("gen_random_uuid()"),
    )

    # FK: 소속 보험 상품
    policy_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("policies.id", ondelete="CASCADE"),
        nullable=False,
    )

    # 보장 항목명 (예: 암 진단비)
    name: Mapped[str] = mapped_column(sa.String(300), nullable=False)

    # 보장 유형 (예: 진단비, 수술비, 입원비)
    coverage_type: Mapped[str] = mapped_column(sa.String(100), nullable=False)

    # 가입 자격 기준 (연령, 건강 상태 등)
    eligibility_criteria: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 면책 사항 (보장 제외 조건)
    exclusions: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 보상 산정 규정
    compensation_rules: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 최대 보상 금액 (단위: 원)
    max_amount: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    # 추가 메타데이터 (JSONB)
    metadata_: Mapped[dict | None] = mapped_column("metadata_", JSONB, nullable=True)

    # 관계: 보장 항목 -> 상품
    policy: Mapped[Policy] = relationship("Policy", back_populates="coverages")

    def __repr__(self) -> str:
        return f"<Coverage id={self.id} name={self.name!r}>"


class PolicyChunk(Base):
    """약관 청크 테이블 (RAG 검색용)

    약관 원문을 토큰 단위로 분할한 청크.
    pgvector를 사용하여 임베딩 벡터 저장 및 유사도 검색.
    업데이트 없이 생성(ingest)만 수행하므로 updated_at 미포함.
    """

    __tablename__ = "policy_chunks"

    # 기본 키: UUID v4
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=sa.text("gen_random_uuid()"),
    )

    # FK: 소속 보험 상품
    policy_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("policies.id", ondelete="CASCADE"),
        nullable=False,
    )

    # FK: 연관 보장 항목 (선택, NULL 가능)
    coverage_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("coverages.id", ondelete="SET NULL"),
        nullable=True,
    )

    # 청크 원문 텍스트
    chunk_text: Mapped[str] = mapped_column(Text, nullable=False)

    # 청크 순서 인덱스 (0부터 시작)
    chunk_index: Mapped[int] = mapped_column(sa.Integer, nullable=False)

    # BAAI/bge-m3 기준 1024차원 임베딩 벡터 (이전: gemini-embedding-001 768차원)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1024), nullable=True)

    # tsvector 전문 검색 벡터 (PostgreSQL 네이티브)
    # deferred=True: 명시적 접근 시에만 로딩 → 일반 쿼리 성능 최적화
    search_vector: Mapped[str | None] = mapped_column(
        sa.Text,
        nullable=True,
        server_default=FetchedValue(),
        deferred=True,
    )

    # 추가 메타데이터 (JSONB: 토큰 수, 페이지 번호 등)
    metadata_: Mapped[dict | None] = mapped_column("metadata_", JSONB, nullable=True)

    # 생성 시각 (업데이트 없으므로 TimestampMixin 미사용)
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # 관계: 청크 -> 상품
    policy: Mapped[Policy] = relationship("Policy", back_populates="chunks")

    # 관계: 청크 -> 보장 항목 (선택)
    coverage: Mapped[Coverage | None] = relationship("Coverage")

    def __repr__(self) -> str:
        return f"<PolicyChunk id={self.id} policy_id={self.policy_id} idx={self.chunk_index}>"
