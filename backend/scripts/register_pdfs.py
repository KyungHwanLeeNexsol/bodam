#!/usr/bin/env python3
"""저장된 PDF 파일을 스캔하여 DB에 InsuranceCompany + Policy 레코드 등록

Usage:
  python scripts/register_pdfs.py
"""
from __future__ import annotations

import asyncio
import logging
import sys
import uuid
from pathlib import Path

project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

try:
    from dotenv import load_dotenv
    load_dotenv(project_root / ".env")
except ImportError:
    pass

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("register_pdfs")


async def main() -> None:
    import app.core.database as db_module
    from app.core.config import Settings
    from app.models.insurance import InsuranceCategory, InsuranceCompany, Policy
    from sqlalchemy import select

    settings = Settings()  # type: ignore[call-arg]
    await db_module.init_database(settings)

    if db_module.session_factory is None:
        logger.error("DB 초기화 실패")
        return

    data_dir = project_root / "data"
    if not data_dir.exists():
        logger.error("data/ 디렉터리 없음: %s", data_dir)
        return

    # data/{company_code}/{product_code}/latest.pdf 구조 스캔
    pdf_files = list(data_dir.glob("**/latest.pdf"))
    logger.info("발견된 PDF 파일: %d개", len(pdf_files))

    created_companies = 0
    created_policies = 0
    skipped = 0

    async with db_module.session_factory() as session:
        for pdf_path in pdf_files:
            # 경로 구조: data/{company_code}/{product_code}/latest.pdf
            parts = pdf_path.relative_to(data_dir).parts
            if len(parts) < 3:
                logger.warning("경로 형식 불일치, 건너뜀: %s", pdf_path)
                continue

            company_code = parts[0]
            product_code = parts[1]
            rel_path = str(pdf_path.relative_to(project_root))

            # company_name 추출 (코드에서 역변환)
            company_name = company_code.replace("-", " ").title()

            # InsuranceCompany upsert
            stmt = select(InsuranceCompany).where(InsuranceCompany.code == company_code)
            result = await session.execute(stmt)
            company = result.scalar_one_or_none()
            if company is None:
                company = InsuranceCompany(
                    id=uuid.uuid4(),
                    code=company_code,
                    name=company_name,
                )
                session.add(company)
                await session.flush()
                created_companies += 1
                logger.info("보험사 생성: %s", company_code)

            # Policy upsert
            stmt2 = select(Policy).where(
                Policy.company_id == company.id,
                Policy.product_code == product_code,
            )
            result2 = await session.execute(stmt2)
            policy = result2.scalar_one_or_none()
            if policy is None:
                policy = Policy(
                    id=uuid.uuid4(),
                    company_id=company.id,
                    name=product_code,  # 상품명은 코드로 대체 (추후 크롤러에서 업데이트)
                    product_code=product_code,
                    category=InsuranceCategory.LIFE,
                    metadata_={"pdf_path": rel_path, "source": "file_scan"},
                )
                session.add(policy)
                created_policies += 1
            else:
                skipped += 1

        await session.commit()

    logger.info("완료 - 보험사: %d개 생성, 상품: %d개 생성, %d개 스킵",
                created_companies, created_policies, skipped)


if __name__ == "__main__":
    asyncio.run(main())
