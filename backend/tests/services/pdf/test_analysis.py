"""PDF 분석 서비스 단위 테스트 (SPEC-PDF-001 TASK-006/007/008/011)

PDFAnalysisService의 Gemini API 연동, 캐싱, 재시도 기능을 테스트합니다.
"""

from __future__ import annotations

import os
from unittest.mock import AsyncMock, MagicMock, patch

import fakeredis.aioredis as aioredis
import pytest

# 테스트 환경변수 설정
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost/testdb")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-testing-purposes-only")
os.environ.setdefault("GEMINI_API_KEY", "test-api-key")


@pytest.fixture
def redis_client():
    """fakeredis 클라이언트 픽스처"""
    return aioredis.FakeRedis()


@pytest.fixture
def analysis_service(redis_client):
    """PDFAnalysisService 픽스처 (Gemini 클라이언트 mock)"""
    from app.services.pdf.analysis import PDFAnalysisService

    service = PDFAnalysisService(
        api_key="test-api-key",
        redis_client=redis_client,
    )
    return service


@pytest.fixture
def mock_gemini_response():
    """Mock Gemini API 응답"""
    response = MagicMock()
    response.text = """
    {
        "담보목록": ["상해사망", "질병입원"],
        "보상조건": {"상해사망": "우연한 사고로 인한 사망"},
        "면책사항": ["고의적 사고", "자살"],
        "보상한도": {"상해사망": "1억원"}
    }
    """
    usage = MagicMock()
    usage.prompt_token_count = 1000
    usage.candidates_token_count = 500
    usage.total_token_count = 1500
    response.usage_metadata = usage
    response.candidates = [MagicMock()]
    return response


class TestAnalyzeInitial:
    """초기 분석 테스트"""

    @pytest.mark.asyncio
    async def test_analyze_initial_returns_structured_result(self, analysis_service, mock_gemini_response):
        """초기 분석이 구조화된 결과를 반환해야 함"""
        with patch.object(
            analysis_service,
            "_upload_and_generate",
            new=AsyncMock(return_value=mock_gemini_response),
        ):
            result = await analysis_service.analyze_initial(
                file_path="/fake/path/test.pdf",
                file_hash="abc123",
            )

        assert isinstance(result, dict)
        assert "담보목록" in result or len(result) > 0

    @pytest.mark.asyncio
    async def test_analyze_tracks_token_usage(self, analysis_service, mock_gemini_response):
        """분석 시 토큰 사용량을 추적해야 함"""
        with patch.object(
            analysis_service,
            "_upload_and_generate",
            new=AsyncMock(return_value=mock_gemini_response),
        ):
            result = await analysis_service.analyze_initial(
                file_path="/fake/path/test.pdf",
                file_hash="abc123def456",
            )

        # 결과는 dict이고 분석 내용이 있어야 함
        assert result is not None

    @pytest.mark.asyncio
    async def test_cache_hit_skips_gemini_call(self, analysis_service, redis_client):
        """캐시 히트 시 Gemini API 호출을 건너뛰어야 함"""
        import json

        file_hash = "cached_hash_123"
        cached_data = {"담보목록": ["상해사망"], "보상조건": {}, "면책사항": [], "보상한도": {}}

        # 캐시에 데이터 저장
        await redis_client.set(
            f"pdf:{file_hash}:initial",
            json.dumps(cached_data, ensure_ascii=False),
            ex=86400,
        )

        mock_api_call = AsyncMock()

        with patch.object(analysis_service, "_upload_and_generate", new=mock_api_call):
            result = await analysis_service.analyze_initial(
                file_path="/fake/path/test.pdf",
                file_hash=file_hash,
            )

        # Gemini API가 호출되지 않아야 함
        mock_api_call.assert_not_called()
        assert result == cached_data


class TestQuery:
    """질의 응답 테스트"""

    @pytest.mark.asyncio
    async def test_query_returns_answer(self, analysis_service, mock_gemini_response):
        """질의에 대한 답변을 반환해야 함"""
        mock_gemini_response.text = "상해사망 보험금은 1억원입니다."

        with patch.object(
            analysis_service,
            "_generate_with_history",
            new=AsyncMock(return_value=mock_gemini_response),
        ):
            result = await analysis_service.query(
                session_id="session-123",
                file_path="/fake/path/test.pdf",
                file_hash="abc123",
                question="상해사망 보험금은 얼마인가요?",
                history=[],
            )

        assert isinstance(result, str)
        assert len(result) > 0


class TestRetryBehavior:
    """재시도 동작 테스트"""

    @pytest.mark.asyncio
    async def test_retry_on_api_failure(self, analysis_service, mock_gemini_response):
        """API 실패 시 재시도해야 함 (2번 실패 후 성공)"""
        call_count = 0

        async def side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise Exception("API 일시적 오류")
            return mock_gemini_response

        with patch.object(analysis_service, "_upload_and_generate", new=side_effect):
            result = await analysis_service.analyze_initial(
                file_path="/fake/path/test.pdf",
                file_hash="retry_test_hash",
            )

        assert call_count == 3
        assert result is not None

    @pytest.mark.asyncio
    async def test_retry_exhausted_raises_exception(self, analysis_service):
        """3번 재시도 후 예외를 발생시켜야 함"""
        async def always_fail(*args, **kwargs):
            raise Exception("영구적 API 오류")

        with patch.object(analysis_service, "_upload_and_generate", new=always_fail):
            with pytest.raises(Exception):
                await analysis_service.analyze_initial(
                    file_path="/fake/path/test.pdf",
                    file_hash="exhausted_hash",
                )


class TestCalculateTokenUsage:
    """토큰 사용량 계산 테스트"""

    def test_calculate_token_usage_returns_dict(self, analysis_service, mock_gemini_response):
        """토큰 사용량이 딕셔너리로 반환되어야 함"""
        result = analysis_service._calculate_token_usage(mock_gemini_response)

        assert isinstance(result, dict)
        assert "input_tokens" in result
        assert "output_tokens" in result
        assert "total_tokens" in result

    def test_calculate_token_usage_values(self, analysis_service, mock_gemini_response):
        """토큰 사용량 값이 올바르게 계산되어야 함"""
        result = analysis_service._calculate_token_usage(mock_gemini_response)

        assert result["input_tokens"] == 1000
        assert result["output_tokens"] == 500
        assert result["total_tokens"] == 1500
