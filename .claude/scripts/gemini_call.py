#!/usr/bin/env python3
"""Gemini API 브릿지 스크립트

MoAI 에이전트가 Gemini 강점 작업을 위임할 때 사용하는 브릿지.
uv run으로 실행: uv run --with google-genai .claude/scripts/gemini_call.py

환경변수:
    GEMINI_API_KEY: Google AI API 키 (필수)

사용법:
    # 프롬프트 직접 전달
    uv run --with google-genai .claude/scripts/gemini_call.py --prompt "코드 분석해줘"

    # 파일 컨텍스트와 함께
    uv run --with google-genai .claude/scripts/gemini_call.py --prompt "이 코드를 분석해줘" --files src/main.py src/utils.py

    # 파이프로 프롬프트 전달
    echo "분석해줘" | uv run --with google-genai .claude/scripts/gemini_call.py --files src/main.py

    # 모델 선택
    uv run --with google-genai .claude/scripts/gemini_call.py --model gemini-2.5-pro --prompt "복잡한 분석"
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def read_files(file_paths: list[str]) -> str:
    """파일 내용을 읽어서 컨텍스트 문자열로 반환"""
    parts = []
    for fp in file_paths:
        p = Path(fp)
        if not p.exists():
            parts.append(f"--- {fp} (파일 없음) ---")
            continue
        try:
            content = p.read_text(encoding="utf-8", errors="replace")
            parts.append(f"--- {fp} ---\n{content}")
        except Exception as e:
            parts.append(f"--- {fp} (읽기 오류: {e}) ---")
    return "\n\n".join(parts)


def call_gemini(prompt: str, model: str, files_context: str = "") -> str:
    """Gemini API 호출"""
    from google import genai

    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        return "ERROR: GEMINI_API_KEY 환경변수가 설정되지 않았습니다."

    client = genai.Client(api_key=api_key)

    # 파일 컨텍스트가 있으면 프롬프트에 포함
    full_prompt = prompt
    if files_context:
        full_prompt = f"""다음 파일들을 컨텍스트로 참고하여 작업을 수행하세요.

<files>
{files_context}
</files>

<task>
{prompt}
</task>"""

    response = client.models.generate_content(
        model=model,
        contents=full_prompt,
    )

    return response.text


def main():
    parser = argparse.ArgumentParser(description="Gemini API 브릿지")
    parser.add_argument(
        "--prompt", "-p",
        type=str,
        default="",
        help="Gemini에 보낼 프롬프트 (미지정 시 stdin에서 읽음)",
    )
    parser.add_argument(
        "--files", "-f",
        nargs="*",
        default=[],
        help="컨텍스트로 포함할 파일 경로들",
    )
    parser.add_argument(
        "--model", "-m",
        type=str,
        default="gemini-2.0-flash",
        choices=[
            "gemini-2.5-pro",
            "gemini-2.5-flash",
            "gemini-2.0-flash",
            "gemini-2.0-flash-lite",
        ],
        help="사용할 Gemini 모델 (기본: gemini-2.0-flash)",
    )
    args = parser.parse_args()

    # 프롬프트 결정: --prompt > stdin
    prompt = args.prompt
    if not prompt:
        if not sys.stdin.isatty():
            prompt = sys.stdin.read().strip()
        if not prompt:
            print("ERROR: 프롬프트가 필요합니다. --prompt 또는 stdin으로 전달하세요.", file=sys.stderr)
            sys.exit(1)

    # 파일 컨텍스트 로드
    files_context = ""
    if args.files:
        files_context = read_files(args.files)

    # Gemini 호출
    result = call_gemini(prompt, args.model, files_context)
    print(result)


if __name__ == "__main__":
    main()
