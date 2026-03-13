"""보험 상품 Admin CRUD API (TAG-019)

Policy 생성, 조회, 수정, 삭제 엔드포인트.
raw_text 제공 시 DocumentProcessor 파이프라인을 통해 자동 임베딩 처리.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.insurance import InsuranceCategory, Policy
from app.schemas.insurance import PolicyCreate, PolicyResponse, PolicyUpdate

# # @MX:ANCHOR: 보험 상품 Admin 라우터 - 상품 CRUD 공개 API 진입점
# # @MX:REASON: 상품 생성/삭제는 보장 항목, 청크 등 연관 데이터에 cascade 영향

router = APIRouter(tags=["policies"])


def _policy_to_response(policy: Policy) -> PolicyResponse:
    """Policy SQLAlchemy 모델을 응답 스키마로 변환

    SQLAlchemy Base.metadata 속성 충돌을 피하기 위해 명시적으로 딕셔너리 변환.
    """
    return PolicyResponse(
        id=policy.id,
        company_id=policy.company_id,
        name=policy.name,
        product_code=policy.product_code,
        category=policy.category,
        effective_date=policy.effective_date,
        expiry_date=policy.expiry_date,
        is_discontinued=policy.is_discontinued,
        metadata=policy.metadata_,
        created_at=policy.created_at,
        updated_at=policy.updated_at,
    )


@router.post("/", response_model=PolicyResponse, status_code=status.HTTP_201_CREATED)
async def create_policy(
    policy_data: PolicyCreate,
    session: AsyncSession = Depends(get_db),
) -> PolicyResponse:
    """보험 상품 생성

    새로운 보험 상품을 등록합니다.
    raw_text 포함 시 DocumentProcessor로 자동 임베딩 처리.
    동일 보험사 내 product_code 중복 시 409를 반환합니다.
    """
    data = policy_data.model_dump(by_alias=False)
    raw_text = data.pop("raw_text", None)

    new_policy = Policy(**data)
    session.add(new_policy)

    try:
        await session.commit()
    except IntegrityError:
        # (company_id, product_code) 유니크 제약 위반
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="동일 보험사 내 상품 코드가 이미 존재합니다",
        )

    await session.refresh(new_policy)

    # raw_text 제공 시 비동기 임베딩 파이프라인 실행
    if raw_text:
        try:
            from app.services.parser.document_processor import DocumentProcessor

            processor = DocumentProcessor()
            await processor.process_text(raw_text, policy_id=new_policy.id, session=session)
        except Exception:
            # 임베딩 실패는 상품 생성을 롤백하지 않음 (비동기 처리)
            pass

    return _policy_to_response(new_policy)


@router.get("/", response_model=list[PolicyResponse])
async def list_policies(
    company_id: Annotated[uuid.UUID | None, Query(description="보험사 ID 필터")] = None,
    category: Annotated[InsuranceCategory | None, Query(description="보험 분류 필터")] = None,
    is_discontinued: Annotated[bool | None, Query(description="판매 중단 여부 필터")] = None,
    session: AsyncSession = Depends(get_db),
) -> list[PolicyResponse]:
    """보험 상품 목록 조회

    선택적 필터(company_id, category, is_discontinued)를 적용하여 목록 반환.
    """
    query = select(Policy)

    if company_id is not None:
        query = query.where(Policy.company_id == company_id)
    if category is not None:
        query = query.where(Policy.category == category)
    if is_discontinued is not None:
        query = query.where(Policy.is_discontinued == is_discontinued)

    result = await session.execute(query)
    policies = result.scalars().all()
    return [_policy_to_response(p) for p in policies]


@router.get("/{policy_id}", response_model=PolicyResponse)
async def get_policy(
    policy_id: uuid.UUID,
    session: AsyncSession = Depends(get_db),
) -> PolicyResponse:
    """보험 상품 단건 조회 (보장 항목 포함)

    지정된 ID의 보험 상품 및 연관 보장 항목을 반환합니다.
    존재하지 않으면 404를 반환합니다.
    """
    result = await session.execute(select(Policy).where(Policy.id == policy_id))
    policy = result.scalar_one_or_none()
    if not policy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="보험 상품을 찾을 수 없습니다")
    return _policy_to_response(policy)


@router.put("/{policy_id}", response_model=PolicyResponse)
async def update_policy(
    policy_id: uuid.UUID,
    update_data: PolicyUpdate,
    session: AsyncSession = Depends(get_db),
) -> PolicyResponse:
    """보험 상품 수정

    지정된 ID의 보험 상품 정보를 수정합니다.
    존재하지 않으면 404를 반환합니다.
    """
    result = await session.execute(select(Policy).where(Policy.id == policy_id))
    policy = result.scalar_one_or_none()
    if not policy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="보험 상품을 찾을 수 없습니다")

    for field, value in update_data.model_dump(exclude_unset=True, by_alias=False).items():
        setattr(policy, field, value)

    await session.commit()
    await session.refresh(policy)
    return _policy_to_response(policy)


@router.delete("/{policy_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_policy(
    policy_id: uuid.UUID,
    session: AsyncSession = Depends(get_db),
) -> None:
    """보험 상품 삭제 (cascade)

    지정된 ID의 보험 상품을 삭제합니다.
    연관 보장 항목(Coverage)과 청크(PolicyChunk)도 cascade 삭제됩니다.
    존재하지 않으면 404를 반환합니다.
    """
    result = await session.execute(select(Policy).where(Policy.id == policy_id))
    policy = result.scalar_one_or_none()
    if not policy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="보험 상품을 찾을 수 없습니다")

    await session.delete(policy)
    await session.commit()


@router.post("/{policy_id}/ingest", response_model=PolicyResponse)
async def ingest_policy(
    policy_id: uuid.UUID,
    session: AsyncSession = Depends(get_db),
) -> PolicyResponse:
    """기존 보험 상품 임베딩 파이프라인 실행

    raw_text가 있는 기존 보험 상품에 대해 문서 처리 및 임베딩을 (재)실행합니다.
    존재하지 않으면 404를 반환합니다.
    """
    result = await session.execute(select(Policy).where(Policy.id == policy_id))
    policy = result.scalar_one_or_none()
    if not policy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="보험 상품을 찾을 수 없습니다")

    if policy.raw_text:
        from app.services.parser.document_processor import DocumentProcessor

        processor = DocumentProcessor()
        await processor.process_text(policy.raw_text, policy_id=policy.id, session=session)

    return _policy_to_response(policy)
