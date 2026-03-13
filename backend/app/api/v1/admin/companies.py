"""보험사 Admin CRUD API (TAG-019)

보험사(InsuranceCompany) 생성, 조회, 수정, 삭제 엔드포인트.
SQLAlchemy 모델 -> Pydantic 응답 변환 시 metadata_ 충돌 방지를 위해
model_to_response 헬퍼를 사용.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.insurance import InsuranceCompany
from app.schemas.insurance import InsuranceCompanyCreate, InsuranceCompanyResponse, InsuranceCompanyUpdate

# # @MX:ANCHOR: 보험사 Admin 라우터 - 보험사 CRUD 공개 API 진입점
# # @MX:REASON: 보험사 생성/수정/삭제는 전체 데이터 무결성에 영향을 미침

router = APIRouter(tags=["companies"])


def _company_to_response(company: InsuranceCompany) -> InsuranceCompanyResponse:
    """InsuranceCompany SQLAlchemy 모델을 응답 스키마로 변환

    SQLAlchemy Base.metadata 속성 충돌을 피하기 위해 명시적으로 딕셔너리 변환.
    """
    return InsuranceCompanyResponse(
        id=company.id,
        name=company.name,
        code=company.code,
        logo_url=company.logo_url,
        website_url=company.website_url,
        is_active=company.is_active,
        metadata=company.metadata_,
        created_at=company.created_at,
        updated_at=company.updated_at,
    )


@router.post("/", response_model=InsuranceCompanyResponse, status_code=status.HTTP_201_CREATED)
async def create_company(
    company_data: InsuranceCompanyCreate,
    session: AsyncSession = Depends(get_db),
) -> InsuranceCompanyResponse:
    """보험사 생성

    새로운 보험사를 데이터베이스에 등록합니다.
    code 필드는 유일해야 합니다.
    """
    data = company_data.model_dump(by_alias=False)
    new_company = InsuranceCompany(**data)
    session.add(new_company)
    await session.commit()
    await session.refresh(new_company)
    return _company_to_response(new_company)


@router.get("/", response_model=list[InsuranceCompanyResponse])
async def list_companies(
    session: AsyncSession = Depends(get_db),
) -> list[InsuranceCompanyResponse]:
    """보험사 목록 조회

    등록된 모든 보험사 목록을 반환합니다.
    """
    result = await session.execute(select(InsuranceCompany))
    companies = result.scalars().all()
    return [_company_to_response(c) for c in companies]


@router.get("/{company_id}", response_model=InsuranceCompanyResponse)
async def get_company(
    company_id: uuid.UUID,
    session: AsyncSession = Depends(get_db),
) -> InsuranceCompanyResponse:
    """보험사 단건 조회

    지정된 ID의 보험사 정보를 반환합니다.
    존재하지 않으면 404를 반환합니다.
    """
    result = await session.execute(select(InsuranceCompany).where(InsuranceCompany.id == company_id))
    company = result.scalar_one_or_none()
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="보험사를 찾을 수 없습니다")
    return _company_to_response(company)


@router.put("/{company_id}", response_model=InsuranceCompanyResponse)
async def update_company(
    company_id: uuid.UUID,
    update_data: InsuranceCompanyUpdate,
    session: AsyncSession = Depends(get_db),
) -> InsuranceCompanyResponse:
    """보험사 수정

    지정된 ID의 보험사 정보를 수정합니다.
    존재하지 않으면 404를 반환합니다.
    """
    result = await session.execute(select(InsuranceCompany).where(InsuranceCompany.id == company_id))
    company = result.scalar_one_or_none()
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="보험사를 찾을 수 없습니다")

    # 제공된 필드만 업데이트 (exclude_unset=True)
    for field, value in update_data.model_dump(exclude_unset=True, by_alias=False).items():
        setattr(company, field, value)

    await session.commit()
    await session.refresh(company)
    return _company_to_response(company)


@router.delete("/{company_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_company(
    company_id: uuid.UUID,
    session: AsyncSession = Depends(get_db),
) -> None:
    """보험사 삭제

    지정된 ID의 보험사를 삭제합니다.
    연관 보험 상품(Policy)도 cascade 삭제됩니다.
    존재하지 않으면 404를 반환합니다.
    """
    result = await session.execute(select(InsuranceCompany).where(InsuranceCompany.id == company_id))
    company = result.scalar_one_or_none()
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="보험사를 찾을 수 없습니다")

    await session.delete(company)
    await session.commit()
