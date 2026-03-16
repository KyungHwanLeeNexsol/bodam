#!/usr/bin/env python3
"""보험 약관 데이터 수집 파이프라인 실행 스크립트

Celery 없이 직접 크롤러와 임베딩 파이프라인을 실행.
개발/테스트 환경과 운영 환경 모두에서 사용 가능.

Usage:
  python scripts/run_pipeline.py crawl --crawler klia
  python scripts/run_pipeline.py crawl --crawler knia
  python scripts/run_pipeline.py crawl --all
  python scripts/run_pipeline.py embed --all
  python scripts/run_pipeline.py status
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path

# 프로젝트 루트를 Python 경로에 추가
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

# 환경변수 로딩 (.env 파일 지원)
try:
    from dotenv import load_dotenv
    load_dotenv(project_root / ".env")
except ImportError:
    pass  # python-dotenv 없어도 동작 (환경변수 직접 설정)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("pipeline")


async def run_crawl(crawler_name: str) -> None:
    """크롤러 실행 및 수집된 PDF 인제스트

    Args:
        crawler_name: 크롤러 이름 ('klia' 또는 'knia')
    """
    import app.core.database as db_module
    from app.core.config import Settings

    settings = Settings()  # type: ignore[call-arg]
    await db_module.init_database(settings)

    if db_module.session_factory is None:
        logger.error("데이터베이스 초기화 실패")
        return

    logger.info("크롤러 시작: %s", crawler_name)

    async with db_module.session_factory() as session:
        # 스토리지 백엔드 초기화
        storage = _create_storage(settings)

        # 크롤러 인스턴스 생성
        crawler = _create_crawler(
            crawler_name=crawler_name,
            db_session=session,
            storage=storage,
            settings=settings,
        )

        if crawler is None:
            logger.error("알 수 없는 크롤러: %s (klia 또는 knia 중 선택)", crawler_name)
            return

        # 크롤링 실행
        result = await crawler.crawl()

        # 결과 출력
        print(f"\n{'='*50}")
        print(f"크롤러: {crawler_name.upper()}")
        print(f"{'='*50}")
        print(f"총 발견:   {result.total_found}개")
        print(f"신규:      {result.new_count}개")
        print(f"업데이트:  {result.updated_count}개")
        print(f"변경없음:  {result.skipped_count}개")
        print(f"실패:      {result.failed_count}개")
        print(f"{'='*50}\n")

        if result.failed_count > 0:
            logger.warning("%s 크롤링에서 %d개 실패 발생", crawler_name, result.failed_count)

        await session.commit()


async def run_embed_all() -> None:
    """임베딩이 없는 모든 정책 청크에 대해 임베딩 생성"""
    from sqlalchemy import select

    import app.core.database as db_module
    from app.core.config import Settings
    from app.models.insurance import PolicyChunk
    from app.services.rag.embeddings import EmbeddingService

    settings = Settings()  # type: ignore[call-arg]
    await db_module.init_database(settings)

    if db_module.session_factory is None:
        logger.error("데이터베이스 초기화 실패")
        return

    import os
    api_key = settings.gemini_api_key or os.environ.get("GOOGLE_API_KEY", "")
    if not api_key:
        logger.error("GEMINI_API_KEY 또는 GOOGLE_API_KEY가 설정되지 않았습니다")
        return

    embedding_service = EmbeddingService(
        api_key=api_key,
        model=settings.embedding_model,
        dimensions=settings.embedding_dimensions,
    )

    async with db_module.session_factory() as session:
        # 임베딩이 없는 청크 조회
        stmt = select(PolicyChunk).where(PolicyChunk.embedding.is_(None))
        result = await session.execute(stmt)
        chunks = result.scalars().all()

        if not chunks:
            logger.info("임베딩이 필요한 청크가 없습니다")
            return

        logger.info("임베딩 생성 시작: %d개 청크", len(chunks))

        texts = [chunk.chunk_text for chunk in chunks]
        vectors = await embedding_service.embed_batch(texts)

        embedded_count = 0
        for chunk, vector in zip(chunks, vectors):
            if vector:
                chunk.embedding = vector
                embedded_count += 1

        await session.commit()

        print(f"\n{'='*50}")
        print("임베딩 생성 완료")
        print(f"{'='*50}")
        print(f"처리 청크:  {len(chunks)}개")
        print(f"성공:       {embedded_count}개")
        print(f"실패:       {len(chunks) - embedded_count}개")
        print(f"{'='*50}\n")


async def show_status() -> None:
    """데이터베이스 현황 조회 및 출력"""
    from sqlalchemy import func, select

    import app.core.database as db_module
    from app.core.config import Settings
    from app.models.case_precedent import CasePrecedent
    from app.models.insurance import InsuranceCompany, Policy, PolicyChunk

    settings = Settings()  # type: ignore[call-arg]
    await db_module.init_database(settings)

    if db_module.session_factory is None:
        logger.error("데이터베이스 초기화 실패")
        return

    async with db_module.session_factory() as session:
        # 각 테이블 레코드 수 조회
        company_count_result = await session.execute(select(func.count()).select_from(InsuranceCompany))
        company_count = company_count_result.scalar() or 0

        policy_count_result = await session.execute(select(func.count()).select_from(Policy))
        policy_count = policy_count_result.scalar() or 0

        chunk_count_result = await session.execute(select(func.count()).select_from(PolicyChunk))
        chunk_count = chunk_count_result.scalar() or 0

        # 임베딩이 완료된 청크 수
        embedded_count_result = await session.execute(
            select(func.count()).select_from(PolicyChunk).where(PolicyChunk.embedding.isnot(None))
        )
        embedded_count = embedded_count_result.scalar() or 0

        # 판례 수
        precedent_count_result = await session.execute(select(func.count()).select_from(CasePrecedent))
        precedent_count = precedent_count_result.scalar() or 0

        # 판례 임베딩 완료 수
        precedent_embedded_result = await session.execute(
            select(func.count()).select_from(CasePrecedent).where(CasePrecedent.embedding.isnot(None))
        )
        precedent_embedded = precedent_embedded_result.scalar() or 0

    print(f"\n{'='*50}")
    print("보담 플랫폼 데이터 현황")
    print(f"{'='*50}")
    print(f"보험사:            {company_count:>8,}개")
    print(f"보험 상품:         {policy_count:>8,}개")
    print(f"약관 청크:         {chunk_count:>8,}개")
    print(f"  임베딩 완료:     {embedded_count:>8,}개")
    print(f"  임베딩 미완료:   {chunk_count - embedded_count:>8,}개")
    print(f"판례:              {precedent_count:>8,}개")
    print(f"  임베딩 완료:     {precedent_embedded:>8,}개")
    print(f"{'='*50}\n")

    if chunk_count > 0:
        embed_pct = embedded_count / chunk_count * 100
        print(f"청크 임베딩 완료율: {embed_pct:.1f}%\n")


def _create_storage(settings: object) -> object:
    """설정에 따라 스토리지 백엔드 생성

    Args:
        settings: 애플리케이션 설정

    Returns:
        스토리지 백엔드 인스턴스
    """
    try:
        from app.services.crawler.storage import LocalStorage
        base_dir = getattr(settings, "crawler_base_dir", "./data/crawled_pdfs")
        return LocalStorage(base_dir=base_dir)
    except ImportError:
        logger.warning("스토리지 모듈을 찾을 수 없습니다. 더미 스토리지 사용")
        return _DummyStorage()


class _DummyStorage:
    """스토리지 모듈 없을 때 사용하는 더미 구현"""

    def get_path(self, company_code: str, product_code: str, version: str) -> str:
        return f"./data/{company_code}/{product_code}/{version}.pdf"

    def save(self, data: bytes, path: str) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
        logger.info("PDF 저장: %s (%d bytes)", path, len(data))


def _create_crawler(
    crawler_name: str,
    db_session: object,
    storage: object,
    settings: object,
) -> object | None:
    """크롤러 이름에 따라 크롤러 인스턴스 생성

    Args:
        crawler_name: 크롤러 이름
        db_session: DB 세션
        storage: 스토리지 백엔드
        settings: 애플리케이션 설정

    Returns:
        크롤러 인스턴스 또는 None
    """
    rate_limit = getattr(settings, "crawler_rate_limit_seconds", 2.0)
    max_retries = getattr(settings, "crawler_max_retries", 3)

    if crawler_name == "klia":
        from app.services.crawler.companies.klia_crawler import KLIACrawler
        return KLIACrawler(
            db_session=db_session,
            storage=storage,
            rate_limit_seconds=rate_limit,
            max_retries=max_retries,
        )
    elif crawler_name == "knia":
        from app.services.crawler.companies.knia_crawler import KNIACrawler
        return KNIACrawler(
            db_session=db_session,
            storage=storage,
            rate_limit_seconds=rate_limit,
            max_retries=max_retries,
        )

    return None


def main() -> None:
    """CLI 진입점"""
    parser = argparse.ArgumentParser(
        description="보험 약관 데이터 수집 파이프라인",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
사용 예시:
  python scripts/run_pipeline.py status
  python scripts/run_pipeline.py crawl --crawler klia
  python scripts/run_pipeline.py crawl --crawler knia
  python scripts/run_pipeline.py crawl --all
  python scripts/run_pipeline.py embed --all
        """,
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    # crawl 서브커맨드
    crawl_parser = subparsers.add_parser("crawl", help="약관 목록 크롤링")
    crawl_group = crawl_parser.add_mutually_exclusive_group(required=True)
    crawl_group.add_argument(
        "--crawler",
        choices=["klia", "knia"],
        help="실행할 크롤러 선택 (klia: 생명보험협회, knia: 손해보험협회)",
    )
    crawl_group.add_argument(
        "--all",
        action="store_true",
        help="모든 크롤러 순차 실행",
    )

    # embed 서브커맨드
    embed_parser = subparsers.add_parser("embed", help="약관 청크 임베딩 생성")
    embed_parser.add_argument(
        "--all",
        action="store_true",
        required=True,
        help="임베딩 없는 모든 청크 처리",
    )

    # status 서브커맨드
    subparsers.add_parser("status", help="데이터베이스 현황 조회")

    args = parser.parse_args()

    try:
        if args.command == "crawl":
            if args.all:
                # 모든 크롤러 순차 실행
                async def run_all() -> None:
                    for name in ["klia", "knia"]:
                        await run_crawl(name)
                asyncio.run(run_all())
            else:
                asyncio.run(run_crawl(args.crawler))

        elif args.command == "embed":
            asyncio.run(run_embed_all())

        elif args.command == "status":
            asyncio.run(show_status())

    except KeyboardInterrupt:
        logger.info("사용자 중단 요청")
        sys.exit(0)
    except Exception as exc:
        logger.error("파이프라인 실행 실패: %s", str(exc), exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
