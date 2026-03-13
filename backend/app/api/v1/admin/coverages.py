"""보장 항목 Admin CRUD API (TAG-019)

Coverage 생성, 조회, 수정, 삭제 엔드포인트.
보장 항목은 특정 보험 상품(Policy)에 종속됩니다.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.insurance import Coverage
from app.schemas.insurance import CoverageCreate, CoverageResponse, CoverageUpdate

router = APIRouter(tags=["coverages"])


def _coverage_to_response(coverage: Coverage) -> CoverageResponse:
    """Coverage SQLAlchemy 모델을 응답 스키마로 변환

    SQLAlchemy Base.metadata 속성 충돌을 피하기 위해 명시적으로 딕셔너리 변환.
    """
    return CoverageResponse(
        id=coverage.id,
        policy_id=coverage.policy_id,
        name=coverage.name,
        coverage_type=coverage.coverage_type,
        eligibility_criteria=coverage.eligibility_criteria,
        exclusions=coverage.exclusions,
        compensation_rules=coverage.compensation_rules,
        max_amount=coverage.max_amount,
        metadata=coverage.metadata_,
        created_at=coverage.created_at,
        updated_at=coverage.updated_at,
    )


@router.post("/policies/{policy_id}/coverages", response_model=CoverageResponse, status_code=status.HTTP_201_CREATED)
async def create_coverage(
    policy_id: uuid.UUID,
    coverage_data: CoverageCreate,
    session: AsyncSession = Depends(get_db),
) -> CoverageResponse:
    """보장 항목 생성

    특정 보험 상품에 새로운 보장 항목을 등록합니다.
    """
    data = coverage_data.model_dump(by_alias=False)
    # policy_id는 URL 경로에서 가져오므로 덮어씀
    data["policy_id"] = policy_id
    new_coverage = Coverage(**data)
    session.add(new_coverage)
    await session.commit()
    await session.refresh(new_coverage)
    return _coverage_to_response(new_coverage)


@router.get("/policies/{policy_id}/coverages", response_model=list[CoverageResponse])
async def list_coverages(
    policy_id: uuid.UUID,
    session: AsyncSession = Depends(get_db),
) -> list[CoverageResponse]:
    """보장 항목 목록 조회

    특정 보험 상품에 속한 모든 보장 항목 목록을 반환합니다.
    """
    result = await session.execute(select(Coverage).where(Coverage.policy_id == policy_id))
    coverages = result.scalars().all()
    return [_coverage_to_response(c) for c in coverages]


@router.put("/coverages/{coverage_id}", response_model=CoverageResponse)
async def update_coverage(
    coverage_id: uuid.UUID,
    update_data: CoverageUpdate,
    session: AsyncSession = Depends(get_db),
) -> CoverageResponse:
    """보장 항목 수정

    지정된 ID의 보장 항목 정보를 수정합니다.
    존재하지 않으면 404를 반환합니다.
    """
    result = await session.execute(select(Coverage).where(Coverage.id == coverage_id))
    coverage = result.scalar_one_or_none()
    if not coverage:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="보장 항목을 찾을 수 없습니다")

    for field, value in update_data.model_dump(exclude_unset=True, by_alias=False).items():
        setattr(coverage, field, value)

    await session.commit()
    await session.refresh(coverage)
    return _coverage_to_response(coverage)


@router.delete("/coverages/{coverage_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_coverage(
    coverage_id: uuid.UUID,
    session: AsyncSession = Depends(get_db),
) -> None:
    """보장 항목 삭제

    지정된 ID의 보장 항목을 삭제합니다.
    존재하지 않으면 404를 반환합니다.
    """
    result = await session.execute(select(Coverage).where(Coverage.id == coverage_id))
    coverage = result.scalar_one_or_none()
    if not coverage:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="보장 항목을 찾을 수 없습니다")

    await session.delete(coverage)
    await session.commit()
