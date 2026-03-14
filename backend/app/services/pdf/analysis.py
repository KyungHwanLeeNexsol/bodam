"""PDF 분석 서비스 (SPEC-PDF-001 TASK-006/007/008/011)

Google Gemini API를 사용하여 PDF 보험 약관을 분석합니다.
Redis 캐싱으로 중복 API 호출을 방지합니다.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from collections.abc import AsyncGenerator
from typing import Any

logger = logging.getLogger(__name__)

# 초기 분석 프롬프트 템플릿
INITIAL_ANALYSIS_PROMPT = """
이 보험 약관 PDF를 분석하여 다음 항목을 JSON 형식으로 정리해주세요:

1. 담보목록: 보장하는 항목들의 목록
2. 보상조건: 각 담보에 대한 보상 조건
3. 면책사항: 보상하지 않는 사항들
4. 보상한도: 각 담보의 보상 한도액

반드시 아래 JSON 형식으로만 응답하세요:
{
    "담보목록": ["항목1", "항목2", ...],
    "보상조건": {"항목1": "조건 설명", ...},
    "면책사항": ["사항1", "사항2", ...],
    "보상한도": {"항목1": "한도액", ...}
}
"""

CACHE_TTL = 86400  # 24시간


class PDFAnalysisService:
    """PDF 분석 서비스

    Gemini API를 사용하여 보험 약관 PDF를 분석하고
    Redis 캐싱으로 중복 호출을 방지합니다.
    """

    def __init__(self, api_key: str, redis_client: Any) -> None:
        """초기화

        Args:
            api_key: Gemini API 키
            redis_client: Redis 클라이언트 (aioredis 호환)
        """
        self._api_key = api_key
        self.redis = redis_client
        self._model_name = "gemini-2.0-flash"

    def _get_model(self) -> Any:
        """Gemini 모델 인스턴스 반환 (지연 초기화)"""
        try:
            import google.generativeai as genai
            genai.configure(api_key=self._api_key)
            return genai.GenerativeModel(self._model_name)
        except ImportError:
            raise ImportError("google-generativeai 패키지가 필요합니다.")

    async def _upload_and_generate(self, file_path: str, prompt: str) -> Any:
        """PDF를 Gemini Files API에 업로드하고 생성 요청

        Args:
            file_path: PDF 파일 경로
            prompt: 분석 프롬프트

        Returns:
            Gemini API 응답 객체
        """
        import google.generativeai as genai

        # 파일 업로드는 동기 작업이므로 executor에서 실행
        loop = asyncio.get_event_loop()

        def _sync_upload_and_generate():
            uploaded_file = genai.upload_file(
                path=file_path,
                mime_type="application/pdf",
            )
            model = self._get_model()
            return model.generate_content([uploaded_file, prompt])

        return await loop.run_in_executor(None, _sync_upload_and_generate)

    async def _generate_with_history(
        self,
        file_path: str,
        question: str,
        history: list[dict],
    ) -> Any:
        """대화 이력과 함께 질의 생성

        Args:
            file_path: PDF 파일 경로
            question: 사용자 질문
            history: 이전 대화 이력

        Returns:
            Gemini API 응답 객체
        """
        import google.generativeai as genai

        loop = asyncio.get_event_loop()

        def _sync_generate():
            uploaded_file = genai.upload_file(
                path=file_path,
                mime_type="application/pdf",
            )

            # 대화 이력 구성
            contents = [uploaded_file]
            for msg in history:
                contents.append(f"{msg['role']}: {msg['content']}")
            contents.append(f"user: {question}")

            model = self._get_model()
            return model.generate_content(contents)

        return await loop.run_in_executor(None, _sync_generate)

    async def analyze_initial(self, file_path: str, file_hash: str) -> dict:
        """PDF 초기 보장 분석

        캐시를 먼저 확인하고, 캐시 미스 시 Gemini API를 호출합니다.
        최대 3번 재시도합니다.

        Args:
            file_path: PDF 파일 경로
            file_hash: 파일 SHA256 해시 (캐시 키 생성에 사용)

        Returns:
            구조화된 보장 분석 결과 딕셔너리
        """
        cache_key = f"pdf:{file_hash}:initial"

        # 캐시 확인
        cached = await self.redis.get(cache_key)
        if cached:
            logger.info("캐시 히트: 초기 분석 결과 반환")
            return json.loads(cached)

        # Gemini API 호출 (재시도 로직 포함)
        last_error = None
        for attempt in range(3):
            try:
                response = await self._upload_and_generate(
                    file_path=file_path,
                    prompt=INITIAL_ANALYSIS_PROMPT,
                )
                break
            except Exception as e:
                last_error = e
                if attempt < 2:
                    wait_time = min(2 ** attempt, 10)
                    await asyncio.sleep(wait_time)
                    continue
                raise last_error

        # 응답 파싱
        result = self._parse_analysis_response(response.text)

        # 캐시 저장
        await self.redis.set(
            cache_key,
            json.dumps(result, ensure_ascii=False),
            ex=CACHE_TTL,
        )

        logger.info("초기 분석 완료")
        return result

    def _parse_analysis_response(self, text: str) -> dict:
        """Gemini 응답 텍스트를 딕셔너리로 파싱

        Args:
            text: Gemini 응답 텍스트

        Returns:
            파싱된 딕셔너리
        """
        try:
            import re
            json_match = re.search(r"```json\s*(.*?)\s*```", text, re.DOTALL)
            if json_match:
                return json.loads(json_match.group(1))

            text = text.strip()
            if text.startswith("{"):
                return json.loads(text)

            return {
                "담보목록": [],
                "보상조건": {},
                "면책사항": [],
                "보상한도": {},
                "raw_response": text,
            }
        except (json.JSONDecodeError, ValueError):
            return {
                "담보목록": [],
                "보상조건": {},
                "면책사항": [],
                "보상한도": {},
                "raw_response": text,
            }

    async def query(
        self,
        session_id: str,
        file_path: str,
        file_hash: str,
        question: str,
        history: list[dict],
    ) -> str:
        """보험 약관 질의 응답

        Args:
            session_id: 세션 ID
            file_path: PDF 파일 경로
            file_hash: 파일 해시 (캐시 키)
            question: 사용자 질문
            history: 이전 대화 이력

        Returns:
            AI 응답 텍스트
        """
        # 쿼리 캐시: 이력 없는 첫 질문만 캐시
        if not history:
            question_hash = hashlib.md5(question.encode()).hexdigest()  # noqa: S324
            cache_key = f"pdf:{file_hash}:q:{question_hash}"

            cached = await self.redis.get(cache_key)
            if cached:
                return cached.decode("utf-8")

        # 재시도 로직 포함 API 호출
        last_error = None
        for attempt in range(3):
            try:
                response = await self._generate_with_history(
                    file_path=file_path,
                    question=question,
                    history=history,
                )
                break
            except Exception as e:
                last_error = e
                if attempt < 2:
                    wait_time = min(2 ** attempt, 10)
                    await asyncio.sleep(wait_time)
                    continue
                raise last_error

        answer = response.text

        # 첫 질문만 캐시
        if not history:
            await self.redis.set(cache_key, answer.encode("utf-8"), ex=CACHE_TTL)

        return answer

    async def query_stream(
        self,
        file_path: str,
        question: str,
        history: list[dict],
    ) -> AsyncGenerator[str]:
        """보험 약관 질의 스트리밍 응답

        Args:
            file_path: PDF 파일 경로
            question: 사용자 질문
            history: 이전 대화 이력

        Yields:
            응답 텍스트 청크
        """
        import google.generativeai as genai

        try:
            uploaded_file = genai.upload_file(
                path=file_path,
                mime_type="application/pdf",
            )

            contents = [uploaded_file]
            for msg in history:
                contents.append(f"{msg['role']}: {msg['content']}")
            contents.append(f"user: {question}")

            model = self._get_model()
            response = model.generate_content(contents, stream=True)
            for chunk in response:
                if chunk.text:
                    yield chunk.text
        except Exception as e:
            logger.error("스트리밍 응답 생성 오류: %s", str(e))
            yield f"오류가 발생했습니다: {str(e)}"

    def _calculate_token_usage(self, response: Any) -> dict:
        """토큰 사용량 계산

        Gemini API 응답에서 토큰 사용량을 추출합니다.

        Args:
            response: Gemini API 응답 객체

        Returns:
            토큰 사용량 딕셔너리
        """
        try:
            usage = response.usage_metadata
            input_tokens = getattr(usage, "prompt_token_count", 0) or 0
            output_tokens = getattr(usage, "candidates_token_count", 0) or 0
            total_tokens = getattr(usage, "total_token_count", 0) or (input_tokens + output_tokens)

            from app.services.llm.metrics import LLMMetrics

            metrics = LLMMetrics()
            cost = metrics.calculate_cost(
                model="gemini-2.0-flash",
                input_tokens=input_tokens,
                output_tokens=output_tokens,
            )

            return {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": total_tokens,
                "estimated_cost_usd": cost,
            }
        except Exception:
            return {
                "input_tokens": 0,
                "output_tokens": 0,
                "total_tokens": 0,
                "estimated_cost_usd": 0.0,
            }
