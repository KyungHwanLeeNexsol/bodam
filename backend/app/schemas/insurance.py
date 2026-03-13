"""보험 도메인 Pydantic 스키마 (TAG-004)

API 요청/응답 직렬화 및 유효성 검사.
from_attributes=True로 SQLAlchemy 모델과 호환.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.insurance import InsuranceCategory

# ─────────────────────────────────────────────
# InsuranceCompany 스키마
# ─────────────────────────────────────────────


class InsuranceCompanyCreate(BaseModel):
    """보험사 생성 요청 스키마"""

    name: str = Field(..., min_length=1, max_length=200, description="보험사 공식 명칭")
    code: str = Field(..., min_length=1, max_length=100, description="보험사 고유 코드 (슬러그)")
    logo_url: str | None = Field(None, description="로고 이미지 URL")
    website_url: str | None = Field(None, description="공식 웹사이트 URL")
    is_active: bool = Field(True, description="활성화 여부")
    metadata_: dict[str, Any] | None = Field(None, alias="metadata", description="추가 메타데이터")

    model_config = ConfigDict(populate_by_name=True)


class InsuranceCompanyUpdate(BaseModel):
    """보험사 수정 요청 스키마 (모든 필드 선택)"""

    name: str | None = Field(None, min_length=1, max_length=200)
    code: str | None = Field(None, min_length=1, max_length=100)
    logo_url: str | None = None
    website_url: str | None = None
    is_active: bool | None = None
    metadata_: dict[str, Any] | None = Field(None, alias="metadata")

    model_config = ConfigDict(populate_by_name=True)


class InsuranceCompanyResponse(BaseModel):
    """보험사 응답 스키마"""

    id: uuid.UUID
    name: str
    code: str
    logo_url: str | None = None
    website_url: str | None = None
    is_active: bool
    metadata_: dict[str, Any] | None = Field(None, alias="metadata")
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


# ─────────────────────────────────────────────
# Policy 스키마
# ─────────────────────────────────────────────


class PolicyCreate(BaseModel):
    """보험 상품 생성 요청 스키마"""

    company_id: uuid.UUID = Field(..., description="소속 보험사 ID")
    name: str = Field(..., min_length=1, max_length=300, description="상품명")
    product_code: str = Field(..., min_length=1, max_length=100, description="상품 코드")
    category: InsuranceCategory = Field(..., description="보험 분류")
    effective_date: date | None = Field(None, description="약관 시행일")
    expiry_date: date | None = Field(None, description="약관 만료일")
    is_discontinued: bool = Field(False, description="판매 중단 여부")
    raw_text: str | None = Field(None, description="원본 약관 전문")
    metadata_: dict[str, Any] | None = Field(None, alias="metadata")

    model_config = ConfigDict(populate_by_name=True)


class PolicyUpdate(BaseModel):
    """보험 상품 수정 요청 스키마 (모든 필드 선택)"""

    name: str | None = Field(None, min_length=1, max_length=300)
    category: InsuranceCategory | None = None
    effective_date: date | None = None
    expiry_date: date | None = None
    is_discontinued: bool | None = None
    raw_text: str | None = None
    metadata_: dict[str, Any] | None = Field(None, alias="metadata")

    model_config = ConfigDict(populate_by_name=True)


class PolicyResponse(BaseModel):
    """보험 상품 응답 스키마"""

    id: uuid.UUID
    company_id: uuid.UUID
    name: str
    product_code: str
    category: InsuranceCategory
    effective_date: date | None = None
    expiry_date: date | None = None
    is_discontinued: bool
    metadata_: dict[str, Any] | None = Field(None, alias="metadata")
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


# ─────────────────────────────────────────────
# Coverage 스키마
# ─────────────────────────────────────────────


class CoverageCreate(BaseModel):
    """보장 항목 생성 요청 스키마"""

    policy_id: uuid.UUID = Field(..., description="소속 보험 상품 ID")
    name: str = Field(..., min_length=1, max_length=300, description="보장 항목명")
    coverage_type: str = Field(..., min_length=1, max_length=100, description="보장 유형")
    eligibility_criteria: str | None = Field(None, description="가입 자격 기준")
    exclusions: str | None = Field(None, description="면책 사항")
    compensation_rules: str | None = Field(None, description="보상 산정 규정")
    max_amount: int | None = Field(None, ge=0, description="최대 보상 금액 (원)")
    metadata_: dict[str, Any] | None = Field(None, alias="metadata")

    model_config = ConfigDict(populate_by_name=True)


class CoverageUpdate(BaseModel):
    """보장 항목 수정 요청 스키마 (모든 필드 선택)"""

    name: str | None = Field(None, min_length=1, max_length=300)
    coverage_type: str | None = None
    eligibility_criteria: str | None = None
    exclusions: str | None = None
    compensation_rules: str | None = None
    max_amount: int | None = Field(None, ge=0)
    metadata_: dict[str, Any] | None = Field(None, alias="metadata")

    model_config = ConfigDict(populate_by_name=True)


class CoverageResponse(BaseModel):
    """보장 항목 응답 스키마"""

    id: uuid.UUID
    policy_id: uuid.UUID
    name: str
    coverage_type: str
    eligibility_criteria: str | None = None
    exclusions: str | None = None
    compensation_rules: str | None = None
    max_amount: int | None = None
    metadata_: dict[str, Any] | None = Field(None, alias="metadata")
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


# ─────────────────────────────────────────────
# PolicyChunk 스키마
# ─────────────────────────────────────────────


class PolicyChunkResponse(BaseModel):
    """약관 청크 응답 스키마"""

    id: uuid.UUID
    policy_id: uuid.UUID
    coverage_id: uuid.UUID | None = None
    chunk_text: str
    chunk_index: int
    metadata_: dict[str, Any] | None = Field(None, alias="metadata")
    created_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


# ─────────────────────────────────────────────
# Semantic Search 스키마
# ─────────────────────────────────────────────


class SemanticSearchRequest(BaseModel):
    """시맨틱 검색 요청 스키마"""

    query: str = Field(..., min_length=1, description="검색 쿼리 텍스트")
    top_k: int = Field(5, ge=1, le=50, description="반환할 최대 결과 수")
    threshold: float = Field(0.8, ge=0.0, le=1.0, description="최소 유사도 임계값")
    company_id: uuid.UUID | None = Field(None, description="특정 보험사로 필터링")
    category: InsuranceCategory | None = Field(None, description="보험 분류로 필터링")


class SearchResult(BaseModel):
    """개별 검색 결과"""

    chunk_id: uuid.UUID = Field(..., description="청크 ID")
    policy_id: uuid.UUID = Field(..., description="소속 상품 ID")
    coverage_id: uuid.UUID | None = Field(None, description="연관 보장 항목 ID")
    chunk_text: str = Field(..., description="청크 원문")
    chunk_index: int = Field(0, description="청크 순서")
    similarity: float = Field(..., ge=0.0, le=1.0, description="코사인 유사도")
    policy_name: str | None = Field(None, description="상품명")
    company_name: str | None = Field(None, description="보험사명")

    model_config = ConfigDict(from_attributes=True)


class SemanticSearchResponse(BaseModel):
    """시맨틱 검색 응답 스키마"""

    results: list[SearchResult] = Field(default_factory=list)
    total: int = Field(..., ge=0, description="전체 결과 수")
    query: str | None = Field(None, description="원본 쿼리")
