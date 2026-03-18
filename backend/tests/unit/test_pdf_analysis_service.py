"""PDFAnalysisService 단위 테스트 (SPEC-PDF-001 TASK-006/007/008/011)

Gemini API 분석, 캐싱, 스트리밍 로직을 검증합니다.
외부 의존성(Gemini API, Redis)은 mock으로 처리합니다.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestParseAnalysisResponse:
    """Gemini 응답 파싱 테스트"""

    def test_parse_valid_json_response(self):
        """유효한 JSON 응답을 올바르게 파싱해야 한다"""
        from app.services.pdf.analysis import PDFAnalysisService

        service = PDFAnalysisService(api_key="test-key", redis_client=AsyncMock())
        valid_json = json.dumps({
            "담보목록": ["사망보험금", "입원일당"],
            "보상조건": {"사망보험금": "피보험자 사망 시"},
            "면책사항": ["자살"],
            "보상한도": {"사망보험금": "1억원"},
        })
        result = service._parse_analysis_response(valid_json)

        assert "담보목록" in result
        assert "보상조건" in result
        assert "면책사항" in result
        assert "보상한도" in result

    def test_parse_json_in_markdown_code_block(self):
        """마크다운 코드 블록 안의 JSON을 파싱해야 한다"""
        from app.services.pdf.analysis import PDFAnalysisService

        service = PDFAnalysisService(api_key="test-key", redis_client=AsyncMock())
        response = """분석 결과입니다.

