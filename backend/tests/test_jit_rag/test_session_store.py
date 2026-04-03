"""JIT RAG 세션 스토어 테스트 (SPEC-JIT-001)

Redis 기반 JIT 문서 세션 저장/조회/삭제 테스트.
fakeredis를 사용하여 실제 Redis 없이 테스트.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import fakeredis.aioredis
import pytest

from app.services.jit_rag.session_store import JITSessionStore
from app.services.jit_rag.models import DocumentData, Section


@pytest.fixture
def fake_redis():
    """fakeredis 비동기 클라이언트 픽스처"""
    return fakeredis.aioredis.FakeRedis(decode_responses=False)


@pytest.fixture
def session_store(fake_redis):
    """JITSessionStore 인스턴스 (fakeredis 주입)"""
    return JITSessionStore(redis_client=fake_redis)


@pytest.fixture
def sample_document():
    """테스트용 DocumentData 샘플"""
    return DocumentData(
        product_name="삼성화재 운전자보험",
        source_url="https://www.samsungfire.com/sample.pdf",
        source_type="pdf",
        sections=[
            Section(
                title="제1조 보험금 지급",
                content="보험회사는 피보험자에게 보험금을 지급합니다.",
                page_number=1,
                section_number=1,
            ),
            Section(
                title="제2조 면책조항",
                content="다음의 경우에는 보험금을 지급하지 않습니다.",
                page_number=2,
                section_number=2,
            ),
        ],
        extracted_at="2024-01-01T00:00:00",
        page_count=10,
    )


@pytest.mark.asyncio
async def test_save_and_get_document(session_store, sample_document):
    """문서 저장 후 동일 내용으로 조회되어야 한다"""
    session_id = "test-session-001"

    await session_store.save(session_id, sample_document)
    retrieved = await session_store.get(session_id)

    assert retrieved is not None
    assert retrieved.product_name == sample_document.product_name
    assert retrieved.source_url == sample_document.source_url
    assert retrieved.source_type == sample_document.source_type
    assert len(retrieved.sections) == 2
    assert retrieved.sections[0].title == "제1조 보험금 지급"
    assert retrieved.page_count == 10


@pytest.mark.asyncio
async def test_get_nonexistent_returns_none(session_store):
    """존재하지 않는 세션 조회 시 None을 반환해야 한다"""
    result = await session_store.get("nonexistent-session-999")
    assert result is None


@pytest.mark.asyncio
async def test_delete_document(session_store, sample_document):
    """문서 삭제 후 조회 시 None을 반환해야 한다"""
    session_id = "test-session-delete"

    await session_store.save(session_id, sample_document)
    assert await session_store.get(session_id) is not None

    await session_store.delete(session_id)
    assert await session_store.get(session_id) is None


@pytest.mark.asyncio
async def test_ttl_set_on_save(session_store, sample_document, fake_redis):
    """저장 시 TTL이 설정되어야 한다 (3600초)"""
    session_id = "test-session-ttl"

    await session_store.save(session_id, sample_document)

    # fakeredis에서 TTL 확인
    key = f"jit_doc:{session_id}"
    ttl = await fake_redis.ttl(key)
    # TTL이 0보다 크면 만료 설정이 된 것 (fakeredis는 실제 TTL 값을 반환)
    assert ttl > 0
    assert ttl <= 3600


@pytest.mark.asyncio
async def test_save_overwrites_existing(session_store, sample_document):
    """동일 세션 ID로 재저장 시 덮어쓰기가 되어야 한다"""
    session_id = "test-session-overwrite"

    await session_store.save(session_id, sample_document)

    # 수정된 문서로 덮어쓰기
    updated_doc = sample_document.model_copy(
        update={"product_name": "현대해상 운전자보험"}
    )
    await session_store.save(session_id, updated_doc)

    retrieved = await session_store.get(session_id)
    assert retrieved is not None
    assert retrieved.product_name == "현대해상 운전자보험"
