"""비동기 유틸리티 모듈 (SPEC-CRAWLER-001)

Celery 워커(동기 컨텍스트)에서 async 함수를 실행하기 위한 헬퍼.
embedding_tasks.py와 crawler_tasks.py에서 공통으로 사용.
"""

from __future__ import annotations

import asyncio
from collections.abc import Coroutine
from typing import Any


def _run_async(coro: Coroutine[Any, Any, Any]) -> Any:
    """비동기 코루틴을 동기 컨텍스트에서 실행하는 헬퍼

    Celery 워커(동기)에서 async 함수를 실행할 때 사용.
    이미 실행 중인 이벤트 루프가 있으면 새 스레드에서 실행.

    Args:
        coro: 실행할 코루틴

    Returns:
        코루틴의 반환값
    """
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # 이미 실행 중인 이벤트 루프가 있으면 새 루프 생성
            import concurrent.futures

            with concurrent.futures.ThreadPoolExecutor() as pool:
                future = pool.submit(asyncio.run, coro)
                return future.result()
        return loop.run_until_complete(coro)
    except RuntimeError:
        return asyncio.run(coro)
