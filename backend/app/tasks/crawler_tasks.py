"""크롤러 Celery 태스크 모듈 (SPEC-CRAWLER-001, SPEC-CRAWLER-002)

crawl_all: 등록된 모든 크롤러 순차 실행 (YAML 기반 자동 등록 포함)
crawl_single: 특정 크롤러 단독 실행
ingest_policy: CrawlResult PDF -> Policy 업데이트 파이프라인
"""

from __future__ import annotations

import logging
import uuid

from app.core.async_utils import _run_async

logger = logging.getLogger(__name__)


async def _run_crawler_async(crawler_name: str) -> dict:
    """단일 크롤러 비동기 실행 (내부 함수)

    DB 세션과 스토리지를 생성 후 크롤러를 실행.
    레지스트리에 인스턴스와 클래스 모두 처리 가능.

    Args:
        crawler_name: 실행할 크롤러 이름

    Returns:
        크롤링 결과 요약 딕셔너리
    """
    from app.core.config import get_settings
    from app.core.database import get_db
    from app.services.crawler.registry import crawler_registry
    from app.services.crawler.storage import create_storage

    settings = get_settings()
    # scan_yaml_configs() 호출 후 인스턴스가 등록되므로 먼저 스토리지 생성
    storage = create_storage(
        backend_type=settings.crawler_storage_backend,
        base_dir=settings.crawler_base_dir,
    )

    # YAML 기반 크롤러 자동 등록 (미등록 상태면 등록)
    crawler_registry.scan_yaml_configs(storage)

    crawler_or_class = crawler_registry.get(crawler_name)

    if crawler_or_class is None:
        raise ValueError(f"크롤러를 찾을 수 없음: {crawler_name!r}")

    async for session in get_db():
        try:
            # 인스턴스인지 클래스인지 판별
            # crawl 메서드가 있으면 인스턴스, 없으면 클래스로 간주
            if callable(crawler_or_class) and not hasattr(crawler_or_class, "crawl"):
                # 클래스 - DB 세션과 스토리지로 인스턴스 생성
                crawler = crawler_or_class(
                    db_session=session,
                    storage=storage,
                    rate_limit_seconds=settings.crawler_rate_limit_seconds,
                    max_retries=settings.crawler_max_retries,
                )
            else:
                # 이미 인스턴스 (scan_yaml_configs로 등록된 경우)
                crawler = crawler_or_class

            result = await crawler.crawl()
            return {
                "crawler_name": crawler_name,
                "total_found": result.total_found,
                "new_count": result.new_count,
                "updated_count": result.updated_count,
                "skipped_count": result.skipped_count,
                "failed_count": result.failed_count,
                "status": "success",
            }
        except Exception as exc:
            logger.error("크롤러 %s 실행 실패: %s", crawler_name, str(exc))
            return {
                "crawler_name": crawler_name,
                "status": "error",
                "error": str(exc),
            }


async def _ingest_policy_async(crawl_result_id: str, pdf_path: str) -> dict:
    """정책 인제스트 비동기 처리 (내부 함수)

    PDF를 DocumentProcessor로 처리하여 PolicyChunk를 생성.

    Args:
        crawl_result_id: CrawlResult UUID
        pdf_path: 처리할 PDF 파일 경로

    Returns:
        처리 결과 딕셔너리
    """
    from sqlalchemy import select

    from app.core.config import get_settings
    from app.core.database import get_db
    from app.models.crawler import CrawlResult
    from app.services.parser.document_processor import DocumentProcessor
    from app.services.parser.pdf_parser import PDFParser
    from app.services.parser.text_chunker import TextChunker
    from app.services.parser.text_cleaner import TextCleaner
    from app.services.rag.embeddings import EmbeddingService

    settings = get_settings()

    async for session in get_db():
        try:
            # CrawlResult 조회
            result = await session.execute(
                select(CrawlResult).where(CrawlResult.id == uuid.UUID(crawl_result_id))
            )
            crawl_result = result.scalar_one_or_none()

            if not crawl_result:
                return {"status": "error", "error": "CrawlResult를 찾을 수 없음"}

            # DocumentProcessor 생성
            embedding_service = EmbeddingService(
                api_key=settings.openai_api_key,
                model=settings.embedding_model,
                dimensions=settings.embedding_dimensions,
            )
            processor = DocumentProcessor(
                embedding_service=embedding_service,
                text_chunker=TextChunker(
                    chunk_size=settings.chunk_size_tokens,
                    chunk_overlap=settings.chunk_overlap_tokens,
                ),
                text_cleaner=TextCleaner(),
                pdf_parser=PDFParser(),
            )

            # PDF 처리
            chunks = await processor.process_pdf(pdf_path)

            return {
                "status": "success",
                "crawl_result_id": crawl_result_id,
                "chunks_count": len(chunks),
            }

        except Exception as exc:
            logger.error("정책 인제스트 실패 (result_id=%s): %s", crawl_result_id, str(exc))
            return {
                "status": "error",
                "crawl_result_id": crawl_result_id,
                "error": str(exc),
            }


