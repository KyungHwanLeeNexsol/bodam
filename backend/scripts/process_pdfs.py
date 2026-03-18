#!/usr/bin/env python3
"""PDF 파싱 및 임베딩 파이프라인

등록된 Policy 레코드의 PDF 파일을 파싱하여 PolicyChunk를 생성하고 임베딩 생성.

Usage:
  python scripts/process_pdfs.py            # 모든 정책 처리
  python scripts/process_pdfs.py --limit 10  # 최대 10개만 처리
  python scripts/process_pdfs.py --company kb  # 특정 보험사만
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

try:
    from dotenv import load_dotenv
    load_dotenv(project_root / ".env")
except ImportError:
    pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("process_pdfs")


async def process_all(limit: int | None = None, company_filter: str | None = None) -> None:
    """등록된 Policy PDF → PolicyChunk + 임베딩 생성"""
    import uuid

    import app.core.database as db_module
    from app.core.config import Settings
    from app.models.insurance import InsuranceCompany, Policy, PolicyChunk
    from app.services.parser.pdf_parser import PDFParser
    from app.services.parser.text_chunker import TextChunker
    from app.services.rag.embeddings import EmbeddingService
    from sqlalchemy import select

    settings = Settings()  # type: ignore[call-arg]
    await db_module.init_database(settings)

    if db_module.session_factory is None:
        logger.error("DB 초기화 실패")
        return

    import os
    api_key = getattr(settings, "gemini_api_key", None) or os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        logger.error("GEMINI_API_KEY가 설정되지 않았습니다")
        return

    embedding_service = EmbeddingService(
        api_key=api_key,
        model=getattr(settings, "embedding_model", "models/text-embedding-004"),
        dimensions=getattr(settings, "embedding_dimensions", 768),
    )
    pdf_parser = PDFParser()
    text_chunker = TextChunker(
        chunk_size=getattr(settings, "chunk_size_tokens", 500),
        chunk_overlap=getattr(settings, "chunk_overlap_tokens", 100),
    )

    async with db_module.session_factory() as session:
        # Policy 조회 (청크가 없는 것만)
        stmt = (
            select(Policy, InsuranceCompany)
            .join(InsuranceCompany, Policy.company_id == InsuranceCompany.id)
        )
        if company_filter:
            stmt = stmt.where(InsuranceCompany.code == company_filter)

        result = await session.execute(stmt)
        rows = result.all()

        # 이미 청크가 있는 Policy 제외
        processed_ids = set()
        chunk_stmt = select(PolicyChunk.policy_id).distinct()
        chunk_result = await session.execute(chunk_stmt)
        processed_ids = {row[0] for row in chunk_result}

        # SQLAlchemy 객체를 plain dict로 변환 (rollback 후 expired 방지)
        raw_policies = [
            {
                "id": policy.id,
                "product_code": policy.product_code,
                "pdf_path": (policy.metadata_ or {}).get("pdf_path"),
                "company_code": company.code,
            }
            for policy, company in rows
            if policy.id not in processed_ids
        ]

        if limit:
            raw_policies = raw_policies[:limit]

        logger.info("처리할 Policy 수: %d개 (전체 %d개 중)", len(raw_policies), len(rows))

        success_count = 0
        fail_count = 0

        for i, pol in enumerate(raw_policies, 1):
            pdf_path_rel = pol["pdf_path"]
            if not pdf_path_rel:
                logger.warning("[%d/%d] PDF 경로 없음: %s", i, len(raw_policies), pol["product_code"])
                fail_count += 1
                continue

            pdf_path = project_root / pdf_path_rel
            if not pdf_path.exists():
                logger.warning("[%d/%d] PDF 없음: %s", i, len(raw_policies), pdf_path)
                fail_count += 1
                continue

            try:
                logger.info("[%d/%d] 처리 중: %s / %s", i, len(raw_policies), pol["company_code"], pol["product_code"])

                # PDF 파싱
                text = pdf_parser.extract_text(str(pdf_path))
                if not text or not text.strip():
                    logger.warning("텍스트 추출 실패 또는 빈 내용: %s", pdf_path)
                    fail_count += 1
                    continue

                # 청크 분할 (메타데이터 포함)
                chunks = text_chunker.chunk_text_with_metadata(text)
                if not chunks:
                    logger.warning("청크 없음: %s", pdf_path)
                    fail_count += 1
                    continue

                # 임베딩 생성
                texts = [c["text"] for c in chunks]
                vectors = await embedding_service.embed_batch(texts)

                # PolicyChunk 저장
                chunk_count = 0
                for j, (chunk, vector) in enumerate(zip(chunks, vectors)):
                    policy_chunk = PolicyChunk(
                        id=uuid.uuid4(),
                        policy_id=pol["id"],
                        chunk_index=j,
                        chunk_text=chunk["text"],
                        embedding=vector,
                        metadata_={
                            "company_code": pol["company_code"],
                            "product_code": pol["product_code"],
                            "chunk_index": j,
                            "total_chunks": len(chunks),
                            "token_count": chunk.get("token_count", 0),
                        },
                    )
                    session.add(policy_chunk)
                    chunk_count += 1

                await session.commit()
                logger.info("  → %d청크 생성 + 임베딩 완료", chunk_count)
                success_count += 1

            except Exception as exc:
                await session.rollback()
                logger.error("[%d/%d] 실패: %s - %s", i, len(raw_policies), pol["product_code"], exc)
                fail_count += 1

    print(f"\n{'='*50}")
    print("PDF 처리 완료")
    print(f"{'='*50}")
    print(f"성공:   {success_count}개")
    print(f"실패:   {fail_count}개")
    print(f"{'='*50}\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="PDF 파싱 및 임베딩 생성")
    parser.add_argument("--limit", type=int, help="처리할 최대 Policy 수")
    parser.add_argument("--company", type=str, help="특정 보험사 코드만 처리 (예: kb, klia-unknown)")
    args = parser.parse_args()

    asyncio.run(process_all(limit=args.limit, company_filter=args.company))


if __name__ == "__main__":
    main()
