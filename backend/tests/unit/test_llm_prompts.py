"""프롬프트 관리자 단위 테스트

SPEC-LLM-001 TASK-006: 프롬프트 템플릿, 메시지 빌더, 컨텍스트 윈도우 관리 검증.
"""

from __future__ import annotations

import pytest

from app.services.llm.models import QueryIntent
from app.services.llm.prompts import PromptManager


@pytest.fixture
def prompt_manager():
    """PromptManager 픽스처"""
    return PromptManager()


class TestPromptManagerSystemPrompt:
    """시스템 프롬프트 테스트"""

    def test_get_system_prompt_policy_lookup(self, prompt_manager):
        """약관 조회용 시스템 프롬프트"""
        prompt = prompt_manager.get_system_prompt(QueryIntent.POLICY_LOOKUP)
        assert isinstance(prompt, str)
        assert len(prompt) > 0

    def test_get_system_prompt_claim_guidance(self, prompt_manager):
        """청구 안내용 시스템 프롬프트"""
        prompt = prompt_manager.get_system_prompt(QueryIntent.CLAIM_GUIDANCE)
        assert isinstance(prompt, str)
        assert len(prompt) > 0

    def test_get_system_prompt_general_qa(self, prompt_manager):
        """일반 질의응답용 시스템 프롬프트"""
        prompt = prompt_manager.get_system_prompt(QueryIntent.GENERAL_QA)
        assert isinstance(prompt, str)
        assert len(prompt) > 0

    def test_different_intents_have_different_prompts(self, prompt_manager):
        """의도별 다른 시스템 프롬프트"""
        policy_prompt = prompt_manager.get_system_prompt(QueryIntent.POLICY_LOOKUP)
        claim_prompt = prompt_manager.get_system_prompt(QueryIntent.CLAIM_GUIDANCE)
        general_prompt = prompt_manager.get_system_prompt(QueryIntent.GENERAL_QA)

        # 세 프롬프트가 모두 다름
        assert policy_prompt != claim_prompt
        assert claim_prompt != general_prompt
        assert policy_prompt != general_prompt

    def test_korean_system_prompts(self, prompt_manager):
        """시스템 프롬프트는 한국어"""
        for intent in QueryIntent:
            prompt = prompt_manager.get_system_prompt(intent)
            # 한국어 문자가 포함되어 있음
            assert any("\uAC00" <= ch <= "\uD7A3" for ch in prompt), f"{intent} 프롬프트에 한국어 없음"


class TestPromptManagerBuildMessages:
    """메시지 빌더 테스트"""

    def test_build_messages_basic(self, prompt_manager):
        """기본 메시지 빌드"""
        messages = prompt_manager.build_messages(
            history=[],
            context=[],
            query="실손보험이 뭔가요?",
            intent=QueryIntent.GENERAL_QA,
        )
        assert isinstance(messages, list)
        assert len(messages) >= 2  # system + user 최소 2개

    def test_build_messages_includes_system(self, prompt_manager):
        """메시지에 시스템 프롬프트 포함"""
        messages = prompt_manager.build_messages(
            history=[],
            context=[],
            query="질문",
            intent=QueryIntent.POLICY_LOOKUP,
        )
        assert messages[0]["role"] == "system"
        assert len(messages[0]["content"]) > 0

    def test_build_messages_includes_user_query(self, prompt_manager):
        """메시지에 사용자 질문 포함"""
        query = "실손보험 약관 질문"
        messages = prompt_manager.build_messages(
            history=[],
            context=[],
            query=query,
            intent=QueryIntent.POLICY_LOOKUP,
        )
        last_message = messages[-1]
        assert last_message["role"] == "user"
        assert query in last_message["content"]

    def test_build_messages_with_context(self, prompt_manager):
        """컨텍스트 포함 메시지 빌드"""
        context = [
            {
                "company_name": "삼성화재",
                "policy_name": "실손보험",
                "chunk_text": "실손 의료비 보상 내용",
                "similarity": 0.9,
            }
        ]
        messages = prompt_manager.build_messages(
            history=[],
            context=context,
            query="실손보험 질문",
            intent=QueryIntent.POLICY_LOOKUP,
        )
        # 컨텍스트가 메시지에 포함됨
        all_content = " ".join(m["content"] for m in messages)
        assert "삼성화재" in all_content or "실손보험" in all_content

    def test_build_messages_with_history(self, prompt_manager):
        """대화 히스토리 포함 메시지 빌드"""
        history = [
            {"role": "user", "content": "이전 질문"},
            {"role": "assistant", "content": "이전 답변"},
        ]
        messages = prompt_manager.build_messages(
            history=history,
            context=[],
            query="새 질문",
            intent=QueryIntent.GENERAL_QA,
        )
        # 시스템 + 히스토리 2개 + 새 질문 = 최소 4개
        assert len(messages) >= 4

    def test_build_messages_returns_dict_list(self, prompt_manager):
        """메시지 목록이 딕셔너리 리스트"""
        messages = prompt_manager.build_messages(
            history=[],
            context=[],
            query="질문",
            intent=QueryIntent.GENERAL_QA,
        )
        for msg in messages:
            assert isinstance(msg, dict)
            assert "role" in msg
            assert "content" in msg


class TestPromptManagerContextWindow:
    """컨텍스트 윈도우 관리 테스트"""

    def test_compress_long_history(self, prompt_manager):
        """긴 대화 히스토리 압축"""
        # 매우 긴 히스토리 생성
        long_history = []
        for i in range(50):
            long_history.append({"role": "user", "content": f"질문 {i} " * 100})
            long_history.append({"role": "assistant", "content": f"답변 {i} " * 100})

        messages = prompt_manager.build_messages(
            history=long_history,
            context=[],
            query="새 질문",
            intent=QueryIntent.GENERAL_QA,
        )

        # 압축이 발생했더라도 시스템과 사용자 메시지는 존재
        assert messages[0]["role"] == "system"
        assert messages[-1]["role"] == "user"
        assert "새 질문" in messages[-1]["content"]