# Celery 앱 임포트는 순환 임포트 방지를 위해 지연 임포트
def _get_celery_app():
    from app.core.celery_app import celery_app

    return celery_app


class CrawlAllTask:
    """등록된 모든 크롤러를 순차 실행하는 Celery 태스크

    YAML 기반 크롤러 자동 등록 후, 협회 크롤러(knia/klia) 우선 실행.
    각 크롤러에 대해 CrawlRun을 생성하고 결과를 저장.
    """

    def run(self) -> dict:
        """모든 크롤러 실행

        실행 순서:
        1. YAML 설정 기반 크롤러 자동 등록 (scan_yaml_configs)
        2. 협회 크롤러(knia, klia) 우선 실행 - 중복 감지 기준 데이터 수집
        3. 개별 보험사 크롤러 순차 실행

        Returns:
            전체 실행 결과 요약 딕셔너리
        """
        from app.core.config import get_settings
        from app.services.crawler.registry import crawler_registry
        from app.services.crawler.storage import create_storage

        settings = get_settings()

        # YAML 기반 크롤러 자동 등록
        storage = create_storage(
            backend_type=settings.crawler_storage_backend,
            base_dir=settings.crawler_base_dir,
        )
        crawler_registry.scan_yaml_configs(storage)

        crawler_names = crawler_registry.list_crawlers()
        results = []
        total_new = 0
        total_updated = 0
        total_failed = 0

        # 협회 크롤러 우선 실행 (knia, klia)
        association_names = ["knia", "klia"]
        company_names = [n for n in crawler_names if n not in association_names]
        ordered_names = [n for n in association_names if n in crawler_names] + company_names

        for name in ordered_names:
            try:
                result = _run_async(_run_crawler_async(name))
                results.append(result)
                total_new += result.get("new_count", 0)
                total_updated += result.get("updated_count", 0)
                total_failed += result.get("failed_count", 0)
            except Exception as exc:
                logger.error("크롤러 %s 실행 중 예외: %s", name, str(exc))
                results.append({"crawler_name": name, "status": "error", "error": str(exc)})
                total_failed += 1

        return {
            "crawlers_run": len(ordered_names),
            "total_new": total_new,
            "total_updated": total_updated,
            "total_failed": total_failed,
            "results": results,
        }


class CrawlSingleTask:
    """특정 크롤러 단독 실행 Celery 태스크"""

    def run(self, crawler_name: str) -> dict:
        """특정 크롤러 실행

        Args:
            crawler_name: 실행할 크롤러 이름

        Returns:
            실행 결과 딕셔너리
        """
        try:
            return _run_async(_run_crawler_async(crawler_name))
        except Exception as exc:
            logger.error("크롤러 %s 실행 실패: %s", crawler_name, str(exc))
            return {"status": "error", "error": str(exc)}


class IngestPolicyTask:
    """CrawlResult PDF를 정책으로 인제스트하는 Celery 태스크"""

    def run(self, crawl_result_id: str, pdf_path: str) -> dict:
        """정책 인제스트 실행

        Args:
            crawl_result_id: CrawlResult UUID 문자열
            pdf_path: 처리할 PDF 파일 경로

        Returns:
            처리 결과 딕셔너리
        """
        return _run_async(_ingest_policy_async(crawl_result_id, pdf_path))


# Celery 태스크 등록
def _register_tasks():
    """Celery 앱에 크롤러 태스크 등록 (지연 등록으로 순환 임포트 방지)"""
    celery_app = _get_celery_app()

    @celery_app.task(
        name="app.tasks.crawler_tasks.crawl_all",
        bind=False,
        acks_late=True,
    )
    def crawl_all() -> dict:
        """등록된 모든 크롤러 실행"""
        task = CrawlAllTask()
        return task.run()

    @celery_app.task(
        name="app.tasks.crawler_tasks.crawl_single",
        bind=False,
        acks_late=True,
    )
    def crawl_single(crawler_name: str) -> dict:
        """특정 크롤러 단독 실행"""
        task = CrawlSingleTask()
        return task.run(crawler_name)

    @celery_app.task(
        name="app.tasks.crawler_tasks.ingest_policy",
        bind=False,
        acks_late=True,
    )
    def ingest_policy(crawl_result_id: str, pdf_path: str) -> dict:
        """CrawlResult PDF를 정책으로 인제스트"""
        task = IngestPolicyTask()
        return task.run(crawl_result_id, pdf_path)

    return crawl_all, crawl_single, ingest_policy


crawl_all, crawl_single, ingest_policy = _register_tasks()
