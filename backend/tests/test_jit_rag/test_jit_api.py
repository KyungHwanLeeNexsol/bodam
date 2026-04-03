"""JIT RAG API 엔드포인트 테스트 (SPEC-JIT-001)

/api/v1/jit/ 엔드포인트 통합 테스트.
의존성 오버라이드 방식으로 Redis/DB 없이 테스트.
"""

from __future__ import annotations

import io
import os
import uuid
from unittest.mock import AsyncMock, MagicMock

import pymupdf
import pytest
from httpx import ASGITransport, AsyncClient

# 테스트 환경변수
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost/testdb")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-testing-purposes-only")

from app.services.jit_rag.models import DocumentData, Section


def create_minimal_pdf_bytes() -> bytes:
    """테스트용 최소 PDF 바이트 생성"""
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text(
        (50, 50),
        "Insurance Terms Article 1\nThis insurance covers the insured.",
        fontsize=11,
    )
    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


def make_mock_user():
    """테스트용 사용자 Mock 객체"""
    from app.models.user import User

    user = MagicMock(spec=User)
    user.id = uuid.uuid4()
    user.email = "test@example.com"
    user.is_active = True
    return user


@pytest.fixture
def sample_document_data():
    """테스트용 DocumentData"""
    return DocumentData(
        product_name="테스트 보험",
        source_url="https://example.com/test.pdf",
        source_type="pdf",
        sections=[
            Section(
                title="제1조 보험의 목적",
                content="이 보험은 피보험자를 보상합니다.",
                page_number=1,
                section_number=1,
            )
        ],
        extracted_at="2024-01-01T00:00:00",
        page_count=5,
    )


@pytest.fixture
def mock_current_user():
    return make_mock_user()


@pytest.fixture
def mock_session_store():
    """Mock JITSessionStore"""
    store = MagicMock()
    store.save = AsyncMock(return_value=None)
    store.get = AsyncMock(return_value=None)
    store.delete = AsyncMock(return_value=None)
    return store


@pytest.fixture
async def authenticated_client(mock_current_user, mock_session_store):
    """인증된 JIT API 테스트 클라이언트"""
    from app.api.deps import get_current_user
    from app.api.v1.jit import get_session_store
    from app.main import app

    app.dependency_overrides[get_current_user] = lambda: mock_current_user
    app.dependency_overrides[get_session_store] = lambda: mock_session_store

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client

    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_upload_pdf_success(authenticated_client, mock_session_store):
    """PDF 업로드 성공 시 200과 문서 정보를 반환해야 한다"""
    pdf_bytes = create_minimal_pdf_bytes()

    response = await authenticated_client.post(
        "/api/v1/jit/upload",
        files={"file": ("test.pdf", pdf_bytes, "application/pdf")},
        data={"session_id": "test-session-upload-001"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert "page_count" in body
    assert body["session_id"] == "test-session-upload-001"
    mock_session_store.save.assert_called_once()


@pytest.mark.asyncio
async def test_upload_non_pdf_returns_400(authenticated_client):
    """PDF가 아닌 파일 업로드 시 400을 반환해야 한다"""
    response = await authenticated_client.post(
        "/api/v1/jit/upload",
        files={"file": ("test.txt", b"not a pdf", "text/plain")},
        data={"session_id": "test-session-001"},
    )

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_find_product_not_found_returns_404(authenticated_client):
    """상품명 검색 시 문서를 찾지 못하면 404를 반환해야 한다"""
    from app.services.jit_rag.document_finder import DocumentNotFoundError

    with __import__("unittest.mock", fromlist=["patch"]).patch(
        "app.api.v1.jit.DocumentFinder.find_url",
        new_callable=AsyncMock,
        side_effect=DocumentNotFoundError("not found"),
    ):
        response = await authenticated_client.post(
            "/api/v1/jit/find",
            json={
                "product_name": "존재하지않는보험상품12345",
                "session_id": "test-session-find-001",
            },
        )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_get_document_metadata(
    authenticated_client,
    mock_session_store,
    sample_document_data,
):
    """세션에 문서가 있으면 메타데이터를 반환해야 한다"""
    mock_session_store.get.return_value = sample_document_data
    session_id = "test-session-meta-001"

    response = await authenticated_client.get(
        f"/api/v1/jit/session/{session_id}/document",
    )

    assert response.status_code == 200
    body = response.json()
    assert body["product_name"] == "테스트 보험"
    assert body["page_count"] == 5


@pytest.mark.asyncio
async def test_get_document_metadata_not_found(
    authenticated_client,
    mock_session_store,
):
    """세션에 문서가 없으면 404를 반환해야 한다"""
    mock_session_store.get.return_value = None
    session_id = "nonexistent-session-999"

    response = await authenticated_client.get(
        f"/api/v1/jit/session/{session_id}/document",
    )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_find_product_success(
    authenticated_client,
    mock_session_store,
    sample_document_data,
):
    """상품명 검색 성공 시 문서 정보를 반환해야 한다"""
    from app.services.jit_rag.document_fetcher import FetchResult

    mock_fetch_result = FetchResult(
        content_type="application/pdf",
        data=create_minimal_pdf_bytes(),
        url="https://example.com/test.pdf",
    )

    with (
        __import__("unittest.mock", fromlist=["patch"]).patch(
            "app.api.v1.jit.DocumentFinder.find_url",
            new_callable=AsyncMock,
            return_value="https://example.com/test.pdf",
        ),
        __import__("unittest.mock", fromlist=["patch"]).patch(
            "app.api.v1.jit.DocumentFetcher.fetch",
            new_callable=AsyncMock,
            return_value=mock_fetch_result,
        ),
    ):
        response = await authenticated_client.post(
            "/api/v1/jit/find",
            json={
                "product_name": "삼성화재 운전자보험",
                "session_id": "test-session-find-success",
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert "source_url" in body


@pytest.mark.asyncio
async def test_delete_document(
    authenticated_client,
    mock_session_store,
    sample_document_data,
):
    """문서 삭제 성공 시 {"status": "deleted"}를 반환해야 한다"""
    session_id = "test-session-delete-001"

    response = await authenticated_client.delete(
        f"/api/v1/jit/session/{session_id}/document",
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "deleted"
    mock_session_store.delete.assert_called_once_with(session_id)
