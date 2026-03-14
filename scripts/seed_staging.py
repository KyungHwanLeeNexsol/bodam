"""스테이징 데이터베이스 시드 스크립트

보담 플랫폼 스테이징 환경에 테스트용 샘플 데이터를 생성합니다.
기존 데이터를 초기화하려면 --reset 플래그를 사용하세요.

Usage:
    python scripts/seed_staging.py
    python scripts/seed_staging.py --reset
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import uuid

# 프로젝트 루트를 Python 경로에 추가 (backend 패키지 임포트용)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

# python-dotenv 사용 가능 시 .env 로드 (없어도 동작)
try:
    from dotenv import load_dotenv

    load_dotenv()
    load_dotenv(".env.staging", override=True)
except ImportError:
    pass  # dotenv 미설치 시 환경 변수는 os.environ에서 읽음

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# 프로젝트 모델 임포트
from app.core.security import hash_password
from app.models.insurance import InsuranceCategory, InsuranceCompany, Policy
from app.models.user import User


def get_database_url() -> str:
    """환경 변수에서 DATABASE_URL을 읽어 반환합니다."""
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise ValueError(
            "DATABASE_URL 환경 변수가 설정되지 않았습니다.\n"
            ".env.staging 파일 또는 환경 변수에 DATABASE_URL을 설정해 주세요."
        )
    # asyncpg 드라이버 사용 (psycopg2 URL인 경우 변환)
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    elif url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+asyncpg://", 1)
    return url


async def reset_data(session: AsyncSession) -> None:
    """기존 시드 데이터를 삭제합니다."""
    from sqlalchemy import delete, select

    print("기존 시드 데이터 삭제 중...")

    # 테스트 사용자 삭제 (이메일로 식별)
    test_emails = ["test1@bodam.io", "test2@bodam.io"]
    for email in test_emails:
        result = await session.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if user:
            await session.delete(user)

    # 테스트 보험사 삭제 (코드로 식별)
    test_company_codes = ["samsung-life-seed", "hyundai-marine-seed"]
    for code in test_company_codes:
        result = await session.execute(select(InsuranceCompany).where(InsuranceCompany.code == code))
        company = result.scalar_one_or_none()
        if company:
            await session.delete(company)

    await session.flush()
    print("  기존 데이터 삭제 완료")


async def seed_users(session: AsyncSession) -> list[User]:
    """테스트 사용자 2명을 생성합니다."""
    users_data = [
        {
            "email": "test1@bodam.io",
            "plain_password": "Test1234!",
            "full_name": "테스트 사용자 1",
        },
        {
            "email": "test2@bodam.io",
            "plain_password": "Test1234!",
            "full_name": "테스트 사용자 2",
        },
    ]

    created_users: list[User] = []
    for data in users_data:
        user = User(
            email=data["email"],
            hashed_password=hash_password(data["plain_password"]),
            full_name=data["full_name"],
            is_active=True,
        )
        session.add(user)
        created_users.append(user)

    await session.flush()
    print("✓ 사용자 2명 생성")
    return created_users


async def seed_insurance_companies(session: AsyncSession) -> list[InsuranceCompany]:
    """보험사 2개를 생성합니다."""
    companies_data = [
        {
            "id": uuid.uuid4(),
            "name": "삼성생명보험",
            "code": "samsung-life-seed",
            "logo_url": None,
            "website_url": "https://www.samsunglife.com",
            "is_active": True,
        },
        {
            "id": uuid.uuid4(),
            "name": "현대해상화재보험",
            "code": "hyundai-marine-seed",
            "logo_url": None,
            "website_url": "https://www.hi.co.kr",
            "is_active": True,
        },
    ]

    created_companies: list[InsuranceCompany] = []
    for data in companies_data:
        company = InsuranceCompany(
            id=data["id"],
            name=data["name"],
            code=data["code"],
            logo_url=data["logo_url"],
            website_url=data["website_url"],
            is_active=data["is_active"],
        )
        session.add(company)
        created_companies.append(company)

    await session.flush()
    print("✓ 보험사 2개 생성")
    return created_companies


async def seed_policies(session: AsyncSession, companies: list[InsuranceCompany]) -> list[Policy]:
    """보험 상품 2개를 생성합니다 (보험사별 1개)."""
    policies_data = [
        {
            "id": uuid.uuid4(),
            "company_id": companies[0].id,
            "name": "삼성생명 종신보험 2024",
            "product_code": "SL-SEED-2024-001",
            "category": InsuranceCategory.LIFE,
            "raw_text": (
                "제1조 (보험의 목적) 이 약관은 삼성생명보험의 종신보험 상품에 관한 사항을 정합니다.\n"
                "제2조 (보험금의 지급) 피보험자가 보험기간 중 사망한 경우 사망보험금을 지급합니다.\n"
                "제3조 (보험료의 납입) 계약자는 보험료를 약정한 날짜에 납입하여야 합니다.\n"
                "제4조 (면책 조항) 피보험자가 고의로 자신을 해친 경우 보험금을 지급하지 않습니다.\n"
                "이 약관은 테스트 목적으로 생성된 샘플 데이터입니다."
            ),
        },
        {
            "id": uuid.uuid4(),
            "company_id": companies[1].id,
            "name": "현대해상 실손의료비보험 2024",
            "product_code": "HM-SEED-2024-001",
            "category": InsuranceCategory.THIRD_SECTOR,
            "raw_text": (
                "제1조 (보험의 목적) 이 약관은 현대해상화재보험의 실손의료비 상품에 관한 사항을 정합니다.\n"
                "제2조 (보험금의 지급) 피보험자가 질병 또는 상해로 인하여 입원 또는 통원 치료를 받은 경우 "
                "실제 의료비를 보장합니다.\n"
                "제3조 (자기부담금) 보험금 청구 시 자기부담금 10%를 공제 후 지급합니다.\n"
                "제4조 (보장 제외 항목) 미용 목적의 수술, 치과 치료 등은 보장에서 제외됩니다.\n"
                "이 약관은 테스트 목적으로 생성된 샘플 데이터입니다."
            ),
        },
    ]

    created_policies: list[Policy] = []
    for data in policies_data:
        policy = Policy(
            id=data["id"],
            company_id=data["company_id"],
            name=data["name"],
            product_code=data["product_code"],
            category=data["category"],
            raw_text=data["raw_text"],
            is_discontinued=False,
        )
        session.add(policy)
        created_policies.append(policy)

    await session.flush()
    print("✓ 보험 상품 2개 생성")
    return created_policies


async def main(reset: bool = False) -> None:
    """메인 시드 실행 함수"""
    print("보담 스테이징 데이터베이스 시드 시작...")
    print()

    database_url = get_database_url()

    # 비동기 엔진 생성 (database.py의 패턴과 동일)
    engine = create_async_engine(
        database_url,
        echo=False,
        pool_pre_ping=True,
    )
    session_factory = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    async with session_factory() as session:
        try:
            if reset:
                await reset_data(session)

            users = await seed_users(session)
            companies = await seed_insurance_companies(session)
            policies = await seed_policies(session, companies)

            await session.commit()

            print()
            print("=================================")
            print("시드 완료 요약")
            print("=================================")
            print(f"  사용자:    {len(users)}명")
            print(f"  보험사:    {len(companies)}개")
            print(f"  보험 상품: {len(policies)}개")
            print()
            print("테스트 계정 정보:")
            print("  test1@bodam.io / Test1234!")
            print("  test2@bodam.io / Test1234!")
            print("=================================")

        except Exception as err:
            await session.rollback()
            print(f"\n[오류] 시드 실패: {err}")
            raise
        finally:
            await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="보담 스테이징 데이터베이스 시드 스크립트")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="기존 시드 데이터를 삭제한 후 재생성합니다.",
    )
    args = parser.parse_args()

    asyncio.run(main(reset=args.reset))