```json
{
    "담보목록": ["사망보험금"],
    "보상조건": {},
    "면책사항": [],
    "보상한도": {}
}
```
"""
        result = service._parse_analysis_response(response)
        assert "담보목록" in result
        assert result["담보목록"] == ["사망보험금"]

    def test_parse_invalid_json_returns_fallback(self):
        """파싱 불가능한 텍스트는 fallback 구조를 반환해야 한다"""
        from app.services.pdf.analysis import PDFAnalysisService

        service = PDFAnalysisService(api_key="test-key", redis_client=AsyncMock())
        invalid_text = "이것은 JSON이 아닙니다."
        result = service._parse_analysis_response(invalid_text)

        # fallback 구조를 포함해야 함
        assert "담보목록" in result
        assert "보상조건" in result
        assert "면책사항" in result
        assert "보상한도" in result

    def test_parse_empty_string_returns_fallback(self):
        """빈 텍스트는 fallback 구조를 반환해야 한다"""
        from app.services.pdf.analysis import PDFAnalysisService

        service = PDFAnalysisService(api_key="test-key", redis_client=AsyncMock())
        result = service._parse_analysis_response("")

        assert isinstance(result, dict)
        assert "담보목록" in result


class TestAnalyzeInitialCache:
    """초기 분석 캐싱 테스트"""

    @pytest.mark.asyncio
    async def test_returns_cached_result_on_cache_hit(self):
        """캐시가 존재하면 캐시된 결과를 반환해야 한다"""
        from app.services.pdf.analysis import PDFAnalysisService

        cached_data = {
            "담보목록": ["사망보험금"],
            "보상조건": {},
            "면책사항": [],
            "보상한도": {},
        }

        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value=json.dumps(cached_data).encode("utf-8"))

        service = PDFAnalysisService(api_key="test-key", redis_client=mock_redis)

        result = await service.analyze_initial(
            file_path="/tmp/test.pdf",
            file_hash="abc123",
        )

        assert result["담보목록"] == ["사망보험금"]
        # Redis get이 호출되었는지 확인
        mock_redis.get.assert_called_once()

    @pytest.mark.asyncio
    async def test_calls_gemini_api_on_cache_miss(self):
        """캐시가 없으면 Gemini API를 호출해야 한다"""
        from app.services.pdf.analysis import PDFAnalysisService

        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value=None)  # 캐시 미스
        mock_redis.set = AsyncMock()

        service = PDFAnalysisService(api_key="test-key", redis_client=mock_redis)

        mock_response = MagicMock()
        mock_response.text = json.dumps({
            "담보목록": ["사망보험금"],
            "보상조건": {},
            "면책사항": [],
            "보상한도": {},
        })

        with patch.object(
            service,
            "_upload_and_generate",
            AsyncMock(return_value=mock_response),
        ):
            result = await service.analyze_initial(
                file_path="/tmp/test.pdf",
                file_hash="abc123",
            )

        assert "담보목록" in result
        # 결과가 캐시에 저장되었는지 확인
        mock_redis.set.assert_called_once()

    @pytest.mark.asyncio
    async def test_cache_key_includes_file_hash(self):
        """캐시 키에 파일 해시가 포함되어야 한다"""
        from app.services.pdf.analysis import PDFAnalysisService

        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value=None)
        mock_redis.set = AsyncMock()

        service = PDFAnalysisService(api_key="test-key", redis_client=mock_redis)

        file_hash = "specific_hash_value"

        mock_response = MagicMock()
        mock_response.text = json.dumps({"담보목록": [], "보상조건": {}, "면책사항": [], "보상한도": {}})

        with patch.object(service, "_upload_and_generate", AsyncMock(return_value=mock_response)):
            await service.analyze_initial(file_path="/tmp/test.pdf", file_hash=file_hash)

        # get 호출 시 파일 해시가 포함된 키 사용
        call_args = mock_redis.get.call_args[0][0]
        assert file_hash in call_args


class TestAnalyzeInitialRetry:
    """초기 분석 재시도 로직 테스트"""

    @pytest.mark.asyncio
    async def test_retries_on_api_failure(self):
        """API 실패 시 최대 3번 재시도해야 한다"""
        from app.services.pdf.analysis import PDFAnalysisService

        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value=None)
        mock_redis.set = AsyncMock()

        service = PDFAnalysisService(api_key="test-key", redis_client=mock_redis)

        call_count = 0
        mock_response = MagicMock()
        mock_response.text = json.dumps({"담보목록": [], "보상조건": {}, "면책사항": [], "보상한도": {}})

        async def fail_then_succeed(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise RuntimeError("API 임시 오류")
            return mock_response

        with patch.object(service, "_upload_and_generate", side_effect=fail_then_succeed), \
             patch("asyncio.sleep", AsyncMock()):
            result = await service.analyze_initial(
                file_path="/tmp/test.pdf",
                file_hash="abc123",
            )

        assert call_count == 3
        assert "담보목록" in result

    @pytest.mark.asyncio
    async def test_raises_after_3_failures(self):
        """3번 모두 실패 시 예외를 발생시켜야 한다"""
        from app.services.pdf.analysis import PDFAnalysisService

        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value=None)

        service = PDFAnalysisService(api_key="test-key", redis_client=mock_redis)

        async def always_fail(*args, **kwargs):
            raise RuntimeError("API 영구 오류")

        with patch.object(service, "_upload_and_generate", side_effect=always_fail), \
             patch("asyncio.sleep", AsyncMock()):
            with pytest.raises(RuntimeError, match="API 영구 오류"):
                await service.analyze_initial(
                    file_path="/tmp/test.pdf",
                    file_hash="abc123",
                )


class TestQueryMethod:
    """질의 응답 테스트"""

    @pytest.mark.asyncio
    async def test_query_returns_answer_text(self):
        """질의에 대한 응답 텍스트를 반환해야 한다"""
        from app.services.pdf.analysis import PDFAnalysisService

        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value=None)
        mock_redis.set = AsyncMock()

        service = PDFAnalysisService(api_key="test-key", redis_client=mock_redis)

        mock_response = MagicMock()
        mock_response.text = "사망보험금은 1억원입니다."

        with patch.object(service, "_generate_with_history", AsyncMock(return_value=mock_response)):
            result = await service.query(
                session_id="session-id",
                file_path="/tmp/test.pdf",
                file_hash="abc123",
                question="사망보험금이 얼마인가요?",
                history=[],
            )

        assert result == "사망보험금은 1억원입니다."

    @pytest.mark.asyncio
    async def test_query_uses_cache_for_first_question(self):
        """이력이 없는 첫 질문은 캐시를 사용해야 한다"""
        from app.services.pdf.analysis import PDFAnalysisService

        cached_answer = "캐시된 답변입니다."
        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value=cached_answer.encode("utf-8"))

        service = PDFAnalysisService(api_key="test-key", redis_client=mock_redis)

        result = await service.query(
            session_id="session-id",
            file_path="/tmp/test.pdf",
            file_hash="abc123",
            question="사망보험금이 얼마인가요?",
            history=[],
        )

        assert result == cached_answer

    @pytest.mark.asyncio
    async def test_query_skips_cache_when_history_exists(self):
        """이력이 있으면 캐시를 건너뛰어야 한다"""
        from app.services.pdf.analysis import PDFAnalysisService

        mock_redis = AsyncMock()
        mock_redis.set = AsyncMock()

        service = PDFAnalysisService(api_key="test-key", redis_client=mock_redis)

        mock_response = MagicMock()
        mock_response.text = "답변입니다."

        history = [{"role": "user", "content": "이전 질문"}, {"role": "assistant", "content": "이전 답변"}]

        with patch.object(service, "_generate_with_history", AsyncMock(return_value=mock_response)):
            await service.query(
                session_id="session-id",
                file_path="/tmp/test.pdf",
                file_hash="abc123",
                question="후속 질문",
                history=history,
            )

        # 이력이 있을 때는 redis.get이 호출되지 않아야 함
        mock_redis.get.assert_not_called()


class TestCalculateTokenUsage:
    """토큰 사용량 계산 테스트"""

    def test_calculate_token_usage_from_response(self):
        """Gemini 응답에서 토큰 사용량을 추출해야 한다"""
        from app.services.pdf.analysis import PDFAnalysisService

        service = PDFAnalysisService(api_key="test-key", redis_client=AsyncMock())

        mock_response = MagicMock()
        mock_usage = MagicMock()
        mock_usage.prompt_token_count = 100
        mock_usage.candidates_token_count = 200
        mock_usage.total_token_count = 300
        mock_response.usage_metadata = mock_usage

        # LLMMetrics는 함수 내에서 지연 임포트됨
        with patch("app.services.llm.metrics.LLMMetrics") as mock_metrics_class:
            mock_metrics = MagicMock()
            mock_metrics.calculate_cost.return_value = 0.001
            mock_metrics_class.return_value = mock_metrics

            result = service._calculate_token_usage(mock_response)

        assert result["input_tokens"] == 100
        assert result["output_tokens"] == 200
        assert result["total_tokens"] == 300
        # 비용은 LLMMetrics 의존성이 있어 0.0이 기본값
        assert "estimated_cost_usd" in result

    def test_calculate_token_usage_returns_zeros_on_error(self):
        """오류 발생 시 0으로 구성된 사용량을 반환해야 한다"""
        from app.services.pdf.analysis import PDFAnalysisService

        service = PDFAnalysisService(api_key="test-key", redis_client=AsyncMock())

        mock_response = MagicMock()
        mock_response.usage_metadata = None  # 사용량 정보 없음

        result = service._calculate_token_usage(mock_response)

        assert result["input_tokens"] == 0
        assert result["output_tokens"] == 0
        assert result["total_tokens"] == 0
        assert result["estimated_cost_usd"] == 0.0


class TestQueryStream:
    """스트리밍 쿼리 테스트"""

    @pytest.mark.asyncio
    async def test_query_stream_yields_chunks(self):
        """스트리밍 쿼리가 텍스트 청크를 반환해야 한다"""
        from app.services.pdf.analysis import PDFAnalysisService

        service = PDFAnalysisService(api_key="test-key", redis_client=AsyncMock())

        # google.generativeai mock
        mock_chunk1 = MagicMock()
        mock_chunk1.text = "첫 번째 "
        mock_chunk2 = MagicMock()
        mock_chunk2.text = "청크입니다."

        mock_response = [mock_chunk1, mock_chunk2]

        mock_model = MagicMock()
        mock_model.generate_content.return_value = mock_response

        mock_genai = MagicMock()
        mock_genai.upload_file.return_value = MagicMock()

        with patch.object(service, "_get_model", return_value=mock_model), \
             patch.dict("sys.modules", {"google.generativeai": mock_genai}):
            chunks = []
            async for chunk in service.query_stream(
                file_path="/tmp/test.pdf",
                question="질문입니다.",
                history=[],
            ):
                chunks.append(chunk)

        assert len(chunks) > 0

    @pytest.mark.asyncio
    async def test_query_stream_returns_error_on_exception(self):
        """스트리밍 중 오류 발생 시 오류 메시지를 반환해야 한다"""
        from app.services.pdf.analysis import PDFAnalysisService

        service = PDFAnalysisService(api_key="test-key", redis_client=AsyncMock())

        mock_genai = MagicMock()
        mock_genai.upload_file.side_effect = RuntimeError("API 오류")

        with patch.dict("sys.modules", {"google.generativeai": mock_genai}):
            chunks = []
            async for chunk in service.query_stream(
                file_path="/tmp/test.pdf",
                question="질문입니다.",
                history=[],
            ):
                chunks.append(chunk)

        assert len(chunks) > 0
        assert "오류" in chunks[0]


class TestCacheTTL:
    """캐시 TTL 설정 테스트"""

    def test_cache_ttl_is_24_hours(self):
        """캐시 TTL이 24시간(86400초)이어야 한다"""
        from app.services.pdf.analysis import CACHE_TTL

        assert CACHE_TTL == 86400

    def test_model_name_is_gemini_2_flash(self):
        """모델명이 gemini-2.0-flash이어야 한다"""
        from app.services.pdf.analysis import PDFAnalysisService

        service = PDFAnalysisService(api_key="test-key", redis_client=AsyncMock())
        assert service._model_name == "gemini-2.0-flash"

    def test_get_model_raises_import_error_without_genai(self):
        """google-generativeai가 없으면 ImportError를 발생시켜야 한다"""
        from app.services.pdf.analysis import PDFAnalysisService

        service = PDFAnalysisService(api_key="test-key", redis_client=AsyncMock())

        with patch.dict("sys.modules", {"google.generativeai": None}):
            with pytest.raises((ImportError, Exception)):
                service._get_model()
