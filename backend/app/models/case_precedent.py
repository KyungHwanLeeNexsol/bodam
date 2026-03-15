"""판례(CasePrecedent) SQLAlchemy 모델

SPEC-GUIDANCE-001 Phase G1: 보험 분쟁 관련 판례 데이터 저장.
pgvector Vector(1536)을 사용하여 판례 임베딩 벡터 저장.
"""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector
from sqlalchemy import DateTime, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class CasePrecedent(Base):
    """판례 테이블 (RAG 검색 및 분쟁 가이던스용)

    보험 분쟁 관련 판례를 저장.
    pgvector를 사용하여 임베딩 벡터 저장 및 유사도 검색.
    업데이트 없이 ingestion만 수행하므로 TimestampMixin 미사용.
    """

    __tablename__ = "case_precedents"

    # 기본 키: UUID v4
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=sa.text("gen_random_uuid()"),
    )

    # 판례 번호 (예: 2023다56789)
    case_number: Mapped[str] = mapped_column(
        sa.String(100),
        nullable=False,
        unique=True,
    )

    # 법원명 (예: 대법원, 서울고등법원)
    court_name: Mapped[str] = mapped_column(sa.String(200), nullable=False)

    # 판결일
    decision_date: Mapped[sa.Date] = mapped_column(sa.Date, nullable=False)

    # 사건 유형 (예: 손해배상, 보험금청구)
    case_type: Mapped[str] = mapped_column(sa.String(100), nullable=False)

    # 관련 보험 유형 (예: 실손의료보험, 자동차보험)
    insurance_type: Mapped[str | None] = mapped_column(sa.String(100), nullable=True)

    # 판례 요약
    summary: Mapped[str] = mapped_column(Text, nullable=False)

    # 판결 요지
    ruling: Mapped[str] = mapped_column(Text, nullable=False)

    # 핵심 약관 조항 목록 (JSONB)
    key_clauses: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # text-embedding-3-small 기준 1536차원 임베딩 벡터
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1536), nullable=True)

    # 판례 출처 URL
    source_url: Mapped[str | None] = mapped_column(sa.String(500), nullable=True)

    # 추가 메타데이터 (JSONB)
    metadata_: Mapped[dict | None] = mapped_column("metadata_", JSONB, nullable=True)

    # 생성 시각
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<CasePrecedent id={self.id} case_number={self.case_number!r}>"
